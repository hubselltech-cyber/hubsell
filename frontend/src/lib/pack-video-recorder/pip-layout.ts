// ============================================================
// Ô CẬN CẢNH (hình trong hình) — phần tính toán THUẦN: ô nằm ở đâu trong khung video, lấy vùng nào của camera cận.
//
// Anh Trung 19/11/2026: thêm camera cận cảnh soi tờ vận đơn, ghép vào một góc video toàn cảnh; "vị trí ghép… khách
// hàng được phép di chuyển cài đặt 1 lần cho phù hợp với góc quay"; là TÙY CHỌN, bình thường vẫn một camera; camera
// cận KHÔNG có chức năng ngắt video (docs/VIDEO-DONG-HANG-THIET-KE.md mục 22).
//
// MỘT nguồn tính cho cả hai nơi: tệp quay (StampCanvas) và khung xem trước (closeup-overlay.tsx) — bài học 18/11:
// thêm gì vào TỆP thì màn xem trực tiếp phải hiện y hệt. Mọi số là TỶ LỆ của khung video (0–1) nên không phụ thuộc
// khổ hình camera hay cỡ màn hình.
// ============================================================

/** Vị trí góc trái trên (x, y), bề ngang, bề cao của ô — tỷ lệ so với khung video; `zoom` = phóng to quanh tâm. */
export interface PipSettings {
  x: number;
  y: number;
  w: number;
  h: number;
  zoom: number;
}

export type PipCorner = "nw" | "ne" | "sw" | "se";

/**
 * Giới hạn cỡ ô và mức phóng to — SỐ TỰ CHỌN, chưa có số đo (lát đo C0 mục 22.5 chưa chạy): ô nhỏ nhất còn nhìn ra
 * tờ tem, ô lớn nhất chưa che quá nửa cảnh đóng hàng; phóng to 4 lần là mức camera 1080p còn ≥ 1 điểm ảnh gốc cho
 * mỗi điểm ảnh của ô cỡ mặc định.
 */
export const PIP_LIMITS = { minW: 0.12, maxW: 0.5, minH: 0.15, maxH: 0.6, minZoom: 1, maxZoom: 4 } as const;

/** Mặc định: góc PHẢI DƯỚI (chỗ anh Trung vẽ 19/11), cách mép một khe nhỏ. */
export const PIP_DEFAULT: PipSettings = { x: 0.785, y: 0.655, w: 0.2, h: 0.32, zoom: 1 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Đưa mọi số về vùng hợp lệ: ô luôn nằm TRỌN trong khung. Nhận cả dữ liệu lạ đọc từ localStorage. */
export function clampPip(raw: Partial<PipSettings> | null | undefined): PipSettings {
  const w = clamp(num(raw?.w, PIP_DEFAULT.w), PIP_LIMITS.minW, PIP_LIMITS.maxW);
  const h = clamp(num(raw?.h, PIP_DEFAULT.h), PIP_LIMITS.minH, PIP_LIMITS.maxH);
  return {
    w,
    h,
    x: clamp(num(raw?.x, PIP_DEFAULT.x), 0, 1 - w),
    y: clamp(num(raw?.y, PIP_DEFAULT.y), 0, 1 - h),
    zoom: clamp(num(raw?.zoom, PIP_DEFAULT.zoom), PIP_LIMITS.minZoom, PIP_LIMITS.maxZoom),
  };
}

/** Kéo cả ô đi (dx, dy là tỷ lệ khung) — cỡ giữ nguyên, không ra ngoài khung. */
export function movePip(s: PipSettings, dx: number, dy: number): PipSettings {
  return clampPip({ ...s, x: s.x + dx, y: s.y + dy });
}

/** Kéo MỘT góc của ô: góc đối diện đứng yên, cỡ nằm trong giới hạn, không ra ngoài khung. */
export function resizePip(s: PipSettings, corner: PipCorner, dx: number, dy: number): PipSettings {
  let left = s.x;
  let right = s.x + s.w;
  let top = s.y;
  let bottom = s.y + s.h;
  if (corner === "nw" || corner === "sw") {
    left = clamp(left + dx, Math.max(0, right - PIP_LIMITS.maxW), right - PIP_LIMITS.minW);
  } else {
    right = clamp(right + dx, left + PIP_LIMITS.minW, Math.min(1, left + PIP_LIMITS.maxW));
  }
  if (corner === "nw" || corner === "ne") {
    top = clamp(top + dy, Math.max(0, bottom - PIP_LIMITS.maxH), bottom - PIP_LIMITS.minH);
  } else {
    bottom = clamp(bottom + dy, top + PIP_LIMITS.minH, Math.min(1, top + PIP_LIMITS.maxH));
  }
  return clampPip({ ...s, x: left, y: top, w: right - left, h: bottom - top });
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ô tính ra điểm ảnh của khung video (số nguyên — vẽ không bị nhòe mép). */
export function pipRect(s: PipSettings, frame: { width: number; height: number }): PixelRect {
  const w = Math.max(2, Math.round(s.w * frame.width));
  const h = Math.max(2, Math.round(s.h * frame.height));
  return {
    w,
    h,
    x: clamp(Math.round(s.x * frame.width), 0, Math.max(0, frame.width - w)),
    y: clamp(Math.round(s.y * frame.height), 0, Math.max(0, frame.height - h)),
  };
}

/**
 * Vùng của hình camera cận được đưa vào ô: lấy phần GIỮA, đúng tỷ lệ của ô (không méo hình), rồi thu hẹp theo
 * `zoom`. Tương đương `object-fit: cover` + `transform: scale(zoom)` của khung xem trước.
 */
export function pipSourceCrop(
  s: PipSettings,
  frame: { width: number; height: number },
  source: { width: number; height: number }
): { sx: number; sy: number; sw: number; sh: number } {
  const box = pipRect(s, frame);
  const boxAspect = box.w / box.h;
  const sourceAspect = source.width / source.height;
  let sw = source.width;
  let sh = source.height;
  if (sourceAspect > boxAspect) sw = source.height * boxAspect;
  else sh = source.width / boxAspect;
  const zoom = clamp(s.zoom, PIP_LIMITS.minZoom, PIP_LIMITS.maxZoom);
  sw /= zoom;
  sh /= zoom;
  return { sx: (source.width - sw) / 2, sy: (source.height - sh) / 2, sw, sh };
}

/**
 * Phần khung XEM TRƯỚC mà hình camera chính thật sự chiếm (thẻ <video> hiện kiểu "contain" trong khung 16:9: camera
 * 4:3 thì có hai dải đen hai bên). Ô cận cảnh phải đặt theo phần này thì mới trùng với tệp quay. Trả tỷ lệ 0–1.
 */
export function pictureArea(
  camera: { width: number; height: number } | null,
  containerAspect: number = 16 / 9
): { left: number; top: number; width: number; height: number } {
  if (!camera || camera.width <= 0 || camera.height <= 0) return { left: 0, top: 0, width: 1, height: 1 };
  const aspect = camera.width / camera.height;
  if (aspect >= containerAspect) {
    const height = containerAspect / aspect;
    return { left: 0, top: (1 - height) / 2, width: 1, height };
  }
  const width = aspect / containerAspect;
  return { left: (1 - width) / 2, top: 0, width, height: 1 };
}
