// ============================================================
// SỔ CÁI ĐƠN — hai cách GHI một lô (LedgerWriteStyle) phải cho cùng một sổ:
//   "values": VALUES ghép từng giá trị thành tham số riêng (cách cũ);
//   "json"  : cả lô trong một tham số JSON, database tách dòng (mặc định từ
//             01/10/2026 — xem services/order-ledger.ts).
// Ghi cùng một nhóm đơn bằng hai cách rồi so TỪNG cột của order_ledger và
// order_line_ledger (trừ computedAt = giờ ghi, dirtyReason = lý do đánh dấu).
//
// Cần migration sổ cái đã áp lên DB dev; chưa áp → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import {
  drainLedgerOnce,
  ledgerFreshness,
  markLedgerScope,
  withLedgerWriteStyle,
  type LedgerWriteStyle,
} from "../../services/order-ledger";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[order-ledger-write-style-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

describe.skipIf(!ledgerReady)("Sổ cái đơn — ghi kiểu JSON khớp ghi kiểu VALUES từng cột", () => {
  let fx: StockFixture;
  const scope = () => ({ userId: fx.userId });

  const drainAll = async (style: LedgerWriteStyle) => {
    await withLedgerWriteStyle(style, async () => {
      for (let i = 0; i < 10; i++) {
        const r = await drainLedgerOnce(100, { scope: scope() });
        if (r.claimed === 0) break;
      }
    });
  };

  /** Toàn bộ dòng sổ của chủ shop test, bỏ hai cột không thuộc nội dung tính toán. */
  const snapshot = async () => {
    const orders = await prisma.orderLedger.findMany({
      where: { ownerId: fx.userId },
      orderBy: [{ createdDate: "asc" }, { orderId: "asc" }],
    });
    const lines = await prisma.orderLineLedger.findMany({
      where: { ownerId: fx.userId },
      orderBy: [{ createdDate: "asc" }, { orderItemId: "asc" }],
    });
    // Qua JSON để Decimal / Date thành chuỗi — so đúng từng số lẻ, từng mili giây.
    return JSON.parse(
      JSON.stringify({
        orders: orders.map(({ computedAt: _c, dirtyReason: _r, ...rest }) => rest),
        lines,
      })
    ) as { orders: Record<string, unknown>[]; lines: Record<string, unknown>[] };
  };

  beforeAll(async () => {
    fx = await createStockFixture("ledger-style");
    const productId = await fx.createProduct(50);

    // Đơn thường; đơn hủy; đơn đang hoàn; đơn đã giao + đã quyết toán có thêm dòng hàng
    // chưa nối SKU kho với tên chứa nháy, gạch chéo, chữ có dấu, emoji và số tiền lẻ;
    // đơn tạo 45 ngày trước (lô ghi trải hai mảnh tháng).
    await fx.createOrder(productId, 2);
    const cancelled = await fx.createOrder(productId, 1);
    await prisma.order.update({ where: { id: cancelled }, data: { shippingStatus: ShippingStatus.CANCELLED } });
    const returning = await fx.createOrder(productId, 3);
    await prisma.order.update({ where: { id: returning }, data: { returnStatus: ReturnStatus.AWAITING } });
    const delivered = await fx.createOrder(productId, 4);
    await prisma.order.update({
      where: { id: delivered },
      data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: new Date(Date.now() - 86_400_000 - 123), isSettled: true },
    });
    await prisma.orderItem.create({
      data: {
        orderId: delivered,
        channelSku: `TEST-${fx.suffix}-"lạ"\\'sku'`,
        productName: `Áo "đỏ" \\ 100% cotton 🧵 'size' L — dòng {json} [1,2]`,
        quantity: 3,
        price: 33333.33,
        costPriceAtSale: 12345.67,
      },
    });
    const old = await fx.createOrder(productId, 5);
    await prisma.order.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 45 * 86_400_000) } });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("ghi cùng nhóm đơn bằng hai cách → mọi cột của sổ đơn và sổ dòng hàng giống hệt", async () => {
    await drainAll("values");
    expect((await ledgerFreshness(scope())).dirty).toBe(0);
    const byValues = await snapshot();
    expect(byValues.orders).toHaveLength(5);
    expect(byValues.lines).toHaveLength(6);
    expect(new Set(byValues.orders.map((o) => String(o.createdDate).slice(0, 7))).size).toBe(2);

    const marked = await markLedgerScope(scope(), undefined, "test:write-style");
    expect(marked.marked).toBe(5);
    await drainAll("json");
    expect((await ledgerFreshness(scope())).dirty).toBe(0);
    const byJson = await snapshot();

    expect(byJson).toEqual(byValues);
    for (const o of byJson.orders) {
      expect(o.dirtyAt).toBeNull();
      expect(o.claimedAt).toBeNull();
    }
  });

  it("ghi lại bằng cách cũ sau cách mới → vẫn giống hệt (đường lui LEDGER_WRITE_STYLE=values)", async () => {
    const byJson = await snapshot();
    await markLedgerScope(scope(), undefined, "test:write-style-back");
    await drainAll("values");
    expect(await snapshot()).toEqual(byJson);
  });
});
