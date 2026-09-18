import { describe, expect, it } from "vitest";
import {
  buildVideoActionReasons,
  parseVideoActionReasons,
  videoActionNote,
} from "../tiktok-ads/action-log";
import { reconcileSendingCommand, soakCheckExclude } from "../tiktok-ads/send-command";
import { GMV_MAX_MAX_RANGE_DAYS, GMV_MAX_OUTSIDE_VIDEO_STATUSES, clampGmvMaxRange, tallyVideoStatuses } from "../tiktok-ads/report";

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

describe("tallyVideoStatuses — đếm video NGOÀI bảng soi theo trạng thái sàn", () => {
  it("gom theo trạng thái, bỏ thẻ sản phẩm (-1), giữ thứ tự ưu tiên; trạng thái lạ xếp cuối", () => {
    const rows = [
      { videoId: "1", deliveryStatus: "NOT_ACTIVE", cost: 100 },
      { videoId: "2", deliveryStatus: "NOT_DELIVERYING", cost: 6_000 },
      { videoId: "3", deliveryStatus: "NOT_DELIVERYING", cost: 179 },
      { videoId: "-1", deliveryStatus: "NOT_ACTIVE", cost: 999 },
      { videoId: "4", deliveryStatus: "AUTHORIZATION_NEEDED", cost: 0 },
      { videoId: "5", deliveryStatus: "LA_LUNG", cost: 0 },
    ];
    expect(tallyVideoStatuses(rows, GMV_MAX_OUTSIDE_VIDEO_STATUSES)).toEqual([
      { status: "NOT_DELIVERYING", videos: 2, cost: 6_179 },
      { status: "AUTHORIZATION_NEEDED", videos: 1, cost: 0 },
      { status: "NOT_ACTIVE", videos: 1, cost: 100 },
      { status: "LA_LUNG", videos: 1, cost: 0 },
    ]);
  });
});

// A3 — dòng sổ kẹt "đang gửi" được chốt theo trạng thái THẬT của video trên TikTok, không đoán.
describe("reconcileSendingCommand — chốt dòng sổ kẹt SENDING", () => {
  const live = new Set(["a", "b"]); // video sàn đang phân phối / học / chờ thử

  it("lệnh LOẠI: video không còn trong nhóm đang phân phối → đã loại đủ", () => {
    const r = reconcileSendingCommand("exclude_video", ["x", "y"], live);
    expect(r.status).toBe("SUCCESS");
    expect(r.note).toContain("ĐÃ loại đủ 2 video");
  });
  it("lệnh LOẠI: mọi video vẫn đang phân phối → chưa loại được, chốt FAILED để lượt sau chấm lại", () => {
    const r = reconcileSendingCommand("exclude_video", ["a", "b"], live);
    expect(r.status).toBe("FAILED");
    expect(r.note).toContain("CHƯA loại video nào");
  });
  it("lệnh LOẠI: sàn áp dụng một phần → SUCCESS kèm số đã áp dụng", () => {
    const r = reconcileSendingCommand("exclude_video", ["a", "x", "y"], live);
    expect(r.status).toBe("SUCCESS");
    expect(r.note).toContain("2/3 video");
  });
  it("lệnh KHÔI PHỤC thì ngược lại: video CÓ trong nhóm đang phân phối mới là đã khôi phục", () => {
    expect(reconcileSendingCommand("restore_video", ["a"], live).status).toBe("SUCCESS");
    const r = reconcileSendingCommand("restore_video", ["x"], live);
    expect(r.status).toBe("FAILED");
    expect(r.note).toContain("CHƯA khôi phục");
  });
});

// B7 — sàn trả OK cho cả lệnh chứ không trả từng video → lượt chấm hôm sau soi lại lệnh loại đã SUCCESS.
describe("soakCheckExclude — lệnh loại đã ngấm chưa", () => {
  const live = new Set(["a", "b"]);
  it("mọi video của lệnh đã rời nhóm đang phân phối → ngấm đủ, không báo gì", () => {
    const r = soakCheckExclude(["x", "y"], live, new Set(), "2026-09-19");
    expect(r.notApplied).toEqual([]);
    expect(r.note).toContain("Kiểm lại 19/09");
    expect(r.note).toContain("đủ 2 video");
  });
  it("video vẫn đang phân phối → nêu đúng mã video không ngấm", () => {
    const r = soakCheckExclude(["a", "x", "b"], live, new Set(), "2026-09-19");
    expect(r.notApplied).toEqual(["a", "b"]);
    expect(r.note).toContain("2/3 video VẪN đang được TikTok phân phối");
    expect(r.note).toContain("#a #b");
  });
  it("video chủ shop đã khôi phục lại trên Hubsell sau lệnh → đang phân phối là ĐÚNG, không báo nhầm", () => {
    const r = soakCheckExclude(["a", "x"], live, new Set(["a"]), "2026-09-19");
    expect(r.notApplied).toEqual([]);
    expect(r.note).toContain("đủ 1 video");
    expect(r.note).toContain("1 video đã được khôi phục lại trên Hubsell");
  });
});
