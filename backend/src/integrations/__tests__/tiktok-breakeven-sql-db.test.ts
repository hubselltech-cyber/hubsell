// ============================================================
// QUẢNG CÁO TikTok trên DB dev: nguyên liệu hòa vốn + tự kiểm mẫu số + đà bán
// GOM TRONG DATABASE (ledgerTiktokBreakevenByGroup) phải bằng đường duyệt mảng
// đơn trong RAM (tiktokBreakevenBase…). DB dev không có gian TikTok nên test tự
// dựng một gian với đủ các ca của luật: bản kê thật, bản kê ước tính, cờ đối
// soát không có bản kê, đơn hủy trước / sau mốc cùng lứa, đơn không có dòng hàng
// làm mốc cùng lứa, đơn thiếu giá vốn, quà tặng giá 0, đơn nhiều SKU, phần phân
// bổ bị làm tròn, đơn ngoài cửa sổ / ngoài 30 ngày / ngoài 7 ngày, khoảng tự
// kiểm riêng từng chiến dịch. Số kỳ vọng suy từ chính cách dựng.
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12). Chưa áp migration sổ cái → BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { vnDateKey } from "../../lib/ads-dates";
import { SHOP_GROUP, campaignGroupKey, productGroupKey, type AdsGroupSets } from "../../lib/ads-margin";
import { prisma } from "../../lib/prisma";
import {
  TIKTOK_PACE_RECENT_MS,
  breakevensFromRows,
  tiktokGroupMappingOf,
  tiktokMarginWindowRange,
} from "../../lib/tiktok-breakeven";
import { ensureLedgerFresh, ledgerTiktokBreakevenByGroup } from "../../services/order-ledger";
import { BREAKEVEN_MIN_COVERAGE_PCT } from "../tiktok-ads/auto-rules";
import { computeTiktokAdsBreakevenUncached, computeTiktokProductBreakevensUncached } from "../tiktok-ads/breakeven";
import { compareBreakevenSources } from "../tiktok-ads/breakeven-compare";
import { loadBreakevenGroups, loadBreakevenInputs, loadBreakevenRows } from "../tiktok-ads/breakeven-source";
import { createStockFixture, type StockFixture } from "./fixtures";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[tiktok-breakeven-sql-db.test] BỎ QUA: DB dev chưa có bảng order_line_ledger");
}

describe.skipIf(!ledgerReady)("Quảng cáo TikTok — gom hòa vốn trong database trên bộ đơn tự dựng", () => {
  let fx: StockFixture;
  let c1: string; // chiến dịch chứa sản phẩm 100 + 200, có số quảng cáo từ 20 ngày trước
  let c2: string; // chiến dịch chứa sản phẩm 400, chưa có số quảng cáo → không tự kiểm
  let c3: string; // chiến dịch chưa biết sản phẩm
  let n1CreatedAt: Date;
  const channel = () => ({ id: fx.channelId, userId: fx.userId });
  const scope = () => ({ userId: fx.userId, id: fx.channelId, channelName: ChannelName.TIKTOK });
  const sku = (name: string) => `TEST-${fx.suffix}-${name}`;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  /** settlement: "real" = bản kê đã quyết toán, "estimated" = số ước tính của sàn, bỏ trống = chưa có bản kê. */
  async function order(
    code: string,
    items: { sku: string; quantity: number; price: number; cost: number }[],
    data: {
      daysAgo?: number;
      createdAt?: Date;
      cancelled?: boolean;
      isSettled?: boolean;
      settlement?: "real" | "estimated";
      feeGmvMax?: number;
      sellerVoucher?: number;
    } = {}
  ) {
    return prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: `TEST-${fx.suffix}-${code}`,
        customerName: "Khách test",
        itemCount: items.length,
        ...(data.createdAt ? { createdAt: data.createdAt } : data.daysAgo != null ? { createdAt: daysAgo(data.daysAgo) } : {}),
        shippingStatus: data.cancelled ? ShippingStatus.CANCELLED : ShippingStatus.DELIVERED,
        isSettled: data.isSettled ?? data.settlement === "real",
        ...(data.sellerVoucher != null ? { sellerVoucher: data.sellerVoucher } : {}),
        items: {
          create: items.map((it) => ({
            channelSku: sku(it.sku),
            productName: `Dòng ${it.sku}`,
            quantity: it.quantity,
            price: it.price,
            costPriceAtSale: it.cost,
          })),
        },
        ...(data.settlement
          ? { tiktokSettlement: { create: { estimated: data.settlement === "estimated", feeGmvMax: data.feeGmvMax ?? 0 } } }
          : {}),
      },
    });
  }
  const a1 = (quantity = 1) => ({ sku: "A1", quantity, price: 100_000, cost: 40_000 });
  const a2 = (quantity = 1) => ({ sku: "A2", quantity, price: 50_000, cost: 20_000 });
  const gift = { sku: "G", quantity: 1, price: 0, cost: 5_000 };
  const b = (quantity = 1) => ({ sku: "B", quantity, price: 30_000, cost: 0 });

  beforeAll(async () => {
    fx = await createStockFixture("ttbreakeven");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.TIKTOK } });
    // Sản phẩm sàn (externalId = "productId-skuId"): 100 = A1/A2; 200 = quà tặng G; 300 = B (chưa có giá vốn); 400 = R1..R3.
    await prisma.channelProduct.createMany({
      data: [
        ["A1", "100-1"], ["A2", "100-2"], ["G", "200-1"], ["B", "300-1"],
        ["R1", "400-1"], ["R2", "400-2"], ["R3", "400-3"],
      ].map(([name, externalId]) => ({
        channelId: fx.channelId,
        channelSku: sku(name),
        productName: `SP sàn test ${name}`,
        externalId,
      })),
    });
    const campaign = (code: string, itemIds: string) =>
      prisma.adsCampaign.create({
        data: { channelId: fx.channelId, campaignId: `TEST-${fx.suffix}-${code}`, name: code, status: "ongoing", itemIds },
      });
    c1 = (await campaign("C1", "100,200")).id;
    c2 = (await campaign("C2", "400")).id;
    c3 = (await campaign("C3", "")).id;
    // Số quảng cáo của C1: mỗi ngày từ 20 ngày trước tới hôm nay (ngày sàn, giờ VN).
    await prisma.adsCampaignDailyPerf.createMany({
      data: Array.from({ length: 21 }, (_, d) => ({
        adsCampaignId: c1,
        date: new Date(`${vnDateKey(d)}T00:00:00Z`),
        expense: 10_000,
        broadGmv: 100_000,
      })),
    });

    // ---- Đã đối soát THẬT ----
    // S1: hai phân loại của CÙNG sản phẩm → nhóm sản phẩm / chiến dịch đếm một đơn.
    await order("S1", [a1(), a2(2)], { daysAgo: 25, settlement: "real", feeGmvMax: -10_000 });
    await order("S2", [a1()], { daysAgo: 24, settlement: "real", feeGmvMax: -5_000 });
    // S3: hàng + quà giá 0 → nhóm quà không có đơn hòa vốn, nhóm hàng nhận trọn đơn.
    await order("S3", [a1(), gift], { daysAgo: 23, settlement: "real", feeGmvMax: -5_000 });
    // S4: đơn chỉ có quà giá 0 (kèm voucher shop → dòng quà mang tiền ÂM trên sổ) → không vào hòa vốn ở nhóm nào, vẫn tính đà bán.
    await order("S4", [gift], { daysAgo: 22, settlement: "real", sellerVoucher: 500, feeGmvMax: -700 });
    // S9: như S4 nhưng quà chưa có giá vốn, nằm trong khoảng tự kiểm của C1 → không vào độ phủ, không vào tự kiểm.
    await order("S9", [{ ...gift, cost: 0 }], { daysAgo: 19, settlement: "real", sellerVoucher: 300 });
    // S5: thiếu giá vốn → chỉ vào độ phủ.
    await order("S5", [b(3)], { daysAgo: 21, settlement: "real", feeGmvMax: -4_000 });
    // S6: ba dòng bằng nhau + voucher shop 1.000 + phí 1.000 → phần phân bổ mỗi dòng bị làm tròn.
    await order(
      "S6",
      ["R1", "R2", "R3"].map((name) => ({ sku: name, quantity: 1, price: 10_000, cost: 3_000 })),
      { daysAgo: 20, settlement: "real", feeGmvMax: -1_000, sellerVoucher: 1_000 }
    );
    // S7: đơn đã đối soát mới nhất CÓ dòng hàng.
    await order("S7", [a1()], { daysAgo: 15, settlement: "real", feeGmvMax: -5_000 });
    // S8: đơn đã đối soát mới nhất của gian nhưng KHÔNG có dòng hàng → vẫn là mốc cùng lứa (12 ngày trước).
    const s8 = await order("S8", [], { daysAgo: 12, settlement: "real" });
    // N2: trong cửa sổ 60 ngày, ngoài 30 ngày của đà bán.
    await order("N2", [a2()], { daysAgo: 40, settlement: "real", feeGmvMax: -2_000 });
    // OUT: ngoài cửa sổ.
    await order("OUT", [a1()], { daysAgo: 70, settlement: "real", feeGmvMax: -5_000 });

    // ---- Đơn hủy ----
    await order("X1", [a1(), gift], { daysAgo: 30, cancelled: true }); // cùng lứa; kèm quà giá 0 → nhóm quà không nhận đơn hủy nào
    // X2: tạo SAU đơn đã đối soát mới nhất có dòng hàng (S7) nhưng TRƯỚC mốc cùng lứa thật (S8) → vẫn cùng lứa.
    await order("X2", [a1()], { daysAgo: 13, cancelled: true });
    await order("X3", [a1()], { daysAgo: 5, cancelled: true }); // sau mốc cùng lứa → chờ
    await order("X4", [b()], { daysAgo: 28, cancelled: true }); // cùng lứa nhưng thiếu giá vốn → chỉ vào độ phủ
    // X5: đơn hủy mang cờ đối soát + bản kê thật → vẫn là đơn HỦY (cùng lứa), không phải đơn đã đối soát.
    await order("X5", [a1()], { daysAgo: 26, cancelled: true, settlement: "real", feeGmvMax: -5_000 });
    // X6: như X5 nhưng tạo SAU mốc cùng lứa → không được tự làm mốc cùng lứa mới, vẫn là đơn chờ.
    await order("X6", [a1()], { daysAgo: 6, cancelled: true, settlement: "real", feeGmvMax: -5_000 });
    // X8: đơn hủy cùng lứa có HAI dòng có giá cùng sản phẩm → nhóm đếm một đơn hủy.
    await order("X8", [a1(), a2()], { daysAgo: 29, cancelled: true });
    // X9: đơn hủy cùng lứa chỉ có quà giá 0 → không nhóm nào nhận đơn hủy này.
    await order("X9", [gift], { daysAgo: 27, cancelled: true });
    // X7: tạo ĐÚNG mốc cùng lứa → còn trong lứa (<=).
    await order("X7", [a1()], { createdAt: s8.createdAt, cancelled: true });

    // ---- Chưa có kết cục cuối ----
    await order("E1", [a1()], { daysAgo: 10, settlement: "estimated", feeGmvMax: -5_000 }); // số ước tính của sàn
    await order("E2", [a1()], { daysAgo: 9, isSettled: true, settlement: "estimated", feeGmvMax: -5_000 }); // cờ đối soát nhưng bản kê là ước tính
    await order("E3", [a2()], { daysAgo: 8, isSettled: true }); // cờ đối soát nhưng không có bản kê
    await order("E4", [a1()], { daysAgo: 11, isSettled: false, settlement: "real", feeGmvMax: -5_000 }); // có bản kê thật nhưng cờ đối soát chưa bật
    n1CreatedAt = (await order("N1", [a1(2)], { daysAgo: 3 })).createdAt; // đang chờ đối soát
    // N4 / N5: tạo ĐÚNG ngày đầu (20 ngày trước) và ĐÚNG ngày cuối (hôm qua) của khoảng tự kiểm C1 → đều được tính.
    await order("N4", [a2()], { daysAgo: 20 });
    await order("N5", [a2()], { daysAgo: 1 });
    // N6: đơn chờ đối soát có HAI dòng có giá cùng sản phẩm → nhóm đếm một đơn chờ.
    await order("N6", [a1(), a2()], { daysAgo: 2 });
    // N7: đơn chờ đối soát chỉ có quà giá 0 → không nhóm nào nhận đơn chờ này, vẫn tính đà bán.
    await order("N7", [gift], { daysAgo: 4 });
    await order("N3", [a1(), gift]); // vừa tạo hôm nay → ngoài khoảng tự kiểm (tới hết hôm qua); kèm quà giá 0 → nhóm quà không nhận đơn chờ nào

    const fresh = await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 });
    expect(fresh.dirty).toBe(0);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  async function groups() {
    const inputs = await loadBreakevenInputs(fx.channelId);
    return loadBreakevenGroups(channel(), tiktokGroupMappingOf(inputs.sets, inputs.checks));
  }

  it("số đơn đã đối soát / hủy cùng lứa / chờ kết cục, danh sách sản phẩm và đà bán đúng như cách dựng", async () => {
    const g = await groups();

    const shop = g.get(SHOP_GROUP)!;
    expect(shop.settledOrders).toBe(6); // S1, S2, S3, S6, S7, N2 — không có S4 (giá 0), S5 (thiếu vốn), S8 (không dòng), OUT
    expect(shop.cancelledOrders).toBe(5); // X1, X2 (nhờ mốc cùng lứa của S8), X5, X7, X8
    expect(shop.pendingOrders).toBe(11); // X3, X6, E1, E2, E3, E4, N1, N3, N4, N5, N6
    expect(shop.missingCostRevenue).toBeGreaterThan(0); // S5 + X4

    const a = g.get(productGroupKey("100"))!;
    expect(a.hasPaid).toBe(true);
    expect(a.settledOrders).toBe(5); // S1 (hai dòng, đếm một), S2, S3, S7, N2
    expect(a.cancelledOrders).toBe(5); // X8 hai dòng, đếm một
    expect(a.pendingOrders).toBe(11); // N6 hai dòng, đếm một
    expect(a.missingCostRevenue).toBe(0);
    // Đơn không hủy trong 30 ngày: S1 (3), S2, S3, S7, E1, E2, E3, E4, N1 (2), N3, N4, N5, N6 (2); 7 ngày: N1 (2), N3, N5, N6 (2).
    expect({ units30d: a.units30d, units7d: a.units7d }).toEqual({ units30d: 17, units7d: 6 });

    const giftGroup = g.get(productGroupKey("200"))!;
    expect(giftGroup.hasPaid).toBe(false); // chỉ có dòng giá 0 → không lên tab Hòa vốn sản phẩm
    expect(giftGroup.settledOrders + giftGroup.cancelledOrders + giftGroup.pendingOrders).toBe(0);
    // Dòng quà của S4 / S9 mang tiền trên sổ (đơn toàn dòng giá 0 thì sổ chia đều) nhưng không được cộng vào đâu.
    expect(giftGroup.revenue).toBe(0);
    expect(giftGroup.profitBeforeAds).toBe(0);
    expect(giftGroup.adFee).toBe(0);
    expect(giftGroup.missingCostRevenue).toBe(0);
    expect({ units30d: giftGroup.units30d, units7d: giftGroup.units7d }).toEqual({ units30d: 5, units7d: 2 }); // S3, S4, S9, N7, N3 — không có X1, X9 (hủy)

    const bGroup = g.get(productGroupKey("300"))!;
    expect(bGroup.settledOrders).toBe(0);
    expect(bGroup.cancelledOrders).toBe(0); // X4 thiếu giá vốn → không đếm vào đơn hủy cùng lứa
    expect(bGroup.pendingOrders).toBe(0);
    expect(bGroup.revenue).toBe(0);
    expect(bGroup.missingCostRevenue).toBeCloseTo(shop.missingCostRevenue, 2);

    const r = g.get(productGroupKey("400"))!;
    expect(r.settledOrders).toBe(1);
    expect(r.revenue).toBeCloseTo(29_000, 2); // Σ ba dòng = đơn, từng xu
    expect(r.adFee).toBeCloseTo(1_000, 2);

    const camp1 = g.get(campaignGroupKey(c1))!;
    expect(camp1.settledOrders).toBe(5); // S3: hàng + quà cùng nhóm, đếm một; S4 chỉ có quà → không tính
    expect(camp1.cancelledOrders).toBe(5);
    expect(camp1.pendingOrders).toBe(11);
    expect(camp1.revenue).toBeCloseTo(a.revenue, 2);
    // Tự kiểm C1, từ 20 ngày trước tới hết hôm qua: MỌI đơn đặt của nhóm — S7, X2, X7, E4, E1, E2, X6, X3 (A1 100k), E3, N4, N5
    // (A2 50k), N6 (150k), N1 (200k); không có N3 (hôm nay), không có S9 (chỉ có quà giá 0).
    expect(camp1.placedRevenue).toBeCloseTo(1_300_000, 2);
    expect(g.get(campaignGroupKey(c2))!.placedRevenue).toBe(0); // chưa có số quảng cáo → không tự kiểm
    expect(g.has(campaignGroupKey(c3))).toBe(false); // chiến dịch chưa biết sản phẩm → không có nhóm
  });

  it("hai đường cộng bằng nhau ở mọi nhóm, kể cả nhóm một dòng của đơn bị làm tròn; tự kiểm, đà bán và hai kết quả cuối giống nhau", async () => {
    const extraSets: AdsGroupSets = new Map([
      ["t:R1", new Set([sku("R1")])],
      ["t:R1R2", new Set([sku("R1"), sku("R2")])],
      ["t:all", new Set(["A1", "A2", "G", "B", "R1", "R2", "R3"].map(sku))],
      ["t:khong-co-don", new Set([sku("KHONG-BAN")])],
    ]);
    const extraCheckFrom = new Map([
      ["t:R1", vnDateKey(25)],
      ["t:all", vnDateKey(45)],
    ]);
    const report = await compareBreakevenSources(channel(), { extraSets, extraCheckFrom });
    expect(report.capped).toBe(false);
    expect(report.baseMismatches).toEqual([]);
    expect(report.checkMismatches).toEqual([]);
    expect(report.paceMismatches).toEqual([]);
    expect(report.endToEndMismatches).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.rowsOrders).toBe(29); // mọi đơn trong cửa sổ, kể cả S8 không dòng hàng; không có OUT
    // Có lệch làm tròn thật (nhóm một dòng của S6) nhưng dưới 1 xu mỗi dòng.
    expect(report.maxMoneyDiff).toBeGreaterThan(0);
    expect(report.maxMoneyDiff).toBeLessThan(0.02);
  });

  it("nhóm mọi SKU = nhóm toàn gian; ánh xạ trùng cặp không cộng đôi; ánh xạ rỗng chỉ ra nhóm toàn gian", async () => {
    const range = tiktokMarginWindowRange();
    const opts = { paceNow: range.lte };
    const skus = ["A1", "A2", "G", "B", "R1", "R2", "R3"].map(sku);
    const doubled = await ledgerTiktokBreakevenByGroup(
      scope(),
      range,
      { groups: [...skus, ...skus].map(() => "t:all"), skus: [...skus, ...skus], checkFrom: [...skus, ...skus].map(() => ""), checkTo: vnDateKey(1) },
      opts
    );
    const shop = doubled.get(SHOP_GROUP)!;
    expect(doubled.get("t:all")).toEqual(shop);

    const none = await ledgerTiktokBreakevenByGroup(scope(), range, { groups: [], skus: [], checkFrom: [], checkTo: vnDateKey(1) }, opts);
    expect([...none.keys()]).toEqual([SHOP_GROUP]);
    expect(none.get(SHOP_GROUP)).toEqual(shop);
  });

  it("chiến dịch đủ mẫu dùng hòa vốn riêng kèm số tự kiểm; chưa đủ mẫu / chưa biết sản phẩm thì mượn hòa vốn gian — ở cả hai đường", async () => {
    for (const source of ["rows", "sql"] as const) {
      const r = await computeTiktokAdsBreakevenUncached(channel(), { source });
      expect(r.shop.source, source).toBe("shop");
      expect(r.shop.orders, source).toBe(6);
      const own = r.byCampaignRowId.get(c1)!;
      expect(own.source, source).toBe("campaign");
      expect(own.orders, source).toBe(5);
      expect(own.check?.from, source).toBe(vnDateKey(20));
      expect(own.check?.to, source).toBe(vnDateKey(1));
      expect(own.check?.revenuePlaced, source).toBeCloseTo(1_300_000, 2);
      expect(own.check?.tiktokGmv, source).toBe(2_000_000); // 20 ngày × 100.000, không tính hôm nay
      expect(r.byCampaignRowId.get(c2), source).toBe(r.shop); // 1 đơn đã đối soát < 5
      expect(r.byCampaignRowId.get(c3), source).toBe(r.shop);

      const p = await computeTiktokProductBreakevensUncached(channel(), BREAKEVEN_MIN_COVERAGE_PCT, { source });
      expect(p.products.map((x) => x.productId).sort(), source).toEqual(["100", "300", "400"]); // không có 200 (chỉ quà giá 0)
      expect(p.products.find((x) => x.productId === "300")!.verdict, source).toBe("no_cost");
    }
  });

  it("cửa sổ chưa có đơn đã đối soát nào → không có mốc cùng lứa, đơn hủy không được tính (đơn đã đối soát NGOÀI cửa sổ không làm mốc)", async () => {
    // Từ 35 tới 27,5 ngày trước: chỉ có X1, X8, X4 (đều hủy). Đơn đã đối soát gần nhất nằm ngoài cửa sổ ở cả hai phía (N2 40 ngày, S1 25 ngày).
    const range = { gte: daysAgo(35), lte: daysAgo(27.5) };
    const inputs = await loadBreakevenInputs(fx.channelId);
    const g = await loadBreakevenGroups(channel(), tiktokGroupMappingOf(inputs.sets, inputs.checks), range);
    expect(g.get(SHOP_GROUP)).toMatchObject({ settledOrders: 0, cancelledOrders: 0, pendingOrders: 3, revenue: 0, missingCostRevenue: 0 });
    const pure = breakevensFromRows(await loadBreakevenRows(channel(), "ledger", range), inputs.sets, inputs.checks, range.lte.getTime());
    expect(pure.base(SHOP_GROUP)).toMatchObject({ settledOrders: 0, cancelledOrders: 0, pendingOrders: 3, revenue: 0, missingCostRevenue: 0 });
  });

  it("mốc 7 ngày của đà bán tính cả đơn tạo ĐÚNG mốc (>=), như đường duyệt mảng", async () => {
    const range = tiktokMarginWindowRange();
    const inputs = await loadBreakevenInputs(fx.channelId);
    const mapping = tiktokGroupMappingOf(inputs.sets, inputs.checks);
    const atNow = new Date(n1CreatedAt.getTime() + TIKTOK_PACE_RECENT_MS);
    const at = await ledgerTiktokBreakevenByGroup(scope(), range, mapping, { paceNow: atNow });
    const after = await ledgerTiktokBreakevenByGroup(scope(), range, mapping, { paceNow: new Date(atNow.getTime() + 1) });
    // N1 góp 2 đơn vị vào sản phẩm 100: mốc trùng giờ tạo thì còn, lùi sau 1 mili giây thì mất.
    expect(at.get(productGroupKey("100"))!.units7d - after.get(productGroupKey("100"))!.units7d).toBe(2);
    const rows = await loadBreakevenRows(channel(), "ledger", range);
    const pure = breakevensFromRows(rows, inputs.sets, inputs.checks, atNow.getTime());
    expect(pure.productPace().get("100")!.units7d).toBe(at.get(productGroupKey("100"))!.units7d);
  });

  it("ánh xạ hỏng bị từ chối trước khi chạm database", async () => {
    const range = tiktokMarginWindowRange();
    const opts = { paceNow: range.lte };
    const checkTo = vnDateKey(1);
    await expect(
      ledgerTiktokBreakevenByGroup(scope(), range, { groups: ["p:1"], skus: [], checkFrom: [""], checkTo }, opts)
    ).rejects.toThrow(/lệch độ dài/);
    await expect(
      ledgerTiktokBreakevenByGroup(scope(), range, { groups: ["p:1"], skus: ["A"], checkFrom: [], checkTo }, opts)
    ).rejects.toThrow(/lệch độ dài/);
    await expect(
      ledgerTiktokBreakevenByGroup(scope(), range, { groups: [SHOP_GROUP], skus: ["A"], checkFrom: [""], checkTo }, opts)
    ).rejects.toThrow(/dành riêng/);
  });
});
