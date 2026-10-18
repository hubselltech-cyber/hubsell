// ============================================================
// BIÊN LÃI QUẢNG CÁO Shopee/Lazada — logic thuần của lib/ads-margin.ts, KHÔNG DB:
//   · đơn THIẾU GIÁ VỐN bị loại khỏi phép tính (28/09/2026, anh Trung: "không
//     được sai giá vốn trong lãi lỗ kéo theo ROAS hòa vốn");
//   · bộ nhóm SKU của gian, mặt tiền hai đường cộng.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  MARGIN_CHECK_MAX_GAP_PCT,
  MARGIN_MIN_COST_COVERAGE_PCT,
  SHOP_GROUP,
  adsGroupMappingOf,
  marginCheckProblem,
  placedRevenueOf,
  buildAdsGroupSets,
  campaignGroupKey,
  groupSkusByItemId,
  itemKey,
  lineGroupKey,
  lowCostCoverage,
  marginBaseFromSums,
  marginOf,
  marginOverRows,
  marginsFromGroups,
  marginsFromRows,
  productGroupKey,
  type MarginRow,
} from "../ads-margin";

function row(p: { sku: string; price: number; qty?: number; revenue: number; profit: number; missing?: boolean }): MarginRow {
  return {
    items: [{ sku: p.sku, price: p.price, quantity: p.qty ?? 1 }],
    actualRevenue: p.revenue,
    profit: p.profit,
    missingCostPrice: p.missing ?? false,
  } as unknown as MarginRow;
}

describe("marginOverRows — loại đơn thiếu giá vốn", () => {
  it("đơn giá vốn 0 không được cộng vào tử/mẫu; doanh thu của nó vào missingCostRevenue", () => {
    const rows = [
      row({ sku: "A", price: 100, revenue: 100, profit: 30 }),
      // giá vốn 0 → profit "ảo" 80 (chỉ trừ phí sàn); trước 28/09 bị cộng vào
      row({ sku: "A", price: 100, revenue: 100, profit: 80, missing: true }),
    ];
    const base = marginOverRows(rows, null);
    expect(base.orders).toBe(1);
    expect(base.revenue).toBe(100);
    expect(base.profit).toBe(30);
    expect(base.missingCostOrders).toBe(1);
    expect(base.missingCostRevenue).toBe(100);
    expect(base.costCoveragePct).toBe(50);
    // biên lãi thật 30% (không phải (30+80)/200 = 55% như trước)
    expect(base.profit / base.revenue).toBeCloseTo(0.3);
  });

  it("độ phủ dưới ngưỡng → marginOf null, lowCostCoverage true (không kết luận ROAS hòa vốn)", () => {
    const rows = [
      row({ sku: "A", price: 100, revenue: 100, profit: 30 }),
      row({ sku: "A", price: 100, revenue: 100, profit: 80, missing: true }),
    ];
    const base = marginOverRows(rows, null);
    expect(base.costCoveragePct).toBeLessThan(MARGIN_MIN_COST_COVERAGE_PCT);
    expect(marginOf(base)).toBeNull();
    expect(lowCostCoverage(base)).toBe(true);
  });

  it("đủ độ phủ → biên lãi tính trên đúng các đơn có giá vốn", () => {
    const rows = Array.from({ length: 19 }, () => row({ sku: "A", price: 100, revenue: 100, profit: 25 }));
    rows.push(row({ sku: "A", price: 100, revenue: 100, profit: 90, missing: true }));
    const base = marginOverRows(rows, null);
    expect(base.costCoveragePct).toBe(95);
    expect(marginOf(base)).toBeCloseTo(0.25);
    expect(lowCostCoverage(base)).toBe(false);
  });

  it("lọc theo SKU: đơn nhiều SKU phân bổ theo tỷ trọng, đơn thiếu giá vốn vẫn bị loại", () => {
    const multi = {
      items: [
        { sku: "A", price: 100, quantity: 1 },
        { sku: "B", price: 300, quantity: 1 },
      ],
      actualRevenue: 400,
      profit: 100,
      missingCostPrice: false,
    } as unknown as MarginRow;
    const missingA = row({ sku: "A", price: 100, revenue: 100, profit: 90, missing: true });
    const base = marginOverRows([multi, missingA], new Set(["A"]));
    expect(base.orders).toBe(1);
    expect(base.revenue).toBeCloseTo(100); // 400 × 1/4
    expect(base.profit).toBeCloseTo(25);
    expect(base.missingCostOrders).toBe(1);
    expect(base.missingCostRevenue).toBeCloseTo(100);
  });

  it("chưa có đơn nào → coverage null, margin null, không coi là độ phủ thấp", () => {
    const base = marginOverRows([], null);
    expect(base.costCoveragePct).toBeNull();
    expect(marginOf(base)).toBeNull();
    expect(lowCostCoverage(base)).toBe(false);
  });
});

// ------------------------------------------------------------
// Biên lãi theo nhóm SKU — hai đường cộng sau một mặt tiền
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md)
// ------------------------------------------------------------

describe("bộ nhóm SKU của gian", () => {
  const products = [
    { channelSku: "A-DO", externalId: "100-1" },
    { channelSku: "A-XANH", externalId: "100-2" },
    { channelSku: "B", externalId: "200" },
    { channelSku: "KHONG-MA", externalId: null },
    { channelSku: "RONG", externalId: "" },
  ];

  it("groupSkusByItemId: gom theo phần trước dấu gạch của externalId, bỏ dòng không có mã sàn", () => {
    const byItem = groupSkusByItemId(products);
    expect([...byItem.keys()].sort()).toEqual(["100", "200"]);
    expect([...byItem.get("100")!].sort()).toEqual(["A-DO", "A-XANH"]);
    expect([...byItem.get("200")!]).toEqual(["B"]);
  });

  it("buildAdsGroupSets: mỗi sản phẩm một nhóm; chiến dịch = hợp SKU các item, item lạ / itemIds trống → tập rỗng", () => {
    const sets = buildAdsGroupSets(groupSkusByItemId(products), [
      { id: "c1", itemIds: "100,200" },
      { id: "c2", itemIds: "200,999" },
      { id: "c3", itemIds: "" },
    ]);
    // Lát 1b (18/10/2026): mỗi nhóm mang thêm khóa SPU "i:<itemId>" — dòng hàng có id khớp bằng khóa này, mã thô chỉ là đường lui.
    expect([...sets.get(productGroupKey("100"))!].sort()).toEqual(["A-DO", "A-XANH", itemKey("100")]);
    expect([...sets.get(campaignGroupKey("c1"))!].sort()).toEqual(["A-DO", "A-XANH", "B", itemKey("100"), itemKey("200")]);
    // Item lạ (999, chưa có trong danh mục) vẫn có khóa SPU: đơn mang id của nó gom đúng chiến dịch dù danh mục chưa kéo về.
    expect([...sets.get(campaignGroupKey("c2"))!].sort()).toEqual(["B", itemKey("200"), itemKey("999")]);
    expect(sets.get(campaignGroupKey("c3"))!.size).toBe(0);
    expect(sets.has(SHOP_GROUP)).toBe(false);
  });

  it("id trước, mã sau: dòng có SPU chỉ khớp khóa SPU (mã trùng sản phẩm khác không kéo vào); dòng chưa có id khớp theo mã", () => {
    const a = (over: { sku: string; itemId?: string | null }, revenue = 100, profit = 30): MarginRow =>
      ({ items: [{ ...over, price: 100, quantity: 1 }], actualRevenue: revenue, profit, missingCostPrice: false }) as unknown as MarginRow;
    const group = new Set(["TC025-XAM", itemKey("100")]);
    expect(lineGroupKey({ sku: "TC025-XAM", itemId: "100" })).toBe("i:100");
    expect(lineGroupKey({ sku: "TC025-XAM", itemId: null })).toBe("TC025-XAM");
    const rows = [
      a({ sku: "TC025-XAM", itemId: "100" }), // id đúng sản phẩm → tính
      a({ sku: "TC025-XAM (XÁM)", itemId: "100" }), // mã đã đổi đuôi nhưng id đúng → tính (ca TC025 NEW)
      a({ sku: "TC025-XAM", itemId: "999" }), // cùng mã nhưng là sản phẩm KHÁC → KHÔNG tính
      a({ sku: "TC025-XAM", itemId: null }), // đơn cũ chưa có id → đường lui mã → tính
      a({ sku: "TC025-XAM (XÁM)", itemId: null }), // chưa có id, mã có đuôi không nằm trong nhóm → không tính (Lát 2 bù id)
    ];
    const base = marginOverRows(rows, group);
    expect(base.orders).toBe(3);
    expect(base.revenue).toBe(300);
  });

  it("adsGroupMappingOf: hai mảng song song xếp cố định; digest không phụ thuộc thứ tự nạp, đổi khi bộ nhóm đổi", () => {
    const a = adsGroupMappingOf(
      buildAdsGroupSets(groupSkusByItemId(products), [{ id: "c1", itemIds: "100,200" }])
    );
    const b = adsGroupMappingOf(
      buildAdsGroupSets(groupSkusByItemId([...products].reverse()), [{ id: "c1", itemIds: "200,100" }])
    );
    expect(a.groups.map((g, i) => `${g}|${a.keys[i]}`)).toEqual([
      "c:c1|A-DO",
      "c:c1|A-XANH",
      "c:c1|B",
      "c:c1|i:100",
      "c:c1|i:200",
      "p:100|A-DO",
      "p:100|A-XANH",
      "p:100|i:100",
      "p:200|B",
      "p:200|i:200",
    ]);
    expect(b).toEqual(a);
    const more = adsGroupMappingOf(
      buildAdsGroupSets(
        groupSkusByItemId([...products, { channelSku: "B-2", externalId: "200-2" }]),
        [{ id: "c1", itemIds: "100,200" }]
      )
    );
    expect(more.digest).not.toBe(a.digest);
    // Chiến dịch chưa biết SKU không sinh cặp nào, không làm đổi ánh xạ.
    const withEmpty = adsGroupMappingOf(
      buildAdsGroupSets(groupSkusByItemId(products), [
        { id: "c1", itemIds: "100,200" },
        { id: "c9", itemIds: "" },
      ])
    );
    expect(withEmpty).toEqual(a);
  });
});

// LÁT 4 (18/10/2026): tự kiểm MỘT CHIỀU với direct_gmv của Shopee (docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 10).
describe("marginCheckProblem / placedRevenueOf / ánh xạ kèm khoảng tự kiểm", () => {
  const check = (revenuePlaced: number, platformDirectGmv: number) => ({ revenuePlaced, platformDirectGmv, from: "2026-09-19", to: "2026-10-17" });

  it("Hubsell ≥ 75% direct_gmv → ổn (kể cả cao hơn nhiều: đơn tự nhiên); không có số sàn → ổn", () => {
    expect(marginCheckProblem(check(100, 100))).toBe("");
    expect(marginCheckProblem(check(75, 100))).toBe(""); // đúng ngưỡng
    expect(marginCheckProblem(check(500, 100))).toBe(""); // chiều cao hơn không kiểm
    expect(marginCheckProblem(check(0, 0))).toBe("");
    expect(marginCheckProblem(null)).toBe("");
    expect(MARGIN_CHECK_MAX_GAP_PCT).toBe(25);
  });

  it("Hubsell dưới 75% direct_gmv → lý do nêu % và hai con số (ca Hanoinest 0,64 / TGXT 0,72 trên prod 18/10)", () => {
    const why = marginCheckProblem(check(6_400_000, 10_000_000));
    expect(why).toContain("64%");
    expect(why).toContain("6.400.000đ");
    expect(why).toContain("10.000.000đ");
    expect(why).toContain("chưa tin được");
    expect(marginCheckProblem(check(0, 10_000_000))).toContain("0%");
  });

  it("placedRevenueOf: mọi đơn đặt (kể cả hủy), ngày VN trong [from, to], chia theo tỷ trọng, khóa id trước mã sau", () => {
    const r = (createdAt: string, items: { sku: string; itemId?: string | null; price: number; quantity: number }[], actualRevenue: number) => ({
      createdAt: new Date(createdAt),
      actualRevenue,
      items,
    });
    const rows = [
      r("2026-10-01T03:00:00Z", [{ sku: "A", itemId: "100", price: 100, quantity: 1 }], 100), // trong khoảng, id khớp
      r("2026-10-02T03:00:00Z", [{ sku: "A", itemId: "100", price: 100, quantity: 1 }, { sku: "B", itemId: "200", price: 300, quantity: 1 }], 400), // 1/4
      r("2026-10-03T03:00:00Z", [{ sku: "A", itemId: "999", price: 100, quantity: 1 }], 100), // cùng mã, SPU khác → không
      r("2026-10-04T03:00:00Z", [{ sku: "A", itemId: null, price: 100, quantity: 1 }], 100), // chưa có id → theo mã
      r("2026-09-30T16:59:00Z", [{ sku: "A", itemId: "100", price: 100, quantity: 1 }], 100), // 23:59 30/09 giờ VN → ngoài
    ];
    expect(placedRevenueOf(rows, new Set(["A", "i:100"]), "2026-10-01", "2026-10-31")).toBe(300);
  });

  it("adsGroupMappingOf kèm khoảng tự kiểm: checkFrom theo cặp, digest đổi khi khoảng đổi", () => {
    const sets = buildAdsGroupSets(groupSkusByItemId([{ channelSku: "A", externalId: "100-1" }]), [{ id: "c1", itemIds: "100" }]);
    const plain = adsGroupMappingOf(sets);
    expect(plain.checkFrom.every((d) => d === "")).toBe(true);
    expect(plain.checkTo).toBe("");
    const checks = { from: new Map([[campaignGroupKey("c1"), "2026-10-01"]]), to: "2026-10-17" };
    const m = adsGroupMappingOf(sets, checks);
    m.groups.forEach((g, i) => expect(m.checkFrom[i]).toBe(g === campaignGroupKey("c1") ? "2026-10-01" : ""));
    expect(m.checkTo).toBe("2026-10-17");
    expect(m.digest).not.toBe(plain.digest);
    expect(adsGroupMappingOf(sets, { ...checks, to: "2026-10-18" }).digest).not.toBe(m.digest);
    expect(adsGroupMappingOf(sets, checks).digest).toBe(m.digest);
  });
});

describe("ChannelMargins — mặt tiền chung của hai đường cộng", () => {
  const NOW = Date.parse("2026-09-30T10:00:00Z");
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);
  const order = (p: {
    at: Date;
    revenue: number;
    profit: number;
    missing?: boolean;
    items: { sku: string; price: number; quantity: number; costPriceAtSale: number }[];
  }): MarginRow =>
    ({
      createdAt: p.at,
      actualRevenue: p.revenue,
      profit: p.profit,
      missingCostPrice: p.missing ?? false,
      items: p.items,
    }) as unknown as MarginRow;

  const sets = buildAdsGroupSets(
    groupSkusByItemId([
      { channelSku: "A-DO", externalId: "100-1" },
      { channelSku: "A-XANH", externalId: "100-2" },
      { channelSku: "B", externalId: "200" },
    ]),
    [
      { id: "c1", itemIds: "100" },
      { id: "c2", itemIds: "" },
    ]
  );
  const rows = [
    // Hai phân loại của CÙNG sản phẩm trong một đơn → nhóm sản phẩm đếm MỘT đơn.
    order({
      at: daysAgo(1),
      revenue: 300,
      profit: 60,
      items: [
        { sku: "A-DO", price: 100, quantity: 1, costPriceAtSale: 50 },
        { sku: "A-XANH", price: 100, quantity: 2, costPriceAtSale: 50 },
      ],
    }),
    // Đơn cũ hơn 7 ngày, dòng B chưa có giá vốn (cờ cấp đơn bật).
    order({
      at: daysAgo(10),
      revenue: 400,
      profit: 300,
      missing: true,
      items: [
        { sku: "A-DO", price: 100, quantity: 1, costPriceAtSale: 50 },
        { sku: "B", price: 300, quantity: 3, costPriceAtSale: 0 },
      ],
    }),
  ];

  it("đường rows: toàn gian, chiến dịch, sản phẩm, chiến dịch chưa biết SKU", () => {
    const m = marginsFromRows(rows, sets, NOW);
    expect(m.base(SHOP_GROUP)).toEqual(marginOverRows(rows, null));
    const product = m.base(productGroupKey("100"));
    expect(product.orders).toBe(1);
    expect(product.revenue).toBeCloseTo(300);
    expect(product.missingCostOrders).toBe(1);
    expect(product.missingCostRevenue).toBeCloseTo(40); // 400 × 100/1000
    expect(m.base(campaignGroupKey("c1"))).toEqual(product);
    expect(m.base(campaignGroupKey("c2"))).toEqual(marginOverRows([], null));
    expect(m.base("c:khong-co")).toEqual(marginOverRows([], null));
  });

  it("đường rows: nhịp bán theo item — 7 ngày tính từ mốc truyền vào, thiếu giá vốn xét theo dòng hàng", () => {
    const pace = marginsFromRows(rows, sets, NOW).productPace();
    expect(pace.get("100")).toEqual({ units30d: 4, units7d: 3, unitsNoCost: 0 });
    expect(pace.get("200")).toEqual({ units30d: 3, units7d: 0, unitsNoCost: 3 });
    expect(pace.size).toBe(2);
  });

  it("đường sql: tra kết quả đã gom; nhóm vắng mặt → toàn 0; nhịp bán chỉ lấy nhóm sản phẩm", () => {
    const stats = (orders: number, units: number) => ({
      base: marginBaseFromSums({
        orders,
        revenue: orders * 100,
        profit: orders * 20,
        missingCostOrders: 0,
        missingCostRevenue: 0,
      }),
      pace: { units30d: units, units7d: 1, unitsNoCost: 0 },
      placedRevenue: 0,
    });
    const m = marginsFromGroups(
      new Map([
        [SHOP_GROUP, stats(5, 9)],
        [campaignGroupKey("c1"), stats(2, 4)],
        [productGroupKey("100"), stats(2, 4)],
      ])
    );
    expect(m.base(SHOP_GROUP).orders).toBe(5);
    expect(m.base(campaignGroupKey("c1")).revenue).toBe(200);
    expect(m.base(productGroupKey("200"))).toEqual(marginOverRows([], null));
    expect([...m.productPace()]).toEqual([["100", { units30d: 4, units7d: 1, unitsNoCost: 0 }]]);
  });

  it("marginBaseFromSums: độ phủ = doanh thu có giá vốn ÷ tổng doanh thu của nhóm", () => {
    expect(
      marginBaseFromSums({ orders: 1, revenue: 300, profit: 60, missingCostOrders: 1, missingCostRevenue: 100 })
        .costCoveragePct
    ).toBe(75);
    expect(
      marginBaseFromSums({ orders: 0, revenue: 0, profit: 0, missingCostOrders: 0, missingCostRevenue: 0 })
        .costCoveragePct
    ).toBeNull();
  });
});
