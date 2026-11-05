// Kế hoạch lượt kéo danh mục: toàn bộ hay tăng dần — phần thuần (lát 3.9 GĐ3, 05/11/2026).
import { describe, expect, it } from "vitest";
import {
  CATALOG_OVERLAP_MS,
  FULL_SYNC_DAYS_DEFAULT,
  fullSyncIntervalMs,
  incrementalSettingFor,
  nextCatalogMarks,
  planCatalogSync,
  type CatalogPlanInput,
} from "../catalog-sync-plan";

const DAY = 24 * 3600_000;
const NOW = new Date("2026-11-05T13:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const base: CatalogPlanInput = {
  channelId: "gian-1",
  supportsIncremental: true,
  setting: "on",
  watermark: ago(DAY),
  fullSyncAt: ago(2 * DAY),
  requested: false,
  now: NOW,
  fullIntervalMs: 7 * DAY,
};

describe("planCatalogSync", () => {
  it("gian mới nối / thiếu mốc → kéo toàn bộ, không đo đối chiếu", () => {
    for (const patch of [{ watermark: null }, { fullSyncAt: null }, { watermark: null, fullSyncAt: null }]) {
      expect(planCatalogSync({ ...base, ...patch })).toEqual({ mode: "full", reason: "chua-co-moc", shadowSince: null });
    }
  });

  it("mốc nằm ở tương lai coi như không có mốc", () => {
    const p = planCatalogSync({ ...base, watermark: new Date(NOW.getTime() + 60_000) });
    expect(p).toMatchObject({ mode: "full", reason: "chua-co-moc" });
  });

  it("adapter không đọc tăng dần được (mock) → luôn toàn bộ, dù cờ on", () => {
    expect(planCatalogSync({ ...base, supportsIncremental: false })).toEqual({
      mode: "full",
      reason: "khong-ho-tro",
      shadowSince: null,
    });
  });

  it("cờ off → toàn bộ, không đo; cờ shadow → toàn bộ + đo từ (mốc − chồng lấn)", () => {
    expect(planCatalogSync({ ...base, setting: "off" })).toEqual({ mode: "full", reason: "tat", shadowSince: null });
    const p = planCatalogSync({ ...base, setting: "shadow" });
    expect(p).toEqual({
      mode: "full",
      reason: "chay-bong",
      shadowSince: new Date(base.watermark!.getTime() - CATALOG_OVERLAP_MS),
    });
  });

  it("cờ on, có mốc, chưa đến hạn toàn bộ → tăng dần từ (mốc − chồng lấn)", () => {
    expect(planCatalogSync(base)).toEqual({
      mode: "incremental",
      since: new Date(base.watermark!.getTime() - CATALOG_OVERLAP_MS),
    });
  });

  it("lượt đêm đến hạn → toàn bộ (kèm đo đối chiếu); nút bấm cùng lúc đó vẫn tăng dần", () => {
    const due = { ...base, fullSyncAt: ago(7 * DAY) };
    expect(planCatalogSync(due)).toMatchObject({ mode: "full", reason: "den-han-toan-bo" });
    expect(planCatalogSync(due).mode === "full" && planCatalogSync(due)).toMatchObject({
      shadowSince: new Date(base.watermark!.getTime() - CATALOG_OVERLAP_MS),
    });
    expect(planCatalogSync({ ...due, requested: true })).toMatchObject({ mode: "incremental" });
  });

  it("nút bấm chỉ bị ép toàn bộ khi đã quá 2 nhịp không có lượt toàn bộ nào", () => {
    expect(planCatalogSync({ ...base, requested: true, fullSyncAt: ago(14 * DAY - 1000) }).mode).toBe("incremental");
    expect(planCatalogSync({ ...base, requested: true, fullSyncAt: ago(14 * DAY) })).toMatchObject({
      mode: "full",
      reason: "den-han-toan-bo",
    });
  });
});

describe("nextCatalogMarks — mốc chỉ tiến khi lượt đọc đủ", () => {
  const startedAt = new Date("2026-11-05T12:00:00Z");
  it("toàn bộ đủ → tiến cả mốc nước lẫn mốc toàn bộ, về giờ BẮT ĐẦU lượt", () => {
    expect(nextCatalogMarks({ mode: "full", complete: true, startedAt })).toEqual({
      productSyncWatermark: startedAt,
      productFullSyncAt: startedAt,
    });
  });
  it("tăng dần đủ → chỉ tiến mốc nước (không được coi là lượt toàn bộ)", () => {
    expect(nextCatalogMarks({ mode: "incremental", complete: true, startedAt })).toEqual({
      productSyncWatermark: startedAt,
    });
  });
  it("đọc chưa đủ → không ghi mốc nào, lượt sau đọc lại từ mốc cũ", () => {
    expect(nextCatalogMarks({ mode: "full", complete: false, startedAt })).toEqual({});
    expect(nextCatalogMarks({ mode: "incremental", complete: false, startedAt })).toEqual({});
  });
});

describe("cờ mở dần + nhịp kéo toàn bộ", () => {
  it("mặc định chạy bóng; on/off theo env; danh sách gian thắng cờ chung", () => {
    expect(incrementalSettingFor("a", {})).toBe("shadow");
    expect(incrementalSettingFor("a", { PRODUCT_SYNC_INCREMENTAL: "ON" })).toBe("on");
    expect(incrementalSettingFor("a", { PRODUCT_SYNC_INCREMENTAL: "off" })).toBe("off");
    expect(incrementalSettingFor("a", { PRODUCT_SYNC_INCREMENTAL: "gi-do" })).toBe("shadow");
    const env = { PRODUCT_SYNC_INCREMENTAL: "off", PRODUCT_SYNC_INCREMENTAL_CHANNELS: "x, a ,y" };
    expect(incrementalSettingFor("a", env)).toBe("on");
    expect(incrementalSettingFor("b", env)).toBe("off");
  });

  it("nhịp toàn bộ 7 ngày + rải 0–2 ngày, ổn định theo id gian, chỉnh được bằng env", () => {
    const a = fullSyncIntervalMs("cmw03dkk0001", {});
    expect(a).toBe(fullSyncIntervalMs("cmw03dkk0001", {}));
    expect(a).toBeGreaterThanOrEqual(FULL_SYNC_DAYS_DEFAULT * DAY);
    expect(a).toBeLessThan((FULL_SYNC_DAYS_DEFAULT + 2) * DAY);
    const spread = new Set(Array.from({ length: 50 }, (_, i) => Math.floor(fullSyncIntervalMs(`gian-${i}`, {}) / (6 * 3600_000))));
    expect(spread.size).toBeGreaterThan(3);
    const b = fullSyncIntervalMs("cmw03dkk0001", { PRODUCT_FULL_SYNC_DAYS: "3" });
    expect(b).toBeGreaterThanOrEqual(3 * DAY);
    expect(b).toBeLessThan(5 * DAY);
    expect(fullSyncIntervalMs("x", { PRODUCT_FULL_SYNC_DAYS: "0" })).toBeGreaterThanOrEqual(7 * DAY);
  });
});
