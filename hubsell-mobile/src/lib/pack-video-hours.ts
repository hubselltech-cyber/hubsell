// ============================================================
// SỐ GIỜ QUAY trên app — 20/11/2026; lên bản app thật 26/11/2026.
//
// Anh Trung 20/11: "Còn việc chặn thời gian trên app có chưa? ví dụ khách chưa mua thời gian quay và đã mua thời
// gian quay đã link với web chưa". Sổ giờ nằm ở MÁY CHỦ theo chủ shop (web + app dùng chung một số dư), máy chủ
// đã từ chối mở video mới khi hết giờ (402 OUT_OF_HOURS). Tệp này là lớp BÁO SỚM của app: hiện số giờ còn lại
// và không mở clip mới khi đã hết — để khách khỏi quay xong rồi mới biết video không lên được.
//
// Cùng luật với màn webcam (frontend `remainingLabel` + `clipBlocker`):
//   · chưa có số (đang tải / mất mạng) → CHO quay, máy chủ vẫn là rào thật ở bước tải lên;
//   · số dư ≤ 0 → không mở clip MỚI; clip đang quay vẫn quay nốt (anh chốt 14/11).
// Tệp THUẦN (không nhập react-native / api) để chạy test bằng node:test.
// ============================================================

import { groupVN } from "./format";

export interface PackHours {
  purchasedSeconds: number;
  usedSeconds: number;
  /** Có thể âm: clip quay dở lúc hết giờ vẫn được nhận, phần vượt trừ vào lần mua sau. */
  remainingSeconds: number;
}

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Đọc câu trả lời `GET /api/pack-videos/hours` — chỉ lấy ba số, bỏ sổ giờ + bảng giá (app không bán giờ). */
export function parsePackHours(body: unknown): PackHours {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    purchasedSeconds: int(b.purchasedSeconds),
    usedSeconds: int(b.usedSeconds),
    remainingSeconds: int(b.remainingSeconds),
  };
}

/** "45 giây" · "12 phút" · "3 giờ" · "1.234 giờ 05 phút" — cùng cách viết với web (`formatHoursBalance`). */
export function formatHoursBalance(sec: number): string {
  const s = Math.round(Math.abs(Number.isFinite(sec) ? sec : 0));
  if (s < 60) return `${s} giây`;
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} phút`;
  const hours = `${groupVN(h)} giờ`;
  return m === 0 ? hours : `${hours} ${String(m).padStart(2, "0")} phút`;
}

/** Câu hiện trên màn quay — cùng chữ với web (`remainingLabel`); ⛔ không dùng chữ "quay lố", dùng "Vượt gói". */
export function hoursLabel(hours: PackHours): string {
  if (hours.purchasedSeconds <= 0 && hours.usedSeconds <= 0) return "Chưa mua giờ quay";
  if (hours.remainingSeconds < 0) return `Vượt gói ${formatHoursBalance(hours.remainingSeconds)}`;
  if (hours.remainingSeconds === 0) return "Đã hết giờ quay";
  return `Còn ${formatHoursBalance(hours.remainingSeconds)}`;
}

/** Có phải chặn mở clip MỚI không. Chưa có số (null) thì KHÔNG chặn. */
export function outOfHours(hours: PackHours | null): boolean {
  return hours !== null && hours.remainingSeconds <= 0;
}

/**
 * Một clip của CHÍNH máy này vừa lên hệ thống → trừ ngay vào số đang hiện, không phải hỏi lại máy chủ sau mỗi
 * clip (shop 1.000 đơn / ngày = 1.000 lượt hỏi thừa). Máy chủ ghi `max(1, round(giây))` cho mỗi video nên trừ đúng
 * số đó. Số thật vẫn được hỏi lại theo nhịp `HOURS_RESYNC_MS` (máy khác của cùng shop cũng đang trừ giờ).
 */
export function afterClipStored(hours: PackHours, durationSec: number): PackHours {
  const used = Math.max(1, Math.round(Number.isFinite(durationSec) ? durationSec : 0));
  return {
    purchasedSeconds: hours.purchasedSeconds,
    usedSeconds: hours.usedSeconds + used,
    remainingSeconds: hours.remainingSeconds - used,
  };
}

/** Hỏi lại số thật nhiều nhất mỗi ngần này khi có clip lên xong. Số TỰ CHỌN (web làm mới mỗi 30 giây; app đã tự trừ). */
export const HOURS_RESYNC_MS = 120_000;
/** Đang bị chặn vì hết giờ mà khách vẫn đưa tem vào: hỏi lại nhiều nhất mỗi ngần này (vừa mua giờ xong trên web). Số TỰ CHỌN. */
export const HOURS_BLOCKED_RESYNC_MS = 10_000;

/**
 * Câu báo khi không mở được clip vì hết giờ. KHÔNG có lời mời mua / đường dẫn mua: app iPhone không được dẫn khách
 * ra ngoài để trả tiền (luật thanh toán của Apple) — giờ quay mua trên web.
 */
export const OUT_OF_HOURS_TEXT = "ĐÃ HẾT GIỜ QUAY — không mở video mới";
