import { describe, expect, it } from "vitest";
import {
  DAILY_MAX_DAYS,
  addMonthsClamped,
  checkRecurringSchedule,
  nextOccurrence,
  occurrencesBetween,
} from "../recurring-expense";

describe("chi phí định kỳ — ngày tới hạn", () => {
  it("hằng ngày: mỗi ngày một khoản, không tính ngày mốc, có tính ngày cuối", () => {
    expect(
      occurrencesBetween({ cadence: "DAILY", start: "2026-12-01", after: "2026-11-30", through: "2026-12-03" })
    ).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    // Worker ngừng 3 ngày (mốc 02/12, hôm nay 05/12) → ghi bù đủ 3 ngày.
    expect(
      occurrencesBetween({ cadence: "DAILY", start: "2026-12-01", after: "2026-12-02", through: "2026-12-05" })
    ).toEqual(["2026-12-03", "2026-12-04", "2026-12-05"]);
  });

  it("hằng ngày: không vượt ngày kết thúc", () => {
    expect(
      occurrencesBetween({
        cadence: "DAILY",
        start: "2026-12-01",
        after: "2026-11-30",
        through: "2026-12-31",
        end: "2026-12-02",
      })
    ).toEqual(["2026-12-01", "2026-12-02"]);
  });

  it("hằng tháng: ngày 31 gặp tháng thiếu → ngày cuối tháng, rồi QUAY LẠI ngày 31 (không cộng dồn)", () => {
    expect(
      occurrencesBetween({ cadence: "MONTHLY", start: "2027-01-31", after: "2027-01-30", through: "2027-05-31" })
    ).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29"); // năm nhuận
  });

  it("hằng tháng: ngày thường giữ nguyên ngày, qua năm vẫn đúng", () => {
    expect(
      occurrencesBetween({ cadence: "MONTHLY", start: "2026-11-05", after: "2026-11-05", through: "2027-02-10" })
    ).toEqual(["2026-12-05", "2027-01-05", "2027-02-05"]);
  });

  it("hằng tháng: mốc nằm ở ngày kẹp cuối tháng không làm sót / lặp kỳ", () => {
    // Mốc 28/02 (kỳ tháng 2 của luật ngày 31 đã ghi) → kỳ kế là 31/03, không ghi lại 28/02.
    expect(
      occurrencesBetween({ cadence: "MONTHLY", start: "2027-01-31", after: "2027-02-28", through: "2027-03-31" })
    ).toEqual(["2027-03-31"]);
    // Mốc 27/02 → 28/02 còn tới hạn.
    expect(
      occurrencesBetween({ cadence: "MONTHLY", start: "2027-01-31", after: "2027-02-27", through: "2027-02-28" })
    ).toEqual(["2027-02-28"]);
  });

  it("hằng năm: 29/02 → 28/02 ở năm thường, 29/02 ở năm nhuận", () => {
    expect(
      occurrencesBetween({ cadence: "YEARLY", start: "2028-02-29", after: "2028-02-28", through: "2032-03-01" })
    ).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });

  it("ngày bắt đầu ở tương lai → chưa có khoản nào", () => {
    expect(
      occurrencesBetween({ cadence: "DAILY", start: "2026-12-10", after: "2026-12-09", through: "2026-12-01" })
    ).toEqual([]);
    expect(
      occurrencesBetween({ cadence: "MONTHLY", start: "2026-12-10", after: "2026-12-09", through: "2026-12-01" })
    ).toEqual([]);
  });

  it("ngày ghi kế tiếp", () => {
    expect(nextOccurrence({ cadence: "MONTHLY", start: "2026-11-05", after: "2026-11-26" })).toBe("2026-12-05");
    expect(nextOccurrence({ cadence: "DAILY", start: "2026-12-01", after: "2026-11-30" })).toBe("2026-12-01");
    expect(nextOccurrence({ cadence: "YEARLY", start: "2026-01-15", after: "2026-11-26" })).toBe("2027-01-15");
    // Đã qua ngày kết thúc → không còn.
    expect(nextOccurrence({ cadence: "DAILY", start: "2026-11-01", after: "2026-11-30", end: "2026-11-30" })).toBeNull();
  });
});

describe("chi phí định kỳ — kiểm lịch trước khi tạo", () => {
  it("hằng ngày bắt buộc ngày kết thúc và không quá trần", () => {
    expect(checkRecurringSchedule({ cadence: "DAILY", startDay: "2026-12-01", endDay: "" }).ok).toBe(false);
    expect(checkRecurringSchedule({ cadence: "DAILY", startDay: "2026-12-01", endDay: "2026-12-31" }).ok).toBe(true);
    // Đúng trần (366 ngày kể cả hai đầu) thì được, thêm một ngày thì không.
    expect(DAILY_MAX_DAYS).toBe(366);
    expect(checkRecurringSchedule({ cadence: "DAILY", startDay: "2026-01-01", endDay: "2027-01-01" }).ok).toBe(true);
    expect(checkRecurringSchedule({ cadence: "DAILY", startDay: "2026-01-01", endDay: "2027-01-02" }).ok).toBe(false);
  });

  it("hằng tháng / hằng năm cho để trống ngày kết thúc", () => {
    expect(checkRecurringSchedule({ cadence: "MONTHLY", startDay: "2026-12-05", endDay: null }).ok).toBe(true);
    expect(checkRecurringSchedule({ cadence: "YEARLY", startDay: "2026-12-05", endDay: undefined }).ok).toBe(true);
  });

  it("ngày kết thúc trước ngày bắt đầu, năm gõ 2 chữ số, ngày không có thật, chu kỳ lạ → từ chối", () => {
    expect(checkRecurringSchedule({ cadence: "MONTHLY", startDay: "2026-12-05", endDay: "2026-12-04" }).ok).toBe(false);
    expect(checkRecurringSchedule({ cadence: "DAILY", startDay: "0026-12-01", endDay: "0026-12-31" }).ok).toBe(false);
    expect(checkRecurringSchedule({ cadence: "MONTHLY", startDay: "2026-02-30", endDay: null }).ok).toBe(false);
    expect(checkRecurringSchedule({ cadence: "WEEKLY", startDay: "2026-12-05", endDay: null }).ok).toBe(false);
  });
});
