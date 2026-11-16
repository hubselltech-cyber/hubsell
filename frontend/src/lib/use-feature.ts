"use client";

import { useSyncExternalStore } from "react";

import { STORED_USER_EVENT, getStoredUser } from "./api";
import { featureState, type FeatureKey, type FeatureState } from "./features";

function subscribe(onChange: () => void) {
  window.addEventListener(STORED_USER_EVENT, onChange);
  // Tab khác đăng nhập / đăng xuất cũng ghi localStorage → sự kiện "storage".
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(STORED_USER_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Trạng thái một cổng tính năng của người đang đăng nhập, cho các TRANG (sidebar đọc
 * thẳng `user` của AppShell). Đọc hồ sơ lưu trong trình duyệt và tự cập nhật khi
 * AppShell nạp lại /api/auth/me (setStoredUser phát STORED_USER_EVENT) — phiên cũ
 * chưa có `features` sẽ chuyển sang "open" ngay sau lượt /me đầu tiên, không cần F5.
 *
 * Trên máy chủ và ở lượt vẽ đầu luôn là "locked" (hỏng thì đóng) nên HTML hai phía khớp nhau.
 */
export function useFeature(key: FeatureKey): FeatureState {
  return useSyncExternalStore<FeatureState>(
    subscribe,
    () => featureState(getStoredUser(), key),
    () => "locked"
  );
}
