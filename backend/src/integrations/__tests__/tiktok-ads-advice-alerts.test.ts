import { describe, expect, it } from "vitest";
import { ADVICE_ALERT_KINDS, adviceAlertPlan } from "../tiktok-ads/advice-alerts";

// Chuông kết luận chiến dịch TikTok (15/10/2026): chỉ chuông khi loại kết luận ĐỔI (luật B8) sang loại có việc phải làm.
describe("adviceAlertPlan — ghi khi đổi, chuông khi đổi sang loại có việc", () => {
  it("lần chấm đầu (chưa có loại) sang loại có việc → ghi + chuông; sang loại không việc → chỉ ghi", () => {
    expect(adviceAlertPlan("", "target_binding")).toEqual({ changed: true, alert: true });
    expect(adviceAlertPlan("", "budget_capped")).toEqual({ changed: true, alert: true });
    expect(adviceAlertPlan("", "losing")).toEqual({ changed: true, alert: true });
    expect(adviceAlertPlan("", "target_below")).toEqual({ changed: true, alert: true });
    expect(adviceAlertPlan("", "healthy")).toEqual({ changed: true, alert: false });
    expect(adviceAlertPlan("", "no_breakeven")).toEqual({ changed: true, alert: false });
  });

  it("cùng loại như lần trước → không ghi, không chuông (kể cả loại có việc — B8)", () => {
    expect(adviceAlertPlan("target_binding", "target_binding")).toEqual({ changed: false, alert: false });
    expect(adviceAlertPlan("healthy", "healthy")).toEqual({ changed: false, alert: false });
  });

  it("đổi giữa hai loại: sang giữ / theo dõi / lãi thì chỉ ghi; quay lại loại có việc thì chuông lại", () => {
    expect(adviceAlertPlan("target_binding", "target_watching")).toEqual({ changed: true, alert: false });
    expect(adviceAlertPlan("target_watching", "healthy")).toEqual({ changed: true, alert: false });
    expect(adviceAlertPlan("healthy", "target_binding")).toEqual({ changed: true, alert: true });
    expect(adviceAlertPlan("target_binding", "budget_capped")).toEqual({ changed: true, alert: true });
    expect(adviceAlertPlan("target_hold", "target_hold")).toEqual({ changed: false, alert: false });
  });

  it("bộ loại có việc = bốn loại sửa mục tiêu / ngân sách + hai loại không ra đơn (15/10 đêm)", () => {
    expect([...ADVICE_ALERT_KINDS].sort()).toEqual(["budget_capped", "losing", "no_delivery", "no_orders", "target_below", "target_binding"]);
    expect(adviceAlertPlan("learning", "no_delivery")).toEqual({ changed: true, alert: true });
    expect(adviceAlertPlan("no_delivery", "no_orders")).toEqual({ changed: true, alert: true });
    expect(adviceAlertPlan("", "learning")).toEqual({ changed: true, alert: false });
  });
});
