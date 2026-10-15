import { describe, expect, it } from "vitest";
import {
  TARGET_STEP_WAIT_HOURS,
  avgDailySpendOf,
  campaignAdvice,
  nextRoiTargetStep,
  targetWatchHoursLeft,
  noOrdersWindowOk,
  type CampaignAdviceInput,
} from "../tiktok-ads/campaign-advice";
import type { TiktokBreakeven } from "../../lib/tiktok-breakeven";

// CHẨN ĐOÁN CHIẾN DỊCH GMV MAX — mọi kết luận ghép từ số đã có; hai mốc 80% ngân sách / 90% mục tiêu là số của TikTok.
// 08/10/2026: sàn hạ mục tiêu = sàn giữ lãi mong muốn (mặc định 5đ/100đ): biên 20% → 1/(0,2 − 0,05) = 6,67 → 6,7.
const be = (over: Partial<TiktokBreakeven> = {}): TiktokBreakeven => ({
  breakevenRoi: 5,
  margin: 0.2,
  negativeMargin: false,
  source: "campaign",
  orders: 120,
  cancelledOrders: 0,
  pendingOrders: 0,
  costCoveragePct: 100,
  check: null,
  ...over,
});
const input = (over: Partial<CampaignAdviceInput> = {}): CampaignAdviceInput => ({
  status: "ongoing",
  roasTarget: 15,
  budget: 1_500_000,
  breakeven: be(),
  spend: 6_000_000,
  gmv: 69_000_000, // ROI thực 11,5
  avgDailySpend: 210_000, // 14% ngân sách
  ...over,
});

describe("campaignAdvice", () => {
  it("TC054 thật: lãi, chưa đạt mục tiêu 15, mới tiêu 14% ngân sách → mục tiêu đang ghìm, hạ một nấc, không dưới sàn giữ lãi", () => {
    const a = campaignAdvice(input());
    expect(a.kind).toBe("target_binding");
    expect(a.budgetUsedPct).toBe(14);
    expect(a.keepPer100).toBe(11.3); // 20% − 1/11,5
    expect(a.safeTarget).toBe(6.7);
    expect(a.minKeepPer100).toBe(5);
    expect(a.nextTarget).toBe(13.5);
    expect(a.keepAtNextTarget).toBe(12.6); // 20% − 1/13,5
    expect(a.conclusion).toBe(
      `Giảm ROI mục tiêu một nấc, từ 15 xuống 13,5, rồi theo dõi ${TARGET_STEP_WAIT_HOURS} giờ mới giảm tiếp. Ở 13,5 mỗi 100đ doanh thu còn lãi khoảng 12,6đ. Không xuống dưới 6,7 (giữ lãi từ 5đ/100đ). Chỉ giảm một lần trong ngày — giảm lần hai là mất bảo vệ ROI của TikTok hôm đó.`
    );
    expect(a.editInSellerCenter).toBe(true);
  });

  // Ca ANO 08/10/2026 (ảnh anh Trung): ROI thực 13,84 / mục tiêu 15 / hòa vốn 5,58 / tiêu 12% — bản cũ nói "chưa thấy gì cần sửa"
  // vì 13,84 ≥ 90% × 15. Mục tiêu đã đạt hay gần đạt mà ngân sách còn dư thì mục tiêu vẫn là thứ ghìm → phải khuyên hạ.
  it("ANO 08/10: ROI gần đạt mục tiêu + tiêu 12% ngân sách → vẫn là mục tiêu đang ghìm; sàn 7,8 (biên 17,9% giữ 5đ)", () => {
    const a = campaignAdvice(
      input({ breakeven: be({ breakevenRoi: 5.58, margin: 0.1793 }), spend: 1_000_000, gmv: 13_840_000, avgDailySpend: 180_000 })
    );
    expect(a.kind).toBe("target_binding");
    expect(a.label).toBe("Mục tiêu đang ghìm phân phối");
    expect(a.points).toContain("ROI mục tiêu đang đặt 15 — gần đạt (từ 90%).");
    expect(a.safeTarget).toBe(7.8); // 1/(0,1793 − 0,05) = 7,73 → 7,8
    expect(a.nextTarget).toBe(13.5);
    // Đã đạt hẳn (ROI 15,5 ≥ 15 nhưng < 16,5) → vẫn ghìm, chữ "đã đạt".
    const b = campaignAdvice(input({ breakeven: be({ breakevenRoi: 5.58, margin: 0.1793 }), spend: 1_000_000, gmv: 15_500_000, avgDailySpend: 180_000 }));
    expect(b.kind).toBe("target_binding");
    expect(b.points).toContain("ROI mục tiêu đang đặt 15 — đã đạt.");
  });

  it("ROI vượt mục tiêu quá 10% mà vẫn tiêu ít → mục tiêu không phải thứ chặn: không khuyên hạ, khuyên thêm video / sản phẩm", () => {
    const a = campaignAdvice(input({ spend: 1_000_000, gmv: 16_500_000 })); // ROI 16,5 = 15 × 1,1
    expect(a.kind).toBe("healthy");
    expect(a.nextTarget).toBeNull();
    expect(a.points.at(-1)).toContain("mục tiêu không phải thứ đang chặn");
    expect(a.conclusion).toContain("thêm video / sản phẩm");
    expect(a.editInSellerCenter).toBe(true);
  });

  describe("hạ ROI mục tiêu từng nấc 10% + khóa 72 giờ (TikTok: giữ mỗi mức ROI ít nhất 3 ngày trọn)", () => {
    it("nấc 10% thủng sàn thì dừng ở sàn; đã sát sàn thì không còn nấc", () => {
      expect(nextRoiTargetStep(15, 6.7)).toBe(13.5);
      expect(nextRoiTargetStep(7, 6.7)).toBe(6.7); // 6,3 < sàn → dừng ở sàn
      expect(nextRoiTargetStep(6.7, 6.7)).toBeNull();
      expect(nextRoiTargetStep(5.58, 5.58)).toBeNull();
    });

    it("mục tiêu đã sát sàn giữ lãi → 'Đang lãi', nói rõ không còn nấc và sàn là bao nhiêu", () => {
      const a = campaignAdvice(input({ roasTarget: 6.7, gmv: 39_000_000 })); // ROI 6,5 < 6,7 × 1,1
      expect(a.kind).toBe("healthy");
      expect(a.nextTarget).toBeNull();
      expect(a.conclusion).toContain("đã sát mức an toàn 6,7 (giữ lãi từ 5đ/100đ)");
    });

    it("lãi mong muốn do gian cấu hình: 0đ → sàn = hòa vốn; 12đ → sàn cao hơn (1/(0,2−0,12) = 12,5)", () => {
      const zero = campaignAdvice(input({ minKeepPer100: 0 }));
      expect(zero.safeTarget).toBe(5);
      expect(zero.conclusion).toContain("Không xuống dưới 5 (giữ lãi từ 0đ/100đ)");
      const high = campaignAdvice(input({ minKeepPer100: 12 }));
      expect(high.safeTarget).toBe(12.5);
      expect(high.nextTarget).toBe(13.5);
      // Mục tiêu 13 với sàn 12,5: nấc 11,7 thủng sàn → hạ về đúng 12,5.
      expect(campaignAdvice(input({ minKeepPer100: 12, roasTarget: 13 })).nextTarget).toBe(12.5);
    });

    it("biên không đủ cho lãi mong muốn → không có sàn hợp lệ, giữ mục tiêu và chỉ cách sửa", () => {
      const a = campaignAdvice(input({ breakeven: be({ breakevenRoi: 25, margin: 0.04 }), roasTarget: 30, gmv: 170_000_000 })); // ROI 28,3
      expect(a.kind).toBe("healthy");
      expect(a.safeTarget).toBeNull();
      expect(a.conclusion).toContain("Biên lãi 4% không đủ cho mức lãi mong muốn 5đ/100đ");
    });

    it("mục tiêu vừa đổi < 72 giờ → 'Theo dõi sau đổi mục tiêu', không gợi ý hạ, nói còn bao nhiêu giờ", () => {
      const now = new Date("2026-10-08T10:00:00Z");
      const a = campaignAdvice(input({ roasTargetChangedAt: new Date("2026-10-07T12:00:00Z"), now })); // đổi cách 22 giờ
      expect(a.kind).toBe("target_watching");
      expect(a.tone).toBe("ok");
      expect(a.watchHoursLeft).toBe(50);
      expect(a.nextTarget).toBeNull();
      expect(a.editInSellerCenter).toBe(false);
      expect(a.conclusion).toContain("chưa đủ 72 giờ");
      expect(a.conclusion).toContain("còn khoảng 50 giờ nữa mới xét hạ nấc tiếp");
      // Đủ 72 giờ → trở lại đề xuất nấc kế.
      expect(campaignAdvice(input({ roasTargetChangedAt: new Date("2026-10-05T09:00:00Z"), now })).kind).toBe("target_binding");
      expect(targetWatchHoursLeft(null, now)).toBe(0);
      expect(targetWatchHoursLeft(new Date("2026-10-08T09:30:00Z"), now)).toBe(72); // vừa đổi 30 phút → làm tròn lên 72
    });

    it("sau nấc hạ gần nhất lãi tuyệt đối không tăng → 'Giữ mục tiêu', không hạ tiếp; có tăng → hạ nấc kế", () => {
      const flat = { changedOn: "2026-10-04", before: 1_200_000, after: 1_150_000, days: 2, flat: true };
      const a = campaignAdvice(input({ stepCheck: flat }));
      expect(a.kind).toBe("target_hold");
      expect(a.tone).toBe("ok");
      expect(a.nextTarget).toBeNull();
      expect(a.points).toContain("Sau nấc hạ gần nhất (2026-10-04): lãi 2 ngày sau 1.150.000đ, 2 ngày trước 1.200.000đ.");
      expect(a.conclusion).toContain("Giữ ROI mục tiêu hiện tại");
      const up = campaignAdvice(input({ stepCheck: { ...flat, after: 1_400_000, flat: false } }));
      expect(up.kind).toBe("target_binding");
      expect(up.nextTarget).toBe(13.5);
    });

    it("khóa 72 giờ KHÔNG che cảnh báo lỗ / mục tiêu dưới hòa vốn / ngân sách chặn (xét trước nấc hạ)", () => {
      const now = new Date("2026-10-08T10:00:00Z");
      const changed = new Date("2026-10-08T08:00:00Z");
      expect(campaignAdvice(input({ gmv: 24_000_000, roasTarget: 4, roasTargetChangedAt: changed, now })).kind).toBe("losing");
      expect(campaignAdvice(input({ roasTarget: 4, roasTargetChangedAt: changed, now })).kind).toBe("target_below");
      expect(campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_200_000, roasTargetChangedAt: changed, now })).kind).toBe("budget_capped");
    });
  });

  it("ROI thực dưới hòa vốn → đang lỗ; mục tiêu cũng dưới hòa vốn thì nói luôn mức phải nâng", () => {
    const a = campaignAdvice(input({ gmv: 24_000_000, roasTarget: 4 })); // ROI 4
    expect(a.kind).toBe("losing");
    expect(a.tone).toBe("warn");
    expect(a.keepPer100).toBe(-5);
    expect(a.conclusion).toContain("Nâng ROI mục tiêu lên ít nhất 5");
    expect(a.points).toContain("ROI mục tiêu đang đặt 4 — thấp hơn hòa vốn.");
  });

  it("ô lý do đọc được: DỮ KIỆN mỗi ý một dòng, KẾT LUẬN để riêng (anh Trung 19/09)", () => {
    const a = campaignAdvice(input());
    expect(a.points).toEqual([
      "ROI thực 11,5 · hòa vốn 5.",
      "Mỗi 100đ doanh thu còn lãi khoảng 11,3đ sau quảng cáo.",
      "ROI mục tiêu đang đặt 15 — chưa đạt.",
      "Mỗi ngày tiêu khoảng 14% ngân sách (1.500.000đ).",
      "Đang lãi nhưng tiêu ít: ROI bám sát mục tiêu nên mục tiêu đang ghìm TikTok phân phối dè dặt.",
    ]);
    expect(a.conclusion).toContain("Không xuống dưới 6,7");
    expect(a.text).toBe([...a.points, a.conclusion].join(" "));
  });

  it("đang lãi nhưng mục tiêu đặt dưới hòa vốn → cảnh báo trước khi TikTok kéo ROI xuống", () => {
    expect(campaignAdvice(input({ roasTarget: 4 })).kind).toBe("target_below");
  });

  it("đạt từ 90% mục tiêu VÀ tiêu từ 80% ngân sách → ngân sách đang chặn (hai mốc của TikTok)", () => {
    const capped = campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_200_000 }));
    expect(capped.kind).toBe("budget_capped"); // 11,5 ≥ 10,8 · 80%
    // 15/10/2026: nấc tăng ngân sách 30% (TikTok Max delivery "tăng dần 30% mỗi ngày"), làm tròn 10.000, giữ 3 ngày trọn.
    expect(capped.nextBudget).toBe(1_950_000); // 1.500.000 × 1,3
    expect(capped.conclusion).toContain("từ 1.500.000đ lên 1.950.000đ, rồi giữ 3 ngày trọn");
    expect(campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_200_000, budget: 0 })).budgetUsedPct).toBeNull();
    expect(campaignAdvice(input({ roasTarget: 12, avgDailySpend: 1_190_000 })).kind).toBe("target_binding"); // 79% → ngân sách còn dư, mục tiêu ghìm
    expect(campaignAdvice(input({ roasTarget: 13, avgDailySpend: 1_200_000 })).kind).toBe("healthy"); // 11,5 < 11,7 chưa đạt, ngân sách đã 80% → không phán
  });

  it("phân phối tối đa (không có ROI mục tiêu) + tiêu gần hết ngân sách → vẫn là ngân sách đang chặn", () => {
    expect(campaignAdvice(input({ roasTarget: null, avgDailySpend: 1_400_000 })).kind).toBe("budget_capped");
  });

  it("chưa có hòa vốn tin được (mượn biên lãi toàn gian / thiếu giá vốn) → KHÔNG kết luận lãi lỗ, chỉ nói việc cần làm", () => {
    const a = campaignAdvice(input({ breakeven: be({ source: "shop" }) }));
    expect(a.kind).toBe("no_breakeven");
    expect(a.keepPer100).toBeNull();
    expect(a.safeTarget).toBeNull();
    expect(a.text).toContain("mượn biên lãi toàn gian");
    expect(campaignAdvice(input({ breakeven: be({ costCoveragePct: 40 }) })).kind).toBe("no_breakeven");
    expect(campaignAdvice(input({ breakeven: null })).kind).toBe("no_breakeven");
  });

  it("tab Hòa vốn sản phẩm: hòa vốn nguồn 'product' + breakevenProblem do dòng sản phẩm quyết → cùng kết luận với trang chiến dịch", () => {
    // Rỗng = dòng sản phẩm đã tin được (đủ đơn, đủ giá vốn) → không bị luật 'phải là nguồn campaign' chặn.
    expect(campaignAdvice(input({ breakeven: be({ source: "product" }), breakevenProblem: "" })).kind).toBe("target_binding");
    // Dòng sản phẩm chưa tin được → đem đúng lý do của dòng đó ra, không kết luận lãi lỗ.
    const a = campaignAdvice(input({ breakeven: be({ source: "product" }), breakevenProblem: "Mới 3 đơn đã đối soát" }));
    expect(a.kind).toBe("no_breakeven");
    expect(a.text).toContain("Mới 3 đơn đã đối soát");
  });

  it("chiến dịch tắt / chưa tiêu tiền → không chẩn đoán; không có ngày trọn nào thì không có % ngân sách", () => {
    expect(campaignAdvice(input({ status: "paused" })).kind).toBe("paused");
    expect(campaignAdvice(input({ spend: 0, gmv: 0 })).kind).toBe("no_spend");
    const a = campaignAdvice(input({ avgDailySpend: null, roasTarget: 11 }));
    expect(a.budgetUsedPct).toBeNull();
    expect(a.kind).toBe("healthy");
  });
});

describe("avgDailySpendOf", () => {
  it("chỉ lấy ngày TRỌN có tiêu tiền — bỏ hôm nay (chưa hết ngày) và ngày không tiêu", () => {
    const days = [
      { date: "2026-09-16", expense: 200_000 },
      { date: "2026-09-17", expense: 0 },
      { date: "2026-09-18", expense: 300_000 },
      { date: "2026-09-19", expense: 50_000 }, // hôm nay
    ];
    expect(avgDailySpendOf(days, "2026-09-19")).toBe(250_000);
    expect(avgDailySpendOf([{ date: "2026-09-19", expense: 50_000 }], "2026-09-19")).toBeNull();
  });
});

// KHÔNG RA ĐƠN (anh Trung 15/10/2026 đêm: "sau bao lâu thì nhận định hạ ROI khi không ra đơn") — mốc 3 ngày trọn của TikTok, 20% ngân sách tự chọn.
describe("campaignAdvice — không ra đơn: khởi động / không phân phối / tiêu tiền không ra đơn", () => {
  const zero = (over: Partial<CampaignAdviceInput> = {}) => input({ gmv: 0, orders: 0, ...over });

  it("chưa đủ 3 ngày trọn → Đang khởi động, không nhận định", () => {
    const a = campaignAdvice(zero({ fullDaysRunning: 2, spend: 50_000, avgDailySpend: 25_000 }));
    expect(a.kind).toBe("learning");
    expect(a.tone).toBe("muted");
    expect(a.conclusion).toContain("chưa đủ 3 ngày trọn");
    expect(campaignAdvice(zero({ fullDaysRunning: 0, spend: 0, avgDailySpend: null })).kind).toBe("learning");
  });

  it("đủ 3 ngày, tiêu < 20% ngân sách, 0 đơn → TikTok không phân phối: hạ một nấc 10%, không dưới sàn giữ lãi 6,7", () => {
    const a = campaignAdvice(zero({ fullDaysRunning: 3, spend: 60_000, avgDailySpend: 20_000 })); // 1,3% ngân sách 1,5tr
    expect(a.kind).toBe("no_delivery");
    expect(a.label).toBe("TikTok không phân phối");
    expect(a.tone).toBe("info");
    expect(a.nextTarget).toBe(13.5);
    expect(a.safeTarget).toBe(6.7);
    expect(a.editInSellerCenter).toBe(true);
    expect(a.conclusion).toContain("Hạ một nấc xuống 13,5 (không dưới 6,7), giữ 3 ngày trọn rồi xét tiếp");
    expect(a.conclusion).toContain("Phân phối tối đa 3–5 ngày");
    // Tiêu lặt vặt (dưới mức ngân sách tối thiểu) cũng là không phân phối dù % ngân sách không tính được.
    expect(campaignAdvice(zero({ fullDaysRunning: 5, spend: 40_000, avgDailySpend: null, budget: 0 })).kind).toBe("no_delivery");
    // Không có hòa vốn tin được → vẫn hạ 10% nhưng nói rõ không có sàn chặn.
    const nb = campaignAdvice(zero({ fullDaysRunning: 3, spend: 60_000, avgDailySpend: 20_000, breakeven: null }));
    expect(nb.kind).toBe("no_delivery");
    expect(nb.nextTarget).toBe(13.5);
    expect(nb.conclusion).toContain("chưa có hòa vốn để chặn sàn");
  });

  it("không phân phối mà mục tiêu đã sát sàn / chạy Phân phối tối đa → không hạ nữa, thêm video", () => {
    const floor = campaignAdvice(zero({ fullDaysRunning: 4, spend: 30_000, avgDailySpend: 10_000, roasTarget: 6.7 }));
    expect(floor.kind).toBe("no_delivery");
    expect(floor.nextTarget).toBeNull();
    expect(floor.conclusion).toContain("đã sát sàn giữ lãi 6,7, không hạ nữa");
    const md = campaignAdvice(zero({ fullDaysRunning: 4, spend: 30_000, avgDailySpend: 10_000, roasTarget: null }));
    expect(md.kind).toBe("no_delivery");
    expect(md.conclusion).toContain("Phân phối tối đa mà vẫn không tiêu");
  });

  it("vừa hạ mục tiêu chưa đủ 72 giờ mà chưa có đơn → theo dõi, không hạ tiếp", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const a = campaignAdvice(zero({ fullDaysRunning: 5, spend: 30_000, avgDailySpend: 10_000, roasTargetChangedAt: new Date("2026-10-14T12:00:00Z"), now }));
    expect(a.kind).toBe("target_watching");
    expect(a.watchHoursLeft).toBe(48);
    expect(a.conclusion).toContain("chưa có đơn trong lúc TikTok học lại là bình thường");
  });

  it("đủ 3 ngày, tiêu tiền thật (≥ 20% ngân sách, ≥ 100.000đ) mà 0 đơn → Tiêu tiền không ra đơn: tạm dừng, đừng hạ ROI", () => {
    const a = campaignAdvice(zero({ fullDaysRunning: 3, spend: 900_000, avgDailySpend: 300_000 })); // 20% ngân sách 1,5tr
    expect(a.kind).toBe("no_orders");
    expect(a.tone).toBe("warn");
    expect(a.nextTarget).toBeNull();
    expect(a.editInSellerCenter).toBe(true);
    expect(a.conclusion).toContain("Đã tiêu 900.000đ mà chưa có đơn nào — đừng hạ ROI mục tiêu");
    expect(a.conclusion).toContain("Tạm dừng chiến dịch trong Seller Center");
  });

  it("có đơn hoặc không biết ngày bật → luật cũ nguyên vẹn", () => {
    expect(campaignAdvice(input({ orders: 10, fullDaysRunning: 1 })).kind).toBe("target_binding");
    expect(campaignAdvice(zero({ spend: 0, avgDailySpend: null })).kind).toBe("no_spend"); // fullDaysRunning bỏ trống
    expect(campaignAdvice(zero({ spend: 0, avgDailySpend: null, fullDaysRunning: null })).kind).toBe("no_spend");
  });
});

describe("noOrdersWindowOk — khoảng xem phải đủ 3 ngày trọn (bỏ hôm nay) mới xét ca không ra đơn", () => {
  it("7 ngày qua / 3 ngày trọn → được; chỉ hôm nay / 2 ngày / khoảng tương lai → không", () => {
    expect(noOrdersWindowOk("2026-10-09", "2026-10-15", "2026-10-15")).toBe(true); // 09→14 = 6 ngày trọn
    expect(noOrdersWindowOk("2026-10-12", "2026-10-14", "2026-10-15")).toBe(true); // đúng 3
    expect(noOrdersWindowOk("2026-10-13", "2026-10-15", "2026-10-15")).toBe(false); // 13→14 = 2
    expect(noOrdersWindowOk("2026-10-15", "2026-10-15", "2026-10-15")).toBe(false); // chỉ hôm nay
    expect(noOrdersWindowOk("2026-10-16", "2026-10-20", "2026-10-15")).toBe(false);
  });
});
