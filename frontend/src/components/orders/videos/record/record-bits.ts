"use client";

import * as React from "react";

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
