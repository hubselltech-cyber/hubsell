// Hàm thuần của LÀN ADS RIÊNG (lát 1 "tách khoang", docs/ADS-NHIP-CANH-BAO.md mục 13, 19/10/2026).
// Không chạm DB / API sàn.
import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { adsCandidateWhere, dueAdsTiers, nextAdsSchedule } from "../ads-lane";
import { ADS_CADENCE } from "../../config/ads-cadence";

const noJitter = () => 0.5; // rand=0.5 → factor 1.0
const now = Date.parse("2026-10-19T10:00:00Z");

describe("dueAdsTiers", () => {
  it("null = chưa từng chạy = đến hạn cả xung lẫn lịch sử", () => {
    expect(dueAdsTiers({ nextAdsSyncAt: null, nextAdsPulseAt: null }, now)).toEqual({ history: true, pulse: true });
  });
  it("chỉ tầng có hạn ≤ now", () => {
    expect(dueAdsTiers({ nextAdsSyncAt: new Date(now + 1), nextAdsPulseAt: new Date(now) }, now)).toEqual({
      history: false,
      pulse: true,
    });
  });
});

describe("adsCandidateWhere — điều kiện nhặt vé của làn", () => {
  const stale = new Date(now - 30 * 60_000);
  it("chỉ 3 sàn, ACTIVE, có token, không ngủ đông; vé riêng adsLockedAt (không đụng syncLockedAt của vòng đơn)", () => {
    const w = adsCandidateWhere(new Date(now), stale, []);
    expect(w.channelName.in).toEqual([ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK]);
    expect(w.status).toBe("ACTIVE");
    expect(w.hibernatedAt).toBeNull();
    expect(JSON.stringify(w)).not.toContain("syncLockedAt");
    expect(w.AND[0]).toEqual({ OR: [{ adsLockedAt: null }, { adsLockedAt: { lt: stale } }] });
  });
  it("đến hạn = xung null / xung ≤ now / lịch sử ≤ now — KHÔNG có tầng nhanh hay tầng giờ", () => {
    const w = adsCandidateWhere(new Date(now), stale, []);
    const s = JSON.stringify(w.AND[1]);
    expect(s).toContain("nextAdsPulseAt");
    expect(s).toContain("nextAdsSyncAt");
    expect(s).not.toContain("nextFastSyncAt");
    expect(s).not.toContain("nextHourlySyncAt");
  });
  it("gian đang chạy trong tiến trình bị loại; danh sách rỗng thì không thêm điều kiện id", () => {
    expect(adsCandidateWhere(new Date(now), stale, ["a", "b"]).id).toEqual({ notIn: ["a", "b"] });
    expect("id" in adsCandidateWhere(new Date(now), stale, [])).toBe(false);
  });
});

describe("nextAdsSchedule — ghi lịch sau một lượt", () => {
  it("xung xong → hạn xung = now + delayMin, kéo được số → lastAdsSyncAt; không chạy lịch sử → không đụng nextAdsSyncAt", () => {
    const r = nextAdsSchedule({ pulse: { delayMin: 30, synced: true }, history: false, historyRan: false }, now, noJitter);
    expect(r.adsLockedAt).toBeNull();
    expect(r.nextAdsPulseAt?.getTime()).toBe(now + 30 * 60_000);
    expect(r.lastAdsSyncAt?.getTime()).toBe(now);
    expect(r.nextAdsSyncAt).toBeUndefined();
    expect(r.adsBackfillPending).toBeUndefined();
  });
  it("lịch sử chạy (dù hỏng) → hạn lịch sử = now + FULL_HOURS; chỉ khi kéo được số mới hạ cờ backfill", () => {
    const bad = nextAdsSchedule({ pulse: null, history: false, historyRan: true }, now, noJitter);
    expect(bad.nextAdsSyncAt?.getTime()).toBe(now + ADS_CADENCE.FULL_HOURS * 3_600_000);
    expect(bad.adsBackfillPending).toBeUndefined();
    expect(bad.lastAdsSyncAt).toBeUndefined();
    const ok = nextAdsSchedule({ pulse: null, history: true, historyRan: true }, now, noJitter);
    expect(ok.adsBackfillPending).toBe(false);
    expect(ok.lastAdsSyncAt?.getTime()).toBe(now);
  });
  it("xung không kéo được số (cầu dao) → vẫn lùi hạn xung, không ghi lastAdsSyncAt", () => {
    const r = nextAdsSchedule({ pulse: { delayMin: 15, synced: false }, history: false, historyRan: false }, now, noJitter);
    expect(r.nextAdsPulseAt?.getTime()).toBe(now + 15 * 60_000);
    expect(r.lastAdsSyncAt).toBeUndefined();
  });
  it("luôn nhả vé adsLockedAt", () => {
    expect(nextAdsSchedule({ pulse: null, history: false, historyRan: false }, now, noJitter)).toEqual({ adsLockedAt: null });
  });
});

describe("config lát 1 (bảng 13.4 — số tự chọn, đọc env)", () => {
  it("mặc định: làn bật, 2 luồng, vé mồ côi 30 phút, tỷ lệ bão 0,2", () => {
    expect(ADS_CADENCE.LANE).toBe(true);
    expect(ADS_CADENCE.CONCURRENCY).toBe(2);
    expect(ADS_CADENCE.LOCK_STALE_MIN).toBe(30);
    expect(ADS_CADENCE.STORM_RATIO).toBe(0.2);
  });
});
