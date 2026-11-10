"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Sắp xếp ngay tại TIÊU ĐỀ CỘT (khẩu vị bảng số liệu 17/09): bấm = chiều đầu (thường cao → thấp),
 * bấm nữa = đảo chiều; mũi tên chỉ hiện ở cột đang sắp.
 */
export interface SortState<K extends string> {
  key: K;
  dir: "asc" | "desc";
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align,
  firstDir = "desc",
  title,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (s: SortState<K>) => void;
  align?: "right";
  firstDir?: "asc" | "desc";
  title?: string;
}) {
  const active = sort.key === sortKey;
  const nextDir = active ? (sort.dir === "asc" ? "desc" : "asc") : firstDir;
  return (
    <button
      type="button"
      title={title}
      onClick={() => onSort({ key: sortKey, dir: nextDir })}
      className={cn(
        "inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground",
        align === "right" && "flex-row-reverse",
        active && "text-foreground"
      )}
    >
      {label}
      {active && (sort.dir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
    </button>
  );
}
