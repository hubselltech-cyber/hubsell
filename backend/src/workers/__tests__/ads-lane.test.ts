// Hàm thuần của LÀN ADS RIÊNG (lát 1 "tách khoang" + lát 2 "cách ly theo gian",
// docs/ADS-NHIP-CANH-BAO.md mục 13, 19/10/2026). Không chạm DB / API sàn.
import { describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { adsCandidateWhere, dueAdsTiers, nextAdsSchedule, nextBackoffLevel, shopBackoffMs } from "../ads-lane";
import { ADS_CADENCE } from "../../config/ads-cadence";

const noJitter = () => 0.5; // rand=0.5 → factor 1.0
const now = Date.parse("2026-10-19T10:00:00Z");
const MIN = 60_000;
const ok = { synced: true, rateLimited: null } as const;
const quiet = { synced: false, rateLimited: null } as const;

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
  const stale = new Date(now - 30 * MIN);
  it("chỉ 3 sàn, ACTIVE, có token, không ngủ đông; vé riêng adsLockedAt (không đụng syncLockedAt của vòng đơn)", () => {
    const w = adsCandidateWhere(new Date(now), stale, []);
    expect(w.channelName.in).toEqual([ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK]);
    expect(w.status).toBe("ACTIVE");
    expect(w.hibernatedAt).toBeNull();
    expect(JSON.stringify(w)).not.toContain("syncLockedAt");
    expect(w.AND[0]).toEqual({ OR: [{ adsLockedAt: null }, { adsLockedAt: { lt: stale } }] });
  });
  it("LÁT 2: gian đang lùi riêng (adsBackoffUntil > now) không được nhặt", () => {
    const w = adsCandidateWhere(new Date(now), stale, []);
    expect(w.AND[1]).toEqual({ OR: [{ adsBackoffUntil: null }, { adsBackoffUntil: { lte: new Date(now) } }] });
  });
  it("đến hạn = xung null / xung ≤ now / lịch sử ≤ now — KHÔNG có tầng nhanh hay tầng giờ", () => {
    const w = adsCandidateWhere(new Date(now), stale, []);
    const s = JSON.stringify(w.AND[2]);
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

describe("shopBackoffMs / nextBackoffLevel — lùi riêng của gian (lát 2)", () => {
  it("bậc 0 = 15', bậc 1 = 30', bậc 2 = 60', bậc 3+ kẹp trần 120'", () => {
    expect(shopBackoffMs(0, noJitter)).toBe(15 * MIN);
    expect(shopBackoffMs(1, noJitter)).toBe(30 * MIN);
    expect(shopBackoffMs(2, noJitter)).toBe(60 * MIN);
    expect(shopBackoffMs(3, noJitter)).toBe(120 * MIN);
    expect(shopBackoffMs(9, noJitter)).toBe(120 * MIN);
  });
  it("có xáo trộn ±15 % để các gian không cùng thức dậy", () => {
    expect(shopBackoffMs(0, () => 0)).toBe(Math.round(15 * MIN * 0.85));
    expect(shopBackoffMs(0, () => 1)).toBe(Math.round(15 * MIN * 1.15));
  });
  it("bậc +1 mỗi lần 429, không phình quá bậc đã chạm trần (log2(120/15) = 3)", () => {
    expect(nextBackoffLevel(0)).toBe(1);
    expect(nextBackoffLevel(2)).toBe(3);
    expect(nextBackoffLevel(3)).toBe(3);
    expect(nextBackoffLevel(-5)).toBe(1);
  });
});

describe("nextAdsSchedule — ghi lịch sau một lượt", () => {
  it("xung xong → hạn xung = now + delayMin, kéo được số → lastAdsSyncAt; không chạy lịch sử → không đụng nextAdsSyncAt", () => {
    const r = nextAdsSchedule({ pulse: { delayMin: 30, synced: true }, history: null, historyRan: false }, now, noJitter);
    expect(r.adsLockedAt).toBeNull();
    expect(r.nextAdsPulseAt?.getTime()).toBe(now + 30 * MIN);
    expect(r.lastAdsSyncAt?.getTime()).toBe(now);
    expect(r.nextAdsSyncAt).toBeUndefined();
    expect(r.adsBackfillPending).toBeUndefined();
    expect(r.adsBackoffLevel).toBeUndefined(); // bậc 0 sẵn, không ghi thừa
  });
  it("lịch sử chạy (dù hỏng) → hạn lịch sử = now + FULL_HOURS; chỉ khi kéo được số mới hạ cờ backfill", () => {
    const bad = nextAdsSchedule({ pulse: null, history: quiet, historyRan: true }, now, noJitter);
    expect(bad.nextAdsSyncAt?.getTime()).toBe(now + ADS_CADENCE.FULL_HOURS * 3_600_000);
    expect(bad.adsBackfillPending).toBeUndefined();
    expect(bad.lastAdsSyncAt).toBeUndefined();
    const good = nextAdsSchedule({ pulse: null, history: ok, historyRan: true }, now, noJitter);
    expect(good.adsBackfillPending).toBe(false);
    expect(good.lastAdsSyncAt?.getTime()).toBe(now);
  });
  it("cầu dao APP đang đóng → chỉ lùi hạn xung như cũ, KHÔNG đổi bậc của gian (không phải lỗi của gian)", () => {
    const r = nextAdsSchedule(
      { pulse: { delayMin: 30, synced: false, rateLimited: "app" }, history: null, historyRan: false, backoffLevel: 1 },
      now,
      noJitter
    );
    expect(r.nextAdsPulseAt?.getTime()).toBe(now + 30 * MIN);
    expect(r.lastAdsSyncAt).toBeUndefined();
    expect(r.adsBackoffLevel).toBeUndefined();
    expect(r.adsBackoffUntil).toBeUndefined();
  });
  it("LÁT 2: xung dính 429 tầng shop → gian lùi riêng 15' ở bậc 0, bậc ghi DB thành 1, hạn xung đẩy tới hết lùi", () => {
    const r = nextAdsSchedule(
      { pulse: { delayMin: 15, synced: false, rateLimited: "shop" }, history: null, historyRan: false, backoffLevel: 0 },
      now,
      noJitter
    );
    expect(r.adsBackoffLevel).toBe(1);
    expect(r.adsBackoffUntil?.getTime()).toBe(now + 15 * MIN);
    expect(r.nextAdsPulseAt?.getTime()).toBe(now + 15 * MIN);
    expect(r.lastAdsSyncAt).toBeUndefined();
  });
  it("LÁT 2: lần 429 thứ hai liên tiếp (bậc 1) → lùi 30', bậc 2; hạn xung không ngắn hơn hạn lùi", () => {
    const r = nextAdsSchedule(
      { pulse: { delayMin: 15, synced: false, rateLimited: "shop" }, history: null, historyRan: false, backoffLevel: 1 },
      now,
      noJitter
    );
    expect(r.adsBackoffLevel).toBe(2);
    expect(r.adsBackoffUntil?.getTime()).toBe(now + 30 * MIN);
    expect(r.nextAdsPulseAt?.getTime()).toBe(now + 30 * MIN);
  });
  it("LÁT 2: lịch sử dính 429 tầng shop (xung OK) → vẫn lùi riêng; hạn xung = max(hạn xung thường, hết lùi)", () => {
    const r = nextAdsSchedule(
      {
        pulse: { delayMin: 120, synced: true },
        history: { synced: false, rateLimited: "shop" },
        historyRan: true,
        backoffLevel: 0,
      },
      now,
      noJitter
    );
    expect(r.adsBackoffLevel).toBe(1);
    expect(r.adsBackoffUntil?.getTime()).toBe(now + 15 * MIN);
    expect(r.nextAdsPulseAt?.getTime()).toBe(now + 120 * MIN);
    expect(r.nextAdsSyncAt?.getTime()).toBe(now + ADS_CADENCE.FULL_HOURS * 3_600_000);
    expect(r.lastAdsSyncAt?.getTime()).toBe(now); // xung vẫn kéo được số
  });
  it("LÁT 2: gian đang bậc 2 mà lượt này kéo được số, không bị chặn → bậc về 0, hết lùi", () => {
    const r = nextAdsSchedule(
      { pulse: { delayMin: 30, synced: true }, history: null, historyRan: false, backoffLevel: 2 },
      now,
      noJitter
    );
    expect(r.adsBackoffLevel).toBe(0);
    expect(r.adsBackoffUntil).toBeNull();
    expect(r.nextAdsPulseAt?.getTime()).toBe(now + 30 * MIN);
  });
  it("LÁT 2: gian đang lùi mà lượt này không kéo được số cũng không bị chặn (lỗi khác) → giữ nguyên bậc", () => {
    const r = nextAdsSchedule(
      { pulse: { delayMin: 120, synced: false }, history: null, historyRan: false, backoffLevel: 2 },
      now,
      noJitter
    );
    expect(r.adsBackoffLevel).toBeUndefined();
    expect(r.adsBackoffUntil).toBeUndefined();
  });
  it("luôn nhả vé adsLockedAt", () => {
    expect(nextAdsSchedule({ pulse: null, history: null, historyRan: false }, now, noJitter)).toEqual({ adsLockedAt: null });
  });
});

describe("config lát 1 + 2 (bảng 13.4 — số tự chọn, đọc env)", () => {
  it("mặc định: làn bật, 2 luồng, vé mồ côi 30 phút, tỷ lệ bão 0,2, lùi gian 15'→120', giãn lệnh tắt", () => {
    expect(ADS_CADENCE.LANE).toBe(true);
    expect(ADS_CADENCE.CONCURRENCY).toBe(2);
    expect(ADS_CADENCE.LOCK_STALE_MIN).toBe(30);
    expect(ADS_CADENCE.STORM_RATIO).toBe(0.2);
    expect(ADS_CADENCE.SHOP_BACKOFF_MIN).toBe(15);
    expect(ADS_CADENCE.SHOP_BACKOFF_MAX_MIN).toBe(120);
    expect(ADS_CADENCE.SHOP_CALL_GAP_SEC).toBe(0);
  });
});
