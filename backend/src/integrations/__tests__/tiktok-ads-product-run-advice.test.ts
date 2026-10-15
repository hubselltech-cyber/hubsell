import { describe, expect, it } from "vitest";
import {
  RUN_ADVICE_MIN_BUDGET,
  productRunAdvice,
  runBudget,
  type ProductRunAdviceInput,
} from "../tiktok-ads/product-run-advice";

// Sản phẩm mẫu: biên lãi 18,5% → hòa vốn 5,4 (đúng dòng anh Trung khoanh trên prod 19/09). 15/10/2026 làm lại ROI mục tiêu +
// ngân sách (docs/ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md): sàn giữ lãi 1/(0,185 − 0,05) = 7,41 → 7,5; mốc đang đạt = ROI gian 8 →
// khởi điểm max(7,5; 8 × 0,9 = 7,2) = 7,5; ngân sách 2 × GMV ngày ÷ ROI.
const base: ProductRunAdviceInput = {
  margin: 0.185,
  breakevenRoi: 1 / 0.185,
  units7d: 7,
  units30d: 30,
  revenue30d: 30 * 250_000, // 7,5 triệu / 30 ngày = 250.000đ/ngày
  stock: 500,
  shopAdsSpend30d: 5_000_000,
  shopAdsGmv30d: 40_000_000, // ROI gian 8
};

describe("productRunAdvice — Nên chạy / Chạy thử / Chưa nên cho sản phẩm chưa chạy quảng cáo", () => {
  it("đủ tồn, bán đều, ROI gian trên sàn giữ lãi → Nên chạy; khởi điểm = max(sàn giữ lãi, mốc × 0,9); có ngân sách", () => {
    const a = productRunAdvice(base);
    expect(a.tier).toBe("run");
    expect(a.label).toBe("Nên chạy");
    expect(a.floorRoi).toBe(7.5); // 1/(0,185 − 0,05) = 7,41 → làm tròn LÊN 7,5
    expect(a.minKeepPer100).toBe(5);
    expect(a.anchorRoi).toBe(8);
    expect(a.suggestedRoi).toBe(7.5); // 8 × 0,9 = 7,2 < sàn 7,5 → lấy sàn
    expect(a.points[1]).toContain("thấp hơn sàn giữ lãi nên khởi điểm lấy sàn 7,5");
    expect(a.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass"]);
    expect(a.conclusion).toContain("đạt cả ba điều kiện");
    expect(a.conclusion).toContain("ROI mục tiêu 7,5, không đặt dưới 7,5");
    expect(a.conclusion).toContain("Giữ mỗi mức ROI 3 ngày trọn");
    expect(a.conclusion).toContain("tối đa 1 lần/ngày");
    expect(a.conclusion).toContain("tăng ngân sách 30%");
    // Ngân sách = 2 × 250.000 ÷ 7,5 = 66.667 → dưới sàn 100.000 → 100.000.
    expect(a.budget).toMatchObject({ daily: 100_000, byTiktok: 2 * 250_000 / 7.5 });
    expect(a.budget?.note).toContain("Theo công thức TikTok");
    expect(a.budget?.note).toContain("Nâng lên 100.000đ/ngày");
    expect(a.conclusion).toContain("Ngân sách 100.000đ/ngày");
  });

  // Ca ANO 15/10 (ảnh anh Trung): biên 17,7%, hòa vốn 5,66, gian đạt 12,85 trên các sản phẩm đang quảng cáo biên 17,5%, doanh thu
  // ~2,34 triệu/ngày. Không truyền biên đang quảng cáo → dùng thẳng ROI gian (× 0,9 = 11,6).
  const ano: ProductRunAdviceInput = {
    ...base,
    margin: 0.177,
    breakevenRoi: 1 / 0.177,
    units7d: 58,
    units30d: 243,
    revenue30d: 70_250_000,
    stock: 5000,
    shopAdsSpend30d: 10_000_000,
    shopAdsGmv30d: 128_500_000,
  };
  it("ANO (chưa biết biên đang quảng cáo): mốc 12,85 → khởi điểm 11,6 (× 0,9), sàn 7,9; ngân sách 2 × 2,34tr ÷ 11,6 ≈ 400.000", () => {
    const a = productRunAdvice(ano);
    expect(a.tier).toBe("run");
    expect(a.floorRoi).toBe(7.9); // 1/(0,177 − 0,05) = 7,87 → 7,9
    expect(a.anchorMargin).toBeNull();
    expect(a.scaledAnchorRoi).toBe(12.85);
    expect(a.suggestedRoi).toBe(11.6); // 12,85 × 0,9 = 11,565 → 11,6
    expect(a.points[1]).toContain("chưa biết biên lãi các sản phẩm đang quảng cáo");
    expect(a.points[1]).toContain("khởi điểm 11,6");
    expect(a.points[1]).toContain("còn lãi khoảng 9,1đ"); // 17,7% − 1/11,6
    expect(a.checks.find((c) => c.key === "feasible")?.text).toContain("cao hơn sàn giữ lãi 7,9");
    expect(a.budget?.byTiktok).toBeCloseTo((2 * (70_250_000 / 30)) / 11.6, 0); // ≈ 403.736
    expect(a.budget?.daily).toBe(400_000);
  });

  // Anh Trung 15/10 đêm: "ROI mục tiêu của tất cả các chiến dịch đều giống nhau thì giá trị công cụ giảm đi rất nhiều" → quy mốc về biên
  // của từng sản phẩm: giữ cùng tỷ lệ tiền quảng cáo trên biên lãi (1/12,85 ÷ 17,5% ≈ 44%).
  it("quy mốc về biên từng sản phẩm: cùng gian, biên khác nhau → khởi điểm khác nhau (biên thấp → ROI cao hơn)", () => {
    const withMargin = { ...ano, anchorMargin: 0.175 };
    const p177 = productRunAdvice(withMargin); // 12,85 × 0,175 / 0,177 = 12,70 → × 0,9 = 11,43 → 11,5
    const p219 = productRunAdvice({ ...withMargin, margin: 0.219, breakevenRoi: 1 / 0.219 }); // 10,27 → 9,24 → 9,3
    const p142 = productRunAdvice({ ...withMargin, margin: 0.142, breakevenRoi: 1 / 0.142 }); // 15,84 → 14,25 → 14,3
    const p329 = productRunAdvice({ ...withMargin, margin: 0.329, breakevenRoi: 1 / 0.329 }); // 6,84 → 6,15 → 6,2 (sàn 3,6)
    const p079 = productRunAdvice({ ...withMargin, margin: 0.079, breakevenRoi: 1 / 0.079 }); // 28,47 → 25,6 < sàn 34,5 → sàn
    expect(p177.anchorMargin).toBe(0.175);
    expect(p177.scaledAnchorRoi).toBeCloseTo(12.7, 1);
    expect(p177.suggestedRoi).toBe(11.5);
    expect(p219.suggestedRoi).toBe(9.3);
    expect(p142.suggestedRoi).toBe(14.3);
    expect(p329.suggestedRoi).toBe(6.2);
    expect(p079.floorRoi).toBe(34.5); // 1/(0,079 − 0,05) = 34,48
    expect(p079.suggestedRoi).toBe(34.5);
    expect(p079.points[1]).toContain("thấp hơn sàn giữ lãi nên khởi điểm lấy sàn 34,5");
    expect(p219.points[1]).toContain("khoảng 44% biên lãi đi vào quảng cáo");
    expect(p219.points[1]).toContain("Giữ cùng tỷ lệ đó cho sản phẩm này (biên 21,9%) → ROI 10,3");
    // Cùng tỷ lệ ⇒ lãi giữ lại / 100đ tỷ lệ với biên: 21,9% giữ ~11,1đ, 14,2% giữ ~7,2đ.
    expect(p219.points[1]).toContain("còn lãi khoảng 11,1đ");
    expect(p142.points[1]).toContain("còn lãi khoảng 7,2đ");
    // Biên đang quảng cáo không hợp lệ (0 / âm) → không quy, như chưa biết.
    expect(productRunAdvice({ ...ano, anchorMargin: 0 }).anchorMargin).toBeNull();
    expect(productRunAdvice({ ...ano, anchorMargin: -0.1 }).suggestedRoi).toBe(11.6);
  });

  it("ROI gian thấp hơn hòa vốn của sản phẩm → Chưa nên, không có ngân sách", () => {
    const a = productRunAdvice({ ...base, margin: 0.103, breakevenRoi: 1 / 0.103 }); // hòa vốn 9,71 > ROI gian 8
    expect(a.tier).toBe("not_yet");
    expect(a.tone).toBe("warn");
    expect(a.checks.find((c) => c.key === "feasible")?.status).toBe("block");
    expect(a.checks.find((c) => c.key === "feasible")?.text).toContain("THẤP hơn hòa vốn 9,71");
    expect(a.conclusion).toContain("Chưa nên chạy vì không đạt");
    expect(a.budget).toBeNull();
  });

  it("ROI gian trên hòa vốn nhưng dưới sàn giữ lãi → Chạy thử; ngân sách chặn trần thử rồi lấy nửa", () => {
    const a = productRunAdvice({ ...base, shopAdsGmv30d: 30_000_000 }); // ROI gian 6: trên 5,4, dưới sàn 7,5
    expect(a.tier).toBe("test");
    expect(a.suggestedRoi).toBe(7.5); // 6 × 0,9 = 5,4 < sàn → sàn
    expect(a.checks.find((c) => c.key === "feasible")?.text).toContain("chưa tới sàn giữ lãi 7,5");
    expect(a.conclusion).toContain("Chỉ nên chạy thử ngân sách nhỏ");
    expect(a.conclusion).toContain("tăng ngân sách 30% mỗi lần");
    expect(a.budget?.note).toContain("Chạy thử: lấy một nửa.");
  });

  it("biên lãi không đủ giữ mức lãi mong muốn → sàn rơi về hòa vốn, Chạy thử và nói rõ", () => {
    const a = productRunAdvice({ ...base, margin: 0.04, breakevenRoi: 25, shopAdsSpend30d: 1_000_000, shopAdsGmv30d: 30_000_000 }); // ROI gian 30 > hòa vốn 25
    expect(a.tier).toBe("test");
    expect(a.floorRoi).toBe(25);
    expect(a.suggestedRoi).toBe(27); // 30 × 0,9
    expect(a.points[0]).toContain("không đủ để giữ 5đ/100đ");
    expect(a.checks.find((c) => c.key === "feasible")?.status).toBe("caution");
    expect(a.checks.find((c) => c.key === "feasible")?.text).toContain("không đủ giữ 5đ/100đ");
  });

  it("khách chỉnh lãi mong muốn (cấu hình Trợ lý) → sàn và khởi điểm đổi theo", () => {
    const a = productRunAdvice({ ...base, minKeepPer100: 2 });
    expect(a.minKeepPer100).toBe(2);
    expect(a.floorRoi).toBe(6.1); // 1/(0,185 − 0,02) = 6,06 → 6,1
    expect(a.suggestedRoi).toBe(7.2); // 8 × 0,9 — giờ cao hơn sàn
    expect(a.points[1]).toContain("TikTok khuyên theo ROI đang đạt hoặc thấp hơn một chút");
  });

  it("gian chưa tiêu đủ tiền quảng cáo → không xét khả thi, khởi điểm = sàn giữ lãi, nhắc dùng ROI gợi ý trong Seller Center", () => {
    const a = productRunAdvice({ ...base, shopAdsSpend30d: 50_000, shopAdsGmv30d: 100_000 });
    expect(a.tier).toBe("run");
    expect(a.anchorRoi).toBeNull();
    expect(a.suggestedRoi).toBe(7.5);
    expect(a.points[1]).toContain("khởi điểm lấy sàn giữ lãi 7,5");
    expect(a.points[1]).toContain("ROI gợi ý hiện trong Seller Center");
    expect(a.checks.find((c) => c.key === "feasible")?.status).toBe("unknown");
    expect(a.conclusion).toContain("chưa xét được");
  });

  it("tồn không đủ 14 ngày khi quảng cáo đẩy lượng gấp rưỡi → Chưa nên; hết hàng → Chưa nên", () => {
    expect(productRunAdvice({ ...base, stock: 20 }).tier).toBe("not_yet"); // 20 ÷ 1,5/ngày = 13 ngày
    expect(productRunAdvice({ ...base, stock: 21 }).tier).toBe("run"); // 14 ngày
    expect(productRunAdvice({ ...base, stock: 0 }).checks.find((c) => c.key === "stock")?.text).toContain("đang là 0");
  });

  it("đà bán chậm lại (≤ 0,8) hoặc 30 ngày không có đơn → Chạy thử; chưa đọc được tồn thì không chặn", () => {
    expect(productRunAdvice({ ...base, units7d: 5 }).tier).toBe("test"); // 5/7 ÷ 1 = 0,71
    const none = productRunAdvice({ ...base, units7d: 0, units30d: 0, revenue30d: 0 });
    expect(none.tier).toBe("test");
    expect(none.budget?.daily).toBe(RUN_ADVICE_MIN_BUDGET);
    expect(none.budget?.byTiktok).toBeNull();
    const a = productRunAdvice({ ...base, stock: null });
    expect(a.tier).toBe("run");
    expect(a.checks.find((c) => c.key === "stock")?.status).toBe("unknown");
  });
});

describe("runBudget — ngân sách ngày: công thức TikTok, chặn trần, sàn tối thiểu", () => {
  it("theo TikTok 2 × GMV ngày ÷ ROI, làm tròn 10.000; trần tồn kéo xuống khi tồn mỏng", () => {
    const i = { ...base, revenue30d: 90_000_000, units30d: 300, stock: 5000 }; // 3 triệu/ngày, giá TB 300.000
    const b = runBudget(i, "run", 10);
    expect(b.byTiktok).toBe(600_000);
    expect(b.daily).toBe(600_000);
    expect(b.note).toContain("2 × GMV ngày 3.000.000đ ÷ ROI 10 = 600.000đ/ngày");
    // Tồn 100 × 300.000 ÷ 10 ÷ 14 = 214.286 → trần tồn kéo xuống → 210.000.
    const thin = runBudget({ ...i, stock: 100 }, "run", 10);
    expect(thin.daily).toBe(210_000);
    expect(thin.note).toContain("không bán cạn 100 tồn trước 14 ngày");
  });

  it("Chạy thử: trần thử 10% lãi tháng ÷ 7 chỉ áp cho Chạy thử, rồi lấy một nửa, không dưới 100.000", () => {
    const i = { ...base, revenue30d: 90_000_000, units30d: 300, stock: 5000 }; // lãi tháng 16,65 triệu → trần 237.857
    const run = runBudget(i, "run", 10);
    expect(run.daily).toBe(600_000); // Nên chạy không bị trần thử
    const test = runBudget(i, "test", 10);
    expect(test.daily).toBe(120_000); // min(600k, 237.857) = 237.857 → nửa 118.929 → 120.000
    expect(test.note).toContain("tiền thử 7 ngày không quá 10% lãi tháng");
    expect(test.note).toContain("Chạy thử: lấy một nửa.");
    expect(runBudget({ ...i, revenue30d: 3_000_000, units30d: 10 }, "test", 10).daily).toBe(RUN_ADVICE_MIN_BUDGET);
  });
});
