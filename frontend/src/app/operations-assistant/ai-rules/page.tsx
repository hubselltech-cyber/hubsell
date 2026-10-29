"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * ROUTE CŨ /operations-assistant/ai-rules — chỉ còn CHUYỂN HƯỚNG.
 *
 * 29/10/2026 anh Trung gộp "Cấu hình tự động hóa" vào trang Phản hồi đánh giá
 * (tab "Tự động trả lời"). Giữ route để link cũ (bookmark, thư nhắc, chuông
 * ?tab=delivery-fail) không rơi 404: mang nguyên query sang, thiếu tab thì
 * mở tab auto.
 */
export default function AiRulesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get("tab")) q.set("tab", "auto");
    router.replace(`/operations-assistant/reviews?${q.toString()}`);
  }, [router]);
  return null;
}
