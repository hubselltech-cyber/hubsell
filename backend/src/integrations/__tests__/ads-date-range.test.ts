// ============================================================
// TEST KHOẢNG NGÀY BỘ LỌC TRỢ LÝ QUẢNG CÁO (24/09/2026) — logic thuần, KHÔNG DB.
//
// resolveAdsDateRange đọc ?from=&to= của bộ lọc chuẩn (ưu tiên) hoặc ?days=
// (đường cũ) và chuẩn hóa: đảo nếu chọn ngược, cắt về hôm nay nếu chọn tương
// lai, kéo ngày đầu lên nếu vượt trần ADS_RANGE_MAX_DAYS (báo clamped).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  ADS_RANGE_MAX_DAYS,
  dateKeyToDbDate,
  resolveAdsDateRange,
  shiftDateKey,
} from "../shopee/ads-insights";

const TODAY = "2026-09-24";

describe("resolveAdsDateRange — bộ lọc from/to", () => {
  it("khoảng hợp lệ giữ nguyên, days tính cả hai đầu", () => {
    const r = resolveAdsDateRange({ from: "2026-09-01", to: "2026-09-15" }, TODAY);
    expect(r).toEqual({ fromKey: "2026-09-01", toKey: "2026-09-15", days: 15, clamped: false });
  });

  it("một ngày (Hôm nay / Hôm qua) → days = 1", () => {
    const r = resolveAdsDateRange({ from: TODAY, to: TODAY }, TODAY);
    expect(r.days).toBe(1);
    expect(r.fromKey).toBe(TODAY);
  });

  it("chọn ngược thì tự đảo lại thay vì trả rỗng", () => {
    const r = resolveAdsDateRange({ from: "2026-09-15", to: "2026-09-01" }, TODAY);
    expect(r.fromKey).toBe("2026-09-01");
    expect(r.toKey).toBe("2026-09-15");
  });

  it("ngày cuối ở tương lai bị cắt về hôm nay", () => {
    const r = resolveAdsDateRange({ from: "2026-09-20", to: "2026-10-05" }, TODAY);
    expect(r.toKey).toBe(TODAY);
    expect(r.days).toBe(5);
    expect(r.clamped).toBe(false);
  });

  it("cả khoảng ở tương lai → co về đúng hôm nay", () => {
    const r = resolveAdsDateRange({ from: "2026-10-01", to: "2026-10-05" }, TODAY);
    expect(r).toMatchObject({ fromKey: TODAY, toKey: TODAY, days: 1 });
  });

  it("vượt trần thì kéo ngày đầu lên và báo clamped", () => {
    const r = resolveAdsDateRange({ from: "2026-01-01", to: TODAY }, TODAY);
    expect(r.clamped).toBe(true);
    expect(r.days).toBe(ADS_RANGE_MAX_DAYS);
    expect(r.fromKey).toBe(shiftDateKey(TODAY, -(ADS_RANGE_MAX_DAYS - 1)));
    expect(r.toKey).toBe(TODAY);
  });

  it("Tháng trước (61 ngày kể từ hôm nay) nằm trong trần → không clamp", () => {
    const r = resolveAdsDateRange({ from: "2026-08-01", to: "2026-08-31" }, TODAY);
    expect(r).toEqual({ fromKey: "2026-08-01", toKey: "2026-08-31", days: 31, clamped: false });
  });

  it("from/to sai định dạng hoặc ngày không tồn tại → rơi về ?days", () => {
    expect(resolveAdsDateRange({ from: "01/09/2026", to: TODAY, days: 3 }, TODAY)).toEqual({
      fromKey: "2026-09-22",
      toKey: TODAY,
      days: 3,
      clamped: false,
    });
    expect(resolveAdsDateRange({ from: "2026-02-31", to: TODAY, days: 3 }, TODAY).days).toBe(3);
    expect(resolveAdsDateRange({ from: TODAY }, TODAY).days).toBe(7);
  });
});

describe("resolveAdsDateRange — đường cũ ?days", () => {
  it("không có gì → 7 ngày kết thúc hôm nay", () => {
    expect(resolveAdsDateRange({}, TODAY)).toEqual({
      fromKey: "2026-09-18",
      toKey: TODAY,
      days: 7,
      clamped: false,
    });
  });

  it("days=1 → hôm nay; days quá trần → trần; days rác → 7", () => {
    expect(resolveAdsDateRange({ days: "1" }, TODAY).fromKey).toBe(TODAY);
    expect(resolveAdsDateRange({ days: 999 }, TODAY).days).toBe(ADS_RANGE_MAX_DAYS);
    expect(resolveAdsDateRange({ days: "abc" }, TODAY).days).toBe(7);
    expect(resolveAdsDateRange({ days: 0 }, TODAY).days).toBe(1);
  });
});

describe("dateKeyToDbDate / shiftDateKey", () => {
  it("ngày sàn → 00:00 UTC đúng cách cột @db.Date lưu", () => {
    expect(dateKeyToDbDate("2026-09-24").toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("dời qua ranh giới tháng/năm", () => {
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateKey("2026-02-28", 1)).toBe("2026-03-01");
  });
});
