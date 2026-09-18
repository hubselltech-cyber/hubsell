import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({ prisma: {} }));
vi.mock("../../services/notifications", () => ({ notify: vi.fn() }));

import { DAILY_RUN_SPREAD_MIN, autoRunDue, dailyRunOffsetMin, pickUnruledToTrack } from "../tiktok-ads/auto-run";

// HẠ TẦNG TikTok Ads — rải giờ chấm + chỉ theo dõi chiến dịch cần theo dõi.
describe("dailyRunOffsetMin / autoRunDue — rải giờ chấm trong khung 12h–14h", () => {
  it("độ lệch suy từ mã gian: cố định theo gian, nằm trong 0–89 phút, các gian khác nhau không dồn một chỗ", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `cmu${i.toString(36)}x${(i * 7919).toString(36)}`);
    const offsets = ids.map(dailyRunOffsetMin);
    expect(offsets.every((o) => o >= 0 && o < DAILY_RUN_SPREAD_MIN)).toBe(true);
    expect(dailyRunOffsetMin(ids[5])).toBe(offsets[5]);
    expect(new Set(offsets).size).toBeGreaterThan(40);
  });
  it("chưa tới 12:00 + độ lệch thì chưa chấm; tới rồi thì chấm một lần mỗi ngày", () => {
    expect(autoRunDue("2026-09-18", "2026-09-19", 12 * 60 + 10, 30)).toBe(false);
    expect(autoRunDue("2026-09-18", "2026-09-19", 12 * 60 + 30, 30)).toBe(true);
    expect(autoRunDue("2026-09-19", "2026-09-19", 15 * 60, 30)).toBe(false);
    expect(autoRunDue("", "2026-09-19", 11 * 60 + 59, 0)).toBe(false);
  });
});

describe("pickUnruledToTrack — chiến dịch chưa bật luật: chỉ theo dõi những cái tiêu nhiều nhất", () => {
  it("xếp theo tiền tiêu 7 ngày, cắt ở trần; chiến dịch không có số coi như 0", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const spend = new Map([
      ["b", 900_000],
      ["d", 5_000_000],
      ["a", 10_000],
    ]);
    expect(pickUnruledToTrack(list, spend, 2).map((x) => x.id)).toEqual(["d", "b"]);
    expect(pickUnruledToTrack(list, spend, 10)).toHaveLength(4);
  });
});
