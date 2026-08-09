"use client";

import { Pin, Star } from "lucide-react";

import { channelMeta } from "@/components/operations/mock-data";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * CỘT DANH SÁCH HỘI THOẠI (trái) — thuần trình bày
 *
 * Trang cha lo toàn bộ nghiệp vụ (lọc, sắp xếp, ghim/theo dõi lưu ở đâu);
 * component này chỉ vẽ: thanh lọc đa cấp + ô tìm + danh sách item. Hội thoại
 * ghim do trang cha xếp lên đầu, ở đây tô viền trái + icon để nhìn là biết.
 */

export type ChatChannelFilter = "ALL" | "SHOPEE" | "LAZADA" | "TIKTOK";
export type ChatStatusFilter = "ALL" | "UNREPLIED" | "REPLIED" | "PINNED";

export interface ConversationItemView {
  key: string;
  customer: string;
  channel: string;
  lastMessage: string;
  time: string;
  unread: number;
  active: boolean;
  pinned: boolean;
  starred: boolean;
  /** Tin cuối là của KHÁCH → ca này đang chờ shop phản hồi. */
  needsReply: boolean;
  select: () => void;
  togglePin: () => void;
  toggleStar: () => void;
}

export function ConversationList({
  items,
  search,
  onSearch,
  channelFilter,
  onChannelFilter,
  statusFilter,
  onStatusFilter,
  emptyText,
}: {
  items: ConversationItemView[];
  search: string;
  onSearch: (v: string) => void;
  channelFilter: ChatChannelFilter;
  onChannelFilter: (v: ChatChannelFilter) => void;
  statusFilter: ChatStatusFilter;
  onStatusFilter: (v: ChatStatusFilter) => void;
  /** Câu hiện khi danh sách trống — inbox thật chưa có khách khác với "không khớp bộ lọc". */
  emptyText?: string;
}) {
  return (
    <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
      {/* ── Bộ lọc đa cấp + tìm kiếm ── */}
      <div className="space-y-2 border-b p-3">
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Tìm khách hàng, nội dung…"
          aria-label="Tìm hội thoại"
        />
        <div className="flex gap-2">
          <NativeSelect
            className="flex-1"
            value={channelFilter}
            onChange={(e) => onChannelFilter(e.target.value as ChatChannelFilter)}
            aria-label="Lọc hội thoại theo sàn"
          >
            <option value="ALL">Tất cả sàn</option>
            <option value="SHOPEE">Shopee</option>
            <option value="LAZADA">Lazada</option>
            <option value="TIKTOK">TikTok Shop</option>
          </NativeSelect>
          <NativeSelect
            className="flex-1"
            value={statusFilter}
            onChange={(e) => onStatusFilter(e.target.value as ChatStatusFilter)}
            aria-label="Lọc hội thoại theo trạng thái"
          >
            <option value="ALL">Tất cả</option>
            <option value="UNREPLIED">🔴 Chưa trả lời</option>
            <option value="REPLIED">✅ Đã trả lời</option>
            <option value="PINNED">📌 Đã ghim / Theo dõi</option>
          </NativeSelect>
        </div>
      </div>

      {/* ── Danh sách ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {emptyText ?? "Không có hội thoại nào khớp bộ lọc."}
          </p>
        )}
        {items.map((c) => (
          <div
            key={c.key}
            role="button"
            tabIndex={0}
            onClick={c.select}
            onKeyDown={(e) => e.key === "Enter" && c.select()}
            className={cn(
              "group relative flex w-full cursor-pointer items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0",
              c.active ? "bg-muted" : "hover:bg-muted/50",
              // Hội thoại ghim: vạch neo trái đậm để nổi hẳn trong danh sách
              c.pinned && "border-l-2 border-l-primary bg-primary/[0.03]"
            )}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-slate-600">
              {(c.customer || "?").charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {c.pinned && <Pin className="size-3 shrink-0 fill-primary text-primary" />}
                {c.starred && (
                  <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                )}
                <span className="truncate text-sm font-semibold text-slate-900">
                  {c.customer}
                </span>
                <span className={cn(TEXT_SUB, "ml-auto shrink-0")}>{c.time}</span>
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-600">{c.lastMessage}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <Badge variant="outline" className={channelMeta(c.channel).badgeClass}>
                  {channelMeta(c.channel).label}
                </Badge>
                {c.needsReply && (
                  <Badge
                    variant="outline"
                    className="border-orange-200 bg-orange-50 text-orange-700"
                  >
                    Chờ phản hồi
                  </Badge>
                )}
                {c.unread > 0 && (
                  <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-semibold text-white tabular-nums">
                    {c.unread}
                  </span>
                )}
              </div>
            </div>

            {/* Nút Ghim / Theo dõi — hiện khi rê chuột (hoặc đã bật thì hiện luôn) */}
            <div
              className={cn(
                "absolute right-2 top-2 flex gap-0.5 rounded-md bg-card/90 opacity-0 shadow-xs transition-opacity group-hover:opacity-100",
                (c.pinned || c.starred) && "opacity-100"
              )}
            >
              <button
                type="button"
                aria-label={c.pinned ? "Bỏ ghim hội thoại" : "Ghim hội thoại"}
                title={c.pinned ? "Bỏ ghim" : "Ghim lên đầu"}
                onClick={(e) => {
                  e.stopPropagation();
                  c.togglePin();
                }}
                className="rounded p-1 hover:bg-muted"
              >
                <Pin
                  className={cn(
                    "size-3.5",
                    c.pinned ? "fill-primary text-primary" : "text-slate-400"
                  )}
                />
              </button>
              <button
                type="button"
                aria-label={c.starred ? "Bỏ theo dõi hội thoại" : "Theo dõi hội thoại"}
                title={c.starred ? "Bỏ theo dõi" : "Đánh dấu cần theo dõi"}
                onClick={(e) => {
                  e.stopPropagation();
                  c.toggleStar();
                }}
                className="rounded p-1 hover:bg-muted"
              >
                <Star
                  className={cn(
                    "size-3.5",
                    c.starred ? "fill-amber-400 text-amber-400" : "text-slate-400"
                  )}
                />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
