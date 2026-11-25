"use client";

import * as React from "react";
import { AlarmClock } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ChannelName, ReturnComplaintDue } from "@/lib/api";
import { complaintDueLabel, type ComplaintDueTone } from "@/lib/return-complaint-due";
import { cn } from "@/lib/utils";

/** Đồng hồ phút cho ô đếm ngược — một nhịp / phút, đủ cho "Còn 5 giờ 20 phút". */
export function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

// Sắc thái: docs/HAN-KHIEU-NAI-DON-HOAN.md mục 14.5. KHÔNG viết lớp dark: — globals.css đã lật thang màu.
const MAIN: Record<ComplaintDueTone, string> = {
  // Viên nền + đồng hồ: việc gấp phải nhận ra bằng HÌNH, không chỉ bằng màu chữ. Cặp tint 50 + 700 (chuẩn huy
  // hiệu) — ở giao diện tối thang màu lật thành chữ hồng nhạt trên nền đỏ sẫm, đủ tương phản (red-600 thì không).
  urgent:
    "inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-700",
  red: "font-semibold text-red-600",
  orange: "font-semibold text-orange-600",
  normal: "font-medium text-foreground",
  soft: "text-muted-foreground",
  overdue: "font-medium text-rose-900/70",
  muted: "text-muted-foreground",
  faint: "text-muted-foreground/70",
};

/**
 * Ô "Hạn khiếu nại" của một đơn hoàn — dùng chung cho tab Đơn hoàn (Video đóng hàng) và cột Thời hạn của
 * trang Đối soát đơn hoàn. Một hạn: hạn gần nhất còn tác dụng. Rê chuột / bấm = ô chi tiết (luật đang áp,
 * nguồn hạn, cửa khiếu nại 7 ngày của TikTok / Lazada).
 */
export function ComplaintDueCell({
  due,
  platform,
  nowMs,
}: {
  due: ReturnComplaintDue;
  platform: ChannelName;
  nowMs: number;
}) {
  const label = complaintDueLabel(due, platform, nowMs);
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        render={<button type="button" className="block cursor-pointer rounded text-left" aria-label="Chi tiết hạn khiếu nại" />}
      >
        <span
          className={cn(
            "whitespace-nowrap text-sm tabular-nums",
            label.tone !== "urgent" && "block",
            MAIN[label.tone],
            // Hạn ước tính: gạch chân chấm = "số này chưa chắc, rê vào để xem vì sao".
            label.estimate && label.tone !== "urgent" && "underline decoration-dotted underline-offset-4"
          )}
        >
          {label.tone === "urgent" && <AlarmClock className="size-3.5 shrink-0" aria-hidden />}
          {label.main}
        </span>
        {label.sub && (
          <span className="mt-0.5 block whitespace-nowrap text-xs tabular-nums text-muted-foreground">{label.sub}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-1.5 p-3 text-left text-sm font-normal">
        <p className="font-semibold text-foreground">Hạn khiếu nại</p>
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground marker:text-muted-foreground/60">
          {label.points.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
