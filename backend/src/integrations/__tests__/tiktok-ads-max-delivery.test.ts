import { describe, expect, it } from "vitest";
import { MAX_DELIVERY_REVIEW_DAYS, campaignAdvice, maxDeliveryFullDays, type CampaignAdviceInput } from "../tiktok-ads/campaign-advice";
import { maxDeliverySinceOf } from "../tiktok-ads/sync";
import type { TiktokBreakeven } from "../../lib/tiktok-breakeven";

// PHÂN PHỐI TỐI ĐA (08/11/2026 — anh Trung: "có gì để Hubsell cảnh báo tới khách khi khách dùng tính năng này"). TikTok tiêu trọn ngân
// sách riêng, không còn ROI mục tiêu chặn lỗ, không ROI protection → hòa vốn Hubsell là lưới duy nhất. Mốc TikTok (Best practices for
// Max delivery): ROI dao động mấy ngày đầu, đánh giá sau 5–7 ngày, lỗ thì giảm ngân sách / quay về ROI mục tiêu, không hẹn ngày kết
// thúc thì không tự quay về.

const NOW = new Date("2026-11-08T10:00:00Z"); // 17:00 VN 08/11
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const be = (over: Partial<TiktokBreakeven> = {}): TiktokBreakeven => ({
  breakevenRoi: 5,
  margin: 0.2,
  negativeMargin: false,
  source: "campaign",
  orders: 120,
  cancelledOrders: 0,
  pendingOrders: 0,
  costCoveragePct: 100,
  unlinkedRevenue: 0,
  suspectGiftOrders: 0,
  ...over,
});
const input = (over: Partial<CampaignAdviceInput> = {}): CampaignAdviceInput => ({
  status: "ongoing",
  roasTarget: null,
  budget: 1_500_000,
  breakeven: be(),
  spend: 6_000_000,
  gmv: 69_000_000, // ROI thực 11,5 — lãi
  avgDailySpend: 1_400_000, // 93% ngân sách: Phân phối tối đa tiêu trọn là ĐÚNG THIẾT KẾ, không phải "ngân sách đang chặn"
  roasTargetPrev: 15,
  now: NOW,
  ...over,
});

describe("maxDeliveryFullDays — ngày trọn theo giờ VN kể từ lúc chuyển", () => {
  it("chuyển hôm nay = 0, hôm qua = 1; mốc 23:30 VN hôm qua vẫn là hôm qua", () => {
    expect(maxDeliveryFullDays(NOW, NOW)).toBe(0);
    expect(maxDeliveryFullDays(daysAgo(1), NOW)).toBe(1);
    expect(maxDeliveryFullDays(new Date("2026-11-07T16:30:00Z"), NOW)).toBe(1); // 23:30 VN 07/11
    expect(maxDeliveryFullDays(new Date("2026-11-07T17:30:00Z"), NOW)).toBe(0); // 00:30 VN 08/11
    expect(maxDeliveryFullDays(daysAgo(5), NOW)).toBe(5);
  });
});

describe("campaignAdvice — Phân phối tối đa", () => {
  it("chưa đủ 3 ngày trọn → khởi động (info), không kết luận, nhắc hẹn ngày kết thúc; không bị 'ngân sách đang chặn' dù tiêu 93%", () => {
    const a = campaignAdvice(input({ maxDeliverySince: daysAgo(1) }));
    expect(a.kind).toBe("max_delivery_learning");
    expect(a.tone).toBe("info");
    expect(a.points[0]).toBe("Phân phối tối đa từ 07/11 (1 ngày trọn): TikTok tiêu trọn 1.500.000đ/ngày để đẩy doanh thu, không có ROI mục tiêu chặn, không được bảo vệ ROI.");
    expect(a.conclusion).toContain("Chưa đủ 3 ngày trọn");
    expect(a.conclusion).toContain("hẹn ngày kết thúc");
    expect(a.editInSellerCenter).toBe(false);
  });

  it("chưa đủ 3 ngày nhưng ROI đã dưới hòa vốn → vẫn khởi động, tông cảnh báo + câu 'lỗ sâu thì giảm ngân sách ngay'", () => {
    const a = campaignAdvice(input({ maxDeliverySince: daysAgo(2), gmv: 24_000_000 })); // ROI 4 < 5
    expect(a.kind).toBe("max_delivery_learning");
    expect(a.tone).toBe("warn");
    expect(a.conclusion).toContain("giảm ngân sách ngay");
    expect(a.editInSellerCenter).toBe(true);
  });

  it("đủ 3 ngày, ROI dưới hòa vốn → losing với lời khuyên quay về ROI mục tiêu cũ (15 ≥ sàn 6,7), không phải 'nâng mục tiêu'", () => {
    const a = campaignAdvice(input({ maxDeliverySince: daysAgo(3), gmv: 24_000_000 }));
    expect(a.kind).toBe("losing");
    expect(a.label).toBe("Phân phối tối đa đang lỗ");
    expect(a.conclusion).toBe(
      "Không có ROI mục tiêu nào chặn nên TikTok cứ tiêu dù đang lỗ. Quay về ROI mục tiêu, đặt 15 (mức trước khi chuyển), hoặc giảm ngân sách ngày; loại bớt video tiêu tiền mà ROI thấp trong bảng video."
    );
    expect(a.nextTarget).toBe(15);
    expect(a.editInSellerCenter).toBe(true);
  });

  it("lỗ mà mục tiêu cũ dưới sàn an toàn (hoặc không có) → khuyên về sàn an toàn 6,7 (biên 20%, giữ 5đ/100đ)", () => {
    expect(campaignAdvice(input({ maxDeliverySince: daysAgo(3), gmv: 24_000_000, roasTargetPrev: 4 })).nextTarget).toBe(6.7);
    const a = campaignAdvice(input({ maxDeliverySince: daysAgo(3), gmv: 24_000_000, roasTargetPrev: null }));
    expect(a.nextTarget).toBe(6.7);
    expect(a.conclusion).toContain("đặt 6,7,");
  });

  it("3–4 ngày, đang lãi → healthy nhãn riêng, giữ tới đủ 5 ngày rồi đánh giá (không chuông)", () => {
    const a = campaignAdvice(input({ maxDeliverySince: daysAgo(4) }));
    expect(a.kind).toBe("healthy");
    expect(a.label).toBe("Phân phối tối đa — đang lãi");
    expect(a.conclusion).toContain(`đủ ${MAX_DELIVERY_REVIEW_DAYS} ngày trọn`);
    expect(a.keepPer100).toBe(11.3);
  });

  it("đủ 5 ngày, vẫn lãi → đến lúc đánh giá: quay về 15 cho ổn định hoặc đẩy tiếp +30%/ngày, không quá 5 lần chi tiêu cũ", () => {
    const a = campaignAdvice(input({ maxDeliverySince: daysAgo(5) }));
    expect(a.kind).toBe("max_delivery_review");
    expect(a.tone).toBe("info");
    expect(a.conclusion).toContain("Đã chạy 5 ngày trọn và vẫn lãi");
    expect(a.conclusion).toContain("đặt 15 (mức trước khi chuyển)");
    expect(a.conclusion).toContain("30%/ngày (1.500.000đ → 1.950.000đ)");
    expect(a.conclusion).toContain("không quá 5 lần");
    expect(a.conclusion).toContain("hẹn ngày kết thúc");
    expect(a.nextBudget).toBe(1_950_000);
    expect(a.editInSellerCenter).toBe(true);
  });

  it("chưa có hòa vốn tin được mà đang Phân phối tối đa → 'chưa kết luận' nhưng tông info + thúc nhập giá vốn ngay", () => {
    const a = campaignAdvice(input({ maxDeliverySince: daysAgo(3), breakeven: null }));
    expect(a.kind).toBe("no_breakeven");
    expect(a.tone).toBe("info");
    expect(a.points[0]).toContain("Phân phối tối đa từ 05/11");
    expect(a.conclusion).toContain("nhập đủ giá vốn");
  });

  it("dòng cũ chưa có mốc (roasTarget null, không maxDeliverySince) → luật cũ: tiêu gần hết ngân sách = ngân sách đang chặn", () => {
    expect(campaignAdvice(input({ maxDeliverySince: null })).kind).toBe("budget_capped");
  });

  it("đang có ROI mục tiêu thì mốc cũ (nếu còn sót) không kích nhánh Phân phối tối đa", () => {
    const a = campaignAdvice(input({ roasTarget: 15, maxDeliverySince: daysAgo(5), avgDailySpend: 210_000 }));
    expect(a.kind).toBe("target_binding");
  });

  it("0 đơn sau 3 ngày vẫn đi nhánh không ra đơn trước (tiêu tiền thật → tạm dừng)", () => {
    const a = campaignAdvice(input({ maxDeliverySince: daysAgo(3), orders: 0, gmv: 0, spend: 900_000, fullDaysRunning: 3 }));
    expect(a.kind).toBe("no_orders");
  });
});

describe("maxDeliverySinceOf — mốc chuyển sau lượt đồng bộ", () => {
  const prevRoi = { biddingMethod: "target_roi", maxDeliverySince: null };
  const prevMax = { biddingMethod: "max_delivery", maxDeliverySince: daysAgo(4) };

  it("báo cáo trả ROI mục tiêu → xóa mốc, không chuông (kể cả vừa quay về từ Phân phối tối đa)", () => {
    expect(maxDeliverySinceOf(prevMax, "target_roi", NOW, undefined)).toEqual({ since: null, switched: false });
    expect(maxDeliverySinceOf(null, "target_roi", NOW, "2026-11-01")).toEqual({ since: null, switched: false });
  });

  it("ROI mục tiêu → Phân phối tối đa: mốc = bây giờ, CHUÔNG", () => {
    expect(maxDeliverySinceOf(prevRoi, "max_delivery", NOW, "2026-11-08")).toEqual({ since: NOW, switched: true });
  });

  it("đang Phân phối tối đa từ trước → giữ mốc cũ, không chuông; dòng cũ chưa có mốc → cận dưới = ngày NO_BID sớm nhất 00:00 VN", () => {
    expect(maxDeliverySinceOf(prevMax, "max_delivery", NOW, "2026-11-01")).toEqual({ since: prevMax.maxDeliverySince, switched: false });
    expect(maxDeliverySinceOf({ biddingMethod: "max_delivery", maxDeliverySince: null }, "max_delivery", NOW, "2026-11-01")).toEqual({
      since: new Date("2026-11-01T00:00:00+07:00"),
      switched: false,
    });
  });

  it("thấy lần đầu đã Phân phối tối đa (lần nối đầu kéo 30 ngày) → cận dưới, không chuông; không có ngày thì = bây giờ", () => {
    expect(maxDeliverySinceOf(null, "max_delivery", NOW, "2026-10-20")).toEqual({ since: new Date("2026-10-20T00:00:00+07:00"), switched: false });
    expect(maxDeliverySinceOf(null, "max_delivery", NOW, undefined)).toEqual({ since: NOW, switched: false });
  });

  it("dòng chưa tiêu tiền (biddingMethod rỗng, chỉ có từ danh sách) rồi chạy thẳng Phân phối tối đa → ghi mốc, không chuông", () => {
    expect(maxDeliverySinceOf({ biddingMethod: "", maxDeliverySince: null }, "max_delivery", NOW, undefined)).toEqual({ since: NOW, switched: false });
  });
});
