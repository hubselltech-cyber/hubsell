"use client";

import * as React from "react";

import type { ClipKind } from "@/lib/pack-video-recorder/types";

/** mm:ss (hoặc h:mm:ss) cho đồng hồ đang quay và thời lượng clip của lượt. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${String(m).padStart(2, "0")}:${r}`;
}

/** Số giây đã trôi từ `sinceMs`, tự cập nhật hai lần mỗi giây; null thì dừng đồng hồ và trả 0. */
export function useElapsedSeconds(sinceMs: number | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (sinceMs === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [sinceMs]);
  return sinceMs === null ? 0 : Math.max(0, (now - sinceMs) / 1000);
}

/** Mã tem dài rút gọn còn phần đuôi (phần phân biệt các tem với nhau) cho danh sách hẹp. */
export function shortCode(code: string, keep = 10): string {
  return code.length > keep + 1 ? `…${code.slice(-keep)}` : code;
}

/**
 * MÀU NHẤN THEO CHẾ ĐỘ QUAY — để liếc màn hình là biết đang đóng hàng hay khui hàng hoàn, không quay nhầm loại
 * (anh Trung 16/11/2026: "phải làm sao để khi quay video khui hàng không bị trùng mã đơn hàng với video đóng hàng").
 *   · Đóng hàng: xanh lá (emerald) như bản anh đã duyệt.
 *   · Khui hàng hoàn: TÍM (violet) — khác hẳn xanh lá, không trùng đỏ "đang quay" hay cam "cảnh báo"; thang violet đã
 *     được lật cho giao diện tối ở globals.css (50–300, 700, 800). Không dùng indigo (chưa lật).
 * Nút lớn dùng bậc 600 / 500 (hai bậc này không bị lật) nên chữ trắng luôn đủ tương phản ở cả hai giao diện.
 */
export const KIND_ACCENT: Record<
  ClipKind,
  { frame: string; readyPill: string; recordingPill: string; startButton: string; chip: string; text: string }
> = {
  PACK: {
    frame: "border",
    readyPill: "border-emerald-200 bg-emerald-50 text-emerald-700",
    recordingPill: "border-rose-200 bg-rose-50 text-rose-700",
    startButton: "bg-emerald-600 hover:bg-emerald-700",
    chip: "bg-emerald-50 text-emerald-700",
    text: "text-emerald-700",
  },
  UNBOX: {
    frame: "border-2 border-violet-400",
    readyPill: "border-violet-200 bg-violet-50 text-violet-700",
    recordingPill: "border-violet-200 bg-violet-50 text-violet-800",
    startButton: "bg-violet-600 hover:bg-violet-500",
    chip: "bg-violet-50 text-violet-700",
    text: "text-violet-700",
  },
};
