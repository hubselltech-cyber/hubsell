import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import {
  placedRevenue,
  productBreakevenVerdict,
  salesPaceByGroup,
  settledCohortCutoff,
  tiktokBreakevenBase,
  tiktokBreakevenBaseByGroup,
  toTiktokBreakeven,
  type BreakevenPnlRow,
  type TiktokBreakeven,
} from "../tiktok-ads/breakeven";

// ROI HÒA VỐN TIKTOK = 1 ÷ biên lãi TRƯỚC quảng cáo, CHỈ trên đơn đã có kết cục cuối (anh Trung 18/09):
// đơn đã đối soát thật (giao thành công / hoàn xong) + đơn hủy cùng lứa. Phí GMV Max đã nằm trong lợi nhuận → cộng ngược.
const day = (d: string) => new Date(`${d}T03:00:00Z`);

function row(over: Partial<BreakevenPnlRow> & { sku?: string }): BreakevenPnlRow {
  return {
    createdAt: day("2026-09-01"),
    shippingStatus: ShippingStatus.DELIVERED,
    isSettled: true,
    items: [{ sku: over.sku ?? "TC054", price: 250_000, quantity: 1 }],
    actualRevenue: 250_000,
    profit: 30_000,
    missingCostPrice: false,
    tiktok: { feeGmvMax: -20_000 },
    ...over,
  };
}
const cancelled = (over: Partial<BreakevenPnlRow> & { sku?: string } = {}) =>
  row({ shippingStatus: ShippingStatus.CANCELLED, isSettled: false, profit: -120_000, tiktok: null, ...over });

describe("tiktokBreakevenBase", () => {
  it("cộng ngược phí GMV Max: lãi 30k đã trừ 20k quảng cáo → lãi trước ads 50k, hòa vốn = 250/50 = 5", () => {
    const base = tiktokBreakevenBase([row({})], null);
    expect(base).toMatchObject({ settledOrders: 1, revenue: 250_000, profitBeforeAds: 50_000, adFee: 20_000, pendingOrders: 0 });
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
        { sku: "TC054", price: 100_000, quantity: 1 },
        { sku: "KHAC", price: 300_000, quantity: 1 },
      ],
      actualRevenue: 400_000,
      profit: 60_000,
    });
    const base = tiktokBreakevenBase([mixed, row({ sku: "KHAC" })], new Set(["TC054"]));
    expect(base.settledOrders).toBe(1);
    expect(base.revenue).toBeCloseTo(100_000);
    expect(base.profitBeforeAds).toBeCloseTo(20_000); // (60k + 20k) × 25%
    expect(base.adFee).toBeCloseTo(5_000);
  });

  it("sàn HOÀN lại phí quảng cáo (feeGmvMax dương) thì trừ ra, không cộng", () => {
    expect(tiktokBreakevenBase([row({ profit: 40_000, tiktok: { feeGmvMax: 5_000 } })], null).profitBeforeAds).toBe(35_000);
  });
});

describe("toTiktokBreakeven", () => {
  it("bán đã lỗ trước cả quảng cáo → không có ROI hòa vốn, gắn cờ negativeMargin", () => {
    expect(toTiktokBreakeven(tiktokBreakevenBase([row({ profit: -40_000 })], null), "campaign")).toMatchObject({ breakevenRoi: null, negativeMargin: true });
  });
});

describe("placedRevenue — tự kiểm mẫu số với doanh thu TikTok báo", () => {
  it("cộng MỌI đơn đặt trong khoảng ngày VN (kể cả hủy, đang giao), đúng SKU, theo tỷ trọng", () => {
    const rows = [
      row({ createdAt: new Date("2026-09-05T18:30:00Z") }), // 01:30 ngày 06/09 giờ VN
      cancelled({ createdAt: day("2026-09-06") }),
      row({ createdAt: day("2026-09-06"), isSettled: false, tiktok: null, shippingStatus: ShippingStatus.SHIPPING }),
      row({ createdAt: day("2026-09-08") }), // ngoài khoảng
      row({ createdAt: day("2026-09-06"), sku: "KHAC" }), // SKU khác
    ];
    expect(placedRevenue(rows, new Set(["TC054"]), "2026-09-06", "2026-09-07")).toBe(750_000);
  });
});

// TAB HÒA VỐN SẢN PHẨM — một lượt quét cho mọi sản phẩm, nhưng con số từng sản phẩm PHẢI trùng phép gom gốc.
describe("tiktokBreakevenBaseByGroup — hòa vốn từng sản phẩm", () => {
  const rows: BreakevenPnlRow[] = [
    row({ sku: "A-den" }),
    row({ sku: "A-trang", profit: -15_000 }),
    row({ sku: "B", missingCostPrice: true }),
    row({ sku: "B", shippingStatus: ShippingStatus.SHIPPING, isSettled: false, tiktok: null }),
    cancelled({ sku: "A-den", createdAt: day("2026-08-30") }),
    cancelled({ sku: "A-den", createdAt: day("2026-09-10") }), // hủy NGOÀI lứa → chưa tính
    // Đơn hai sản phẩm: A 250k + B 750k → A nhận 25% doanh thu và lãi của đơn.
    row({
      items: [
        { sku: "A-den", price: 250_000, quantity: 1 },
        { sku: "B", price: 250_000, quantity: 3 },
      ],
      actualRevenue: 1_000_000,
      profit: 180_000,
      tiktok: { feeGmvMax: -20_000 },
    }),
    row({ sku: "khong-co-trong-bang" }),
  ];
  const groupOfSku = new Map([
    ["A-den", "SP-A"],
    ["A-trang", "SP-A"],
    ["B", "SP-B"],
  ]);

  it("kết quả mỗi sản phẩm = đúng phép gom gốc trên tập SKU của sản phẩm đó (số ở tab mới không lệch số hòa vốn chiến dịch)", () => {
    const byGroup = tiktokBreakevenBaseByGroup(rows, groupOfSku);
    expect([...byGroup.keys()].sort()).toEqual(["SP-A", "SP-B"]);
    for (const [g, skus] of [
      ["SP-A", ["A-den", "A-trang"]],
      ["SP-B", ["B"]],
    ] as const) {
      const got = byGroup.get(g)!;
      const want = tiktokBreakevenBase(rows, new Set(skus));
      for (const k of Object.keys(want) as (keyof typeof want)[]) expect(got[k]).toBeCloseTo(want[k], 6);
    }
  });

  it("đơn nhiều sản phẩm chia theo tỷ trọng giá trị hàng; đơn chưa đối soát và đơn thiếu giá vốn để ngoài", () => {
    const a = tiktokBreakevenBaseByGroup(rows, groupOfSku).get("SP-A")!;
    // 2 đơn riêng (250k + 250k) + 25% đơn ghép (250k) + 1 đơn hủy cùng lứa (250k)
    expect(a).toMatchObject({ settledOrders: 3, cancelledOrders: 1, revenue: 1_000_000, pendingOrders: 1 });
    expect(a.profitBeforeAds).toBeCloseTo(50_000 + 5_000 + 50_000, 6);
    const b = tiktokBreakevenBaseByGroup(rows, groupOfSku).get("SP-B")!;
    expect(b).toMatchObject({ settledOrders: 1, missingCostRevenue: 250_000, pendingOrders: 1 });
  });
});

describe("productBreakevenVerdict — cột Nhận định của tab Hòa vốn sản phẩm", () => {
  const be = (over: Partial<TiktokBreakeven>): TiktokBreakeven => ({
    breakevenRoi: 5,
    margin: 0.2,
    negativeMargin: false,
    source: "product",
    orders: 12,
    cancelledOrders: 0,
    pendingOrders: 0,
    costCoveragePct: 100,
    check: null,
    ...over,
  });
  const camp = (roasTarget: number | null, status = "ongoing") => ({ id: "c1", name: "TC054", status, roasTarget });

  it("đủ đơn, đủ giá vốn, mục tiêu trên hòa vốn → ổn, nói luôn mức ROI tối thiểu", () => {
    const v = productBreakevenVerdict(be({}), [camp(15)], 90);
    expect(v.verdict).toBe("ok");
    expect(v.reason).toContain("từ 5 trở lên");
  });
  it("chiến dịch ĐANG CHẠY đặt ROI mục tiêu dưới hòa vốn → cảnh báo; chiến dịch tạm dừng thì không", () => {
    expect(productBreakevenVerdict(be({}), [camp(4)], 90).verdict).toBe("target_below");
    expect(productBreakevenVerdict(be({}), [camp(4, "paused")], 90).verdict).toBe("ok");
  });
  it("thiếu giá vốn đứng trước mọi kết luận khác — con số chưa tin được thì không phán gì thêm", () => {
    expect(productBreakevenVerdict(be({ orders: 0, breakevenRoi: null, margin: null, costCoveragePct: 0 }), [], 90).verdict).toBe("no_cost");
    expect(productBreakevenVerdict(be({ costCoveragePct: 60, negativeMargin: true }), [], 90).verdict).toBe("no_cost");
  });
  it("chưa có đơn đã đối soát → nói rõ còn bao nhiêu đơn đang chờ", () => {
    const v = productBreakevenVerdict(be({ orders: 0, breakevenRoi: null, margin: null, costCoveragePct: null, pendingOrders: 7 }), [], 90);
    expect(v.verdict).toBe("no_settled");
    expect(v.reason).toContain("7 đơn");
  });
  it("lỗ sẵn trước quảng cáo · mới vài đơn đã đối soát", () => {
    expect(productBreakevenVerdict(be({ negativeMargin: true, breakevenRoi: null, margin: -0.05 }), [], 90).verdict).toBe("loss");
    expect(productBreakevenVerdict(be({ orders: 3 }), [camp(2)], 90).verdict).toBe("low_sample");
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
  it("đếm SỐ SẢN PHẨM của mọi đơn đặt (kể cả chưa đối soát), bỏ đơn hủy và đơn ngoài 30 ngày", () => {
    const rows: BreakevenPnlRow[] = [
      row({ sku: "A1", createdAt: ago(2), isSettled: false, tiktok: null, items: [{ sku: "A1", price: 100, quantity: 3 }] }),
      row({ sku: "A2", createdAt: ago(10) }),
      row({ sku: "A1", createdAt: ago(40) }),
      cancelled({ sku: "A1", createdAt: ago(1) }),
      row({ sku: "B", createdAt: ago(6.5) }),
      row({ sku: "la", createdAt: ago(1) }),
    ];
    const p = salesPaceByGroup(rows, g, now);
    expect(p.get("SP-A")).toEqual({ units7d: 3, units30d: 4 });
    expect(p.get("SP-B")).toEqual({ units7d: 1, units30d: 1 });
    expect(p.size).toBe(2);
  });
});
