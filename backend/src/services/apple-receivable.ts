// ============================================================
// PHẢI THU APPLE — khoản bán gói qua App Store chưa về tài khoản (17/11/2026)
//
// Khách mua trong app iOS: Apple thu tiền, giữ hoa hồng (15–30 %) + thuế nhà
// thầu, rồi chuyển phần còn lại khoảng 45 ngày sau tháng tài chính. Hubsell
// vẫn xuất hóa đơn ĐỦ giá khách trả ngay ngày mua (Công văn 1063/CT-CS), nên
// bút toán THU của khoản này là DOANH THU đúng nhưng CHƯA phải tiền trong quỹ.
//
// Lát A (17/11): sổ quỹ HQ không cộng các khoản này vào Tổng THU / chênh lệch,
// mà hiện riêng thành "Apple chưa chuyển về". Hóa đơn, hoa hồng giới thiệu,
// thời hạn gói — không đổi.
//
// Lát B (17/11): khi Apple chuyển tiền, HQ ghi nhận một ĐỢT (services/
// apple-settlement.ts) → các khoản bán của đợt mang appleSettlementId (hết chờ),
// sổ quỹ có phiếu thu tổng khách trả + phiếu chi hoa hồng + phiếu chi thuế Apple
// trừ, cùng ngày tiền về. Khoản BÁN qua App Store (đã hay chưa trả) KHÔNG BAO GIỜ
// tính là tiền quỹ — nó là doanh thu + hóa đơn; tiền quỹ đi qua bút toán của đợt.
// ============================================================

import { LedgerDirection, PackagePaymentMethod, type Prisma } from "@prisma/client";

/** Lọc Prisma: khoản BÁN qua App Store còn chờ Apple chuyển (chưa vào đợt nào). */
export const APPLE_RECEIVABLE_WHERE: Prisma.PlatformLedgerEntryWhereInput = {
  direction: LedgerDirection.IN,
  packagePayment: { method: PackagePaymentMethod.APPLE_IAP },
  appleSettlementId: null,
};

/** Điều kiện SQL thô: KHÔNG phải khoản bán qua App Store (bí danh bảng sổ quỹ `l`). */
export const APPLE_SALE_SQL_NOT = `NOT EXISTS (
  SELECT 1 FROM "package_payments" pp
  WHERE pp."id" = l."packagePaymentId" AND pp."method" = 'APPLE_IAP'
)`;

// ---------------- Ngày dự kiến Apple chuyển tiền (17/11/2026) ----------------
//
// Apple trả theo THÁNG TÀI CHÍNH riêng (không trùng tháng dương lịch), cam kết
// "trong 45 ngày kể từ ngày cuối tháng tài chính" (trang trợ giúp App Store
// Connect "Overview of receiving payments"). Apple KHÔNG công bố lịch trả; thực
// tế thường trả 33 ngày sau ngày cuối tháng (ước của aso.dev + RevenueCat).
//
// Ngày cuối từng tháng tài chính lấy từ bảng của aso.dev (đọc 17/11/2026). Từ
// tháng 12/2026 RevenueCat ghi khác (cho rằng năm 2027 có tuần thứ 53) — chưa có
// lịch chính thức để chốt, nên mọi ngày ở đây chỉ là ƯỚC. Ngày mua nằm ngoài
// bảng → không đoán (trả null), giao diện ghi "chưa có lịch".

/** Ngày cuối tháng tài chính Apple (giờ Thái Bình Dương), tăng dần. */
export const APPLE_FISCAL_MONTH_ENDS = [
  "2026-09-26",
  "2026-10-31",
  "2026-11-28",
  "2026-12-26",
  "2027-01-30",
  "2027-02-27",
  "2027-03-27",
  "2027-05-01",
  "2027-05-29",
  "2027-06-26",
  "2027-07-31",
  "2027-08-28",
  "2027-09-25",
] as const;

/** Ngày bắt đầu bảng: ngày đầu tháng tài chính 09/2026. */
const APPLE_FISCAL_TABLE_START = "2026-08-30";
const TYPICAL_PAYOUT_DAYS = 33;
const MAX_PAYOUT_DAYS = 45;

function pacificDateKey(at: Date): string {
  // en-CA cho dạng yyyy-mm-dd.
  return at.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ApplePayoutEstimate {
  /** Ngày cuối tháng tài chính chứa giao dịch (yyyy-mm-dd). */
  fiscalMonthEnd: string;
  /** Ngày Apple thường chuyển (cuối tháng + 33 ngày) — ƯỚC. */
  expected: string;
  /** Hạn Apple cam kết (cuối tháng + 45 ngày). */
  deadline: string;
}

export function estimateApplePayout(purchasedAt: Date): ApplePayoutEstimate | null {
  const key = pacificDateKey(purchasedAt);
  if (key < APPLE_FISCAL_TABLE_START) return null;
  const end = APPLE_FISCAL_MONTH_ENDS.find((e) => key <= e);
  if (!end) return null;
  return {
    fiscalMonthEnd: end,
    expected: addDaysKey(end, TYPICAL_PAYOUT_DAYS),
    deadline: addDaysKey(end, MAX_PAYOUT_DAYS),
  };
}

/** Gom các khoản chờ Apple theo đợt chuyển dự kiến (sớm trước); khoản ngoài bảng gom cuối, expected null. */
export function groupApplePayouts(items: { occurredAt: Date; amount: number }[]) {
  const groups = new Map<string, { expected: string | null; deadline: string | null; amount: number; count: number }>();
  for (const it of items) {
    const est = estimateApplePayout(it.occurredAt);
    const k = est?.expected ?? "none";
    const g = groups.get(k) ?? { expected: est?.expected ?? null, deadline: est?.deadline ?? null, amount: 0, count: 0 };
    g.amount += it.amount;
    g.count += 1;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) =>
    a.expected === b.expected ? 0 : a.expected === null ? 1 : b.expected === null ? -1 : a.expected < b.expected ? -1 : 1
  );
}

export interface LedgerCashInput {
  direction: LedgerDirection | "IN" | "OUT";
  amount: number;
  packagePayment: { method: PackagePaymentMethod | string } | null;
  appleSettlementId?: string | null;
}

/** Khoản BÁN gói qua App Store (đã hay chưa được Apple trả). */
export function isAppleSale(e: LedgerCashInput): boolean {
  return e.direction === LedgerDirection.IN && e.packagePayment?.method === PackagePaymentMethod.APPLE_IAP;
}

/** Khoản bán qua App Store còn chờ Apple chuyển. */
export function isAppleReceivable(e: LedgerCashInput): boolean {
  return isAppleSale(e) && !e.appleSettlementId;
}

/**
 * Tổng tiền quỹ một kỳ: khoản BÁN qua App Store không bao giờ là tiền quỹ (tiền
 * đi qua bút toán của đợt Apple chuyển); khoản chưa trả gom vào `appleAwaiting`.
 */
export function ledgerCashTotals(entries: LedgerCashInput[]) {
  let cashIn = 0;
  let cashOut = 0;
  let appleAwaiting = 0;
  let appleAwaitingCount = 0;
  for (const e of entries) {
    if (isAppleSale(e)) {
      if (!e.appleSettlementId) {
        appleAwaiting += e.amount;
        appleAwaitingCount += 1;
      }
    } else if (e.direction === LedgerDirection.IN) cashIn += e.amount;
    else cashOut += e.amount;
  }
  return { in: cashIn, out: cashOut, net: cashIn - cashOut, appleAwaiting, appleAwaitingCount };
}
