// ============================================================
// QUẢNG CÁO TikTok trên DB dev: nguyên liệu hòa vốn + tự kiểm mẫu số + đà bán
// GOM TRONG DATABASE (ledgerTiktokBreakevenByGroup) phải bằng đường duyệt mảng
// đơn trong RAM (tiktokBreakevenBase…). DB dev không có gian TikTok nên test tự
// dựng một gian với đủ các ca của luật: bản kê thật, bản kê ước tính, cờ đối
// soát không có bản kê, đơn hủy trước / sau mốc cùng lứa, đơn không có dòng hàng
// làm mốc cùng lứa, đơn thiếu giá vốn, quà tặng giá 0, đơn nhiều SKU, phần phân
// bổ bị làm tròn, đơn ngoài cửa sổ / ngoài 30 ngày / ngoài 7 ngày, dòng CHƯA
// CÓ id lá chỉ khớp mã (A2, B, G, R*: đi vào unlinkedRevenue — 28/10/2026).
// Số kỳ vọng suy từ chính cách dựng.
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12). Chưa áp migration sổ cái → BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { vnDateKey } from "../../lib/ads-dates";
import { SHOP_GROUP, campaignGroupKey, itemKey, productGroupKey, type AdsGroupSets } from "../../lib/ads-margin";
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
  let c2: string; // chiến dịch chứa sản phẩm 400 (toàn dòng chưa có id → chỉ có unlinkedRevenue)
  let c3: string; // chiến dịch chưa biết sản phẩm
  let n1CreatedAt: Date;
  const channel = () => ({ id: fx.channelId, userId: fx.userId });
  const scope = () => ({ userId: fx.userId, id: fx.channelId, channelName: ChannelName.TIKTOK });
  const sku = (name: string) => `TEST-${fx.suffix}-${name}`;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  /** settlement: "real" = bản kê đã quyết toán, "estimated" = số ước tính của sàn, bỏ trống = chưa có bản kê. */
  async function order(
    code: string,
    items: { sku: string; quantity: number; price: number; cost: number; externalId?: string }[],
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
            // Lát 1a/1b: dòng A1 mang id lá → sổ có itemId 100 → gom bằng khóa "i:100"; các dòng khác đi đường mã.
            externalId: it.externalId ?? null,
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
  const a1 = (quantity = 1) => ({ sku: "A1", quantity, price: 100_000, cost: 40_000, externalId: "100-1" });
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
    return loadBreakevenGroups(channel(), tiktokGroupMappingOf(inputs.sets));
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
    // Dòng A1 có id (khóa i:100) vào biên lãi; dòng A2 chưa có id chỉ khớp mã → unlinkedRevenue, không đếm đơn đã đối soát/hủy.
    expect(a.settledOrders).toBe(4); // S1 (dòng A1), S2, S3, S7 — N2 chỉ có A2 (chưa id) → không
    expect(a.cancelledOrders).toBe(5); // X8 hai dòng, đếm một (nhờ dòng A1)
    expect(a.pendingOrders).toBe(11); // N6 hai dòng, đếm một; E3 / N4 / N5 chỉ có A2 vẫn đếm là đơn chờ
    expect(a.missingCostRevenue).toBe(0);
    expect(a.unlinkedRevenue).toBeCloseTo(200_000, 2); // S1 A2 100k + N2 A2 50k + X8 A2 50k (đơn đã chốt); E3/N4/N5 chưa chốt → chưa
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

    // B chưa có id: đơn đã chốt (S5 thiếu giá vốn, X4 hủy) đều dồn vào unlinkedRevenue — chưa biết chắc là sản phẩm nào.
    const bGroup = g.get(productGroupKey("300"))!;
    expect(bGroup.settledOrders).toBe(0);
    expect(bGroup.cancelledOrders).toBe(0);
    expect(bGroup.pendingOrders).toBe(0);
    expect(bGroup.revenue).toBe(0);
    expect(bGroup.missingCostRevenue).toBe(0);
    expect(bGroup.unlinkedRevenue).toBeCloseTo(shop.missingCostRevenue, 2);

    // R1..R3 chưa có id: đơn S6 (29.000 sau voucher, từng xu) chỉ còn là phần chưa nối.
    const r = g.get(productGroupKey("400"))!;
    expect(r.settledOrders).toBe(0);
    expect(r.revenue).toBe(0);
    expect(r.adFee).toBe(0);
    expect(r.unlinkedRevenue).toBeCloseTo(29_000, 2);

    const camp1 = g.get(campaignGroupKey(c1))!;
    expect(camp1.settledOrders).toBe(4); // S3: hàng + quà cùng nhóm, đếm một; S4 chỉ có quà → không tính
    expect(camp1.cancelledOrders).toBe(5);
    expect(camp1.pendingOrders).toBe(11);
    expect(camp1.revenue).toBeCloseTo(a.revenue, 2);
    expect(camp1.unlinkedRevenue).toBeCloseTo(a.unlinkedRevenue, 2);
    expect(g.get(campaignGroupKey(c2))!.unlinkedRevenue).toBeCloseTo(29_000, 2);
    expect(g.has(campaignGroupKey(c3))).toBe(false); // chiến dịch chưa biết sản phẩm → không có nhóm
    // Nhóm toàn gian không tách: mọi dòng đều thuộc gian.
    expect(shop.unlinkedRevenue).toBe(0);
  });

  it("hai đường cộng bằng nhau ở mọi nhóm (kể cả phần chưa nối id và nhóm một dòng của đơn bị làm tròn); đà bán và hai kết quả cuối giống nhau", async () => {
    const extraSets: AdsGroupSets = new Map([
      ["t:R1", new Set([sku("R1")])],
      ["t:R1R2", new Set([sku("R1"), sku("R2")])],
      ["t:all", new Set(["A1", "A2", "G", "B", "R1", "R2", "R3"].map(sku))],
      ["t:khong-co-don", new Set([sku("KHONG-BAN")])],
    ]);
    const report = await compareBreakevenSources(channel(), { extraSets });
    expect(report.capped).toBe(false);
    expect(report.baseMismatches).toEqual([]);
    expect(report.paceMismatches).toEqual([]);
    expect(report.endToEndMismatches).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.rowsOrders).toBe(29); // mọi đơn trong cửa sổ, kể cả S8 không dòng hàng; không có OUT
    // Có lệch làm tròn thật (nhóm một dòng của S6) nhưng dưới 1 xu mỗi dòng.
    expect(report.maxMoneyDiff).toBeGreaterThan(0);
    expect(report.maxMoneyDiff).toBeLessThan(0.02);
  });

  it("nhóm mọi khóa phủ đúng tiền của toàn gian (phần chưa nối id tách riêng); ánh xạ trùng cặp không cộng đôi; ánh xạ rỗng chỉ ra nhóm toàn gian", async () => {
    const range = tiktokMarginWindowRange();
    const opts = { paceNow: range.lte };
    // Dòng A1 mang id (itemId 100) nên khóa của nó là "i:100", không phải mã — "nhóm mọi khóa" phải gồm cả khóa SPU.
    const skus = [...["A1", "A2", "G", "B", "R1", "R2", "R3"].map(sku), itemKey("100")];
    const doubled = await ledgerTiktokBreakevenByGroup(
      scope(),
      range,
      { groups: [...skus, ...skus].map(() => "t:all"), keys: [...skus, ...skus] },
      opts
    );
    const shop = doubled.get(SHOP_GROUP)!;
    const all = doubled.get("t:all")!;
    // Toàn gian không tách phần chưa nối id; nhóm "mọi khóa" tách → tổng tiền đơn đã chốt vẫn bằng nhau, đơn chờ và đà bán bằng nhau.
    expect(all.revenue + all.missingCostRevenue + all.unlinkedRevenue).toBeCloseTo(shop.revenue + shop.missingCostRevenue, 2);
    expect(all.unlinkedRevenue).toBeGreaterThan(0);
    expect({ pendingOrders: all.pendingOrders, units30d: all.units30d, units7d: all.units7d, revenue30d: all.revenue30d, hasPaid: all.hasPaid }).toEqual({
      pendingOrders: shop.pendingOrders, units30d: shop.units30d, units7d: shop.units7d, revenue30d: shop.revenue30d, hasPaid: shop.hasPaid,
    });
    // Phần có id ("i:100" = A1) khớp đúng nhóm sản phẩm 100 ở phần biên lãi.
    const a = (await groups()).get(productGroupKey("100"))!;
    expect({ settledOrders: all.settledOrders, revenue: all.revenue, profitBeforeAds: all.profitBeforeAds }).toEqual({
      settledOrders: a.settledOrders, revenue: a.revenue, profitBeforeAds: a.profitBeforeAds,
    });

    const none = await ledgerTiktokBreakevenByGroup(scope(), range, { groups: [], keys: [] }, opts);
    expect([...none.keys()]).toEqual([SHOP_GROUP]);
    expect(none.get(SHOP_GROUP)).toEqual(shop);
  });

  it("chiến dịch chưa đủ mẫu (4 đơn có id < 5) / chưa biết sản phẩm thì mượn hòa vốn gian — ở cả hai đường; phần chưa nối id lên độ phủ", async () => {
    for (const source of ["rows", "sql"] as const) {
      const r = await computeTiktokAdsBreakevenUncached(channel(), { source });
      expect(r.shop.source, source).toBe("shop");
      expect(r.shop.orders, source).toBe(6);
      expect(r.shop.unlinkedRevenue, source).toBe(0);
      // C1 chỉ còn 4 đơn đã đối soát có id (N2 toàn dòng A2 chưa id) → dưới MIN_ORDERS_FOR_MARGIN (5) → mượn gian.
      expect(r.byCampaignRowId.get(c1), source).toBe(r.shop);
      expect(r.byCampaignRowId.get(c2), source).toBe(r.shop); // 0 đơn có id
      expect(r.byCampaignRowId.get(c3), source).toBe(r.shop);
      // Tab sản phẩm: sản phẩm 100 nêu rõ phần chưa nối id và độ phủ tính cả phần đó: 900k có id / (900k + 200k) = 82%.
      const p100 = (await computeTiktokProductBreakevensUncached(channel(), BREAKEVEN_MIN_COVERAGE_PCT, { source })).products.find((x) => x.productId === "100")!;
      expect(p100.breakeven.orders, source).toBe(4);
      expect(p100.breakeven.unlinkedRevenue, source).toBeCloseTo(200_000, 2);
      expect(p100.breakeven.costCoveragePct, source).toBe(82);
      expect(p100.verdict, source).toBe("no_cost");

      const p = await computeTiktokProductBreakevensUncached(channel(), BREAKEVEN_MIN_COVERAGE_PCT, { source });
      expect(p.products.map((x) => x.productId).sort(), source).toEqual(["100", "300", "400"]); // không có 200 (chỉ quà giá 0)
      expect(p.products.find((x) => x.productId === "300")!.verdict, source).toBe("no_cost");
    }
  });

  it("cửa sổ chưa có đơn đã đối soát nào → không có mốc cùng lứa, đơn hủy không được tính (đơn đã đối soát NGOÀI cửa sổ không làm mốc)", async () => {
    // Từ 35 tới 27,5 ngày trước: chỉ có X1, X8, X4 (đều hủy). Đơn đã đối soát gần nhất nằm ngoài cửa sổ ở cả hai phía (N2 40 ngày, S1 25 ngày).
    const range = { gte: daysAgo(35), lte: daysAgo(27.5) };
    const inputs = await loadBreakevenInputs(fx.channelId);
    const g = await loadBreakevenGroups(channel(), tiktokGroupMappingOf(inputs.sets), range);
    expect(g.get(SHOP_GROUP)).toMatchObject({ settledOrders: 0, cancelledOrders: 0, pendingOrders: 3, revenue: 0, missingCostRevenue: 0 });
    const pure = breakevensFromRows(await loadBreakevenRows(channel(), range), inputs.sets, range.lte.getTime());
    expect(pure.base(SHOP_GROUP)).toMatchObject({ settledOrders: 0, cancelledOrders: 0, pendingOrders: 3, revenue: 0, missingCostRevenue: 0 });
  });

  it("mốc 7 ngày của đà bán tính cả đơn tạo ĐÚNG mốc (>=), như đường duyệt mảng", async () => {
    const range = tiktokMarginWindowRange();
    const inputs = await loadBreakevenInputs(fx.channelId);
    const mapping = tiktokGroupMappingOf(inputs.sets);
    const atNow = new Date(n1CreatedAt.getTime() + TIKTOK_PACE_RECENT_MS);
    const at = await ledgerTiktokBreakevenByGroup(scope(), range, mapping, { paceNow: atNow });
    const after = await ledgerTiktokBreakevenByGroup(scope(), range, mapping, { paceNow: new Date(atNow.getTime() + 1) });
    // N1 góp 2 đơn vị vào sản phẩm 100: mốc trùng giờ tạo thì còn, lùi sau 1 mili giây thì mất.
    expect(at.get(productGroupKey("100"))!.units7d - after.get(productGroupKey("100"))!.units7d).toBe(2);
    const rows = await loadBreakevenRows(channel(), range);
    const pure = breakevensFromRows(rows, inputs.sets, atNow.getTime());
    expect(pure.productPace().get("100")!.units7d).toBe(at.get(productGroupKey("100"))!.units7d);
  });

  it("ánh xạ hỏng bị từ chối trước khi chạm database", async () => {
    const range = tiktokMarginWindowRange();
    const opts = { paceNow: range.lte };
    await expect(ledgerTiktokBreakevenByGroup(scope(), range, { groups: ["p:1"], keys: [] }, opts)).rejects.toThrow(/lệch độ dài/);
    await expect(ledgerTiktokBreakevenByGroup(scope(), range, { groups: [SHOP_GROUP], keys: ["A"] }, opts)).rejects.toThrow(/dành riêng/);
  });
});
