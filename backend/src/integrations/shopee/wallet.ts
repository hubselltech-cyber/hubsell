// ============================================================
// SHOPEE — ĐỒNG BỘ RÚT VÍ (READ-ONLY). Đọc lịch sử giao dịch ví của sàn, lọc ra
// các lệnh RÚT TIỀN thành công rồi ghi vào WalletWithdrawal (source=SYNC) để bảng
// dòng tiền tách "Tiền trên Ví sàn" khỏi "Tiền về Ngân hàng".
//
// AN TOÀN: chỉ ĐỌC (get_wallet_transaction_list) + ghi bản ghi đối soát nội bộ.
// TUYỆT ĐỐI không gọi API chuyển/rút tiền. Idempotent theo (channelId, txnId) nên
// chạy lại bao nhiêu lần cũng không nhân đôi.
//
// TRẠNG THÁI: cấu trúc SẴN SÀNG, CHƯA gắn cron/chưa chạy thật (sandbox chưa test
// được luồng ví). Chạy tay: scripts/shopee-sync-withdrawals.ts.
// ============================================================

import type { Channel } from "@prisma/client";
import { WithdrawalSource } from "@prisma/client";
import { prisma } from "../../prisma";
import { getWalletTransactionList, type ShopeeWalletTxn } from "./client";
import { getValidShopeeAccessToken } from "./service";

const WINDOW_SEC = 15 * 24 * 60 * 60; // chia cửa sổ 15 ngày/lần cho an toàn
const PAGE_SIZE = 100;
const MAX_PAGES = 200; // chốt chặn phân trang vô tận

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
  };

  for (let winFrom = startFrom; winFrom < nowSec && result.pages < MAX_PAGES; winFrom += WINDOW_SEC) {
    const winTo = Math.min(winFrom + WINDOW_SEC, nowSec);
    let pageNo = 0;
    let more = true;

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
        if (!isWithdrawal(txn) || txn.transaction_id == null) continue;
        result.withdrawals++;

        const externalTxnId = String(txn.transaction_id);
        const amount = Math.abs(Number(txn.amount ?? 0)) || 0;
        const status = mapStatus(txn.status);
        const transactionTime = txn.create_time
          ? new Date(txn.create_time * 1000)
          : new Date();

        const existing = await prisma.walletWithdrawal.findUnique({
          where: { channelId_externalTxnId: { channelId: channel.id, externalTxnId } },
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
  }

  return result;
}
