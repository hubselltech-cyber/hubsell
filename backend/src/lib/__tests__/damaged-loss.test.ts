import { describe, expect, it } from "vitest";
import { buildDamagedLoss, emptyDamagedLoss } from "../damaged-loss";
import { cashFlowNetProfit } from "../net-profit";

describe("buildDamagedLoss — tách phần đã nằm trong giá vốn và phần ngoài đơn tính doanh thu", () => {
  const d = buildDamagedLoss(
    [
      // Đã chốt không được đền, sàn vẫn ghi Đã giao → đơn tính doanh thu
      { channelName: "SHOPEE", countsAsRevenue: true, count: 4, amount: 630_000 },
      // Hỏng chờ khiếu nại (đang hoàn) + đơn sàn hủy → không tính doanh thu
      { channelName: "SHOPEE", countsAsRevenue: false, count: 2, amount: 263_000 },
      { channelName: "TIKTOK", countsAsRevenue: false, count: 1, amount: 60_000 },
    ],
    [
      { day: "2026-11-12", amount: 263_000 },
      { day: "2026-11-13", amount: 60_000 },
    ]
  );

  it("tổng dòng = cả hai phần; số đơn cộng đủ", () => {
    expect(d.total).toBe(953_000);
    expect(d.inActive).toBe(630_000);
    expect(d.outside).toBe(323_000);
    expect(d.total).toBe(d.inActive + d.outside);
    expect(d.orderCount).toBe(7);
  });

  it("phần trong giá vốn bóc theo sàn; phần ngoài bóc theo ngày", () => {
    expect([...d.inActiveByChannelName]).toEqual([["SHOPEE", 630_000]]);
    expect([...d.outsideByDay.values()].reduce((a, b) => a + b, 0)).toBe(d.outside);
  });

  it("không có đơn báo hỏng → mọi số 0", () => {
    expect(buildDamagedLoss([])).toEqual(emptyDamagedLoss());
  });
});

describe("đẳng thức Dòng tiền sau khi thêm dòng Thất thu: Doanh thu − Chi phí + Thu khác = LN trước thuế", () => {
  it("tách dòng không làm đổi tổng với phần đã nằm trong giá vốn; phần ngoài bị trừ đúng một lần", () => {
    const revenue = 10_000_000; // Σ platformRevenue đơn tính doanh thu
    const activeCogs = 6_000_000; // Σ giá vốn đơn tính doanh thu (đã gồm 630k hàng hỏng)
    const ads = 500_000;
    const opex = 400_000;
    const income = 100_000;
    const damaged = buildDamagedLoss([
      { channelName: "SHOPEE", countsAsRevenue: true, count: 4, amount: 630_000 },
      { channelName: "SHOPEE", countsAsRevenue: false, count: 3, amount: 323_000 },
    ]);

    // Cột Chi phí: Giá vốn (đã tách) + Thất thu + quảng cáo + vận hành
    const cogsLine = activeCogs - damaged.inActive;
    const costColumn = cogsLine + damaged.total + ads + opex;

    const np = cashFlowNetProfit({
      orderProfit: revenue - activeCogs,
      adsSpend: ads,
      operatingExpense: opex,
      operatingIncome: income,
      damagedLossOutside: damaged.outside,
      additionalTaxOf: () => 0,
    });

    expect(np.provisionalProfit).toBe(revenue - costColumn + income);
    // So với trước 13/11: lợi nhuận chỉ giảm đúng phần ngoài đơn tính doanh thu
    const before = cashFlowNetProfit({
      orderProfit: revenue - activeCogs,
      adsSpend: ads,
      operatingExpense: opex,
      operatingIncome: income,
      additionalTaxOf: () => 0,
    });
    expect(before.provisionalProfit - np.provisionalProfit).toBe(323_000);
  });
});
