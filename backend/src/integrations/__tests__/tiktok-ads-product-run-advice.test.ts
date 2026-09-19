import { describe, expect, it } from "vitest";
import { productRunAdvice, type ProductRunAdviceInput } from "../tiktok-ads/product-run-advice";

// Sản phẩm mẫu: biên lãi 18,5% → hòa vốn 5,4 (đúng dòng anh Trung khoanh trên prod 19/09).
const base: ProductRunAdviceInput = {
  margin: 0.185,
  breakevenRoi: 1 / 0.185,
  units7d: 7,
  units30d: 30,
  stock: 500,
  shopAdsSpend30d: 5_000_000,
  shopAdsGmv30d: 40_000_000, // ROI gian 8
};

describe("productRunAdvice — Nên chạy / Chạy thử / Chưa nên cho sản phẩm chưa chạy quảng cáo", () => {
  it("đủ tồn, bán đều, ROI gian trên mức an toàn → Nên chạy, đề xuất hòa vốn × 1,1 làm tròn LÊN 0,1", () => {
    const a = productRunAdvice(base);
    expect(a.tier).toBe("run");
    expect(a.label).toBe("Nên chạy");
    expect(a.suggestedRoi).toBe(6); // 5,405 × 1,1 = 5,95 → 6,0
    expect(a.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass"]);
    expect(a.conclusion).toContain("đạt cả ba điều kiện");
    expect(a.conclusion).toContain("6");
  });

  it("ROI gian thấp hơn hòa vốn của sản phẩm → Chưa nên", () => {
    const a = productRunAdvice({ ...base, margin: 0.103, breakevenRoi: 1 / 0.103 }); // hòa vốn 9,71 > ROI gian 8
    expect(a.tier).toBe("not_yet");
    expect(a.tone).toBe("warn");
    expect(a.checks.find((c) => c.key === "feasible")?.status).toBe("block");
    expect(a.checks.find((c) => c.key === "feasible")?.text).toContain("THẤP hơn hòa vốn 9,71");
    expect(a.conclusion).toContain("Chưa nên chạy vì không đạt");
  });

  it("ROI gian trên hòa vốn nhưng dưới mức an toàn → Chạy thử", () => {
    const a = productRunAdvice({ ...base, shopAdsGmv30d: 28_000_000 }); // ROI gian 5,6: trên 5,4, dưới 6,0
    expect(a.tier).toBe("test");
  });

  it("gian chưa tiêu đủ tiền quảng cáo → không xét khả thi, ghi rõ chưa có số", () => {
    const a = productRunAdvice({ ...base, shopAdsSpend30d: 50_000, shopAdsGmv30d: 100_000 });
    expect(a.tier).toBe("run");
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
    expect(productRunAdvice({ ...base, units7d: 0, units30d: 0 }).tier).toBe("test");
    const a = productRunAdvice({ ...base, stock: null });
    expect(a.tier).toBe("run");
    expect(a.checks.find((c) => c.key === "stock")?.status).toBe("unknown");
  });
});
