"use client";

import * as React from "react";
import { HardDrive, RotateCcw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { queueNotice, type QueueSnapshot } from "@/lib/pack-video-recorder/upload-speed";
import { cn } from "@/lib/utils";

const TONE: Record<"rose" | "amber" | "slate", string> = {
  rose: "border-rose-200 bg-rose-50 text-rose-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
};

/**
 * DẢI BÁO TÌNH TRẠNG HÀNG CHỜ GỬI (lát M1, mục 18.4: N2 · N4 · N5) — đúng MỘT dải, ca nặng nhất thắng:
 * ổ đĩa đầy · mất mạng · chưa gửi được (đang tự thử lại) · mạng chậm hơn tốc độ quay · ổ sắp đầy.
 *
 * Cảnh báo, KHÔNG khóa (anh Trung): mạng chậm / mất mạng vẫn quay bình thường, video nằm trên máy tới khi gửi
 * được. Không có nút gạt đi — dải tự mất khi tình trạng hết (đây là trạng thái thật, không phải lời nhắc).
 */
export function QueueNotice({ queue, onRetryNow }: { queue: QueueSnapshot; onRetryNow: () => void }) {
  // Đồng hồ đếm lùi "tự thử lại sau N giây" — chỉ chạy khi đang có mốc thử lại.
  const [now, setNow] = React.useState(() => Date.now());
  const counting = queue.nextRetryAtMs !== null;
  React.useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting, queue.nextRetryAtMs]);

  const notice = queueNotice(queue, now);
  if (!notice) return null;
  const Icon = notice.kind === "disk-full" || notice.kind === "disk-low" || notice.kind === "memory" ? HardDrive : WifiOff;
  return (
    <div
      role={notice.tone === "rose" ? "alert" : "status"}
      className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3", TONE[notice.tone])}
    >
      <p className="flex min-w-0 flex-1 items-start gap-2 text-sm font-medium">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0">{notice.text}</span>
      </p>
      {notice.canRetryNow && (
        <Button size="sm" variant="outline" className="shrink-0" onClick={onRetryNow}>
          <RotateCcw className="size-3.5" />
          Thử ngay
        </Button>
      )}
    </div>
  );
}
