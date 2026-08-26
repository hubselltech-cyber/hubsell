"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Bọc quanh vùng số liệu để báo "đang tính lại" khi người dùng đổi bộ lọc.
 *
 * Vì sao mờ đi chứ không thay bằng khung xương (skeleton)? Đổi khoảng thời
 * gian là thao tác nhanh và lặp lại nhiều lần; nếu mỗi lần đều xoá sạch số cũ
 * rồi dựng khung xám, cả trang sẽ nhấp nháy giật cục. Giữ số cũ mờ đi giúp mắt
 * bám được vị trí, chỉ cần biết "số đang được làm mới" là đủ.
 *
 * Vì sao có `delayMs`? Máy chủ nội bộ trả lời trong ~100ms — nếu mờ ngay lập
 * tức thì người dùng chỉ thấy một cái nháy khó chịu chứ không kịp đọc là gì.
 * Chờ qua ngưỡng này mới mờ: tải nhanh thì im lặng đổi số, tải chậm mới báo.
 *
 * `aria-busy` vẫn bám sát trạng thái thật (không chờ) để trình đọc màn hình
 * biết dữ liệu đang được cập nhật kể cả khi mắt thường chưa thấy gì.
 */
export function Refreshing({
  active,
  delayMs = 150,
  children,
  className,
}: {
  active: boolean;
  delayMs?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const [dimmed, setDimmed] = React.useState(false);

  React.useEffect(() => {
    if (!active) {
      setDimmed(false);
      return;
    }
    const timer = setTimeout(() => setDimmed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return (
    <div
      aria-busy={active}
      className={cn(
        "transition-opacity duration-300 motion-reduce:transition-none",
        // Mờ đi thì nhanh cho kịp nhận biết, sáng lại thì từ tốn cho êm mắt
        dimmed && "pointer-events-none opacity-45 duration-100",
        className
      )}
    >
      {children}
    </div>
  );
}
