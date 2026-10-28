import { api } from "./client";
import type {
  MissingCostSkuList,
  SkuProductsResponse,
  UpdateCostResult,
} from "../types/api";

/**
 * Toàn bộ SKU của shop (mọi gian, cả đang bán lẫn đã gỡ) — cùng endpoint trang
 * Cấu hình giá vốn web. ⚠️ Backend chưa phân trang / tìm phía máy chủ: gian
 * vài nghìn SKU về một cục, app lọc tại máy (ghi ở docs/MOBILE-NOI-GIAN-GIA-VON.md).
 */
export function fetchSkuProducts() {
  return api<SkuProductsResponse>("/api/finance/sku-products?channel=all");
}

/**
 * SKU đã BÁN trong kỳ mà chưa có giá vốn, xếp theo số đơn bị ảnh hưởng — chính
 * là danh sách "cần nhập ngay" (đơn đang bị loại khỏi lợi nhuận).
 */
export function fetchMissingCostSkus(from: string, to: string) {
  const q = new URLSearchParams({ from, to }).toString();
  return api<MissingCostSkuList>(`/api/finance/sku-products/missing-cost?${q}`);
}

/** Đặt giá vốn cho MỘT dòng (giá riêng của gian nếu là SKU sàn). */
export function updateSkuCostPrice(skuId: string, costPrice: number) {
  return api<UpdateCostResult>("/api/finance/update-cost", {
    method: "PATCH",
    body: { sku_id: skuId, cost_price: costPrice },
  });
}

/** Một giá cho nhiều dòng (mọi phân loại cùng mẫu) — trần 500 mã/lượt phía backend. */
export function updateSkuCostPriceBulk(skuIds: string[], costPrice: number) {
  return api<{ updated: number; costPrice: string; backfilledOrderLines: number }>(
    "/api/finance/update-cost-bulk",
    { method: "PATCH", body: { sku_ids: skuIds, cost_price: costPrice } }
  );
}
