// ============================================================
// TIKTOK — SỔ CÁI VÍ + "CHƯA THANH TOÁN" (READ-ONLY), 23/10/2026
//
// TikTok KHÔNG có API số dư ví. GET /finance/202309/withdrawals ("Get Seller
// Financial Transactions") trả từng dòng giao dịch tài chính của gian:
//   type  : SETTLE (sàn cộng tiền vào ví) · WITHDRAW (shop rút về bank) ·
//           PAYMENT (sàn tự chuyển về bank) · TRANSFER (trợ cấp/khấu trừ) ·
//           REVERSE (rút thất bại, tiền quay lại ví) · REFUND · REWARD ·
//           POLICY_VIOLATION_DEDUCTION · UNKNOWN
//   status: SUCCESS INIT ORDERED PROCESSING RECEIVED PROCESSED FAILED
//           REVERSED EXCEPTION CLOSED UNKNOWN
// Lưu dòng THÔ vào TiktokWalletTxn (idempotent theo id sàn) → số dư =
// tiktokWalletBalance(rows) (hàm thuần, có test) → Channel.walletBalance.
// Dòng WITHDRAW/PAYMENT ghi thêm WalletWithdrawal để cột "Về Ngân hàng" tự chạy.
//
// CỬA SỔ (anh Trung chốt 23/10): đọc từ 90 ngày TRƯỚC ngày ủy quyền — không ai
// để tiền trên sàn quá 90 ngày nên số dư đầu cửa sổ coi như 0. Nhịp giờ chỉ
// đọc phần mới: từ dòng mới nhất đã lưu lùi OVERLAP, kéo thêm về dòng chưa
// chốt cũ nhất (PROCESSING → PROCESSED đổi cột Về Ngân hàng).
//
// LUẬT DẤU chưa kiểm với sàn thật (ghi log tổng theo loại ở mỗi lượt có dòng
// mới để anh đối chiếu Seller Center; đổi luật thì chỉ sửa tiktokWalletDelta,
// không phải đọc lại sàn): REFUND tạm KHÔNG cộng/trừ vì chưa rõ đã nằm trong
// SETTLE hay chưa.
//
// AN TOÀN: chỉ ĐỌC + ghi bản ghi nội bộ. TUYỆT ĐỐI không gọi API rút tiền.
// ============================================================

import type { Channel } from "@prisma/client";
import { WithdrawalSource } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { fetchUnsettledTransactions, fetchWithdrawals, type TikTokWalletTxn } from "./client";
import { SETTLE_BACKFILL_FLOOR, getValidAccessToken } from "./service";
import { tiktokUnsettledSum } from "../../lib/pending-income";

/** Cửa sổ lịch sử ví: 90 ngày trước ngày ủy quyền (anh Trung chốt 23/10/2026). */
export const TIKTOK_WALLET_DAYS_BEFORE_AUTH = 90;
/** Nhịp giờ đọc lùi 2 ngày so với dòng mới nhất đã lưu (sàn ghi dòng trễ / lệch giờ). */
const OVERLAP_SEC = 2 * 86_400;
const PAGE_SIZE = 100;
/** 5.000 dòng/lượt — gian VN 90 ngày chỉ vài trăm dòng; trang còn dư thì lượt sau đọc tiếp. */
const MAX_PAGES = 50;

/** Trạng thái đã chốt — dòng ở trạng thái khác sẽ được đọc lại mỗi lượt. */
const FINAL_STATUSES = new Set(["SUCCESS", "PROCESSED", "FAILED", "REVERSED", "CLOSED"]);

export interface TiktokWalletLedgerRow {
  type: string;
  status: string;
  amount: number; // giữ dấu sàn trả
}

/** Loại dòng = tiền rời ví về ngân hàng (shop tự rút hoặc sàn tự chuyển). */
export function isTiktokBankTransfer(type: string): boolean {
  return type === "WITHDRAW" || type === "PAYMENT";
}

/**
 * Trạng thái sàn → trạng thái WalletWithdrawal của app.
 * PROCESSED/SUCCESS = tiền đã về bank; FAILED/REVERSED/CLOSED/EXCEPTION = không
 * về (hoặc về một phần — coi như chưa, đợi sàn chốt); còn lại = đang chuyển.
 */
export function mapTiktokWithdrawalStatus(status: string): "SUCCESS" | "PENDING" | "FAILED" {
  const s = status.toUpperCase();
  if (s === "SUCCESS" || s === "PROCESSED") return "SUCCESS";
  if (s === "FAILED" || s === "REVERSED" || s === "CLOSED" || s === "EXCEPTION") return "FAILED";
  return "PENDING";
}

/**
 * Một dòng làm số dư ví đổi bao nhiêu.
 *   SETTLE / REWARD / REVERSE : +|amount|  (tiền vào ví; REVERSE = rút thất bại
 *                               trả lại — docs: mỗi lần rút hỏng sinh một dòng
 *                               REVERSE riêng, nên WITHDRAW vẫn trừ dù FAILED).
 *   WITHDRAW / PAYMENT        : −|amount|  trừ mọi trạng thái trừ CLOSED
 *                               (lệnh đóng, tiền chưa từng rời ví).
 *   TRANSFER                  : +amount   GIỮ DẤU sàn (trợ cấp dương, khấu trừ âm).
 *   POLICY_VIOLATION_DEDUCTION: −|amount|
 *   REFUND / UNKNOWN / khác   : 0 (chưa rõ, xem chú thích đầu file).
 */
export function tiktokWalletDelta(row: TiktokWalletLedgerRow): number {
  const amount = Number(row.amount);
  if (!Number.isFinite(amount)) return 0;
  const abs = Math.abs(amount);
  switch (row.type.toUpperCase()) {
    case "SETTLE":
    case "REWARD":
    case "REVERSE":
      return abs;
    case "WITHDRAW":
    case "PAYMENT":
      return row.status.toUpperCase() === "CLOSED" ? 0 : -abs;
    case "TRANSFER":
      return amount;
    case "POLICY_VIOLATION_DEDUCTION":
      return -abs;
    default:
      return 0;
  }
}

/** Số dư ví = Σ delta mọi dòng trong cửa sổ (làm tròn 2 chữ số). */
export function tiktokWalletBalance(rows: readonly TiktokWalletLedgerRow[]): number {
  const sum = rows.reduce((acc, r) => acc + tiktokWalletDelta(r), 0);
  return Math.round(sum * 100) / 100;
}

/** Tóm tắt theo loại để log đối chiếu: "SETTLE 42 dòng 12.345.678 · PAYMENT 40 dòng 12.000.000". */
export function summarizeTiktokWalletRows(rows: readonly TiktokWalletLedgerRow[]): string {
  const byType = new Map<string, { n: number; sum: number }>();
  for (const r of rows) {
    const k = r.type.toUpperCase();
    const cur = byType.get(k) ?? { n: 0, sum: 0 };
    cur.n++;
    cur.sum += Number(r.amount) || 0;
    byType.set(k, cur);
  }
  return [...byType.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} ${v.n} dòng ${Math.round(v.sum).toLocaleString("vi-VN")}`)
    .join(" · ");
}

/**
 * "CHƯA THANH TOÁN" của gian TikTok = sum_est_settlement_amount của
 * /finance/202507/orders/unsettled (ước tính CỦA CHÍNH SÀN cho mọi đơn + điều
 * chỉnh chưa quyết toán). Chỉ gửi search_time_ge (lượt thật 16/09: gửi cả
 * ge+lt bị 36009002/3) — trang đầu đã mang tổng, không cần lật trang.
 * Sàn không trả tổng → GIỮ số cũ, không ghi đè null.
 */
export async function syncTiktokPendingIncome(channel: Channel): Promise<number | null> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const data = await fetchUnsettledTransactions({
    accessToken,
    shopCipher,
    searchTimeGe: SETTLE_BACKFILL_FLOOR,
    pageSize: 20,
    sortOrder: "DESC",
  });
  const pending = tiktokUnsettledSum(data);
  if (pending == null) return null;
  await prisma.channel.update({
    where: { id: channel.id },
    data: { pendingIncome: pending, pendingIncomeSyncedAt: new Date() },
  });
  return pending;
}

export interface SyncTiktokWalletResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number; // thiếu id / số không đọc được
  bankCreated: number; // dòng WITHDRAW/PAYMENT mới ghi vào WalletWithdrawal
  bankUpdated: number;
  walletBalance: number;
  more: boolean; // còn trang chưa đọc (quá MAX_PAGES) — lượt sau đọc tiếp
}

let shapeLogged = false;

function toSec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/**
 * Mốc bắt đầu đọc của lượt này (giây):
 *   lượt đầu  : ủy quyền − 90 ngày (không sớm hơn SETTLE_BACKFILL_FLOOR).
 *   lượt sau  : min(dòng mới nhất − OVERLAP, dòng chưa chốt cũ nhất), không
 *               lùi quá mốc lượt đầu.
 */
export function tiktokWalletReadFrom(input: {
  authorizedAt: Date | null;
  createdAt: Date;
  latestStoredAt: Date | null;
  oldestOpenAt: Date | null;
}): number {
  const anchor = input.authorizedAt ?? input.createdAt;
  const floor = Math.max(toSec(anchor) - TIKTOK_WALLET_DAYS_BEFORE_AUTH * 86_400, SETTLE_BACKFILL_FLOOR);
  if (!input.latestStoredAt) return floor;
  let from = toSec(input.latestStoredAt) - OVERLAP_SEC;
  if (input.oldestOpenAt) from = Math.min(from, toSec(input.oldestOpenAt));
  return Math.max(from, floor);
}

/**
 * Đọc sổ cái ví của MỘT gian TikTok → TiktokWalletTxn + WalletWithdrawal →
 * Channel.walletBalance. Idempotent theo (channelId, id sàn). Một lệnh/trang,
 * nhịp thường 1 trang/giờ/gian.
 */
export async function syncTiktokWallet(channel: Channel): Promise<SyncTiktokWalletResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const nowSec = Math.floor(Date.now() / 1000);
  const result: SyncTiktokWalletResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    bankCreated: 0,
    bankUpdated: 0,
    walletBalance: 0,
    more: false,
  };

  const [latest, oldestOpen] = await Promise.all([
    prisma.tiktokWalletTxn.aggregate({ where: { channelId: channel.id }, _max: { createTime: true } }),
    prisma.tiktokWalletTxn.findFirst({
      where: { channelId: channel.id, status: { notIn: [...FINAL_STATUSES] } },
      orderBy: { createTime: "asc" },
      select: { createTime: true },
    }),
  ]);
  const fromSec = tiktokWalletReadFrom({
    authorizedAt: channel.authorizedAt,
    createdAt: channel.createdAt,
    latestStoredAt: latest._max.createTime,
    oldestOpenAt: oldestOpen?.createTime ?? null,
  });

  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await fetchWithdrawals({
      accessToken,
      shopCipher,
      createTimeGe: fromSec,
      createTimeLt: nowSec,
      pageSize: PAGE_SIZE,
      pageToken,
    });
    pages++;
    for (const t of page.withdrawals) {
      result.fetched++;
      if (!shapeLogged && process.env.TIKTOK_SHAPE_LOG !== "0") {
        shapeLogged = true;
        console.log(
          `[TikTok] Hình dạng dòng sổ cái ví (withdrawals): keys=[${Object.keys(t).join(",")}] type=${JSON.stringify(t.type)} status=${JSON.stringify(t.status)} amount=${JSON.stringify(t.amount)}`
        );
      }
      const externalId = String(t.id ?? "").trim();
      const amount = Number(typeof t.amount === "string" ? t.amount.replace(/,/g, "") : t.amount);
      if (!externalId || !Number.isFinite(amount)) {
        result.skipped++;
        continue;
      }
      const type = String(t.type ?? "UNKNOWN").toUpperCase();
      const status = String(t.status ?? "UNKNOWN").toUpperCase();
      const createTime = new Date((t.create_time || nowSec) * 1000);
      const currency = typeof t.currency === "string" ? t.currency : null;

      const existing = await prisma.tiktokWalletTxn.findUnique({
        where: { channelId_externalId: { channelId: channel.id, externalId } },
        select: { id: true, type: true, status: true, amount: true },
      });
      if (!existing) {
        await prisma.tiktokWalletTxn.create({
          data: { channelId: channel.id, externalId, type, status, amount, currency, createTime },
        });
        result.created++;
      } else if (existing.type !== type || existing.status !== status || Number(existing.amount) !== amount) {
        await prisma.tiktokWalletTxn.update({
          where: { id: existing.id },
          data: { type, status, amount, currency, createTime, syncedAt: new Date() },
        });
        result.updated++;
      }

      // Tiền rời ví về bank → cột "Về Ngân hàng" (cùng bảng với Shopee/Lazada).
      if (isTiktokBankTransfer(type) && Math.abs(amount) > 0) {
        const bankStatus = mapTiktokWithdrawalStatus(status);
        const bank = await prisma.walletWithdrawal.findUnique({
          where: { channelId_externalTxnId: { channelId: channel.id, externalTxnId: externalId } },
          select: { id: true, status: true, amount: true },
        });
        if (!bank) {
          await prisma.walletWithdrawal.create({
            data: {
              channelId: channel.id,
              amount: Math.abs(amount),
              status: bankStatus,
              source: WithdrawalSource.SYNC,
              externalTxnId: externalId,
              transactionTime: createTime,
              note: `${type === "PAYMENT" ? "Sàn chuyển tiền" : "Rút ví"} TikTok ${externalId}`,
            },
          });
          result.bankCreated++;
        } else if (bank.status !== bankStatus || Number(bank.amount) !== Math.abs(amount)) {
          await prisma.walletWithdrawal.update({
            where: { id: bank.id },
            data: { amount: Math.abs(amount), status: bankStatus, transactionTime: createTime },
          });
          result.bankUpdated++;
        }
      }
    }
    pageToken = page.next_page_token || undefined;
  } while (pageToken && pages < MAX_PAGES);
  result.more = Boolean(pageToken);

  // Số dư = cộng dồn TOÀN BỘ dòng đã lưu của gian (cửa sổ 90 ngày trước ủy quyền → nay).
  const rows = await prisma.tiktokWalletTxn.findMany({
    where: { channelId: channel.id },
    select: { type: true, status: true, amount: true },
  });
  const ledger = rows.map((r) => ({ type: r.type, status: r.status, amount: Number(r.amount) }));
  result.walletBalance = tiktokWalletBalance(ledger);
  await prisma.channel.update({
    where: { id: channel.id },
    data: { walletBalance: result.walletBalance, walletBalanceSyncedAt: new Date() },
  });
  if (result.created > 0 || result.updated > 0) {
    console.log(
      `[TikTok] Ví "${channel.shopName}": ${summarizeTiktokWalletRows(ledger)} → số dư ${Math.round(result.walletBalance).toLocaleString("vi-VN")}${result.more ? " (còn trang, lượt sau đọc tiếp)" : ""}`
    );
  }
  return result;
}
