"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Segmented control (kiểu iOS / YouTube Studio): khay bg-muted, mục đang chọn nổi lên
 * bằng nền card + bóng; icon + chữ 14 px. Dùng cho bộ lọc / chuyển chế độ ít mục
 * (≤ 5) — nhiều mục hơn dùng PageTabs.
 */
export function Segmented<K extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  className,
}: {
  value: K;
  items: { key: K; label: string; icon?: React.ReactNode }[];
  onChange: (key: K) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("inline-flex rounded-lg bg-muted p-1", className)}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-all",
              active ? "bg-card font-medium text-slate-900 shadow-sm ring-1 ring-black/5" : "text-slate-500 hover:text-slate-900"
            )}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
