"use client";

// ============================================================
// DẢI NHẮC ĐỔI TÊN MIỀN — chặng 3 bước 5, docs/CHUYEN-TEN-MIEN-HUBSELL-VN.md
//
// Sau khi Vercel bật 301 app.hubsell.tech → app.hubsell.vn, phiên đăng nhập
// (token trong localStorage, lưu theo origin) KHÔNG theo sang tên miền mới nên
// khách đang dùng dở bỗng thấy màn đăng nhập mà không hiểu vì sao. Dải này nói
// đúng một câu + Bỏ qua = không hiện lại (localStorage). Chỉ hiện ở
// app.hubsell.vn và tự tắt sau SHOW_UNTIL — khỏi phải phát hành lại để gỡ.
// ============================================================

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";

const DISMISS_KEY = "hubsell:domain-move-notice-dismissed";
const NEW_APP_HOST = "app.hubsell.vn";
/** Mốc tự tắt — tự chọn 6 tuần sau buổi cắt (phiên cũ đã hết hạn từ lâu). */
const SHOW_UNTIL = Date.parse("2026-11-30T16:59:59Z"); // hết ngày 30/11/2026 giờ VN

export function DomainMoveNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.location.hostname !== NEW_APP_HOST) return;
      if (Date.now() > SHOW_UNTIL) return;
      if (localStorage.getItem(DISMISS_KEY)) return;
      setVisible(true);
    } catch {
      // localStorage bị chặn (chế độ riêng tư) → không hiện, vô hại.
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // không lưu được thì chỉ ẩn trong phiên này
    }
    setVisible(false);
  }

  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100"
    >
      <Info className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        Hubsell đã chuyển sang địa chỉ mới <strong>app.hubsell.vn</strong>. Anh/chị
        đăng nhập lại một lần, tài khoản và dữ liệu vẫn giữ nguyên.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Bỏ qua"
        className="-m-1 rounded p-1 text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/60"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
