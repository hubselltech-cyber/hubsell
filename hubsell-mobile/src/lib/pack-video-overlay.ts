// ============================================================
// CHỮ IN LÊN VIDEO ĐÓNG GÓI (app mobile) — 18/11/2026; lên bản app thật 26/11/2026.
//
// Anh Trung 18/11: "Trước tiên cứ thử đường in thêm mã đơn hàng và mã vận đơn kèm xem sao" — sàn đòi video
// phải THẤY RÕ mã vận đơn, mà tem thật trong hình quá nhỏ (đo ở tài liệu khảo sát mục 64.6). Đảo quyết định
// 14/11 "chỉ cần ngày giờ thôi".
//
// Chữ được in NGAY LÚC QUAY bởi phần gốc của thư viện camera (bản vá HubsellTimestampOverlay.swift), cạnh
// dòng ngày giờ. Màn quay chỉ việc nói cho phần gốc biết in những dòng nào:
//   iPhone  — `Settings.set` của React Native ghi xuống NSUserDefaults, bản vá Swift đọc lại ở mỗi khung hình.
//   Android — CHƯA có đường truyền (bản vá Kotlin mới in ngày giờ) → hàm dưới đây không làm gì.
// Câu chữ nằm ở ĐÂY (JS) nên đổi câu chữ vá được qua OTA, không cần dựng lại app.
// ============================================================

import { Platform, Settings } from "react-native";

/** Khóa NSUserDefaults — PHẢI trùng `HubsellTimestampOverlay.labelKey` trong bản vá Swift. */
const OVERLAY_LABEL_KEY = "hubsellPackOverlayLabel";

/** Phần gốc cắt mỗi dòng ở 44 ký tự; mã dài hơn thế là rác, cắt sẵn ở đây cho hai phía thấy cùng một chuỗi. */
const MAX_CODE_CHARS = 30;

const clean = (v: string) => v.replace(/\s+/g, "").slice(0, MAX_CODE_CHARS);

/** Các dòng in dưới ngày giờ: mã vận đơn luôn có; mã đơn hàng có khi máy chủ đã khớp ra đơn. */
export function overlayLines(trackingCode: string, orderCode: string | null): string[] {
  const lines = [`Mã vận đơn: ${clean(trackingCode)}`];
  const order = orderCode ? clean(orderCode) : "";
  if (order) lines.push(`Mã đơn hàng: ${order}`);
  return lines;
}

/**
 * Hai dòng mã hiện TRỄ ngần này so với lúc clip mở (anh Trung 20/11/2026: "để 1 giây trễ… cảnh đưa lên hạ xuống cũng
 * mất tầm 1 giây") — video mở ra thấy tem còn trước camera rồi mã mới hiện, không có sẵn mã từ giây 0. Ngày giờ vẫn in
 * từ khung đầu, mốc cắt clip KHÔNG đổi. Cùng số với bản webcam (`CODE_LINES_DELAY_MS` ở frontend, commit e749f7ce).
 */
export const CODE_LINES_DELAY_MS = 1000;

/** Thiết bị này có in được các dòng mã lên video không (để màn quay khỏi hiện thứ không có trong tệp). */
export const overlayLabelSupported = Platform.OS === "ios";

/** Đặt các dòng sẽ in lên video từ khung hình kế tiếp. Mảng rỗng = chỉ in ngày giờ. */
export function setOverlayLabel(lines: string[]): void {
  if (!overlayLabelSupported) return;
  try {
    Settings.set({ [OVERLAY_LABEL_KEY]: lines.join("\n") });
  } catch {
    // Không ghi được thì video vẫn quay, chỉ thiếu dòng mã — không chặn việc đóng hàng.
  }
}
