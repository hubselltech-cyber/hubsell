// ============================================================
// SỔ DÒNG HÀNG MANG ID LÁ SÀN (Lát 1a, 18/10/2026 — docs/MO-HINH-CAY-SAN-PHAM-SAN.md):
// dòng sổ chép OrderItem.externalId và suy itemId (SPU) để câu gom theo sản phẩm /
// chiến dịch JOIN thẳng theo id. Thuần, không DB.
// ============================================================

import { describe, expect, it } from "vitest";
import { buildLedgerRows, ledgerItemIdOf } from "../order-ledger";
import { D, mkOrder } from "./ledger-order-fixture";

describe("ledgerItemIdOf — SPU từ id lá", () => {
  it("item-leaf → item; SP đơn Shopee (không dấu gạch) → chính nó; trống → null", () => {
    expect(ledgerItemIdOf("1729515122339187124-1729515122339203508")).toBe("1729515122339187124");
    expect(ledgerItemIdOf("111-2")).toBe("111");
    expect(ledgerItemIdOf("111")).toBe("111");
    expect(ledgerItemIdOf(null)).toBeNull();
    expect(ledgerItemIdOf(undefined)).toBeNull();
    expect(ledgerItemIdOf("")).toBeNull();
  });
});

describe("buildLedgerRows — dòng hàng mang externalId + itemId", () => {
  it("dòng có id → chép id + SPU; dòng chưa có id (đơn cũ, Lazada) → null, tiền không đổi", () => {
    const o = mkOrder({
      items: [
        { id: "i1", channelSku: "TC025-XAM (XÁM)", externalId: "1729515122339187124-1729515122339203508", price: D(269000), costPriceAtSale: D(131000) },
        { id: "i2", channelSku: "TC025-XAM", externalId: null, price: D(100000), costPriceAtSale: D(40000) },
      ],
    });
    const { lines, order } = buildLedgerRows(o);
    expect(lines.map((l) => [l.channelSku, l.externalId, l.itemId])).toEqual([
      ["TC025-XAM (XÁM)", "1729515122339187124-1729515122339203508", "1729515122339187124"],
      ["TC025-XAM", null, null],
    ]);
    // Thêm id không đụng tiền: Σ dòng vẫn bằng đơn.
    expect(lines.reduce((s, l) => s + l.actualRevenue, 0)).toBeCloseTo(order.actualRevenue, 2);
    expect(lines.reduce((s, l) => s + l.profit, 0)).toBeCloseTo(order.profit, 2);
  });
});
