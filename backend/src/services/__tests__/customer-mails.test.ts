// Hàm thuần của thư tự động gửi khách (19/09/2026): người gửi theo vai, nội
// dung từng thư, cửa sổ ngày VN của worker nhắc hạn. Không chạm DB / SMTP.
import { afterEach, describe, expect, it } from "vitest";
import { resolveSender } from "../../lib/mailer";
import {
  escapeHtml,
  passwordChangedEmailHtml,
  planActivatedEmailHtml,
  renewalReminderEmailHtml,
  renewalReminderSubject,
  vnDateLabel,
  vnDateTimeLabel,
  welcomeEmailHtml,
} from "../customer-mails";
import { vnDayWindow } from "../../workers/subscription-reminder";

const ENV_KEYS = [
  "MAIL_FROM",
  "MAIL_FROM_NOREPLY",
  "MAIL_FROM_BILLING",
  "MAIL_REPLY_TO_SUPPORT",
  "MAIL_REPLY_TO_BILLING",
  "SMTP_USER",
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveSender — người gửi theo vai", () => {
  it("chưa đặt env vai → rơi về MAIL_FROM nhưng Reply-To vẫn về đúng hộp", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.MAIL_FROM = "Hubsell <hubselltech@gmail.com>";
    expect(resolveSender("noreply")).toEqual({
      from: "Hubsell <hubselltech@gmail.com>",
      replyTo: "support@hubsell.vn",
    });
    expect(resolveSender("billing")).toEqual({
      from: "Hubsell <hubselltech@gmail.com>",
      replyTo: "billing@hubsell.vn",
    });
  });
  it("đặt env vai → dùng đúng địa chỉ từng vai", () => {
    process.env.MAIL_FROM = "Hubsell <dev@hubsell.vn>";
    process.env.MAIL_FROM_NOREPLY = "Hubsell <no-reply@hubsell.vn>";
    process.env.MAIL_FROM_BILLING = "Hubsell Thanh toán <billing@hubsell.vn>";
    expect(resolveSender("noreply").from).toBe("Hubsell <no-reply@hubsell.vn>");
    expect(resolveSender("billing").from).toBe("Hubsell Thanh toán <billing@hubsell.vn>");
  });
  it("thư nội bộ (không vai) giữ MAIL_FROM, không gắn Reply-To", () => {
    process.env.MAIL_FROM = "Hubsell <dev@hubsell.vn>";
    expect(resolveSender()).toEqual({ from: "Hubsell <dev@hubsell.vn>" });
  });
  it("không có MAIL_FROM → Hubsell <SMTP_USER>", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.SMTP_USER = "dev@hubsell.vn";
    expect(resolveSender().from).toBe("Hubsell <dev@hubsell.vn>");
  });
});

describe("nhãn ngày giờ Việt Nam", () => {
  it("17:30Z ngày 19/09 = 00:30 ngày 20/09 giờ VN", () => {
    const d = new Date("2026-09-19T17:30:00Z");
    expect(vnDateLabel(d)).toBe("20/09/2026");
    expect(vnDateTimeLabel(d)).toBe("00:30 20/09/2026");
  });
});

describe("nội dung thư", () => {
  it("họ tên khách luôn được escape — không chèn được HTML vào thư", () => {
    expect(escapeHtml(`<b>"A" & B</b>`)).toBe("&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;");
    const html = welcomeEmailHtml({ fullName: "<script>x</script>", trialDays: 14 });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("thư chào nêu số ngày dùng thử khi có, bỏ hẳn câu đó khi không", () => {
    expect(welcomeEmailHtml({ fullName: "Lan", trialDays: 14 })).toContain("dùng thử <b>14 ngày</b>");
    expect(welcomeEmailHtml({ fullName: "Lan", trialDays: null })).not.toContain("dùng thử");
  });
  it("thư đổi mật khẩu ghi giờ VN và dẫn về form Quên mật khẩu", () => {
    const html = passwordChangedEmailHtml({ fullName: "Lan", changedAt: new Date("2026-09-19T12:11:00Z") });
    expect(html).toContain("19:11 19/09/2026");
    expect(html).toContain("/login?mode=forgot");
  });
  const base = {
    fullName: "Lan",
    planName: "Growth",
    cycleLabel: "1 tháng",
    periodStart: new Date("2026-09-19T03:00:00Z"),
    periodEnd: new Date("2026-10-19T03:00:00Z"),
    paymentId: "pay_123",
    externalRef: "payos:FT26",
    methodLabel: "Cổng thanh toán payOS",
  };
  it("thư kích hoạt gói: có tiền thì nêu số tiền + hình thức + mã giao dịch", () => {
    const html = planActivatedEmailHtml({ ...base, amount: 199000 });
    expect(html).toContain("199.000₫");
    expect(html).toContain("Cổng thanh toán payOS");
    expect(html).toContain("payos:FT26");
    expect(html).toContain("19/09/2026 – 19/10/2026");
    expect(html).toContain("ghi nhận thanh toán");
  });
  it("thư kích hoạt gói 0₫ (HQ tặng kỳ): không nói thanh toán, không hiện số tiền", () => {
    const html = planActivatedEmailHtml({ ...base, amount: 0, externalRef: null });
    expect(html).not.toContain("ghi nhận thanh toán");
    expect(html).not.toContain("Số tiền");
    expect(html).not.toContain("Mã giao dịch");
  });
  it("thư nhắc hạn: mốc 1 ngày nói ngày mai, dùng thử nói kỳ dùng thử", () => {
    const end = new Date("2026-09-26T03:00:00Z");
    const paid7 = { fullName: "Lan", planName: "Growth", daysLeft: 7, periodEnd: end, isTrial: false };
    expect(renewalReminderSubject(paid7)).toBe("Hubsell — Gói Growth còn 7 ngày (hết hạn 26/09/2026)");
    expect(renewalReminderEmailHtml(paid7)).toContain("Gia hạn ngay");
    const trial1 = { ...paid7, daysLeft: 1, isTrial: true };
    expect(renewalReminderSubject(trial1)).toBe("Hubsell — Kỳ dùng thử hết hạn ngày mai (26/09/2026)");
    expect(renewalReminderEmailHtml(trial1)).toContain("Chọn gói");
  });
});

describe("vnDayWindow — cửa sổ ngày lịch VN của worker nhắc hạn", () => {
  // 19/09/2026 09:00 VN = 02:00Z
  const now = new Date("2026-09-19T02:00:00Z");
  it("mốc 7 ngày = trọn ngày 26/09 giờ VN", () => {
    const w = vnDayWindow(now, 7);
    expect(w.from.toISOString()).toBe("2026-09-25T17:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-26T17:00:00.000Z");
  });
  it("hết hạn hôm qua = trọn ngày 18/09 giờ VN", () => {
    const w = vnDayWindow(now, -1);
    expect(w.from.toISOString()).toBe("2026-09-17T17:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-18T17:00:00.000Z");
  });
});
