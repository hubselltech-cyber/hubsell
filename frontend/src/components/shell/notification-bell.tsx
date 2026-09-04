"use client";

/**
 * CHUÔNG THÔNG BÁO trên header — Tầng 3 kế hoạch UI ("chủ động thay vì chờ hỏi").
 *
 * Hai đường dữ liệu bổ trợ nhau:
 * 1. REST /api/notifications qua React Query (nạp lần đầu + poll 60s dự phòng).
 * 2. SSE /api/notifications/stream: sự kiện mới đẩy xuống NGAY — hiện toast +
 *    làm tươi danh sách; EventSource tự reconnect khi rớt mạng nên không cần
 *    code retry tay.
 *
 * Quy ước "đã đọc": MỞ chuông là đánh dấu đọc toàn bộ (badge về 0 — đã liếc là
 * xong, không bắt tick từng dòng); chấm xanh trong danh sách vẫn giữ theo dữ
 * liệu lúc mở để biết cái nào vừa tới. GĐ1 chỉ CHỦ SHOP có chuông.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  fetchNotifications,
  markNotificationsRead,
  notificationStreamUrl,
  type AppNotification,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const QUERY_KEY = ["notifications"] as const;

/** "5 phút trước" — đủ dùng cho feed thông báo, không cần thư viện. */
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchNotifications,
    staleTime: 30_000,
    // Poll dự phòng khi SSE rớt dài (đổi mạng, backend restart) — thưa thôi,
    // đường chính là stream bên dưới.
    refetchInterval: 60_000,
  });
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  // SSE: sự kiện mới → toast + làm tươi danh sách. Chỉ mở MỘT kết nối cho cả
  // vòng đời chuông; EventSource tự reconnect nên effect không cần retry.
  React.useEffect(() => {
    const es = new EventSource(notificationStreamUrl());
    es.onmessage = (e) => {
      try {
        const n = JSON.parse(e.data) as AppNotification;
        toast(n.title, {
          description: n.body ?? undefined,
          action: n.link
            ? { label: "Xem", onClick: () => router.push(n.link!) }
            : undefined,
        });
      } catch {
        // dòng giữ ấm / dữ liệu lạ — bỏ qua
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    };
    return () => es.close();
  }, [queryClient, router]);

  // Mở chuông = đã liếc qua → đánh dấu đọc toàn bộ, badge về 0 ngay (optimistic;
  // giữ nguyên readAt của items để chấm "mới" trong danh sách không mất).
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && unread > 0) {
      queryClient.setQueryData<{ items: AppNotification[]; unread: number }>(
        QUERY_KEY,
        (prev) => (prev ? { ...prev, unread: 0 } : prev)
      );
      markNotificationsRead().catch(() => {
        // lỗi mạng thì badge sẽ tự đúng lại ở lần refetch sau
      });
    }
  }

  function openItem(n: AppNotification) {
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={
              unread > 0 ? `Thông báo (${unread} chưa đọc)` : "Thông báo"
            }
            className="relative"
          >
            <Bell className="size-4" />
            {unread > 0 && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white"
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <p className="border-b px-4 py-2.5 text-sm font-semibold">Thông báo</p>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Chưa có thông báo nào. Khi có đơn hoàn mới hay cảnh báo điều hành,
            chúng sẽ hiện ở đây ngay lập tức.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={cn(
                  "flex w-full items-start gap-2.5 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted",
                  !n.link && "cursor-default"
                )}
              >
                {/* Chấm "mới" — theo trạng thái đọc tại thời điểm nạp danh sách */}
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.readAt ? "bg-transparent" : "bg-primary"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-slate-900">
                    {n.title}
                  </span>
                  {n.body && (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] text-slate-400">
                    {timeAgo(n.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
