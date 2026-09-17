import { describe, expect, it } from "vitest";
import {
  buildVideoActionReasons,
  parseVideoActionReasons,
  videoActionNote,
} from "../tiktok-ads/action-log";
import { GMV_MAX_MAX_RANGE_DAYS, clampGmvMaxRange } from "../tiktok-ads/report";

describe("clampGmvMaxRange — khoảng ngày của trang soi video", () => {
  const today = "2026-09-17";

  it("không có from/to → lùi fallbackDays ngày, tính cả hôm nay", () => {
    expect(clampGmvMaxRange({ fallbackDays: 7 }, today)).toEqual({ startDate: "2026-09-11", endDate: today });
    expect(clampGmvMaxRange({ fallbackDays: 1 }, today)).toEqual({ startDate: today, endDate: today });
  });

  it("from/to hợp lệ thì giữ nguyên (vd Tháng trước)", () => {
    expect(clampGmvMaxRange({ from: "2026-08-01", to: "2026-08-31", fallbackDays: 7 }, today)).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
  });

  it("to vượt hôm nay → kẹp về hôm nay; from sau to → kéo về to", () => {
    expect(clampGmvMaxRange({ from: "2026-09-10", to: "2026-12-31", fallbackDays: 7 }, today)).toEqual({
      startDate: "2026-09-10",
      endDate: today,
    });
    expect(clampGmvMaxRange({ from: "2026-09-20", to: "2026-09-15", fallbackDays: 7 }, today)).toEqual({
      startDate: "2026-09-15",
      endDate: "2026-09-15",
    });
  });

  it("dài quá trần → cắt from cho vừa đúng trần ngày", () => {
    const r = clampGmvMaxRange({ from: "2020-01-01", to: today, fallbackDays: 7 }, today);
    const span = (Date.parse(`${r.endDate}T00:00:00Z`) - Date.parse(`${r.startDate}T00:00:00Z`)) / 86_400_000 + 1;
    expect(span).toBe(GMV_MAX_MAX_RANGE_DAYS);
  });

  it("định dạng sai (hoặc không phải chuỗi) → coi như không có, dùng fallback", () => {
    expect(clampGmvMaxRange({ from: "17/09/2026", to: today, fallbackDays: 3 }, today)).toEqual({
      startDate: "2026-09-15",
      endDate: today,
    });
    expect(clampGmvMaxRange({ from: ["2026-09-01"], to: 5, fallbackDays: 0 }, today)).toEqual({
      startDate: today,
      endDate: today,
    });
  });
});

describe("sổ thao tác video — ghi rồi đọc lại phải tròn", () => {
  it("lệnh thủ công: chỉ có dòng video, không có căn cứ", () => {
    const reasons = buildVideoActionReasons([
      { videoId: "7678267749268933895", note: videoActionNote(90377, 0) },
      { videoId: "7682014661016931602", note: videoActionNote(41787.4, 2) },
    ]);
    expect(reasons.split("\n")).toHaveLength(2);
    expect(parseVideoActionReasons(reasons)).toEqual({
      videos: [
        { videoId: "7678267749268933895", note: "chi 90.377đ · 0 đơn" },
        { videoId: "7682014661016931602", note: "chi 41.787đ · 2 đơn" },
      ],
      grounds: [],
    });
  });

  it("lệnh tự động: căn cứ đứng trước, tách riêng khỏi danh sách video", () => {
    const reasons = buildVideoActionReasons(
      [{ videoId: "7683684766759062791", note: "chi 312.000đ · 0 đơn" }],
      ["Tiêu 312.000đ trong 7 ngày mà 0 đơn (ngưỡng 300.000đ)"]
    );
    const parsed = parseVideoActionReasons(reasons);
    expect(parsed.grounds).toEqual(["Tiêu 312.000đ trong 7 ngày mà 0 đơn (ngưỡng 300.000đ)"]);
    expect(parsed.videos.map((v) => v.videoId)).toEqual(["7683684766759062791"]);
  });

  it("căn cứ lỡ mở đầu bằng # không bị đọc nhầm thành video", () => {
    const parsed = parseVideoActionReasons(buildVideoActionReasons([{ videoId: "123456789012345678", note: "" }], ["#1 video tệ nhất"]));
    expect(parsed.videos).toEqual([{ videoId: "123456789012345678", note: "" }]);
    expect(parsed.grounds).toEqual(["1 video tệ nhất"]);
  });

  it("đọc được dòng kiểu cũ đã ghi trên prod (#id · ghi chú) và bỏ qua dòng trống", () => {
    expect(parseVideoActionReasons("#7678267749268933895 · chi 90.377đ · 0 đơn\n\n").videos).toEqual([
      { videoId: "7678267749268933895", note: "chi 90.377đ · 0 đơn" },
    ]);
  });
});
