import { describe, expect, it } from "vitest";
import { DRIP, dripBudget, pauseKind } from "../feature-announce-drip";

/** Giờ VN → Date (VN = UTC+7). */
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe("dripBudget — gửi nốt thư báo tính năng mỗi ngày một lô", () => {
  it("trước giờ gửi buổi sáng: chưa gửi", () => {
    expect(dripBudget({ now: vn("2026-11-07T08:59:00"), sentToday: 0, pausedToday: false })).toBe(0);
  });

  it("từ giờ gửi: được cả lô trong ngày", () => {
    expect(dripBudget({ now: vn("2026-11-07T09:00:00"), sentToday: 0, pausedToday: false })).toBe(DRIP.perDay);
  });

  it("đã gửi một phần trong ngày (khởi động lại giữa chừng): chỉ gửi nốt phần còn lại", () => {
    expect(dripBudget({ now: vn("2026-11-07T14:00:00"), sentToday: 20, pausedToday: false })).toBe(DRIP.perDay - 20);
  });

  it("06/11 đã gửi tay 51 thư: hôm đó không gửi thêm", () => {
    expect(dripBudget({ now: vn("2026-11-06T17:00:00"), sentToday: 51, pausedToday: false })).toBe(0);
  });

  it("hôm nay đã gặp thư lỗi (Zoho chặn): nghỉ tới mai", () => {
    expect(dripBudget({ now: vn("2026-11-07T15:00:00"), sentToday: 3, pausedToday: true })).toBe(0);
  });

  it("quá hạn đợt gửi: thôi hẳn", () => {
    expect(dripBudget({ now: vn("2026-12-01T10:00:00"), sentToday: 0, pausedToday: false })).toBe(0);
    expect(dripBudget({ now: vn("2026-11-30T23:30:00"), sentToday: 0, pausedToday: false })).toBe(DRIP.perDay);
  });

  it("dấu nghỉ theo ngày VN, khác kind vé gửi thư", () => {
    expect(pauseKind("feature-mobile-1-4-2", "2026-11-07")).toBe("drip-pause:feature-mobile-1-4-2:2026-11-07");
  });
});
