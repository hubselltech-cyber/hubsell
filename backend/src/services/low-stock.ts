// ============================================================
// CẢNH BÁO SẮP HẾT HÀNG THEO NGƯỠNG — helper thuần (không đụng DB)
//
// Nguyên lý (anh Trung chốt 05/09): chủ shop đặt một con số; tồn KHẢ DỤNG
// (quantityInStock − holdQuantity, tức hàng chưa bị đơn nào giữ) rơi xuống
// ≤ số đó → phát cảnh báo: chuông thông báo + thẻ Trung tâm điều hành.
// Nhập thêm kho vượt ngưỡng → thẻ tự đóng; rơi xuống lần nữa → báo lại.
//
// Ngưỡng: Product.lowStockThreshold (riêng SKU) ?? ShopSyncSetting.lowStockDefault
// (toàn shop). 0 = tắt. KHÔNG trừ tồn an toàn — tồn an toàn là đệm chống bán
// vượt trên sàn, còn đây là hàng thật còn trong kho.
//
// Hai đường dùng chung file này để không lệch nhau:
//   · Đường SỰ KIỆN: mọi biến động kho → checkLowStock() (ops-alerts.ts) —
//     báo NGAY khi rơi qua ngưỡng, không chờ vòng quét.
//   · Đường QUÉT: detector detectLowStock trong scanOpsAlerts (10'/lần) — lưới
//     an toàn cho biến động đi đường khác (Excel, TikTok cũ…) + tự đóng thẻ.
// ============================================================

import type { DetectedAlert } from "./ops-alerts";

export const LOW_STOCK_ALERT_TYPE = "low-stock";

export interface LowStockFields {
  id: string;
  skuCode: string;
  productName: string;
  quantityInStock: number;
  holdQuantity: number;
  lowStockThreshold: number | null;
}

/** Ngưỡng đang áp cho SKU (riêng ?? mặc định shop). 0 = tắt. */
export function effectiveLowStockThreshold(
  p: { lowStockThreshold: number | null },
  shopDefault: number
): number {
  return Math.max(0, p.lowStockThreshold ?? shopDefault);
}

/** Tồn khả dụng thật trong kho (chưa trừ tồn an toàn). */
export function availableInStock(p: { quantityInStock: number; holdQuantity: number }): number {
  return p.quantityInStock - p.holdQuantity;
}

/** SKU đang ở/dưới ngưỡng cảnh báo (ngưỡng > 0). */
export function isLowStock(
  p: { quantityInStock: number; holdQuantity: number; lowStockThreshold: number | null },
  shopDefault: number
): boolean {
  const t = effectiveLowStockThreshold(p, shopDefault);
  return t > 0 && availableInStock(p) <= t;
}

/** Thẻ cảnh báo cho MỘT SKU — dedupeKey = productId để mỗi SKU một thẻ, tự đóng khi nhập thêm. */
export function buildLowStockAlert(p: LowStockFields, threshold: number): DetectedAlert {
  const available = availableInStock(p);
  const out = available <= 0;
  const holdNote = p.holdQuantity > 0 ? `, đang giữ cho đơn ${p.holdQuantity}` : "";
  return {
    type: LOW_STOCK_ALERT_TYPE,
    dedupeKey: p.id,
    tag: "inventory",
    severity: out ? "high" : "medium",
    title: out
      ? `SKU ${p.skuCode} đã HẾT hàng trong kho (ngưỡng cảnh báo ${threshold})`
      : `SKU ${p.skuCode} sắp hết hàng: còn ${available} (ngưỡng ${threshold})`,
    summary: `${p.productName} — tồn ${p.quantityInStock}${holdNote}, khả dụng ${available} đã ${
      out ? "về 0" : `chạm ngưỡng ${threshold}`
    }. Nhập thêm kho để không đứt hàng; nhập vượt ngưỡng là thẻ tự đóng.`,
    payload: {
      kind: "navigate",
      href: `/products?search=${encodeURIComponent(p.skuCode)}`,
      label: "Nhập kho ngay",
    },
  };
}
