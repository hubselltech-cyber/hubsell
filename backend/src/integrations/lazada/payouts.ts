// ============================================================
// LAZADA — ĐỒNG BỘ ĐỢT CHI TIỀN VỀ NGÂN HÀNG (READ-ONLY)
//
// Đọc /finance/payout/status/get: mỗi kỳ sao kê Lazada chốt MỘT đợt chuyển
// tiền (payout) về bank người bán. Ghi vào WalletWithdrawal (source=SYNC) để
// bảng "Phân bổ dòng tiền theo gian hàng" tự chuyển tiền từ cột "Ví sàn" sang
// "Về Ngân hàng" — không phải bấm tay nữa.
//
// HÌNH DẠNG RESPONSE đã ĐỐI CHIẾU BẰNG REQUEST THẬT trên shop Hi.Bé
// (scripts/lazada-payout-probe.ts, 08/08/2026) — KHÔNG phải chép từ docs:
//   payout           : "99303.00 VND"  ← CHUỖI KÈM ĐƠN VỊ, phải bóc số
//   statement_number : "VN344XRB8H-2026-0803"  ← khoá dedupe
//   paid             : "1" | "0"
//   created_at       : "2026-08-04 02:20:11"
//
// AN TOÀN: chỉ ĐỌC + ghi bản ghi đối soát nội bộ, idempotent theo
// (channelId, statement_number). TUYỆT ĐỐI không gọi API chuyển/rút tiền.
// ============================================================

import type { Channel } from "@prisma/client";
import { WithdrawalSource } from "@prisma/client";
import { prisma } from "../../prisma";
import { getPayoutStatus, type LazadaPayout } from "./client";
import { getValidLazadaAccessToken } from "./service";

/** Bóc số tiền từ chuỗi kiểu "99303.00 VND" (chấp nhận cả số trần). */
function parsePayoutAmount(raw: LazadaPayout["payout"]): number {
  if (typeof raw === "number") return raw;
  const cleaned = String(raw ?? "").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** paid "1"/1/true/"paid" → SUCCESS; còn lại coi là PENDING (kỳ chưa chi). */
function mapPaidStatus(p: LazadaPayout): "SUCCESS" | "PENDING" {
  const raw = p.paid ?? p.paid_status ?? p.paidStatus;
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "paid" ? "SUCCESS" : "PENDING";
}

/** "2026-08-04 02:20:11" → Date (đổi khoảng trắng thành T cho parser chuẩn). */
function parsePayoutTime(p: LazadaPayout): Date {
  const raw = String(p.created_at ?? p.createdAt ?? p.updated_at ?? p.updatedAt ?? "");
  const d = new Date(raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export interface SyncLazadaPayoutsResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number; // thiếu statement_number/số tiền 0 — không đủ căn cứ ghi sổ
}

/**
 * Kéo đợt payout của MỘT gian Lazada trong `daysBack` ngày, upsert vào
 * WalletWithdrawal. Idempotent theo (channelId, externalTxnId=statement_number).
 */
export async function syncLazadaPayouts(
  channel: Channel,
  opts: { daysBack?: number } = {}
): Promise<SyncLazadaPayoutsResult> {
  const accessToken = await getValidLazadaAccessToken(channel);
  const createdAfter = new Date(Date.now() - (opts.daysBack ?? 90) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const payouts = await getPayoutStatus({ accessToken, createdAfter });
  const result: SyncLazadaPayoutsResult = {
    fetched: payouts.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  for (const p of payouts) {
    const statementNumber = String(p.statement_number ?? p.statementNumber ?? "").trim();
    const amount = parsePayoutAmount(p.payout ?? p.payout_amount ?? p.payoutAmount);
    // Kỳ sao kê không có tiền chi (payout 0) vẫn bỏ qua: ghi bản ghi 0 đồng chỉ
    // làm nhiễu bảng đối soát mà không đổi cột nào.
    if (!statementNumber || amount <= 0) {
      result.skipped++;
      continue;
    }

    const status = mapPaidStatus(p);
    const transactionTime = parsePayoutTime(p);

    const existing = await prisma.walletWithdrawal.findUnique({
      where: {
        channelId_externalTxnId: {
          channelId: channel.id,
          externalTxnId: statementNumber,
        },
      },
      select: { id: true },
    });

    if (existing) {
      // Kỳ chưa chi → đã chi (paid 0→1), hoặc Lazada điều chỉnh số — cập nhật.
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
          externalTxnId: statementNumber,
          transactionTime,
          note: `Kỳ sao kê ${statementNumber}`,
        },
      });
      result.created++;
    }
  }

  return result;
}
