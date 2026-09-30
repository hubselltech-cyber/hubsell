// ============================================================
// QUẢNG CÁO Shopee/Lazada trên DB dev: biên lãi + nhịp bán GOM TRONG DATABASE
// (ledgerMarginByGroup) phải bằng đường duyệt mảng đơn trong RAM (marginOverRows)
// trên DỮ LIỆU THẬT của DB dev — cho bộ nhóm thật của gian (sản phẩm, chiến
// dịch) và các nhóm thử dựng từ chính SKU có đơn, để phép so luôn có nghĩa dù
// gian dev chưa đồng bộ danh mục hay chưa có chiến dịch.
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 6). Chưa áp migration sổ cái → BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import { ensureLedgerFresh, ledgerMarginByGroup, LEDGER_MARGIN_SHOP_GROUP } from "../../services/order-ledger";
import {
  SALES_PACE_RECENT_MS,
  SHOP_GROUP,
  adsGroupMappingOf,
  campaignGroupKey,
  loadAdsGroupSets,
  loadMarginGroups,
  loadMarginRows,
  marginOverRows,
  marginWindowRange,
  marginsFromRows,
  pnlRowsForMargin,
  productGroupKey,
  type AdsGroupSets,
} from "../shopee/ads-insights";
import { compareMarginSources } from "../shopee/ads-margin-compare";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[ads-margin-sql-db.test] BỎ QUA: DB dev chưa có bảng order_line_ledger");
}

async function channels() {
  const list = await prisma.channel.findMany({
    where: { channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] } },
    select: { id: true, userId: true, channelName: true, shopName: true },
    orderBy: { id: "asc" },
  });
  for (const userId of new Set(list.map((c) => c.userId))) {
    const fresh = await ensureLedgerFresh({ userId }, undefined, { maxInline: 20_000 });
    expect(fresh.dirty, `${userId} còn dòng bẩn`).toBe(0);
  }
  return list;
}

/**
 * Nhóm thử của một gian, dựng từ các SKU có đơn trong cửa sổ:
 *   · "t:all"    — MỌI SKU: phải bằng đúng nhóm toàn gian (đơn nhiều dòng đếm một lần);
 *   · "t:3"      — ba SKU đầu gộp lại;
 *   · "t:sku:…"  — từng SKU riêng (tối đa 25);
 *   · "p:test-…" — SKU chưa thuộc sản phẩm sàn nào, coi như một sản phẩm, để nhịp bán có cái so.
 */
async function testSets(ch: { id: string; userId: string; channelName: ChannelName }): Promise<{
  extra: AdsGroupSets;
  lines: number;
  orders: number;
}> {
  const rows = pnlRowsForMargin(await loadMarginRows(ch, "ledger"), ch.channelName);
  const skus = [...new Set(rows.flatMap((r) => r.items.map((i) => i.sku)))].sort();
  const extra: AdsGroupSets = new Map();
  if (skus.length > 0) extra.set("t:all", new Set(skus));
  if (skus.length >= 3) extra.set("t:3", new Set(skus.slice(0, 3)));
  for (const sku of skus.slice(0, 25)) extra.set(`t:sku:${sku}`, new Set([sku]));
  const inRealProduct = new Set<string>();
  for (const [key, set] of await loadAdsGroupSets(ch.id)) {
    if (key.startsWith("p:")) for (const sku of set) inRealProduct.add(sku);
  }
  skus
    .filter((sku) => !inRealProduct.has(sku))
    .slice(0, 25)
    .forEach((sku, i) => extra.set(productGroupKey(`test-${i}`), new Set([sku])));
  return { extra, lines: rows.reduce((n, r) => n + r.items.length, 0), orders: rows.length };
}

describe.skipIf(!ledgerReady)("Quảng cáo Shopee/Lazada — gom trong database = duyệt mảng đơn, trên DB dev", () => {
  it("từng nhóm (toàn gian, sản phẩm, chiến dịch, nhóm thử) + nhịp bán + ba kết quả cuối", { timeout: 300_000 }, async () => {
    let withOrders = 0;
    let multiLineChannels = 0;
    for (const ch of await channels()) {
      const tag = `${ch.shopName} (${ch.channelName})`;
      const { extra, lines, orders } = await testSets(ch);
      const report = await compareMarginSources(ch, { extraSets: extra });
      expect(report.capped, `${tag} chạm phanh`).toBe(false);
      expect(report.baseMismatches, `${tag} lệch số gốc`).toEqual([]);
      expect(report.paceMismatches, `${tag} lệch nhịp bán`).toEqual([]);
      expect(report.endToEndMismatches, `${tag} lệch kết quả cuối`).toEqual([]);
      expect(report.ok, tag).toBe(true);
      if (orders === 0) continue;
      withOrders += 1;
      if (lines > orders) multiLineChannels += 1;
      console.log(
        `[ads-margin-sql-db] ${tag}: ${report.groups} nhóm, ${orders} đơn / ${lines} dòng, ` +
          `lệch tiền lớn nhất ${report.maxMoneyDiff.toFixed(4)}đ, rows ${report.timing.rowsMs}ms, sql ${report.timing.sqlMs}ms`
      );
    }
    expect(withOrders, "DB dev phải có gian Shopee/Lazada có đơn 30 ngày để phép so có nghĩa").toBeGreaterThan(0);
    expect(multiLineChannels, "DB dev phải có gian có đơn nhiều dòng để thử phép đếm mã đơn phân biệt").toBeGreaterThan(0);
  });

  it("nhóm mọi SKU = nhóm toàn gian; ánh xạ trùng cặp không cộng đôi; ánh xạ rỗng chỉ ra nhóm toàn gian", { timeout: 120_000 }, async () => {
    for (const ch of await channels()) {
      const tag = `${ch.shopName} (${ch.channelName})`;
      const range = marginWindowRange();
      const rows = pnlRowsForMargin(await loadMarginRows(ch, "ledger", range), ch.channelName);
      if (rows.length === 0) continue;
      const scope = { userId: ch.userId, id: ch.id, channelName: ch.channelName };
      const opts = { settledOnly: ch.channelName === ChannelName.LAZADA, recentSince: new Date(range.lte.getTime() - 7 * 86_400_000) };
      const skus = [...new Set(rows.flatMap((r) => r.items.map((i) => i.sku)))];

      // Mỗi cặp gửi HAI lần: kết quả vẫn phải bằng nhóm toàn gian.
      const doubled = await ledgerMarginByGroup(
        scope,
        range,
        { groups: [...skus, ...skus].map(() => "t:all"), skus: [...skus, ...skus] },
        opts
      );
      const shop = doubled.get(LEDGER_MARGIN_SHOP_GROUP)!;
      expect(doubled.get("t:all"), `${tag} nhóm mọi SKU`).toEqual(shop);
      // Đếm theo ĐƠN chứ không theo dòng.
      const pure = marginOverRows(rows, null);
      expect(shop.orders, `${tag} số đơn`).toBe(pure.orders);
      expect(shop.missingCostOrders, `${tag} đơn thiếu giá vốn`).toBe(pure.missingCostOrders);
      expect(shop.units, `${tag} số lượng`).toBe(rows.reduce((n, r) => n + r.items.reduce((s, i) => s + i.quantity, 0), 0));

      const none = await ledgerMarginByGroup(scope, range, { groups: [], skus: [] }, opts);
      expect([...none.keys()], `${tag} ánh xạ rỗng`).toEqual([SHOP_GROUP]);
      expect(none.get(SHOP_GROUP)).toEqual(shop);
    }
  });

  it("ánh xạ hỏng bị từ chối trước khi chạm database", async () => {
    const scope = { userId: "khong-co", id: "khong-co" };
    const range = marginWindowRange();
    const opts = { settledOnly: false, recentSince: new Date() };
    await expect(ledgerMarginByGroup(scope, range, { groups: ["p:1"], skus: [] }, opts)).rejects.toThrow(/lệch độ dài/);
    await expect(
      ledgerMarginByGroup(scope, range, { groups: [LEDGER_MARGIN_SHOP_GROUP], skus: ["A"] }, opts)
    ).rejects.toThrow(/dành riêng/);
  });
});

// ------------------------------------------------------------
// Bộ đơn TỰ DỰNG cho các ca mà dữ liệu dev không có sẵn: đơn quà tặng giá 0,
// dòng quà trong đơn có hàng, đơn hủy, đơn thiếu giá vốn, đơn ngoài cửa sổ,
// phần phân bổ bị làm tròn. Số kỳ vọng suy từ chính cách dựng.
// ------------------------------------------------------------
describe.skipIf(!ledgerReady)("Quảng cáo Shopee/Lazada — gom trong database trên bộ đơn tự dựng", () => {
  let fx: StockFixture;
  let campaignRowId: string;
  let o1CreatedAt: Date;
  const channel = () => ({ id: fx.channelId, userId: fx.userId, channelName: ChannelName.SHOPEE });
  const sku = (name: string) => `TEST-${fx.suffix}-${name}`;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  async function order(
    code: string,
    items: { sku: string; quantity: number; price: number; cost: number }[],
    data: { createdAt?: Date; shippingStatus?: ShippingStatus; sellerVoucher?: number } = {}
  ) {
    return prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: `TEST-${fx.suffix}-${code}`,
        customerName: "Khách test",
        itemCount: items.length,
        ...data,
        items: {
          create: items.map((it) => ({
            channelSku: sku(it.sku),
            productName: `Dòng ${it.sku}`,
            quantity: it.quantity,
            price: it.price,
            costPriceAtSale: it.cost,
          })),
        },
      },
    });
  }

  beforeAll(async () => {
    fx = await createStockFixture("adsmargin");
    // Sản phẩm sàn: 100 = hai phân loại A1/A2; 200 = quà tặng G; 300 = B (chưa có giá vốn); 400 = R1..R3.
    await prisma.channelProduct.createMany({
      data: [
        ["A1", "100-1"], ["A2", "100-2"], ["G", "200"], ["B", "300"],
        ["R1", "400-1"], ["R2", "400-2"], ["R3", "400-3"],
      ].map(([name, externalId]) => ({
        channelId: fx.channelId,
        channelSku: sku(name),
        productName: `SP sàn test ${name}`,
        externalId,
      })),
    });
    const campaign = await prisma.adsCampaign.create({
      data: { channelId: fx.channelId, campaignId: `TEST-${fx.suffix}`, status: "ongoing", itemIds: "100,200" },
    });
    campaignRowId = campaign.id;

    // O1: hai phân loại của CÙNG sản phẩm → nhóm sản phẩm / chiến dịch đếm một đơn.
    const o1 = await order("O1", [
      { sku: "A1", quantity: 1, price: 100_000, cost: 40_000 },
      { sku: "A2", quantity: 2, price: 50_000, cost: 20_000 },
    ]);
    o1CreatedAt = o1.createdAt;
    // O2: đơn chỉ có quà giá 0 → không vào biên lãi ở nhóm nào, vẫn tính nhịp bán.
    await order("O2", [{ sku: "G", quantity: 1, price: 0, cost: 5_000 }]);
    // O3: hàng + quà giá 0 → nhóm quà không có đơn biên lãi, nhóm hàng nhận trọn đơn.
    await order("O3", [
      { sku: "A1", quantity: 1, price: 100_000, cost: 40_000 },
      { sku: "G", quantity: 1, price: 0, cost: 5_000 },
    ]);
    // O4: đơn hủy → đứng ngoài cả biên lãi lẫn nhịp bán.
    await order("O4", [{ sku: "A1", quantity: 1, price: 100_000, cost: 40_000 }], {
      shippingStatus: ShippingStatus.CANCELLED,
    });
    // O5: thiếu giá vốn → chỉ vào độ phủ.
    await order("O5", [{ sku: "B", quantity: 3, price: 30_000, cost: 0 }]);
    // O6: trong cửa sổ 30 ngày nhưng ngoài 7 ngày gần đây.
    await order("O6", [{ sku: "A1", quantity: 1, price: 100_000, cost: 40_000 }], { createdAt: daysAgo(10) });
    // O7: ngoài cửa sổ.
    await order("O7", [{ sku: "A1", quantity: 1, price: 100_000, cost: 40_000 }], { createdAt: daysAgo(40) });
    // O8: ba dòng bằng nhau + voucher shop 1.000 → phần phân bổ mỗi dòng bị làm tròn (29.000 ÷ 3).
    await order(
      "O8",
      ["R1", "R2", "R3"].map((name) => ({ sku: name, quantity: 1, price: 10_000, cost: 3_000 })),
      { sellerVoucher: 1_000 }
    );
    // O9: đơn thiếu giá vốn có kèm quà giá 0 → nhóm quà KHÔNG nhận đơn thiếu giá vốn nào.
    await order("O9", [
      { sku: "B", quantity: 1, price: 30_000, cost: 0 },
      { sku: "G", quantity: 1, price: 0, cost: 5_000 },
    ]);
    // O10: đơn thiếu giá vốn có HAI dòng cùng SKU → nhóm đếm một đơn thiếu giá vốn.
    await order("O10", [
      { sku: "B", quantity: 1, price: 30_000, cost: 0 },
      { sku: "B", quantity: 1, price: 30_000, cost: 0 },
    ]);

    const fresh = await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 });
    expect(fresh.dirty).toBe(0);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("số đơn, độ phủ và nhịp bán của từng nhóm đúng như cách dựng", async () => {
    const groups = await loadMarginGroups(channel(), adsGroupMappingOf(await loadAdsGroupSets(fx.channelId)));

    const shop = groups.get(SHOP_GROUP)!;
    expect(shop.base.orders).toBe(4); // O1, O3, O6, O8 — không có O2 (giá 0), O4 (hủy), O5/O9/O10 (thiếu vốn), O7 (ngoài cửa sổ)
    expect(shop.base.missingCostOrders).toBe(3); // O5, O9, O10

    const a = groups.get(productGroupKey("100"))!;
    expect(a.base.orders).toBe(3); // O1 (hai dòng, đếm một), O3, O6
    expect(a.base.missingCostOrders).toBe(0);
    expect(a.pace).toEqual({ units30d: 5, units7d: 4, unitsNoCost: 0 });

    const gift = groups.get(productGroupKey("200"))!;
    expect(gift.base.orders).toBe(0);
    expect(gift.base.revenue).toBe(0);
    expect(gift.base.profit).toBe(0); // dòng quà của O2 mang lợi nhuận âm trên sổ (chia đều) nhưng không được cộng
    expect(gift.base.missingCostOrders).toBe(0); // O9 có quà nhưng dòng quà giá 0
    expect(gift.base.costCoveragePct).toBeNull();
    expect(gift.pace).toEqual({ units30d: 3, units7d: 3, unitsNoCost: 0 }); // O2, O3, O9

    const b = groups.get(productGroupKey("300"))!;
    expect(b.base.orders).toBe(0);
    expect(b.base.missingCostOrders).toBe(3); // O5, O9, O10 (hai dòng, đếm một)
    expect(b.base.costCoveragePct).toBe(0);
    expect(b.pace).toEqual({ units30d: 6, units7d: 6, unitsNoCost: 6 });

    const r = groups.get(productGroupKey("400"))!;
    expect(r.base.orders).toBe(1);
    expect(r.base.revenue).toBeCloseTo(29_000, 2); // Σ ba dòng = đơn, từng xu

    const c = groups.get(campaignGroupKey(campaignRowId))!;
    expect(c.base.orders).toBe(3); // O1, O3 (hàng + quà cùng nhóm, đếm một), O6; O2 chỉ có quà → không tính
    expect(c.base.revenue).toBeCloseTo(a.base.revenue, 2);
    expect(c.base.missingCostOrders).toBe(0); // O9 chỉ chạm nhóm qua dòng quà giá 0
  });

  it("hai đường cộng bằng nhau ở mọi nhóm, kể cả nhóm một dòng của đơn bị làm tròn; ba kết quả cuối giống nhau", async () => {
    const extra: AdsGroupSets = new Map([
      ["t:R1", new Set([sku("R1")])],
      ["t:R1R2", new Set([sku("R1"), sku("R2")])],
      ["t:khong-co-don", new Set([sku("KHONG-BAN")])],
    ]);
    const report = await compareMarginSources(channel(), { extraSets: extra });
    expect(report.baseMismatches).toEqual([]);
    expect(report.paceMismatches).toEqual([]);
    expect(report.endToEndMismatches).toEqual([]);
    expect(report.ok).toBe(true);
    // Có lệch làm tròn thật (nhóm một dòng của O8) nhưng dưới 1 xu mỗi dòng.
    expect(report.maxMoneyDiff).toBeGreaterThan(0);
    expect(report.maxMoneyDiff).toBeLessThan(0.02);
  });

  it("mốc 7 ngày gần đây tính cả đơn tạo ĐÚNG mốc (>=), như đường duyệt mảng", async () => {
    const range = marginWindowRange();
    const scope = { userId: fx.userId, id: fx.channelId, channelName: ChannelName.SHOPEE };
    const mapping = adsGroupMappingOf(await loadAdsGroupSets(fx.channelId));
    const at = await ledgerMarginByGroup(scope, range, mapping, { settledOnly: false, recentSince: o1CreatedAt });
    const after = await ledgerMarginByGroup(scope, range, mapping, {
      settledOnly: false,
      recentSince: new Date(o1CreatedAt.getTime() + 1),
    });
    // O1 góp 3 đơn vị vào sản phẩm 100: mốc trùng giờ tạo thì còn, lùi sau 1 mili giây thì mất.
    expect(at.get(productGroupKey("100"))!.unitsRecent - after.get(productGroupKey("100"))!.unitsRecent).toBe(3);
    const rows = pnlRowsForMargin(await loadMarginRows(channel(), "ledger", range), ChannelName.SHOPEE);
    const pure = marginsFromRows(rows, await loadAdsGroupSets(fx.channelId), o1CreatedAt.getTime() + SALES_PACE_RECENT_MS);
    expect(pure.productPace().get("100")!.units7d).toBe(at.get(productGroupKey("100"))!.unitsRecent);
  });
});
