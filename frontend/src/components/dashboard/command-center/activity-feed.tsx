"use client";

import { FlaskConical } from "lucide-react";

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
  tax: "bg-teal-400",
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

  // Chia "Hôm nay / Trước đó" — danh sách đã sắp mới nhất lên đầu nên chỉ cần
  // một vạch ngăn tại điểm chuyển ngày (tin cũ tự hiện "dd/mm HH:mm").
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const isToday = (iso: string) => new Date(iso).getTime() >= todayStart.getTime();
  const todayItems = shown.filter((it) => isToday(it.at));
  const olderItems = shown.filter((it) => !isToday(it.at));

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
          filter === "tax" ? (
            // Luồng Thuế chưa chạy — trạng thái Beta. Sau này chỉ hiện hoạt động
            // khi có lỗi phát sinh (lỗi kết nối API hóa đơn, lỗi ký số…).
            <div className="flex flex-col items-center gap-2 px-4 pt-10 text-center">
              <FlaskConical className="size-8 text-teal-500" />
              <p className="text-sm text-slate-600">
                Tính năng đối soát Thuế tự động đang được thiết lập (Beta)
              </p>
              <p className="max-w-xs text-xs text-slate-400">
                Khi hoàn tất, mục này chỉ hiển thị lúc có lỗi phát sinh (lỗi kết
                nối API hóa đơn, lỗi ký số…).
              </p>
            </div>
          ) : (
            <p className="pt-8 text-center text-sm text-slate-400">
              Chưa có hoạt động nào.
            </p>
          )
        ) : (
          <>
            {todayItems.length > 0 && <DayDivider label="Hôm nay" />}
            {todayItems.map((it) => (
              <FeedRow key={it.id} item={it} />
            ))}
            {olderItems.length > 0 && todayItems.length > 0 && (
              <DayDivider label="Trước đó" />
            )}
            {olderItems.map((it) => (
              <FeedRow key={it.id} item={it} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Một dòng nhật ký. */
function FeedRow({ item }: { item: ActivityItem }) {
  return (
    <div className="flex gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[item.tag])} />
      <div className="min-w-0">
        <p className="text-sm leading-relaxed text-slate-700">{item.message}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {formatRelative(item.at)}
        </p>
      </div>
    </div>
  );
}

/** Vạch ngăn "Hôm nay / Trước đó" trong dòng thời gian. */
function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1 first:pt-1">
      <span className="text-[11px] font-medium text-slate-400">
        {label}
      </span>
      <span className="h-px flex-1 bg-slate-100" />
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
