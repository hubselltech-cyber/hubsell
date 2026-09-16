// ============================================================
// TIKTOK — ĐỒNG BỘ ĐỢT CHI TIỀN VỀ NGÂN HÀNG (READ-ONLY)
//
// Đọc /finance/202309/payments: mỗi dòng = một lần TikTok chuyển tiền về tài
// khoản ngân hàng của shop (PROCESSING → PAID / FAILED). Ghi vào
// WalletWithdrawal (source=SYNC) như payout Lazada để bảng "Phân bổ dòng tiền
// theo gian hàng" tự chuyển tiền từ "Ví sàn" sang "Về Ngân hàng".
//
// AN TOÀN: chỉ ĐỌC + ghi bản ghi đối soát nội bộ, idempotent theo
// (channelId, externalTxnId = payment id). TUYỆT ĐỐI không gọi API rút tiền.
// Tên trường đối chiếu qua log hình dạng ở lượt chạy thật đầu tiên.
// ============================================================

import type { Channel } from "@prisma/client";
import { WithdrawalSource } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fetchPayments, type TikTokPayment } from "./client";
import { getValidAccessToken } from "./service";

const MAX_PAGES = 20;
let shapeLogged = false;

function paymentAmount(p: TikTokPayment): number {
  const v = p.amount?.value ?? p.settlement_amount?.value;
  return Number(v ?? 0) || 0;
}

/** PAID → SUCCESS; FAILED → FAILED; còn lại (PROCESSING…) → PENDING. */
function mapStatus(p: TikTokPayment): "SUCCESS" | "PENDING" | "FAILED" {
  const s = String(p.status ?? "").toUpperCase();
  if (s === "PAID" || s === "SUCCESS") return "SUCCESS";
  if (s === "FAILED") return "FAILED";
  return "PENDING";
}

export interface SyncTiktokPayoutsResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

export async function syncTiktokPayouts(
  channel: Channel,
  opts: { daysBack?: number } = {}
): Promise<SyncTiktokPayoutsResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const nowSec = Math.floor(Date.now() / 1000);
  const result: SyncTiktokPayoutsResult = { fetched: 0, created: 0, updated: 0, skipped: 0 };

  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await fetchPayments({
      accessToken,
      shopCipher,
      createTimeGe: nowSec - (opts.daysBack ?? 90) * 24 * 60 * 60,
      createTimeLt: nowSec,
      pageSize: 50,
      pageToken,
    });
    pages++;
    for (const p of page.payments) {
      result.fetched++;
      if (!shapeLogged && process.env.TIKTOK_SHAPE_LOG !== "0") {
        shapeLogged = true;
        console.log(
          `[TikTok] Hình dạng đợt chi tiền (payments): keys=[${Object.keys(p).join(",")}] amount=[${Object.keys(p.amount ?? {}).join(",")}] status=${JSON.stringify(p.status)}`
        );
      }
      const externalTxnId = String(p.id ?? "").trim();
      const amount = paymentAmount(p);
      if (!externalTxnId || amount <= 0) {
        result.skipped++;
        continue;
      }
      const status = mapStatus(p);
      const transactionTime = new Date((p.paid_time || p.create_time || nowSec) * 1000);

      const existing = await prisma.walletWithdrawal.findUnique({
        where: { channelId_externalTxnId: { channelId: channel.id, externalTxnId } },
        select: { id: true },
      });
      if (existing) {
        await prisma.walletWithdrawal.update({
          where: { id: existing.id },
          data: { amount, status, transactionTime },
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
            note: `Đợt chi tiền TikTok ${externalTxnId}`,
          },
        });
        result.created++;
      }
    }
    pageToken = page.next_page_token || undefined;
  } while (pageToken && pages < MAX_PAGES);

  return result;
}
