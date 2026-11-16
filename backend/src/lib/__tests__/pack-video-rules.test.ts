// Luật thuần của Video đóng hàng: đọc thân yêu cầu, chia mảnh, kiểm chéo thời lượng, chuyển trạng thái.
import { describe, expect, it } from "vitest";
import {
  PACK_VIDEO_MAX_DURATION_SEC,
  PACK_VIDEO_MAX_SIZE_BYTES,
  PACK_VIDEO_MULTIPART_THRESHOLD_BYTES,
  PACK_VIDEO_PART_SIZE_BYTES,
} from "../../config/pack-video";
import {
  canTransition,
  durationLooksOff,
  escapeLikePrefix,
  expectedSizeBytes,
  parseBeginInput,
  planParts,
  uploadModeFor,
} from "../pack-video-rules";

const NOW = new Date("2026-11-16T03:00:00.000Z");
const good = {
  clientId: "client-0001",
  trackingCode: " SPXVN061234567890 ",
  kind: "PACK",
  recordedAt: "2026-11-16T02:50:00.000Z",
  durationSec: 60,
  sizeBytes: 6_500_000,
  width: 768,
  height: 1024,
  deviceName: "  Note8  ",
};

describe("parseBeginInput", () => {
  it("nhận thân hợp lệ, cắt khoảng trắng", () => {
    const r = parseBeginInput(good, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.trackingCode).toBe("SPXVN061234567890");
    expect(r.value.deviceName).toBe("Note8");
    expect(r.value.recordedAt.toISOString()).toBe("2026-11-16T02:50:00.000Z");
  });

  it("giờ quay ở TƯƠNG LAI (đồng hồ điện thoại sai) → lấy giờ máy chủ, không từ chối", () => {
    const r = parseBeginInput({ ...good, recordedAt: "2031-01-01T00:00:00.000Z" }, NOW);
    expect(r.ok && r.value.recordedAt.getTime()).toBe(NOW.getTime());
  });

  it.each([
    ["thiếu clientId", { clientId: undefined }],
    ["clientId quá ngắn", { clientId: "abc" }],
    ["clientId có ký tự lạ", { clientId: "abc/../../def" }],
    ["mã vận đơn rỗng", { trackingCode: "   " }],
    ["mã vận đơn có khoảng trắng giữa", { trackingCode: "SPX 123" }],
    ["mã vận đơn quá dài", { trackingCode: "X".repeat(65) }],
    ["loại lạ", { kind: "OTHER" }],
    ["giờ quay hỏng", { recordedAt: "hôm qua" }],
    ["thời lượng 0", { durationSec: 0 }],
    ["thời lượng lẻ", { durationSec: 1.5 }],
    ["thời lượng vượt trần", { durationSec: PACK_VIDEO_MAX_DURATION_SEC + 1 }],
    ["cỡ tệp 0", { sizeBytes: 0 }],
    ["cỡ tệp là chuỗi", { sizeBytes: "6500000" }],
    ["cỡ tệp vượt trần", { sizeBytes: PACK_VIDEO_MAX_SIZE_BYTES + 1 }],
    ["khổ hình âm", { width: -1 }],
  ])("từ chối: %s", (_name, patch) => {
    expect(parseBeginInput({ ...good, ...patch }, NOW).ok).toBe(false);
  });

  it("khổ hình và tên máy được phép vắng", () => {
    const r = parseBeginInput({ ...good, width: undefined, height: null, deviceName: undefined }, NOW);
    expect(r.ok && [r.value.width, r.value.height, r.value.deviceName]).toEqual([null, null, null]);
  });
});

describe("chia mảnh", () => {
  it("đúng ngưỡng thì tải một lần, hơn một byte thì theo mảnh", () => {
    expect(uploadModeFor(PACK_VIDEO_MULTIPART_THRESHOLD_BYTES)).toBe("single");
    expect(uploadModeFor(PACK_VIDEO_MULTIPART_THRESHOLD_BYTES + 1)).toBe("multipart");
  });

  it("tệp 90.291.111 byte (clip 15 phút đã thử thật) = 11 mảnh, mảnh cuối là phần dư", () => {
    const parts = planParts(90_291_111);
    expect(parts).toHaveLength(11);
    expect(parts.slice(0, 10).every((p) => p.size === PACK_VIDEO_PART_SIZE_BYTES)).toBe(true);
    expect(parts[10].size).toBe(90_291_111 - 10 * PACK_VIDEO_PART_SIZE_BYTES);
    expect(parts.reduce((s, p) => s + p.size, 0)).toBe(90_291_111);
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("tệp chia hết cho cỡ mảnh không sinh mảnh rỗng", () => {
    const parts = planParts(PACK_VIDEO_PART_SIZE_BYTES * 5);
    expect(parts).toHaveLength(5);
    expect(parts[4].size).toBe(PACK_VIDEO_PART_SIZE_BYTES);
  });

  it("tệp ở trần cỡ không vượt 50 mảnh", () => {
    expect(planParts(PACK_VIDEO_MAX_SIZE_BYTES).length).toBeLessThanOrEqual(50);
  });
});

describe("kiểm chéo thời lượng ↔ cỡ tệp", () => {
  it("bốn clip thật quay trên Note8 đều KHÔNG bị gắn cờ", () => {
    // (giây, byte) đo bằng ffprobe 14–15/11/2026.
    for (const [sec, bytes] of [
      [94, 9_870_027],
      [74, 7_889_483],
      [544, 54_879_188],
      [900, 90_291_111],
    ]) {
      expect(durationLooksOff(sec, bytes)).toBe(false);
    }
  });

  it("báo 1 phút cho tệp của 15 phút, hoặc ngược lại → gắn cờ", () => {
    expect(durationLooksOff(60, 90_291_111)).toBe(true);
    expect(durationLooksOff(900, 6_500_000)).toBe(true);
  });

  it("cỡ dự kiến tăng theo thời lượng", () => {
    expect(expectedSizeBytes(120)).toBeGreaterThan(expectedSizeBytes(60));
  });
});

describe("chuyển trạng thái", () => {
  it("chỉ cho PENDING → STORED / LOST và STORED → DELETED", () => {
    expect(canTransition("PENDING", "STORED")).toBe(true);
    expect(canTransition("PENDING", "LOST")).toBe(true);
    expect(canTransition("STORED", "DELETED")).toBe(true);
    expect(canTransition("STORED", "PENDING")).toBe(false);
    expect(canTransition("DELETED", "STORED")).toBe(false);
    expect(canTransition("LOST", "STORED")).toBe(false);
    expect(canTransition("PENDING", "DELETED")).toBe(false);
  });
});

describe("escapeLikePrefix", () => {
  it("thoát % _ và gạch chéo ngược để ô tìm không bị lái", () => {
    expect(escapeLikePrefix("SPX%_1")).toBe("SPX\\%\\_1");
    expect(escapeLikePrefix("a\\b")).toBe("a\\\\b");
    expect(escapeLikePrefix("SPXVN06")).toBe("SPXVN06");
  });
});
