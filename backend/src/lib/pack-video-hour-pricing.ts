// ============================================================
// VIDEO ĐÓNG HÀNG — TÍNH TIỀN MUA GIỜ QUAY (hàm thuần, 18/11/2026)
//
// Đơn giá ở config/pack-video.ts (21/11/2026: 2.000 đ / giờ; trước đó 1.500 đ), TÍNH THẲNG, không bậc. Máy chủ là nơi DUY NHẤT tính tiền:
// trình duyệt chỉ gửi số giờ, máy chủ trả số tiền; số tiền trình duyệt gửi lên (nếu có) bị bỏ qua.
// Cùng hàm này kiểm lại lúc tiền về: số tiền thu ≠ số giờ × đơn giá thì KHÔNG cộng giờ.
// ============================================================

import {
  PACK_VIDEO_HOUR_MAX_PURCHASE,
  PACK_VIDEO_HOUR_MIN_PURCHASE,
  PACK_VIDEO_HOUR_PRICE_VND,
} from "../config/pack-video";

export const SECONDS_PER_HOUR = 3600;

export type HourQuote = { ok: true; hours: number; amountVnd: number } | { ok: false; error: string };

export interface HourPricing {
  priceVnd: number;
  minHours: number;
  maxHours: number;
}

export const DEFAULT_HOUR_PRICING: HourPricing = {
  priceVnd: PACK_VIDEO_HOUR_PRICE_VND,
  minHours: PACK_VIDEO_HOUR_MIN_PURCHASE,
  maxHours: PACK_VIDEO_HOUR_MAX_PURCHASE,
};

/** Báo giá cho số giờ khách nhập. Chỉ nhận số NGUYÊN giờ trong [tối thiểu, tối đa]. */
export function quoteHours(raw: unknown, pricing: HourPricing = DEFAULT_HOUR_PRICING): HourQuote {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, error: "Số giờ phải là một con số" };
  if (!Number.isInteger(n)) return { ok: false, error: "Số giờ phải là số nguyên" };
  if (n < pricing.minHours) return { ok: false, error: `Mua tối thiểu ${pricing.minHours.toLocaleString("vi-VN")} giờ` };
  if (n > pricing.maxHours) {
    return { ok: false, error: `Mỗi lần mua tối đa ${pricing.maxHours.toLocaleString("vi-VN")} giờ` };
  }
  return { ok: true, hours: n, amountVnd: n * pricing.priceVnd };
}

/** Số tiền đã thu có khớp đúng số giờ không (dùng lúc tiền về, trước khi cộng giờ). */
export function amountMatchesHours(amountVnd: number, hours: number, pricing: HourPricing = DEFAULT_HOUR_PRICING): boolean {
  const q = quoteHours(hours, pricing);
  return q.ok && Number.isInteger(amountVnd) && amountVnd === q.amountVnd;
}
