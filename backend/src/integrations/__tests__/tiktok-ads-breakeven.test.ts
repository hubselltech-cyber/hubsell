// TAB HÒA VỐN SẢN PHẨM + bộ đệm kết quả của integrations/tiktok-ads/breakeven.ts.
// Luật hòa vốn thuần (đơn đã có kết cục cuối, đơn hủy cùng lứa, tự kiểm, đà bán): lib/__tests__/tiktok-breakeven.test.ts.
import { describe, expect, it } from "vitest";
import type { TiktokBreakeven } from "../../lib/tiktok-breakeven";
import { memoizeByChannel, productBreakevenVerdict, profitPer100AtRoi } from "../tiktok-ads/breakeven";

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

  it("đủ đơn, đủ giá vốn, chưa chạy chiến dịch nào → ổn, nói luôn mức ROI tối thiểu", () => {
    const v = productBreakevenVerdict(be({}), [], 90);
    expect(v.verdict).toBe("ok");
    expect(v.reason).toContain("từ 5 trở lên");
  });
  it("đang chạy với mục tiêu TRÊN hòa vốn → ổn, nói đạt mục tiêu thì mỗi 100đ doanh thu còn lãi bao nhiêu", () => {
    // Biên lãi 20% − 1/15 (6,67%) = 13,3đ trên mỗi 100đ doanh thu.
    const v = productBreakevenVerdict(be({}), [camp(15)], 90);
    expect(v.verdict).toBe("ok");
    expect(v.reason).toContain("13,3đ");
    // Anh Trung 08/10: hạ mục tiêu đi từng nấc 10% + theo dõi 72 giờ (TIKTOK_TARGET_STEP_WAIT_HOURS,
    // tài liệu TikTok: giữ mỗi mức ROI ít nhất 3 ngày trọn; test cũ còn ghi 48 giờ của bản sáng 08/10).
    expect(v.reason).toContain("hạ mục tiêu từng nấc 10%, theo dõi 72 giờ mới hạ tiếp, không xuống dưới 5");
  });
  it("chiến dịch ĐANG CHẠY đặt ROI mục tiêu dưới hòa vốn → cảnh báo kèm số lỗ + mức phải nâng; chiến dịch tạm dừng thì không", () => {
    // Biên lãi 20% − 1/4 (25%) = lỗ 5đ trên mỗi 100đ doanh thu.
    const v = productBreakevenVerdict(be({}), [camp(4)], 90);
    expect(v.verdict).toBe("target_below");
    expect(v.reason).toContain("lỗ khoảng 5đ");
    expect(v.reason).toContain("ít nhất 5");
    expect(productBreakevenVerdict(be({}), [camp(4, "paused")], 90).verdict).toBe("ok");
  });
  it("profitPer100AtRoi: đúng tại hòa vốn = 0, ROI không hợp lệ → null", () => {
    expect(profitPer100AtRoi(0.2, 5)).toBe(0);
    expect(profitPer100AtRoi(0.169, 15)).toBe(10.2); // TC054 thật: hòa vốn 5,92, đang đặt 15
    expect(profitPer100AtRoi(0.2, 0)).toBeNull();
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

// HẠ TẦNG — một lần mở trang bắn 2–3 request cùng cần hòa vốn của gian: tính MỘT lần, nhớ 45 giây.
describe("memoizeByChannel — nhớ đệm kết quả hòa vốn theo gian", () => {
  const ch = (id: string) => ({ id, userId: "u" });
  it("các request song song của cùng một gian dùng chung một lượt tính; gian khác tính riêng", async () => {
    let calls = 0;
    const f = memoizeByChannel(async (c) => `${c.id}#${++calls}`);
    const [a, b, other] = await Promise.all([f(ch("g1")), f(ch("g1")), f(ch("g2"))]);
    expect(a).toBe(b);
    expect(other).not.toBe(a);
    expect(calls).toBe(2);
  });
  it("quá 45 giây thì tính lại (giá vốn vừa nhập phải hiện lên)", async () => {
    let t = 0;
    let calls = 0;
    const f = memoizeByChannel(async () => ++calls, () => t);
    expect(await f(ch("g1"))).toBe(1);
    t = 44_000;
    expect(await f(ch("g1"))).toBe(1);
    t = 46_000;
    expect(await f(ch("g1"))).toBe(2);
  });
  it("lượt tính hỏng không bị nhớ lại", async () => {
    let calls = 0;
    const f = memoizeByChannel(async () => {
      if (++calls === 1) throw new Error("DB chập chờn");
      return "ok";
    });
    await expect(f(ch("g1"))).rejects.toThrow("DB chập chờn");
    expect(await f(ch("g1"))).toBe("ok");
  });
});
