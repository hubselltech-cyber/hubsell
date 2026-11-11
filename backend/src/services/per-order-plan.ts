// ============================================================
// GÓI TÍNH THEO ĐƠN tự phục vụ — Enterprise (11/11/2026, anh Trung chốt: "khách tự
// nhập số lượng đơn (tối thiểu 20K đơn) sẽ nhảy ra số tiền", tự giảm theo 3/6/12 tháng).
//
// Giá là DATA: 4 cột giá của gói là giá Ở ĐÚNG MỨC TỐI THIỂU (minOrdersPerMonth).
// Khách chọn N đơn/tháng → giá = làm tròn tới nghìn(giá kỳ × N ÷ mức tối thiểu).
// Ở 20.000 đơn ra đúng 4 con số đã báo khách 11/11: 1.300.000 / 3.690.000 /
// 6.990.000 / 12.990.000. Mức giảm kỳ dài vì thế tự đi theo 4 ô giá HQ nhập —
// không có hằng số hệ số nào trong mã. Thiết kế: docs/ENTERPRISE-TU-PHUC-VU-PHAN-VUOT.md.
// ============================================================

import type { BillingCycle, Prisma } from "@prisma/client";

// Không import subscription-service (nó import ngược module này) — đọc cột giá tại chỗ.
const CYCLE_PRICE_KEY = {
  MONTHLY: "priceMonthly",
  QUARTERLY: "priceQuarterly",
  SEMIANNUAL: "priceSemiannual",
  YEARLY: "priceYearly",
} as const satisfies Record<BillingCycle, string>;

/** Lưới an toàn nhập liệu (không phải giá trần bán hàng) — chặn số gõ nhầm thừa chữ số. */
export const PER_ORDER_MAX_ORDERS = 1_000_000;

type PlanPrices = {
  priceMonthly: Prisma.Decimal | number;
  priceQuarterly: Prisma.Decimal | number;
  priceSemiannual: Prisma.Decimal | number;
  priceYearly: Prisma.Decimal | number;
  minOrdersPerMonth: number | null;
};

/** Gói này bán theo số đơn khách tự chọn? */
export function isPerOrderPlan(plan: { minOrdersPerMonth: number | null }): boolean {
  return plan.minOrdersPerMonth != null && plan.minOrdersPerMonth > 0;
}

export class PerOrderInputError extends Error {}

/** Kiểm số đơn khách nhập — trả số nguyên hợp lệ hoặc ném lỗi tiếng người. */
export function validateCommittedOrders(plan: { minOrdersPerMonth: number | null }, raw: unknown): number {
  const min = plan.minOrdersPerMonth ?? 0;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[.,\s]/g, "")) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new PerOrderInputError("Vui lòng nhập số đơn mỗi tháng (số nguyên)");
  }
  if (n < min) {
    throw new PerOrderInputError(`Gói này tối thiểu ${min.toLocaleString("vi-VN")} đơn mỗi tháng`);
  }
  if (n > PER_ORDER_MAX_ORDERS) {
    throw new PerOrderInputError("Số đơn quá lớn — vui lòng đăng ký tư vấn để Hubsell báo giá riêng");
  }
  return n;
}

/**
 * Giá trọn kỳ cho N đơn/tháng. 0 = gói không bán kỳ đó (giữ quy ước 0 của 4 cột giá).
 * Làm tròn tới 1.000 ₫ — giá kỳ ở mức tối thiểu vốn là số tròn nghìn nên tại đúng
 * mức tối thiểu kết quả bằng y giá niêm yết.
 */
export function perOrderPlanPrice(plan: PlanPrices, cycle: BillingCycle, orders: number): number {
  const base = Number(plan[CYCLE_PRICE_KEY[cycle]]);
  const min = plan.minOrdersPerMonth;
  if (!min || min <= 0) return base;
  if (!(base > 0)) return 0;
  return Math.round((base * orders) / min / 1000) * 1000;
}
