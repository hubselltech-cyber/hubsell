// ============================================================
// SỐ LIỆU KÊ KHAI THUẾ THEO KỲ — cho seller SÀN (07/09/2026).
//
// Vì sao có: mỗi quý hộ kinh doanh phải vào Seller Center TỪNG SÀN tải báo
// cáo thuế rồi cộng tay để có "doanh thu tính thuế" + "số sàn đã khấu trừ
// nộp thay" điền vào tờ khai 01/CNKD (hoặc 01/GTGT với doanh nghiệp).
// Hubsell đã có cả hai con số trên từng đơn thật — chỉ cần gom theo KỲ và
// theo SÀN. Anh Trung chốt 07/09: làm đúng phần gom số, KHÔNG nộp thay
// (chỉ T-VAN mới được nộp), KHÔNG gán "chỉ tiêu số mấy" của tờ khai (hướng
// dẫn giữa MISA/Shopee còn mâu thuẫn — gán sai là khách bị phạt).
//
// Nguồn số: computePnlRow (SSOT tài chính) trên tập đơn phân trang
// fetchPnlOrdersAll — cùng công thức với Báo cáo dòng tiền / Lãi-Lỗ, seller
// đối chiếu hai trang là khớp. Kỳ cắt theo NGÀY TẠO ĐƠN giờ VN như mọi báo
// cáo khác (báo cáo thuế của sàn cắt theo ngày hoàn thành — lệch ở mép quý,
// UI nói rõ).
//
// Công thức doanh thu tính thuế (theo hướng dẫn chính thức Shopee bài 24233
// + TikTok Academy): tiền hàng − giảm giá NGƯỜI BÁN − hoàn trả khách;
// KHÔNG trừ phí sàn / phí ship / voucher sàn.
// ============================================================

import { ChannelName, ShippingStatus } from "@prisma/client";

import {
  HOUSEHOLD_TAX_FREE_THRESHOLD,
  householdTier,
  PLATFORM_TAX_RATE,
  PLATFORM_VAT_RATE,
  type HouseholdTierInfo,
} from "../config/tax-config";
import { BUSINESS_TZ_OFFSET_MS, type DateRangeFilter } from "../lib/date-range";
import type { ChannelScope } from "../lib/channel-filter";
import { prisma } from "../lib/prisma";
import { computePnlRow, fetchPnlOrdersAll } from "../routes/finance";

// ---------------------------------------------------------------- KỲ

export interface DeclarationPeriod {
  year: number;
  /** 1–4, hoặc null = cả năm (thông báo doanh thu năm của hộ nhóm 1). */
  quarter: 1 | 2 | 3 | 4 | null;
}

/** Ngày/tháng giờ VN của một thời điểm. */
function vnParts(d: Date) {
  const t = new Date(d.getTime() + BUSINESS_TZ_OFFSET_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 00:00 giờ VN của ngày y-m-d (m 1-12). */
function vnDayStart(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - BUSINESS_TZ_OFFSET_MS);
}

/** Khoảng [00:00 ngày đầu, 23:59:59.999 ngày cuối] giờ VN của kỳ. */
export function periodRange(p: DeclarationPeriod): DateRangeFilter {
  const startMonth = p.quarter ? (p.quarter - 1) * 3 + 1 : 1;
  const endMonthExclusive = p.quarter ? startMonth + 3 : 13;
  const gte = vnDayStart(p.year, startMonth, 1);
  // Ngày đầu tháng kế tiếp − 1ms = hết ngày cuối kỳ (không cần đếm ngày trong tháng).
  const nextStart =
    endMonthExclusive === 13 ? vnDayStart(p.year + 1, 1, 1) : vnDayStart(p.year, endMonthExclusive, 1);
  return { gte, lte: new Date(nextStart.getTime() - 1) };
}

/** Quý hiện tại theo giờ VN. */
export function currentPeriod(now: Date = new Date()): DeclarationPeriod {
  const { year, month } = vnParts(now);
  return { year, quarter: (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
}

/** Kỳ TRƯỚC kỳ hiện tại — kỳ đang tới hạn kê khai. */
export function previousQuarter(now: Date = new Date()): DeclarationPeriod {
  const cur = currentPeriod(now);
  const q = cur.quarter as number;
  return q === 1 ? { year: cur.year - 1, quarter: 4 } : { year: cur.year, quarter: (q - 1) as 1 | 2 | 3 };
}

/**
 * Đọc ?year=&quarter= của query. quarter bỏ trống hoặc "all" = cả năm; không
 * có year → quý hiện tại. Sai định dạng → null để route trả 400.
 */
export function parseDeclarationPeriod(query: {
  year?: unknown;
  quarter?: unknown;
}, now: Date = new Date()): DeclarationPeriod | null {
  if (query.year === undefined || query.year === "") return currentPeriod(now);
  const year = Number(query.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (query.quarter === undefined || query.quarter === "" || query.quarter === "all") {
    return { year, quarter: null };
  }
  const q = Number(query.quarter);
  if (![1, 2, 3, 4].includes(q)) return null;
  return { year, quarter: q as 1 | 2 | 3 | 4 };
}

export function periodLabel(p: DeclarationPeriod): string {
  return p.quarter ? `quý ${p.quarter}/${p.year}` : `năm ${p.year}`;
}

/** Chuỗi "2026-Q3" / "2026" dùng cho query + deep-link. */
export function periodKey(p: DeclarationPeriod): string {
  return p.quarter ? `${p.year}-Q${p.quarter}` : String(p.year);
}

// ---------------------------------------------------------------- HẠN NỘP

export interface FilingDeadline {
  /** 00:00 giờ VN của ngày hạn. */
  date: Date;
  /** "31/10/2026" */
  label: string;
  /** Diễn giải nghĩa vụ đến hạn. */
  description: string;
}

function ddmmyyyy(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d)}/${p(m)}/${y}`;
}

/**
 * Hạn nộp tờ khai của kỳ (NĐ 252/2026 Đ.10 + NĐ 68/2026): tờ khai QUÝ chậm
 * nhất NGÀY CUỐI của tháng đầu quý sau (30/04, 31/07, 31/10, 31/01). Cả
 * NĂM = hạn thông báo doanh thu năm 01/TKN-CNKD của hộ nhóm 1 = 31/01 năm
 * sau — trùng hạn quý 4 nên chuông quý 4 gộp luôn nhắc này.
 */
export function filingDeadline(p: DeclarationPeriod): FilingDeadline {
  if (p.quarter === 1) return { date: vnDayStart(p.year, 4, 30), label: ddmmyyyy(p.year, 4, 30), description: `Tờ khai thuế quý 1/${p.year}` };
  if (p.quarter === 2) return { date: vnDayStart(p.year, 7, 31), label: ddmmyyyy(p.year, 7, 31), description: `Tờ khai thuế quý 2/${p.year}` };
  if (p.quarter === 3) return { date: vnDayStart(p.year, 10, 31), label: ddmmyyyy(p.year, 10, 31), description: `Tờ khai thuế quý 3/${p.year}` };
  const next = p.year + 1;
  return {
    date: vnDayStart(next, 1, 31),
    label: ddmmyyyy(next, 1, 31),
    description:
      p.quarter === 4
        ? `Tờ khai thuế quý 4/${p.year} + thông báo doanh thu năm ${p.year} (hộ dưới 1 tỷ)`
        : `Thông báo doanh thu năm ${p.year} (mẫu 01/TKN-CNKD, hộ dưới 1 tỷ)`,
  };
}

/** Số ngày (theo ngày VN) từ `now` tới hạn; âm = đã qua hạn. */
export function daysUntil(deadline: Date, now: Date = new Date()): number {
  const a = vnParts(now);
  const b = vnParts(deadline);
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const db = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((db - da) / 86_400_000);
}

// ---------------------------------------------------------------- GOM SỐ

export interface DeclarationChannelRow {
  channelName: ChannelName;
  orderCount: number;
  /** Đơn sàn đã đối soát — số khấu trừ là số THẬT. */
  settledCount: number;
  unsettledCount: number;
  /** Tiền hàng gốc (Σ giá bán × SL, trước giảm giá người bán). */
  grossRevenue: number;
  /** Giảm giá / voucher của NGƯỜI BÁN (không gồm voucher sàn). */
  sellerVoucher: number;
  /** Tiền đã trả lại khách (hoàn/trả hàng) theo số sàn. */
  refundedAmount: number;
  /** = gross − voucher người bán − hoàn: cơ sở sàn tính khấu trừ. */
  taxableRevenue: number;
  /** Phần doanh thu tính thuế của đơn CHƯA đối soát (chưa có số khấu trừ thật). */
  unsettledTaxableRevenue: number;
  /** Sàn đã khấu trừ nộp thay — số THẬT của đơn đã đối soát (GTGT + TNCN). */
  taxWithheldActual: number;
  /** Số sàn ƯỚC TÍNH cho đơn chưa đối soát (escrow ước tính, có thể 0 nếu sàn chưa cấp). */
  taxWithheldEstimated: number;
}

function emptyRow(channelName: ChannelName): DeclarationChannelRow {
  return {
    channelName,
    orderCount: 0,
    settledCount: 0,
    unsettledCount: 0,
    grossRevenue: 0,
    sellerVoucher: 0,
    refundedAmount: 0,
    taxableRevenue: 0,
    unsettledTaxableRevenue: 0,
    taxWithheldActual: 0,
    taxWithheldEstimated: 0,
  };
}

/** Dòng số tối thiểu mà bộ gom cần — tách khỏi PnlRow để test thuần. */
export interface DeclarationInput {
  channelName: ChannelName;
  shippingStatus: ShippingStatus;
  isSettled: boolean;
  revenueGross: number;
  sellerVoucher: number;
  refundedAmount: number;
  platformTax: number;
}

/**
 * Gom theo sàn — hàm THUẦN (có test). Đơn hủy loại hẳn; đơn còn lại vào số
 * dù đang hoàn (phần hoàn trừ ở refundedAmount, đúng cách sàn bù trừ).
 */
export function aggregateDeclaration(rows: DeclarationInput[]): DeclarationChannelRow[] {
  const map = new Map<ChannelName, DeclarationChannelRow>();
  for (const r of rows) {
    if (r.shippingStatus === ShippingStatus.CANCELLED) continue;
    const row = map.get(r.channelName) ?? emptyRow(r.channelName);
    const taxable = Math.max(0, r.revenueGross - r.sellerVoucher - r.refundedAmount);
    row.orderCount += 1;
    row.grossRevenue += r.revenueGross;
    row.sellerVoucher += r.sellerVoucher;
    row.refundedAmount += r.refundedAmount;
    row.taxableRevenue += taxable;
    if (r.isSettled) {
      row.settledCount += 1;
      row.taxWithheldActual += r.platformTax;
    } else {
      row.unsettledCount += 1;
      row.unsettledTaxableRevenue += taxable;
      row.taxWithheldEstimated += r.platformTax;
    }
    map.set(r.channelName, row);
  }
  // Thứ tự cố định để bảng không nhảy dòng giữa hai lần tải.
  const order: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK", "OFFLINE"];
  return order.filter((c) => map.has(c)).map((c) => round(map.get(c)!));
}

function round(row: DeclarationChannelRow): DeclarationChannelRow {
  const r = (n: number) => Math.round(n);
  return {
    ...row,
    grossRevenue: r(row.grossRevenue),
    sellerVoucher: r(row.sellerVoucher),
    refundedAmount: r(row.refundedAmount),
    taxableRevenue: r(row.taxableRevenue),
    unsettledTaxableRevenue: r(row.unsettledTaxableRevenue),
    taxWithheldActual: r(row.taxWithheldActual),
    taxWithheldEstimated: r(row.taxWithheldEstimated),
  };
}

export function sumRows(rows: DeclarationChannelRow[]): DeclarationChannelRow {
  const t = emptyRow("OFFLINE");
  for (const r of rows) {
    t.orderCount += r.orderCount;
    t.settledCount += r.settledCount;
    t.unsettledCount += r.unsettledCount;
    t.grossRevenue += r.grossRevenue;
    t.sellerVoucher += r.sellerVoucher;
    t.refundedAmount += r.refundedAmount;
    t.taxableRevenue += r.taxableRevenue;
    t.unsettledTaxableRevenue += r.unsettledTaxableRevenue;
    t.taxWithheldActual += r.taxWithheldActual;
    t.taxWithheldEstimated += r.taxWithheldEstimated;
  }
  return t;
}

/**
 * Tách 1,5% đã khấu trừ thành GTGT / TNCN theo TỶ LỆ LUẬT 1% : 0,5% (hàng
 * hóa). Sàn không trả hai số riêng ở mọi luồng đồng bộ nên đây là ước chia —
 * chứng từ khấu trừ sàn cấp cuối năm mới là số chính thức; UI ghi rõ.
 */
export function splitWithheld(total: number): { vat: number; pit: number } {
  const vat = Math.round((total * PLATFORM_VAT_RATE) / PLATFORM_TAX_RATE);
  return { vat, pit: Math.round(total) - vat };
}

export interface TaxDeclarationResult {
  period: DeclarationPeriod & {
    key: string;
    label: string;
    deadline: { date: string; label: string; description: string; daysLeft: number };
  };
  rows: DeclarationChannelRow[];
  total: DeclarationChannelRow & { withheldSplit: { vat: number; pit: number } };
  /** Ngưỡng năm — tính trên TOÀN BỘ gian của chủ shop, không theo bộ lọc gian. */
  annual: {
    year: number;
    /** Doanh thu tính thuế lũy kế năm qua Hubsell (cùng công thức bảng trên). */
    taxableRevenueToDate: number;
    threshold: number;
    tier: HouseholdTierInfo;
    /** % đã đi so với ngưỡng 1 tỷ (trần 999 để UI vẽ thanh). */
    percentOfThreshold: number;
    /** Số đơn năm vượt trần quét → số lũy kế là CẬN DƯỚI. */
    truncated: boolean;
  };
  /** Kỳ nhiều đơn hơn phanh an toàn — bảng trên là cận dưới, thu hẹp kỳ để lấy đủ. */
  truncated: boolean;
}

/** Doanh thu tính thuế của một tập đơn đã bóc số (dùng cho lũy kế năm). */
function taxableOf(rows: DeclarationInput[]): number {
  return sumRows(aggregateDeclaration(rows)).taxableRevenue;
}

/**
 * Dựng bảng số liệu kê khai của kỳ cho chủ shop (theo phạm vi gian của người
 * xem) + lũy kế năm toàn shop để soi ngưỡng 1 tỷ.
 */
export async function buildTaxDeclaration(
  ownerId: string,
  scope: ChannelScope,
  period: DeclarationPeriod,
  now: Date = new Date()
): Promise<TaxDeclarationResult> {
  const range = periodRange(period);
  const { orders, truncated } = await fetchPnlOrdersAll(scope, range);
  const rows = aggregateDeclaration(orders.map(computePnlRow));
  const total = sumRows(rows);

  // Lũy kế năm: toàn shop (ngưỡng tính theo pháp nhân, không theo gian đang
  // lọc). Kỳ đang xem là cả năm và scope không lọc gian → dùng lại, khỏi quét
  // hai lần.
  const yearRange = periodRange({ year: period.year, quarter: null });
  const scopeIsWholeShop = Object.keys(scope).length === 1; // chỉ có userId
  let annualTaxable: number;
  let annualTruncated: boolean;
  if (period.quarter === null && scopeIsWholeShop) {
    annualTaxable = total.taxableRevenue;
    annualTruncated = truncated;
  } else {
    const y = await fetchPnlOrdersAll({ userId: ownerId }, yearRange);
    annualTaxable = taxableOf(y.orders.map(computePnlRow));
    annualTruncated = y.truncated;
  }

  const deadline = filingDeadline(period);
  return {
    period: {
      ...period,
      key: periodKey(period),
      label: periodLabel(period),
      deadline: {
        date: deadline.date.toISOString(),
        label: deadline.label,
        description: deadline.description,
        daysLeft: daysUntil(deadline.date, now),
      },
    },
    rows,
    total: { ...total, withheldSplit: splitWithheld(total.taxWithheldActual) },
    annual: {
      year: period.year,
      taxableRevenueToDate: Math.round(annualTaxable),
      threshold: HOUSEHOLD_TAX_FREE_THRESHOLD,
      tier: householdTier(annualTaxable),
      percentOfThreshold: Math.min(
        999,
        Math.round((annualTaxable / HOUSEHOLD_TAX_FREE_THRESHOLD) * 100)
      ),
      truncated: annualTruncated,
    },
    truncated,
  };
}

/** Chủ shop có ít nhất một đơn (không hủy) trong kỳ — đối tượng nhận chuông nhắc hạn. */
export async function ownersWithOrdersIn(range: DateRangeFilter): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: { createdAt: range, shippingStatus: { not: ShippingStatus.CANCELLED } },
    distinct: ["channelId"],
    select: { channel: { select: { userId: true } } },
  });
  return [...new Set(rows.map((r) => r.channel.userId))];
}
