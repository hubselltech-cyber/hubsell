"use client";

import * as React from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ChannelName, PackVideoReturnComplaintDue } from "@/lib/api";
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

// Màu theo mốc docs 3.1: đỏ ≤ 24 giờ, cam ≤ 48 giờ. KHÔNG viết lớp dark: — globals.css đã lật thang màu.
const MAIN: Record<ComplaintDueTone, string> = {
  red: "font-semibold text-red-600",
  orange: "font-semibold text-orange-600",
  normal: "font-medium text-foreground",
  overdue: "font-medium text-rose-900/70",
  muted: "text-muted-foreground",
  faint: "text-muted-foreground/70",
};

/**
 * Ô "Hạn khiếu nại" của một đơn hoàn: một hạn — hạn gần nhất còn tác dụng. Rê chuột / bấm = ô chi tiết
 * (luật đang áp, nguồn hạn, cửa khiếu nại 7 ngày của TikTok / Lazada).
 */
export function ComplaintDueCell({
  due,
  platform,
  nowMs,
}: {
  due: PackVideoReturnComplaintDue;
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
        <span className={cn("block whitespace-nowrap text-sm tabular-nums", MAIN[label.tone])}>{label.main}</span>
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
