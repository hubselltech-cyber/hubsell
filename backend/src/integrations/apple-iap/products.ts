// ============================================================
// MÃ SẢN PHẨM APP STORE ↔ GÓI HUBSELL (10/10/2026)
//
// Mỗi (gói, kỳ) là MỘT Non-Renewing Subscription trên App Store Connect, mã
// cố định theo khuôn `vn.hubsell.app.<code gói viết thường>.<kỳ>`:
//   vn.hubsell.app.starter.monthly · vn.hubsell.app.pro.yearly ...
// Mã là BẤT BIẾN sau khi tạo trên ASC nên không lưu DB — hàm thuần suy ra từ
// ServicePlan.code + BillingCycle, và giải ngược khi Apple trả giao dịch về.
// Gói Enterprise (bán bằng tư vấn) và kỳ có giá 0 KHÔNG có sản phẩm.
// ============================================================

import { BillingCycle } from "@prisma/client";

export const APPLE_PRODUCT_PREFIX = "vn.hubsell.app.";

const CYCLE_SUFFIX: Record<BillingCycle, string> = {
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  SEMIANNUAL: "semiannual",
  YEARLY: "yearly",
};

const SUFFIX_CYCLE: Record<string, BillingCycle> = Object.fromEntries(
  (Object.keys(CYCLE_SUFFIX) as BillingCycle[]).map((c) => [CYCLE_SUFFIX[c], c])
) as Record<string, BillingCycle>;

/** Mã gói được phép đặt tên sản phẩm: chữ/số, không dấu, không khoảng trắng. */
export function isAppleSellablePlanCode(code: string): boolean {
  return /^[A-Za-z0-9]+$/.test(code) && code.toUpperCase() !== "ENTERPRISE";
}

export function appleProductId(planCode: string, cycle: BillingCycle): string | null {
  if (!isAppleSellablePlanCode(planCode)) return null;
  return `${APPLE_PRODUCT_PREFIX}${planCode.toLowerCase()}.${CYCLE_SUFFIX[cycle]}`;
}

export interface ParsedAppleProduct {
  /** Mã gói viết THƯỜNG (so với ServicePlan.code bằng mode insensitive). */
  planCodeLower: string;
  cycle: BillingCycle;
}

/** Giải mã sản phẩm Apple → (gói, kỳ); null khi không đúng khuôn Hubsell. */
export function parseAppleProductId(productId: string | null | undefined): ParsedAppleProduct | null {
  if (!productId || !productId.startsWith(APPLE_PRODUCT_PREFIX)) return null;
  const rest = productId.slice(APPLE_PRODUCT_PREFIX.length);
  const m = /^([a-z0-9]+)\.([a-z]+)$/.exec(rest);
  if (!m) return null;
  const cycle = SUFFIX_CYCLE[m[2]];
  if (!cycle) return null;
  return { planCodeLower: m[1], cycle };
}
