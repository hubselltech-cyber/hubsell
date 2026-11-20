import { describe, expect, it } from "vitest";
import { buildDamagedLoss, emptyDamagedLoss } from "../damaged-loss";
import { cashFlowNetProfit } from "../net-profit";

describe("buildDamagedLoss — thất thu theo ngày báo hỏng, tách phần đã nằm trong giá vốn theo ngày tạo đơn", () => {
  const d = buildDamagedLoss({
    // Kho báo hỏng trong kỳ (trục ngày báo hỏng)
    damagedDays: [
      { day: "2026-11-12", count: 3, amount: 263_000 },
      { day: "2026-11-20", count: 4, amount: 690_000 },
    ],
    // Đơn tính doanh thu TẠO trong kỳ đã bị báo hỏng (đã chốt không được đền)
    inActive: [
      { channelName: "SHOPEE", day: "2026-11-08", amount: 400_000 },
      { channelName: "SHOPEE", day: "2026-11-12", amount: 230_000 },
    ],
    byDaySince: "2026-11-10",
  });

  it("dòng Thất thu = đơn báo hỏng trong kỳ; phần trừ thêm = tổng − phần đã nằm trong giá vốn", () => {
    expect(d.total).toBe(953_000);
    expect(d.orderCount).toBe(7);
    expect(d.inActive).toBe(630_000);
    expect(d.outside).toBe(323_000);
    expect(d.total).toBe(d.inActive + d.outside);
  });

  it("phần trong giá vốn bóc theo sàn; chuỗi ngày: + ở ngày báo hỏng, − ở ngày tạo đơn, chỉ từ mốc", () => {
    expect([...d.inActiveByChannelName]).toEqual([["SHOPEE", 630_000]]);
    expect(Object.fromEntries(d.outsideByDay)).toEqual({
      "2026-11-12": 263_000 - 230_000,
      "2026-11-20": 690_000,
    });
  });

  it("không truyền mốc chuỗi ngày → không dựng chuỗi; không có đơn báo hỏng → mọi số 0", () => {
    expect(
      buildDamagedLoss({
        damagedDays: [{ day: "2026-11-20", count: 1, amount: 100_000 }],
        inActive: [],
      }).outsideByDay.size
    ).toBe(0);
    expect(buildDamagedLoss({ damagedDays: [], inActive: [] })).toEqual(emptyDamagedLoss());
  });

  it("ngày vừa cộng vừa trừ bằng nhau thì không để lại điểm 0 trong chuỗi", () => {
    const same = buildDamagedLoss({
      damagedDays: [{ day: "2026-11-12", count: 1, amount: 80_000 }],
      inActive: [{ channelName: "TIKTOK", day: "2026-11-12", amount: 80_000 }],
      byDaySince: "2026-11-01",
    });
    expect(same.outside).toBe(0);
    expect(same.outsideByDay.size).toBe(0);
  });
});

describe("đẳng thức Dòng tiền với dòng Thất thu: Doanh thu − Chi phí + Thu khác = LN trước thuế", () => {
  const revenue = 10_000_000; // Σ platformRevenue đơn tính doanh thu tạo trong kỳ
  const ads = 500_000;
  const opex = 400_000;
  const income = 100_000;
  const netOf = (activeCogs: number, outside?: number) =>
    cashFlowNetProfit({
      orderProfit: revenue - activeCogs,
      adsSpend: ads,
      operatingExpense: opex,
      operatingIncome: income,
      damagedLossOutside: outside,
      additionalTaxOf: () => 0,
    });

  it("báo hỏng trong kỳ: phần đã nằm trong giá vốn không trừ lại, phần ngoài trừ đúng một lần", () => {
    const activeCogs = 6_000_000; // đã gồm 630k hàng hỏng của đơn tính doanh thu
    const damaged = buildDamagedLoss({
      damagedDays: [{ day: "2026-11-12", count: 7, amount: 953_000 }],
      inActive: [{ channelName: "SHOPEE", day: "2026-11-05", amount: 630_000 }],
    });
    // Cột Chi phí: Giá vốn (đã tách) + Thất thu + quảng cáo + vận hành
    const costColumn = activeCogs - damaged.inActive + damaged.total + ads + opex;
    const np = netOf(activeCogs, damaged.outside);
    expect(np.provisionalProfit).toBe(revenue - costColumn + income);
    expect(netOf(activeCogs).provisionalProfit - np.provisionalProfit).toBe(323_000);
  });

  it("đơn tạo tháng 10, báo hỏng tháng 11: giá vốn hàng hỏng chỉ bị trừ một lần, ở tháng 11", () => {
    const cost = 130_000;
    // Tháng 10 (kỳ tạo đơn): đơn tính doanh thu, giá vốn đang nằm trong dòng Giá vốn
    const octCogs = 6_000_000;
    const oct = buildDamagedLoss({
      damagedDays: [],
      inActive: [{ channelName: "SHOPEE", day: "2026-10-21", amount: cost }],
    });
    expect(oct.total).toBe(0);
    expect(oct.outside).toBe(-cost);
    const octNp = netOf(octCogs, oct.outside);
    // Dòng Giá vốn tháng 10 bớt đúng giá vốn hàng hỏng → lợi nhuận tháng 10 tăng lại
    expect(octNp.provisionalProfit).toBe(revenue - (octCogs - cost + ads + opex) + income);
    // Tháng 11 (kỳ báo hỏng): đơn không thuộc kỳ, dòng Thất thu gánh trọn
    const novCogs = 5_000_000;
    const nov = buildDamagedLoss({
      damagedDays: [{ day: "2026-11-20", count: 1, amount: cost }],
      inActive: [],
    });
    const novNp = netOf(novCogs, nov.outside);
    expect(novNp.provisionalProfit).toBe(revenue - (novCogs + cost + ads + opex) + income);
    // Cộng hai tháng: giá vốn hàng hỏng bị trừ đúng một lần
    const noDamage = netOf(octCogs - cost).provisionalProfit + netOf(novCogs).provisionalProfit;
    expect(octNp.provisionalProfit + novNp.provisionalProfit).toBe(noDamage - cost);
  });
});
