// Hàm thuần của chuông nhắc gia hạn kỳ dịch vụ Lazada (14/09/2026): hạn kỳ,
// đếm ngày lịch VN, nội dung theo mốc. Không chạm DB / API sàn.
import { describe, expect, it } from "vitest";
import {
  buildRenewalReminder,
  calendarDaysUntil,
  cycleEndOf,
  REMIND_DAYS_BEFORE,
} from "../lazada-renewal-reminder";

// 14/03/2027 00:03 VN = 13/03/2027 17:03Z (số thật gian DarkMan sau ủy quyền app ISV)
const CYCLE_END = new Date("2027-03-13T17:03:02.255Z");

describe("cycleEndOf — hạn kỳ = mốc muộn nhất của hai hạn token", () => {
  it("lấy max để không tin nhầm fallback 30 ngày khi một trường thiếu", () => {
    const soon = new Date("2026-10-14T00:00:00Z");
    expect(cycleEndOf({ accessTokenExpireAt: CYCLE_END, refreshTokenExpireAt: soon })).toEqual(CYCLE_END);
    expect(cycleEndOf({ accessTokenExpireAt: soon, refreshTokenExpireAt: CYCLE_END })).toEqual(CYCLE_END);
  });
  it("null khi chưa có hạn nào", () => {
    expect(cycleEndOf({ accessTokenExpireAt: null, refreshTokenExpireAt: null })).toBeNull();
  });
});

describe("calendarDaysUntil — ngày lịch theo giờ VN", () => {
  it("cùng ngày VN = 0 dù khác giờ UTC", () => {
    // 13/03 17:03Z = 14/03 00:03 VN; 14/03 10:00 VN = 14/03 03:00Z
    expect(calendarDaysUntil(CYCLE_END, new Date("2027-03-14T03:00:00Z"))).toBe(0);
  });
  it("ngày mai = 1, đã qua = âm", () => {
    expect(calendarDaysUntil(CYCLE_END, new Date("2027-03-13T03:00:00Z"))).toBe(1);
    expect(calendarDaysUntil(CYCLE_END, new Date("2027-03-15T03:00:00Z"))).toBe(-1);
  });
});

describe("buildRenewalReminder — nội dung theo mốc", () => {
  it("đúng mốc 14/7/1 ngày thì có chuông, mốc khác thì null", () => {
    for (const d of REMIND_DAYS_BEFORE) {
      const now = new Date(CYCLE_END.getTime() - d * 86_400_000);
      const r = buildRenewalReminder("DarkMan", CYCLE_END, now);
      expect(r?.daysLeft).toBe(d);
      expect(r?.title).toContain("DarkMan");
      expect(r?.title).toContain("14/03/2027");
      expect(r?.link).toBe("/channels");
    }
    expect(
      buildRenewalReminder("DarkMan", CYCLE_END, new Date(CYCLE_END.getTime() - 10 * 86_400_000))
    ).toBeNull();
  });
  it("mốc 1 ngày nói 'Ngày mai', mốc xa nói 'Còn N ngày'", () => {
    expect(
      buildRenewalReminder("X", CYCLE_END, new Date(CYCLE_END.getTime() - 86_400_000))?.title
    ).toMatch(/Ngày mai/);
    expect(
      buildRenewalReminder("X", CYCLE_END, new Date(CYCLE_END.getTime() - 7 * 86_400_000))?.title
    ).toMatch(/Còn 7 ngày/);
  });
  it("quá hạn → bản 'đã hết kỳ' với daysLeft âm", () => {
    const r = buildRenewalReminder("DarkMan", CYCLE_END, new Date(CYCLE_END.getTime() + 2 * 86_400_000));
    expect(r?.daysLeft).toBeLessThan(0);
    expect(r?.title).toMatch(/đã hết kỳ/);
  });
});
