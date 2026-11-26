import { describe, expect, it } from "vitest";
import { parseExpenseDate } from "../expense-date";

const NOW = new Date("2026-11-26T03:00:00.000Z");

describe("parseExpenseDate — ngày phát sinh khoản thu/chi vận hành", () => {
  it("bỏ trống → không đặt ngày (DB tự lấy lúc lưu)", () => {
    expect(parseExpenseDate(undefined, NOW)).toEqual({ ok: true, date: undefined });
    expect(parseExpenseDate("", NOW)).toEqual({ ok: true, date: undefined });
    expect(parseExpenseDate(null, NOW)).toEqual({ ok: true, date: undefined });
  });

  it("ngày thường (lịch hoặc gõ đủ 4 chữ số năm) → nhận", () => {
    const r = parseExpenseDate("2026-11-15", NOW);
    expect(r.ok && r.date?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
  });

  it("năm gõ 2 chữ số (trình duyệt ra 0026) → TỪ CHỐI, không lưu vào năm 26", () => {
    const r = parseExpenseDate("0026-11-15", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("đủ 4 chữ số");
  });

  it("năm gõ dở (0202) và năm gõ thừa (20261, 2206) → từ chối", () => {
    expect(parseExpenseDate("0202-11-15", NOW).ok).toBe(false);
    expect(parseExpenseDate("+020261-11-15", NOW).ok).toBe(false);
    expect(parseExpenseDate("2206-11-15", NOW).ok).toBe(false);
  });

  it("ghi trước tới hết năm sau thì được, xa hơn thì không", () => {
    expect(parseExpenseDate("2027-12-31", NOW).ok).toBe(true);
    expect(parseExpenseDate("2028-01-01", NOW).ok).toBe(false);
  });

  it("chuỗi rác / sai kiểu → từ chối", () => {
    expect(parseExpenseDate("hôm qua", NOW).ok).toBe(false);
    expect(parseExpenseDate(20261115, NOW).ok).toBe(false);
  });
});
