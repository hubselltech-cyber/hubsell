import { api } from "./client";
import type {
  NotificationListResponse,
  NotificationPreferencesResponse,
} from "../types/api";

/**
 * CHUÔNG THÔNG BÁO — cùng backend /api/notifications với chuông web (chỉ chủ
 * shop). App không có SSE: đọc REST khi mở / foreground / 60 s, còn tin mới
 * tới ngay qua push (services/push.ts backend).
 */

/** Trang 30 dòng mới nhất; `before` = createdAt của dòng cuối để cuộn tiếp. */
export function fetchNotifications(before?: string) {
  const q = before ? `?before=${encodeURIComponent(before)}` : "";
  return api<NotificationListResponse>(`/api/notifications${q}`);
}

/** Đánh dấu ĐÃ ĐỌC — không truyền ids là toàn bộ (mở màn Thông báo = đã liếc). */
export function markNotificationsRead(ids?: string[]) {
  return api<{ marked: number }>("/api/notifications/read", {
    method: "POST",
    body: ids && ids.length > 0 ? { ids } : {},
  });
}

export function fetchNotificationPreferences() {
  return api<NotificationPreferencesResponse>("/api/notifications/preferences");
}

/** Ghi đè danh sách nhóm đã tắt. */
export function saveNotificationPreferences(muted: string[]) {
  return api<NotificationPreferencesResponse>("/api/notifications/preferences", {
    method: "PUT",
    body: { muted },
  });
}

/** Đăng ký / làm mới token push của máy này sau khi đăng nhập. */
export function registerPushDevice(input: {
  token: string;
  platform: string;
  appVersion?: string;
  deviceName?: string | null;
}) {
  return api<{ ok: true }>("/api/notifications/devices", { method: "POST", body: input });
}

/** Gửi một tin đẩy thử tới mọi máy đang bật của chủ shop; trả số máy đã nhận. */
export function sendTestPush() {
  return api<{ sent: number }>("/api/notifications/test-push", { method: "POST", body: {} });
}

/** Gỡ token (đăng xuất / tắt công tắc "Nhận thông báo đẩy"). */
export function unregisterPushDevice(token: string) {
  return api<{ removed: number }>("/api/notifications/devices", {
    method: "DELETE",
    body: { token },
  });
}
