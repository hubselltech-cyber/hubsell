import { api } from "./client";

/**
 * MUA GÓI TRONG APP iOS (10/10/2026) — backend phát danh mục mã sản phẩm App
 * Store + appAccountToken của chủ shop; giá hiển thị lấy từ StoreKit, KHÔNG từ
 * backend (Apple duyệt giá trong app phải là giá App Store).
 */
export type AppleCycle = "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "YEARLY";

export interface AppleCatalogItem {
  productId: string;
  planId: string;
  planCode: string;
  planName: string;
  tier: number;
  cycle: AppleCycle;
  maxOrdersPerMonth: number | null;
  maxChannels: number | null;
  maxStaff: number | null;
}

export interface AppleCatalogResponse {
  appAccountToken: string;
  items: AppleCatalogItem[];
}

export function fetchAppleCatalog() {
  return api<AppleCatalogResponse>("/api/subscription/apple-iap/catalog");
}

export interface AppleRedeemResponse {
  ok: true;
  outcome: "recorded" | "duplicate";
  planName: string;
  cycle: AppleCycle;
  periodEnd: string | null;
  sandbox: boolean;
}

/** Gửi JWS giao dịch StoreKit lên backend ghi nhận — idempotent, gửi lại an toàn. */
export function redeemApplePurchase(jws: string) {
  return api<AppleRedeemResponse>("/api/subscription/apple-iap/redeem", {
    method: "POST",
    body: { jws },
  });
}
