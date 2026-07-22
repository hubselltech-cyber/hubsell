"use client";

import { cn } from "@/lib/utils";
import {
  TAG_META,
  type ActivityItem,
  type AlertTag,
} from "./types";
import { formatRelative } from "./mock-service";

/** Màu chấm nhỏ theo tag — tái dùng nền badge của tag cho nhất quán. */
const DOT: Record<AlertTag, string> = {
  inventory: "bg-sky-400",
  finance: "bg-violet-400",
  channel: "bg-amber-400",
  ads: "bg-rose-400",
};

export function ActivityFeed({
  items,
  tags,
  filter,
  onFilter,
}: {
  items: ActivityItem[];
  /** Các tag người dùng được xem (để dựng bộ lọc nhanh). */
  tags: AlertTag[];
  filter: AlertTag | "all";
  onFilter: (f: AlertTag | "all") => void;
}) {
  const shown =
    filter === "all" ? items : items.filter((it) => it.tag === filter);

  return (
    <div className="flex h-full flex-col">
      {/* Bộ lọc nhanh theo nhóm hoạt động */}
      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
        <FilterChip active={filter === "all"} onClick={() => onFilter("all")}>
          Tất cả
        </FilterChip>
        {tags.map((t) => (
          <FilterChip
            key={t}
            active={filter === t}
            onClick={() => onFilter(t)}
          >
            {TAG_META[t].label}
          </FilterChip>
        ))}
      </div>

      <div className="mt-1 flex-1 space-y-0 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="pt-8 text-center text-sm text-slate-400">
            Chưa có hoạt động nào.
          </p>
        ) : (
          shown.map((it) => (
            <div
              key={it.id}
              className="flex gap-3 border-b border-slate-100 py-2.5 last:border-b-0"
            >
              <span
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[it.tag])}
              />
              <div className="min-w-0">
                <p className="text-sm leading-relaxed text-slate-700">
                  {it.message}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {formatRelative(it.at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
      )}
    >
      {children}
    </button>
  );
}
