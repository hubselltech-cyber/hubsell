// ============================================================
// HÒA VỐN QUẢNG CÁO TikTok — logic thuần của lib/tiktok-breakeven.ts, KHÔNG DB:
//   · luật: chỉ đơn đã có kết cục cuối, cộng ngược phí GMV Max, đơn hủy cùng lứa,
//     dòng chưa nối id chỉ vào độ phủ, đà bán;
//   · bộ nhóm, mặt tiền hai đường cộng.
// ============================================================

import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import { SHOP_GROUP, buildAdsGroupSets, campaignGroupKey, groupSkusByItemId, itemKey, productGroupKey } from "../ads-margin";
import {
  breakevensFromGroups,
  breakevensFromRows,
  salesPaceByGroup,
  settledCohortCutoff,
  tiktokBreakevenBase,
  tiktokBreakevenBaseByGroup,
  tiktokEstProfit,
  tiktokGroupMappingOf,
  toTiktokBreakeven,
  type BreakevenPnlRow,
  type LedgerTiktokBreakevenGroup,
} from "../tiktok-breakeven";

// ROI HÒA VỐN TIKTOK = 1 ÷ biên lãi TRƯỚC quảng cáo, CHỈ trên đơn đã có kết cục cuối (anh Trung 18/09):
// đơn đã đối soát thật (giao thành công / hoàn xong) + đơn hủy cùng lứa. Phí GMV Max đã nằm trong lợi nhuận → cộng ngược.
const day = (d: string) => new Date(`${d}T03:00:00Z`);

/** Dòng mặc định mang id lá (itemId "54") — từ Lát 1a mọi đơn mới đều có id; dòng không id là ca riêng (xem "id trước, mã sau"). */
function row(over: Partial<BreakevenPnlRow> & { sku?: string }): BreakevenPnlRow {
  return {
    createdAt: day("2026-09-01"),
    shippingStatus: ShippingStatus.DELIVERED,
    isSettled: true,
    items: [{ sku: over.sku ?? "TC054", itemId: "54", price: 250_000, quantity: 1 }],
    actualRevenue: 250_000,
    profit: 30_000,
    missingCostPrice: false,
    tiktok: { feeGmvMax: -20_000 },
    ...over,
  };
}
const cancelled = (over: Partial<BreakevenPnlRow> & { sku?: string } = {}) =>
  row({ shippingStatus: ShippingStatus.CANCELLED, isSettled: false, profit: -120_000, tiktok: null, ...over });
/** Tập khóa của nhóm "sản phẩm 54" — id lá trước, mã thô làm đường lui cho dòng chưa có id. */
const G54 = new Set([itemKey("54"), "TC054"]);

describe("tiktokBreakevenBase", () => {
  it("cộng ngược phí GMV Max: lãi 30k đã trừ 20k quảng cáo → lãi trước ads 50k, hòa vốn = 250/50 = 5", () => {
    const base = tiktokBreakevenBase([row({})], null);
    expect(base).toMatchObject({ settledOrders: 1, revenue: 250_000, profitBeforeAds: 50_000, adFee: 20_000, pendingOrders: 0, unlinkedRevenue: 0 });
    expect(toTiktokBreakeven(base, "campaign")).toMatchObject({ breakevenRoi: 5, margin: 0.2, negativeMargin: false, source: "campaign", orders: 1, costCoveragePct: 100 });
  });

  it("đơn CHƯA đối soát không được tính: đang giao, đã giao chờ đối soát, mới có số ƯỚC TÍNH của sàn", () => {
    const base = tiktokBreakevenBase(
      [
        row({}),
        row({ shippingStatus: ShippingStatus.SHIPPING, isSettled: false, tiktok: null, profit: 140_000 }),
        row({ isSettled: false, tiktok: null, profit: 140_000 }), // giao xong, chưa có bản kê
        row({ isSettled: false, tiktok: { feeGmvMax: -20_000 }, profit: 60_000 }), // bản kê ước tính
      ],
      null
    );
    expect(base).toMatchObject({ settledOrders: 1, revenue: 250_000, profitBeforeAds: 50_000, pendingOrders: 3 });
  });

  it("đơn HOÀN đã đối soát vẫn tính (trục returnStatus, trạng thái giao vẫn DELIVERED) — thất thu thật kéo biên lãi xuống", () => {
    const base = tiktokBreakevenBase([row({}), row({ profit: -15_000 })], null);
    expect(base).toMatchObject({ settledOrders: 2, revenue: 500_000, profitBeforeAds: 55_000 }); // 50k + (−15k + 20k)
  });

  it("đơn HỦY cùng lứa góp doanh thu vào mẫu số (TikTok vẫn đếm) nhưng 0 đồng lãi — không lấy lỗ ảo của dòng P&L", () => {
    const base = tiktokBreakevenBase([row({}), cancelled({ createdAt: day("2026-08-30") })], null);
    expect(base).toMatchObject({ settledOrders: 1, cancelledOrders: 1, revenue: 500_000, profitBeforeAds: 50_000 });
    expect(toTiktokBreakeven(base, "shop").breakevenRoi).toBe(10); // hủy 50% → hòa vốn gấp đôi
  });

  it("đơn hủy TẠO SAU đơn đã đối soát mới nhất thì để ngoài — tránh thổi phồng tỷ lệ hủy của mấy tuần chưa đối soát", () => {
    const rows = [row({ createdAt: day("2026-09-01") }), cancelled({ createdAt: day("2026-09-10") })];
    expect(settledCohortCutoff(rows)?.toISOString()).toBe(day("2026-09-01").toISOString());
    expect(tiktokBreakevenBase(rows, null)).toMatchObject({ settledOrders: 1, cancelledOrders: 0, revenue: 250_000, pendingOrders: 1 });
  });

  it("gian chưa có đơn đối soát nào → không tính gì, kể cả đơn hủy", () => {
    const base = tiktokBreakevenBase([cancelled(), row({ isSettled: false, tiktok: null })], null);
    expect(base).toMatchObject({ settledOrders: 0, cancelledOrders: 0, revenue: 0, pendingOrders: 2 });
    expect(toTiktokBreakeven(base, "shop")).toMatchObject({ breakevenRoi: null, source: null, pendingOrders: 2 });
  });

  it("đơn đã đối soát nhưng thiếu giá vốn bị loại khỏi cả tử lẫn mẫu, chỉ tính vào độ phủ", () => {
    const base = tiktokBreakevenBase([row({}), row({ missingCostPrice: true, profit: 200_000 })], null);
    expect(base).toMatchObject({ settledOrders: 1, revenue: 250_000, missingCostRevenue: 250_000 });
    expect(toTiktokBreakeven(base, "shop")).toMatchObject({ breakevenRoi: 5, costCoveragePct: 50 });
  });

  it("lọc theo SKU của chiến dịch + phân bổ đơn nhiều SKU theo tỷ trọng giá trị hàng", () => {
    const mixed = row({
      items: [
        { sku: "TC054", itemId: "54", price: 100_000, quantity: 1 },
        { sku: "KHAC", itemId: "99", price: 300_000, quantity: 1 },
      ],
      actualRevenue: 400_000,
      profit: 60_000,
    });
    const base = tiktokBreakevenBase([mixed, row({ sku: "KHAC", items: [{ sku: "KHAC", itemId: "99", price: 250_000, quantity: 1 }] })], G54);
    expect(base.settledOrders).toBe(1);
    expect(base.revenue).toBeCloseTo(100_000);
    expect(base.profitBeforeAds).toBeCloseTo(20_000); // (60k + 20k) × 25%
    expect(base.adFee).toBeCloseTo(5_000);
  });

  it("sàn HOÀN lại phí quảng cáo (feeGmvMax dương) thì trừ ra, không cộng", () => {
    expect(tiktokBreakevenBase([row({ profit: 40_000, tiktok: { feeGmvMax: 5_000 } })], null).profitBeforeAds).toBe(35_000);
  });
});

// LÁT 1b (18/10/2026): dòng hàng có SPU (itemId từ OrderItem.externalId) khớp nhóm bằng khóa "i:<itemId>"; mã thô chỉ cho dòng chưa có id.
// 28/10/2026: dòng chưa có id (chỉ khớp mã) KHÔNG vào biên lãi nữa — chỉ vào unlinkedRevenue để kéo độ phủ xuống (mã có thể dùng
// chung nhiều sản phẩm; ca TC025 18/10). Thay cho phép so doanh thu với TikTok (bỏ).
describe("id trước, mã sau — dòng chưa nối id chỉ vào độ phủ", () => {
  const group = new Set(["TC025-XAM", itemKey("100")]);
  const rows = [
    row({ items: [{ sku: "TC025-XAM", itemId: "100", price: 250_000, quantity: 1 }] }), // id đúng → tính
    row({ items: [{ sku: "TC025-XAM (XÁM)", itemId: "100", price: 250_000, quantity: 1 }] }), // mã đổi đuôi, id đúng → tính
    row({ items: [{ sku: "TC025-XAM", itemId: "999", price: 250_000, quantity: 1 }] }), // cùng mã, sản phẩm khác → không
    row({ items: [{ sku: "TC025-XAM", itemId: null, price: 250_000, quantity: 1 }] }), // đơn cũ chưa có id → chỉ vào độ phủ
  ];

  it("tiktokBreakevenBase: 2 đơn vào biên lãi; đơn cùng mã của sản phẩm khác không; đơn chưa có id → unlinkedRevenue, độ phủ 67%", () => {
    const base = tiktokBreakevenBase(rows, group);
    expect(base).toMatchObject({ settledOrders: 2, revenue: 500_000, unlinkedRevenue: 250_000, missingCostRevenue: 0 });
    expect(toTiktokBreakeven(base, "campaign")).toMatchObject({ orders: 2, costCoveragePct: 67, unlinkedRevenue: 250_000 });
    // Toàn gian không tách: mọi dòng đều thuộc gian.
    expect(tiktokBreakevenBase(rows, null)).toMatchObject({ settledOrders: 4, unlinkedRevenue: 0 });
  });

  it("đơn chưa có id chưa có kết cục cuối → đếm vào đơn chờ, chưa vào độ phủ; đơn hủy cùng lứa chưa có id → unlinkedRevenue", () => {
    const more = [
      ...rows,
      row({ items: [{ sku: "TC025-XAM", itemId: null, price: 250_000, quantity: 1 }], isSettled: false, tiktok: null }),
      cancelled({ createdAt: day("2026-08-30"), items: [{ sku: "TC025-XAM", itemId: null, price: 250_000, quantity: 1 }] }),
    ];
    expect(tiktokBreakevenBase(more, group)).toMatchObject({ settledOrders: 2, cancelledOrders: 0, pendingOrders: 1, unlinkedRevenue: 500_000 });
  });

  it("đơn ghép dòng có id + dòng chưa có id cùng nhóm: phần có id vào biên lãi, phần chưa có id vào độ phủ, đơn đếm một lần", () => {
    const mixed = row({
      items: [
        { sku: "TC025-XAM (XÁM)", itemId: "100", price: 100_000, quantity: 1 },
        { sku: "TC025-XAM", itemId: null, price: 300_000, quantity: 1 },
      ],
      actualRevenue: 400_000,
      profit: 60_000,
    });
    const base = tiktokBreakevenBase([mixed], group);
    expect(base).toMatchObject({ settledOrders: 1, pendingOrders: 0 });
    expect(base.revenue).toBeCloseTo(100_000);
    expect(base.unlinkedRevenue).toBeCloseTo(300_000);
    expect(base.profitBeforeAds).toBeCloseTo(20_000); // (60k + 20k) × 25%
    // Đơn chỉ có dòng chưa id → không đếm vào đơn đã đối soát.
    const only = row({ items: [{ sku: "TC025-XAM", itemId: null, price: 300_000, quantity: 1 }], actualRevenue: 300_000 });
    expect(tiktokBreakevenBase([only], group)).toMatchObject({ settledOrders: 0, revenue: 0, unlinkedRevenue: 300_000 });
  });

  it("tiktokBreakevenBaseByGroup / salesPaceByGroup: tra nhóm theo khóa dòng (lineGroupKey), cùng luật; đà bán vẫn đếm dòng chưa id", () => {
    const groupOfKey = new Map([[itemKey("100"), "SP-100"], ["TC025-XAM", "SP-100"], [itemKey("999"), "SP-999"]]);
    const byGroup = tiktokBreakevenBaseByGroup(rows, groupOfKey);
    expect(byGroup.get("SP-100")).toEqual(tiktokBreakevenBase(rows, group));
    expect(byGroup.get("SP-100")).toMatchObject({ settledOrders: 2, revenue: 500_000, unlinkedRevenue: 250_000 });
    expect(byGroup.get("SP-999")).toMatchObject({ settledOrders: 1, revenue: 250_000, unlinkedRevenue: 0 });
    const pace = salesPaceByGroup(rows, groupOfKey, day("2026-09-02"));
    expect(pace.get("SP-100")).toMatchObject({ units30d: 3 });
    expect(pace.get("SP-999")).toMatchObject({ units30d: 1 });
  });
});

describe("toTiktokBreakeven", () => {
  it("bán đã lỗ trước cả quảng cáo → không có ROI hòa vốn, gắn cờ negativeMargin", () => {
    expect(toTiktokBreakeven(tiktokBreakevenBase([row({ profit: -40_000 })], null), "campaign")).toMatchObject({ breakevenRoi: null, negativeMargin: true });
  });
  it("độ phủ = doanh thu tính được ÷ (tính được + thiếu giá vốn + chưa nối id) — một rào cho cả hai thứ", () => {
    const base = { settledOrders: 3, cancelledOrders: 0, revenue: 600_000, profitBeforeAds: 60_000, adFee: 0, missingCostRevenue: 200_000, unlinkedRevenue: 200_000, pendingOrders: 0 };
    expect(toTiktokBreakeven(base, "campaign")).toMatchObject({ breakevenRoi: 10, costCoveragePct: 60, unlinkedRevenue: 200_000 });
  });
});

// TAB HÒA VỐN SẢN PHẨM — một lượt quét cho mọi sản phẩm, nhưng con số từng sản phẩm PHẢI trùng phép gom gốc.
describe("tiktokBreakevenBaseByGroup — hòa vốn từng sản phẩm", () => {
  const line = (sku: string, itemId: string, price = 250_000, quantity = 1) => ({ sku, itemId, price, quantity });
  const rows: BreakevenPnlRow[] = [
    row({ items: [line("A-den", "A")] }),
    row({ items: [line("A-trang", "A")], profit: -15_000 }),
    row({ items: [line("B", "B")], missingCostPrice: true }),
    row({ items: [line("B", "B")], shippingStatus: ShippingStatus.SHIPPING, isSettled: false, tiktok: null }),
    cancelled({ items: [line("A-den", "A")], createdAt: day("2026-08-30") }),
    cancelled({ items: [line("A-den", "A")], createdAt: day("2026-09-10") }), // hủy NGOÀI lứa → chưa tính
    // Đơn hai sản phẩm: A 250k + B 750k → A nhận 25% doanh thu và lãi của đơn.
    row({
      items: [line("A-den", "A"), line("B", "B", 250_000, 3)],
      actualRevenue: 1_000_000,
      profit: 180_000,
      tiktok: { feeGmvMax: -20_000 },
    }),
    row({ items: [line("khong-co-trong-bang", "Z")] }),
  ];
  const groupOfKey = new Map([
    [itemKey("A"), "SP-A"],
    [itemKey("B"), "SP-B"],
  ]);
  const keysOf = { "SP-A": new Set([itemKey("A")]), "SP-B": new Set([itemKey("B")]) };

  it("kết quả mỗi sản phẩm = đúng phép gom gốc trên tập khóa của sản phẩm đó (số ở tab mới không lệch số hòa vốn chiến dịch)", () => {
    const byGroup = tiktokBreakevenBaseByGroup(rows, groupOfKey);
    expect([...byGroup.keys()].sort()).toEqual(["SP-A", "SP-B"]);
    for (const g of ["SP-A", "SP-B"] as const) {
      const got = byGroup.get(g)!;
      const want = tiktokBreakevenBase(rows, keysOf[g]);
      for (const k of Object.keys(want) as (keyof typeof want)[]) expect(got[k]).toBeCloseTo(want[k], 6);
    }
  });

  it("đơn nhiều sản phẩm chia theo tỷ trọng giá trị hàng; đơn chưa đối soát và đơn thiếu giá vốn để ngoài", () => {
    const a = tiktokBreakevenBaseByGroup(rows, groupOfKey).get("SP-A")!;
    // 2 đơn riêng (250k + 250k) + 25% đơn ghép (250k) + 1 đơn hủy cùng lứa (250k)
    expect(a).toMatchObject({ settledOrders: 3, cancelledOrders: 1, revenue: 1_000_000, pendingOrders: 1 });
    expect(a.profitBeforeAds).toBeCloseTo(50_000 + 5_000 + 50_000, 6);
    const b = tiktokBreakevenBaseByGroup(rows, groupOfKey).get("SP-B")!;
    expect(b).toMatchObject({ settledOrders: 1, missingCostRevenue: 250_000, pendingOrders: 1 });
  });
});

describe("salesPaceByGroup — đà bán 7 / 30 ngày của từng sản phẩm", () => {
  const now = new Date("2026-09-18T10:00:00Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86400_000);
  const g = new Map([
    ["A1", "SP-A"],
    ["A2", "SP-A"],
    ["B", "SP-B"],
  ]);
  // Dòng đi đường mã (không id) — đà bán không phân biệt, vẫn đếm.
  const noId = (sku: string, price = 250_000, quantity = 1) => ({ sku, itemId: null, price, quantity });
  it("đếm SỐ SẢN PHẨM của mọi đơn đặt (kể cả chưa đối soát), bỏ đơn hủy và đơn ngoài 30 ngày", () => {
    const rows: BreakevenPnlRow[] = [
      row({ createdAt: ago(2), isSettled: false, tiktok: null, items: [noId("A1", 100, 3)] }),
      row({ createdAt: ago(10), items: [noId("A2")] }),
      row({ createdAt: ago(40), items: [noId("A1")] }),
      cancelled({ createdAt: ago(1), items: [noId("A1")] }),
      row({ createdAt: ago(6.5), items: [noId("B")] }),
      row({ createdAt: ago(1), items: [noId("la")] }),
    ];
    const p = salesPaceByGroup(rows, g, now);
    // revenue30d: doanh thu mọi đơn đặt trừ hủy trong 30 ngày (250k × 2 đơn SP-A; đơn 40 ngày và đơn hủy không tính).
    expect(p.get("SP-A")).toEqual({ units7d: 3, units30d: 4, revenue30d: 500_000 });
    expect(p.get("SP-B")).toEqual({ units7d: 1, units30d: 1, revenue30d: 250_000 });
    expect(p.size).toBe(2);
  });

  it("đơn nhiều sản phẩm: doanh thu chia theo tỷ trọng giá trị hàng; dòng giá 0 không nhận doanh thu", () => {
    const rows: BreakevenPnlRow[] = [
      row({
        createdAt: ago(1),
        actualRevenue: 300_000,
        items: [
          noId("A1", 100_000, 3), // 300k / 400k
          noId("B", 100_000, 1), // 100k / 400k
          noId("A2", 0, 1),
        ],
      }),
    ];
    const p = salesPaceByGroup(rows, g, now);
    expect(p.get("SP-A")).toEqual({ units7d: 4, units30d: 4, revenue30d: 225_000 });
    expect(p.get("SP-B")).toEqual({ units7d: 1, units30d: 1, revenue30d: 75_000 });
  });
});

describe("bộ nhóm gửi vào câu SQL", () => {
  const sets = buildAdsGroupSets(
    groupSkusByItemId([
      { channelSku: "A1", externalId: "100-1" },
      { channelSku: "A2", externalId: "100-2" },
      { channelSku: "B", externalId: "300-1" },
    ]),
    [
      { id: "c1", itemIds: "100,300" },
      { id: "c2", itemIds: "" },
    ]
  );

  it("hai mảng song song (nhóm, khóa); chiến dịch chưa biết sản phẩm không có cặp nào", () => {
    const m = tiktokGroupMappingOf(sets);
    expect(m.groups.length).toBe(m.keys.length);
    expect(m.groups).toContain(campaignGroupKey("c1"));
    expect(m.groups).not.toContain(campaignGroupKey("c2"));
  });

  it("dấu vân tay: cùng đầu vào ra cùng mã; đổi bộ nhóm thì ra mã khác", () => {
    const base = tiktokGroupMappingOf(sets);
    expect(tiktokGroupMappingOf(sets).digest).toBe(base.digest);
    const more = new Map(sets).set(productGroupKey("999"), new Set(["Z"]));
    expect(tiktokGroupMappingOf(more).digest).not.toBe(base.digest);
  });
});

describe("mặt tiền ChannelBreakevens — hai đường cộng cùng một cách hỏi", () => {
  const sets = buildAdsGroupSets(
    groupSkusByItemId([
      { channelSku: "A1", externalId: "100-1" },
      { channelSku: "A2", externalId: "100-2" },
      { channelSku: "G", externalId: "200-1" },
    ]),
    [
      { id: "c1", itemIds: "100" },
      { id: "c2", itemIds: "" },
    ]
  );
  const now = day("2026-09-18");
  const rows: BreakevenPnlRow[] = [
    row({ createdAt: day("2026-09-01"), items: [{ sku: "A1", itemId: "100", price: 250_000, quantity: 1 }] }),
    row({ createdAt: day("2026-09-15"), isSettled: false, tiktok: null, items: [{ sku: "A2", itemId: "100", price: 250_000, quantity: 1 }] }),
    // Quà giá 0 đi kèm: sản phẩm 200 chỉ có dòng giá 0.
    row({
      createdAt: day("2026-09-02"),
      items: [
        { sku: "A1", itemId: "100", price: 250_000, quantity: 1 },
        { sku: "G", itemId: "200", price: 0, quantity: 1 },
      ],
    }),
  ];

  it("đường rows: nhóm toàn gian, chiến dịch, danh sách sản phẩm có dòng có giá, đà bán", () => {
    const be = breakevensFromRows(rows, sets, now.getTime());
    expect(be.base(SHOP_GROUP)).toEqual(tiktokBreakevenBase(rows, null));
    expect(be.base(campaignGroupKey("c1"))).toMatchObject({ settledOrders: 2, pendingOrders: 1, revenue: 500_000 });
    // Chiến dịch chưa biết sản phẩm và nhóm lạ → toàn 0.
    expect(be.base(campaignGroupKey("c2"))).toMatchObject({ settledOrders: 0, pendingOrders: 0, revenue: 0 });
    expect(be.base("khong-co")).toMatchObject({ settledOrders: 0, pendingOrders: 0, revenue: 0 });
    expect([...be.productBases().keys()]).toEqual(["100"]); // 200 chỉ có dòng giá 0
    expect(be.productPace().get("100")).toEqual({ units7d: 1, units30d: 3, revenue30d: 750_000 });
    expect(be.productPace().get("200")).toEqual({ units7d: 0, units30d: 1, revenue30d: 0 });
  });

  it("đường sql: tra đúng kết quả đã gom; sản phẩm không có dòng có giá không lên danh sách", () => {
    const group = (over: Partial<LedgerTiktokBreakevenGroup>): LedgerTiktokBreakevenGroup => ({
      hasPaid: true,
      settledOrders: 0,
      cancelledOrders: 0,
      revenue: 0,
      profitBeforeAds: 0,
      adFee: 0,
      missingCostRevenue: 0,
      unlinkedRevenue: 0,
      pendingOrders: 0,
      units30d: 0,
      units7d: 0,
      revenue30d: 0,
      ...over,
    });
    const be = breakevensFromGroups(
      new Map([
        [SHOP_GROUP, group({ settledOrders: 2, revenue: 500_000, profitBeforeAds: 100_000, adFee: 40_000, pendingOrders: 1 })],
        [campaignGroupKey("c1"), group({ settledOrders: 2, revenue: 500_000, unlinkedRevenue: 50_000 })],
        [productGroupKey("100"), group({ settledOrders: 2, revenue: 500_000, units30d: 3, units7d: 1, revenue30d: 750_000 })],
        [productGroupKey("200"), group({ hasPaid: false, units30d: 1 })],
      ])
    );
    expect(be.base(SHOP_GROUP)).toEqual({
      settledOrders: 2, cancelledOrders: 0, revenue: 500_000, profitBeforeAds: 100_000, adFee: 40_000, missingCostRevenue: 0, unlinkedRevenue: 0, pendingOrders: 1,
    });
    expect(be.base(campaignGroupKey("c1")).unlinkedRevenue).toBe(50_000);
    expect(be.base(campaignGroupKey("c2"))).toMatchObject({ settledOrders: 0, revenue: 0 });
    expect([...be.productBases().keys()]).toEqual(["100"]);
    expect(be.productPace().get("100")).toEqual({ units7d: 1, units30d: 3, revenue30d: 750_000 });
    expect(be.productPace().get("200")).toEqual({ units7d: 0, units30d: 1, revenue30d: 0 });
  });
});

// LÃI/LỖ ƯỚC TÍNH (12/10/2026) = doanh thu × biên lãi trước quảng cáo − chi phí; cùng rổ với ROI thực nên đổi dấu đúng tại hòa vốn.
describe("tiktokEstProfit", () => {
  it("ROI trên hòa vốn → dương; dưới → âm; đúng bằng 0 tại hòa vốn", () => {
    const be = { margin: 0.2 }; // hòa vốn = 5
    expect(tiktokEstProfit(6_000_000, 1_000_000, be)).toBeCloseTo(200_000); // ROI 6 > 5
    expect(tiktokEstProfit(4_000_000, 1_000_000, be)).toBeCloseTo(-200_000); // ROI 4 < 5
    expect(tiktokEstProfit(5_000_000, 1_000_000, be)).toBeCloseTo(0);
  });
  it("chưa có biên lãi → null; biên lãi âm (lỗ sẵn) → âm sâu hơn cả tiền ads", () => {
    expect(tiktokEstProfit(1_000_000, 100_000, null)).toBeNull();
    expect(tiktokEstProfit(1_000_000, 100_000, { margin: null })).toBeNull();
    expect(tiktokEstProfit(1_000_000, 100_000, { margin: -0.1 })).toBeCloseTo(-200_000);
    expect(tiktokEstProfit(0, 0, { margin: 0.2 })).toBe(0);
  });
  it("khớp dấu với so sánh ROI thực ↔ hòa vốn của toTiktokBreakeven", () => {
    const be = toTiktokBreakeven(
      { settledOrders: 5, cancelledOrders: 0, revenue: 1_000_000, profitBeforeAds: 175_000, adFee: 0, missingCostRevenue: 0, unlinkedRevenue: 0, pendingOrders: 0 },
      "campaign"
    );
    const spend = 1_218_615;
    for (const gmv of [17_788_694, 6_000_000, 7_000_000]) {
      const roi = gmv / spend;
      const est = tiktokEstProfit(gmv, spend, be)!;
      expect(est >= 0).toBe(roi >= be.breakevenRoi!);
    }
  });
});
