"use client";

import { Clock } from "lucide-react";

import { formatHoursBalance } from "@/lib/pack-video";
import { usePackVideoCaps } from "@/lib/use-feature";

import { BuyHoursButton, HoursSummary, usePackVideoHours } from "../hours-balance";

/** Hết giờ quay (số dư ≤ 0) → không mở được video mới. Chưa có số thì coi như còn (máy chủ là rào thật). */
export function useOutOfHours(): boolean {
  const hours = usePackVideoHours().data;
  return !!hours && hours.remainingSeconds <= 0;
}

/**
 * SỐ GIỜ QUAY CÒN LẠI ở hàng đầu màn quay, ghim mép phải — cùng khối chữ + thanh đã dùng với trang Video đóng
 * hàng (HoursSummary), cùng nguồn số. Anh Trung 21/11/2026: "phần thời gian còn lại để lên trên cho dễ nhìn"
 * (trước đó là một dòng chữ xám dưới nút Bắt đầu quay). Hết giờ thì nhường chỗ cho dải đỏ OutOfHoursNotice.
 */
export function RecordHoursSummary() {
  const hours = usePackVideoHours().data;
  if (!hours || hours.remainingSeconds <= 0) return null;
  return <HoursSummary hours={hours} className="flex" />;
}

/**
 * HẾT GIỜ (số dư ≤ 0): dải đỏ trọn bề ngang ngay dưới hàng đầu, kèm nút mua. Không mở được video mới, video
 * đang quay dở vẫn quay nốt (anh chốt 14/11).
 */
export function OutOfHoursNotice() {
  const hours = usePackVideoHours().data;
  // Nhân viên không mua giờ (24/11/2026) → câu nhắc báo chủ shop; nút mua tự ẩn (BuyHoursButton).
  const { manage } = usePackVideoCaps();
  if (!hours || hours.remainingSeconds > 0) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"
    >
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-rose-700">
          <Clock className="size-4 shrink-0" aria-hidden />
          {hours.purchasedSeconds > 0 || hours.usedSeconds > 0 ? "Hết giờ quay" : "Chưa có giờ quay"}
          {hours.remainingSeconds < 0 && (
            <span className="font-normal">· vượt gói {formatHoursBalance(hours.remainingSeconds)}</span>
          )}
        </p>
        <p className="text-sm text-rose-700">
          {manage
            ? "Không mở được video mới. Video đang quay dở vẫn quay nốt; phần thời gian vượt gói sẽ khấu trừ vào lần thanh toán tiếp theo."
            : "Không mở được video mới — báo chủ shop mua thêm giờ quay. Video đang quay dở vẫn quay nốt."}
        </p>
      </div>
      <BuyHoursButton hours={hours} />
    </div>
  );
}
