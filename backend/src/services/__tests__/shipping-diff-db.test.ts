// ============================================================
// loadShipDiffByProduct (10/11/2026) trên DB dev — bất biến khách nhìn thấy:
// Σ "Shop chịu" của MỌI dòng sản phẩm (qua mọi trang) = Σ Order.shippingFeeDiff của
// cùng bộ lọc (= số trên thẻ "Truy thu phí ship"), kể cả khi lọc theo nguyên nhân.
// Chỉ đọc, chạy trên chủ shop có nhiều đơn lệch nhất của DB dev.
// ============================================================

import "../../integrations/__tests__/load-env";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import type { ChannelScope } from "../../lib/channel-filter";
import {
  loadShipDiffByProduct,
  SHIP_REASON_SELECT,
  shipDiffWhere,
  shipGuaranteeGapOf,
  shipGuaranteeGapWhere,
  shipPartsOf,
  shipReasonOf,
  type ShipDiffProductRow,
} from "../shipping-diff";

// Chủ shop có nhiều đơn lệch nhất của DB dev; undefined = không nối được DB hoặc chưa có đơn lệch.
const owner: { userId: string } | undefined = await (async () => {
  try {
    const rows = await prisma.$queryRaw<{ userId: string }[]>`
      SELECT c."userId" FROM "Order" o JOIN "Channel" c ON c.id = o."channelId"
      WHERE o."shippingFeeDiff" > 0 GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`;
    return rows[0];
  } catch {
    return undefined;
  }
})();
if (!owner) console.log("[shipping-diff-db.test] BỎ QUA: không nối được DB dev hoặc chưa có đơn lệch phí ship");

const cents = (n: number) => Math.round(n * 100);

async function allPages(scope: ChannelScope, reasonKey: string) {
  const items: ShipDiffProductRow[] = [];
  let page = 1;
  let first: Awaited<ReturnType<typeof loadShipDiffByProduct>> | undefined;
  for (;;) {
    const r = await loadShipDiffByProduct({ scope, range: undefined, reasonKey, sort: "amount", dir: "desc", page, pageSize: 100 });
    first ??= r;
    items.push(...r.items);
    if (page >= r.pageCount) break;
    page += 1;
  }
  return { summary: first!.summary, total: first!.total, items };
}

describe.skipIf(!owner)("loadShipDiffByProduct", () => {
  const scope: ChannelScope = { userId: owner?.userId ?? "" };

  it("Σ dòng sản phẩm = Σ shippingFeeDiff của thẻ; số đơn khớp; không trùng khóa giữa các trang", async () => {
    const [agg, all] = await Promise.all([
      prisma.order.aggregate({ where: shipDiffWhere(scope, undefined), _count: { _all: true }, _sum: { shippingFeeDiff: true } }),
      allPages(scope, ""),
    ]);
    expect(cents(all.summary.totalAmount)).toBe(cents(Number(agg._sum.shippingFeeDiff)));
    expect(all.summary.orders).toBe(agg._count._all);
    expect(all.items.reduce((s, r) => s + cents(r.amount), 0)).toBe(cents(all.summary.totalAmount));
    expect(all.summary.reasons.reduce((s, r) => s + cents(r.amount), 0)).toBe(cents(all.summary.totalAmount));
    expect(all.summary.reasons.reduce((s, r) => s + r.orders, 0)).toBe(agg._count._all);
    expect(new Set(all.items.map((r) => r.key)).size).toBe(all.items.length);
    expect(all.items.length).toBe(all.total);
    for (const r of all.items) {
      expect(r.reasons.reduce((s, x) => s + cents(x.amount), 0), r.key).toBe(cents(r.amount));
      expect(r.topReason, r.key).toBe(r.reasons[0].reason);
      if (r.rate !== null) {
        expect(r.totalOrders, r.key).toBeGreaterThanOrEqual(r.orders);
        expect(r.rate, r.key).toBeLessThanOrEqual(100);
      }
    }
  });

  it("lọc Khiếu nại được + Theo chính sách sàn cộng lại bằng Tất cả; chip nguyên nhân không đổi theo bộ lọc", async () => {
    const [all, claimable, policy] = await Promise.all([allPages(scope, ""), allPages(scope, "CLAIMABLE"), allPages(scope, "POLICY")]);
    expect(cents(claimable.summary.totalAmount) + cents(policy.summary.totalAmount)).toBe(cents(all.summary.totalAmount));
    expect(claimable.summary.orders + policy.summary.orders).toBe(all.summary.orders);
    expect(claimable.summary.reasons).toEqual(all.summary.reasons);
    expect(
      cents(all.summary.reasons.filter((r) => r.claimable).reduce((s, r) => s + r.amount, 0))
    ).toBe(cents(claimable.summary.totalAmount));
  });

  it("thẻ đếm 'có bảo đảm, vẫn lệch' bằng bộ lọc DB = đếm bằng luật phân loại từng đơn", async () => {
    const [agg, rows] = await Promise.all([
      prisma.order.aggregate({ where: shipGuaranteeGapWhere(scope, undefined), _count: { _all: true }, _sum: { shippingFeeDiff: true } }),
      prisma.order.findMany({ where: shipDiffWhere(scope, undefined), select: SHIP_REASON_SELECT }),
    ]);
    const flagged = rows.filter((o) => shipGuaranteeGapOf(o, shipReasonOf(o)) !== null);
    expect(agg._count._all).toBe(flagged.length);
    expect(cents(Number(agg._sum.shippingFeeDiff ?? 0))).toBe(flagged.reduce((s, o) => s + cents(Number(o.shippingFeeDiff)), 0));
    // Tách tiền: đơn nào tách được thì các phần cộng lại đúng bằng số lệch của đơn.
    for (const o of rows) {
      const p = shipPartsOf(o);
      if (p) expect(cents(p.outbound) + cents(p.returnLeg) + cents(p.surcharge) - cents(p.reimbursed) + cents(p.other), o.id).toBe(cents(Number(o.shippingFeeDiff)));
    }
  });

  it("gian không thuộc chủ shop → rỗng, không lộ số của người khác", async () => {
    const r = await loadShipDiffByProduct({
      scope: { userId: scope.userId, id: "khong-co-gian-nay" },
      range: undefined,
      reasonKey: "",
      sort: "amount",
      dir: "desc",
      page: 1,
      pageSize: 20,
    });
    expect(r.items).toEqual([]);
    expect(r.summary).toEqual({ totalAmount: 0, orders: 0, productCount: 0, reasons: [] });
  });
});
