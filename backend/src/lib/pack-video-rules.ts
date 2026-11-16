// ============================================================
// VIDEO ĐÓNG HÀNG — luật thuần (không gọi DB, không gọi mạng)
//  · kiểm dữ liệu app báo lúc "đã quay xong";
//  · chia tệp thành mảnh;
//  · kiểm chéo thời lượng ↔ cỡ tệp (rào D7);
//  · chuyển trạng thái hợp lệ của một dòng sổ.
// ============================================================

import {
  PACK_VIDEO_DURATION_TOLERANCE,
  PACK_VIDEO_MAX_DURATION_SEC,
  PACK_VIDEO_MAX_SIZE_BYTES,
  PACK_VIDEO_MULTIPART_THRESHOLD_BYTES,
  PACK_VIDEO_PART_SIZE_BYTES,
  PACK_VIDEO_SIZE_BASE_BYTES,
  PACK_VIDEO_SIZE_BYTES_PER_MIN,
} from "../config/pack-video";

export const PACK_VIDEO_KINDS = ["PACK", "UNBOX"] as const;
export type PackVideoKind = (typeof PACK_VIDEO_KINDS)[number];

export const PACK_VIDEO_STATUSES = ["PENDING", "STORED", "DELETED", "LOST"] as const;
export type PackVideoStatus = (typeof PACK_VIDEO_STATUSES)[number];

/** Chuyển trạng thái được phép. PENDING → PENDING không có ở đây: gọi lại chỉ ký lại, không ghi. */
const TRANSITIONS: Record<PackVideoStatus, readonly PackVideoStatus[]> = {
  PENDING: ["STORED", "LOST"],
  STORED: ["DELETED"],
  DELETED: [],
  LOST: [],
};

export function canTransition(from: PackVideoStatus, to: PackVideoStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface BeginInput {
  clientId: string;
  trackingCode: string;
  kind: PackVideoKind;
  recordedAt: Date;
  durationSec: number;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  deviceName: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function intIn(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

/**
 * Đọc thân `POST /api/pack-videos`. Mọi lỗi trả câu nói được cho người dùng.
 * `now` truyền vào để test được; giờ app báo nằm ở TƯƠNG LAI (đồng hồ điện thoại sai — rào D6)
 * thì lấy giờ máy chủ, không từ chối: khách không sửa được đồng hồ giữa ca đóng hàng.
 */
export function parseBeginInput(body: unknown, now: Date = new Date()): ParseResult<BeginInput> {
  const b = (body ?? {}) as Record<string, unknown>;

  if (typeof b.clientId !== "string" || !CLIENT_ID_RE.test(b.clientId)) {
    return { ok: false, error: "Thiếu clientId hợp lệ (8–64 ký tự chữ, số, gạch)" };
  }
  const trackingCode = typeof b.trackingCode === "string" ? b.trackingCode.trim() : "";
  if (!trackingCode || trackingCode.length > 64 || /\s/.test(trackingCode)) {
    return { ok: false, error: "Mã vận đơn không hợp lệ" };
  }
  if (!PACK_VIDEO_KINDS.includes(b.kind as PackVideoKind)) {
    return { ok: false, error: "Loại video phải là PACK hoặc UNBOX" };
  }
  const recordedRaw = typeof b.recordedAt === "string" ? new Date(b.recordedAt) : null;
  if (!recordedRaw || Number.isNaN(recordedRaw.getTime())) {
    return { ok: false, error: "Thiếu giờ quay (recordedAt)" };
  }
  const durationSec = intIn(b.durationSec, 1, PACK_VIDEO_MAX_DURATION_SEC);
  if (durationSec === null) {
    return {
      ok: false,
      error: `Thời lượng phải từ 1 giây tới ${PACK_VIDEO_MAX_DURATION_SEC / 60} phút`,
    };
  }
  const sizeBytes = intIn(b.sizeBytes, 1, PACK_VIDEO_MAX_SIZE_BYTES);
  if (sizeBytes === null) {
    return {
      ok: false,
      error: `Cỡ tệp phải từ 1 byte tới ${Math.round(PACK_VIDEO_MAX_SIZE_BYTES / 1024 / 1024)} MB`,
    };
  }
  const width = b.width == null ? null : intIn(b.width, 1, 8192);
  const height = b.height == null ? null : intIn(b.height, 1, 8192);
  if ((b.width != null && width === null) || (b.height != null && height === null)) {
    return { ok: false, error: "Khổ hình không hợp lệ" };
  }
  const deviceName =
    typeof b.deviceName === "string" && b.deviceName.trim() ? b.deviceName.trim().slice(0, 80) : null;

  const recordedAt = recordedRaw.getTime() > now.getTime() ? now : recordedRaw;
  return {
    ok: true,
    value: {
      clientId: b.clientId,
      trackingCode,
      kind: b.kind as PackVideoKind,
      recordedAt,
      durationSec,
      sizeBytes,
      width,
      height,
      deviceName,
    },
  };
}

/** Tệp này tải một lần hay theo mảnh. */
export function uploadModeFor(sizeBytes: number): "single" | "multipart" {
  return sizeBytes > PACK_VIDEO_MULTIPART_THRESHOLD_BYTES ? "multipart" : "single";
}

export interface PartPlan {
  partNumber: number;
  /** Cỡ ĐÚNG của mảnh — được ký vào đường dẫn, tải cỡ khác là kho từ chối. */
  size: number;
}

/** Chia tệp thành mảnh: mọi mảnh bằng nhau trừ mảnh cuối. */
export function planParts(sizeBytes: number, partSize: number = PACK_VIDEO_PART_SIZE_BYTES): PartPlan[] {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new Error("sizeBytes phải là số nguyên dương");
  const total = Math.ceil(sizeBytes / partSize);
  const parts: PartPlan[] = [];
  for (let n = 1; n <= total; n++) {
    parts.push({ partNumber: n, size: n < total ? partSize : sizeBytes - partSize * (total - 1) });
  }
  return parts;
}

/** Cỡ tệp DỰ KIẾN cho một thời lượng, theo số đo 720p · 800k · 15 khung/giây. */
export function expectedSizeBytes(durationSec: number): number {
  return PACK_VIDEO_SIZE_BASE_BYTES + (durationSec / 60) * PACK_VIDEO_SIZE_BYTES_PER_MIN;
}

/**
 * true = thời lượng và cỡ tệp LỆCH nhau quá biên → gắn cờ để người xem lại.
 * Chỉ gắn cờ; không từ chối, không tính tiền theo cờ (biên là số tự chọn).
 */
export function durationLooksOff(durationSec: number, sizeBytes: number): boolean {
  const expected = expectedSizeBytes(durationSec);
  return Math.abs(sizeBytes - expected) / expected > PACK_VIDEO_DURATION_TOLERANCE;
}

/** Thoát ký tự đại diện của LIKE để ô tìm theo tiền tố không bị "%" / "_" lái. */
export function escapeLikePrefix(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}
