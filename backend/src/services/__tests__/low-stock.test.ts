// Cảnh báo sắp hết hàng theo ngưỡng — helper thuần (không DB).
import { describe, expect, it } from "vitest";
import {
  buildLowStockAlert,
  effectiveLowStockThreshold,
  isLowStock,
  LOW_STOCK_ALERT_TYPE,
} from "../low-stock";

const base = {
  id: "p1",
  skuCode: "AO-DEN-M",
  productName: "Áo thun đen M",
  quantityInStock: 10,
  holdQuantity: 2,
  lowStockThreshold: null as number | null,
};

describe("ngưỡng cảnh báo sắp hết hàng", () => {
  it("ngưỡng riêng đè mặc định shop; null dùng mặc định; âm coi như 0", () => {
    expect(effectiveLowStockThreshold({ lowStockThreshold: null }, 5)).toBe(5);
    expect(effectiveLowStockThreshold({ lowStockThreshold: 3 }, 5)).toBe(3);
    expect(effectiveLowStockThreshold({ lowStockThreshold: 0 }, 5)).toBe(0); // 0 = tắt riêng SKU
    expect(effectiveLowStockThreshold({ lowStockThreshold: -1 }, 5)).toBe(0);
  });

  it("so theo tồn KHẢ DỤNG (tồn − giữ), ngưỡng 0 không bao giờ báo", () => {
    // khả dụng = 8
    expect(isLowStock(base, 8)).toBe(true); // bằng ngưỡng là báo
    expect(isLowStock(base, 7)).toBe(false);
    expect(isLowStock(base, 0)).toBe(false);
    expect(isLowStock({ ...base, lowStockThreshold: 0 }, 50)).toBe(false);
    expect(isLowStock({ ...base, quantityInStock: 0 }, 1)).toBe(true);
  });

  it("thẻ cảnh báo: mỗi SKU một khoá, hết hàng nâng severity, deep-link theo SKU", () => {
    const low = buildLowStockAlert(base, 8);
    expect(low.type).toBe(LOW_STOCK_ALERT_TYPE);
    expect(low.dedupeKey).toBe("p1");
    expect(low.severity).toBe("medium");
    expect(low.title).toContain("còn 8");
    expect(low.payload.href).toBe("/products?search=AO-DEN-M");

    const out = buildLowStockAlert({ ...base, quantityInStock: 2 }, 8);
    expect(out.severity).toBe("high");
    expect(out.title).toContain("HẾT hàng");
  });
});
