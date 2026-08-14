// ============================================================
// SHOPEE — ĐỒNG BỘ RÚT VÍ (READ-ONLY). Đọc lịch sử giao dịch ví của sàn, lọc ra
// các lệnh RÚT TIỀN thành công rồi ghi vào WalletWithdrawal (source=SYNC) để bảng
// dòng tiền tách "Tiền trên Ví sàn" khỏi "Tiền về Ngân hàng".
//
// AN TOÀN: chỉ ĐỌC (get_wallet_transaction_list) + ghi bản ghi đối soát nội bộ.
// TUYỆT ĐỐI không gọi API chuyển/rút tiền. Idempotent theo (channelId, txnId) nên
// chạy lại bao nhiêu lần cũng không nhân đôi.
//
// TRẠNG THÁI: đã GẮN CRON nhịp giờ trong order-auto-sync.ts (08/08) — lỗi quyền
// ví (nếu app chưa bật) được bắt riêng, không chặn luồng khác. Sandbox không test
// được luồng ví; kiểm chứng bằng shop thật production. Chạy tay khi cần backfill:
// scripts/shopee-sync-withdrawals.ts.
// ============================================================

import type { Channel } from "@prisma/client";
import { WithdrawalSource } from "@prisma/client";
import { prisma } from "../../prisma";
import { getWalletTransactionList, type ShopeeWalletTxn } from "./client";
import { getValidShopeeAccessToken } from "./service";

const DAY_SEC = 24 * 60 * 60;
// Probe production 14/08: cửa sổ 15 ngày bị sàn chê "wallet.time_invalid — time
// period too large"; trần thật KHÔNG công bố trong docs → bắt đầu 7 ngày, còn
// bị chê thì TỰ CHIA ĐÔI thử lại (xem isTimeRangeError), không đoán mò nữa.
const START_WINDOW_SEC = 7 * DAY_SEC;
const MIN_WINDOW_SEC = 6 * 60 * 60; // sàn chê tới mức này thì là lỗi khác, ném ra
const PAGE_SIZE = 40; // TRẦN của get_wallet_transaction_list — quá là sàn báo lỗi
const MAX_PAGES = 200; // chốt chặn phân trang vô tận

/** Sàn chê khoảng thời gian quá dài (trần không công bố) — tín hiệu chia đôi cửa sổ. */
function isTimeRangeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("time_invalid") || msg.includes("time period too large");
}

/** Đây có phải lệnh RÚT TIỀN không (bất kể giai đoạn created/completed). */
function isWithdrawal(txn: ShopeeWalletTxn): boolean {
  return String(txn.transaction_type ?? "").toUpperCase().includes("WITHDRAWAL");
}

/** Quy đổi trạng thái ví của sàn → trạng thái nội bộ (SUCCESS | PENDING | FAILED). */
function mapStatus(raw?: string): "SUCCESS" | "PENDING" | "FAILED" {
  const s = String(raw ?? "").toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS") return "SUCCESS";
  if (s === "FAILED" || s === "CANCELLED" || s === "REJECTED") return "FAILED";
  return "PENDING";
}

export interface SyncWithdrawalsResult {
  fetched: number;
  withdrawals: number; // số lệnh rút nhận diện được
  created: number;
  updated: number;
  pages: number;
  /** Số dư ví THẬT sau giao dịch mới nhất quét được (null = cửa sổ không có giao dịch). */
  walletBalance: number | null;
}

/**
 * Kéo lịch sử ví Shopee của MỘT gian, lọc lệnh rút, upsert vào WalletWithdrawal.
 * Idempotent theo (channelId, externalTxnId=transaction_id).
 */
export async function syncShopeeWithdrawals(
  channel: Channel,
  opts: { daysBack?: number } = {}
): Promise<SyncWithdrawalsResult> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

  const nowSec = Math.floor(Date.now() / 1000);
  const startFrom = nowSec - (opts.daysBack ?? 180) * 24 * 60 * 60;

  const result: SyncWithdrawalsResult = {
    fetched: 0,
    withdrawals: 0,
    created: 0,
    updated: 0,
    pages: 0,
    walletBalance: null,
  };
  // Giao dịch MỚI NHẤT quét được — current_balance của nó = số dư ví thật.
  let latestTxnTime = -1;

  // Cửa sổ TỰ THÍCH ỨNG: gặp "time period too large" thì chia đôi rồi thử lại
  // CÙNG mốc winFrom (chưa tiến), tới MIN_WINDOW_SEC vẫn bị chê thì ném lỗi
  // thật ra ngoài. Upsert idempotent nên trang đã xử lý trước khi lỗi vô hại.
  let winSec = START_WINDOW_SEC;
  let winFrom = startFrom;
  while (winFrom < nowSec && result.pages < MAX_PAGES) {
    const winTo = Math.min(winFrom + winSec, nowSec);
    let pageNo = 0;
    let more = true;

    try {
      while (more && result.pages < MAX_PAGES) {
        const data = await getWalletTransactionList({
          accessToken,
          shopId,
          createTimeFrom: winFrom,
          createTimeTo: winTo,
          pageNo,
          pageSize: PAGE_SIZE,
        });
        result.pages++;

        const list = data.response?.transaction_list ?? [];
        for (const txn of list) {
          result.fetched++;
          // Số dư ví: current_balance của giao dịch mới nhất (mọi loại giao
          // dịch, không riêng lệnh rút) — Shopee không có API số dư riêng.
          if (
            typeof txn.current_balance === "number" &&
            (txn.create_time ?? 0) > latestTxnTime
          ) {
            latestTxnTime = txn.create_time ?? 0;
            result.walletBalance = txn.current_balance;
          }
          if (!isWithdrawal(txn) || txn.transaction_id == null) continue;
          result.withdrawals++;

          const externalTxnId = String(txn.transaction_id);
          const amount = Math.abs(Number(txn.amount ?? 0)) || 0;
          const status = mapStatus(txn.status);
          const transactionTime = txn.create_time
            ? new Date(txn.create_time * 1000)
            : new Date();

          const existing = await prisma.walletWithdrawal.findUnique({
            where: {
              channelId_externalTxnId: { channelId: channel.id, externalTxnId },
            },
            select: { id: true },
          });

          if (existing) {
            // Cập nhật trạng thái/số tiền (vd created → completed) — giữ nguyên bản ghi.
            await prisma.walletWithdrawal.update({
              where: { id: existing.id },
              data: { amount, status, transactionTime, note: txn.reason ?? null },
            });
            result.updated++;
          } else {
            await prisma.walletWithdrawal.create({
              data: {
                channelId: channel.id,
                amount,
                status,
                source: WithdrawalSource.SYNC,
                externalTxnId,
                transactionTime,
                note: txn.reason ?? null,
              },
            });
            result.created++;
          }
        }

        more = data.response?.more === true && list.length > 0;
        pageNo++;
      }
    } catch (err) {
      if (isTimeRangeError(err) && winSec > MIN_WINDOW_SEC) {
        winSec = Math.max(Math.floor(winSec / 2), MIN_WINDOW_SEC);
        continue; // thử lại cùng winFrom với cửa sổ ngắn hơn
      }
      throw err;
    }
    winFrom = winTo;
  }

  // Ghi số dư ví thật vào Channel cho bảng Phân bổ dòng tiền. Cửa sổ quét không
  // có giao dịch nào → số dư KHÔNG đổi (ví chỉ thay đổi qua giao dịch) nên giữ
  // nguyên giá trị cũ, không ghi đè null.
  if (result.walletBalance != null) {
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        walletBalance: result.walletBalance,
        walletBalanceSyncedAt: new Date(),
      },
    });
  }

  return result;
}
