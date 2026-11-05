"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  ApiError,
  fetchChannels,
  setChannelAutoArrange,
  type Channel,
  type ChannelName,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK"];

/** Gian bật được: đang hoạt động và đã nối API sàn (cùng luật với backend). */
function canAutoArrange(c: Channel): boolean {
  return c.status === "ACTIVE" && Boolean(c.apiConnected);
}

/** Vì sao gian không có công tắc — để khách không thắc mắc gian "biến mất". */
function blockedReason(c: Channel): string {
  return c.status !== "ACTIVE" ? "Đã ngắt kết nối" : "Chưa nối API sàn";
}

/**
 * NÚT + HỘP "TỰ CHUẨN BỊ HÀNG" trên trang Đơn hàng (05/11/2026, anh Trung: chuyển
 * công tắc từ trang Kênh bán về đây — bấm nút hiện danh sách gian, bật / tắt từng gian).
 * Thiết kế gốc ở docs/TU-CHUAN-BI-HANG.md.
 *
 * - Danh sách gian đọc chung bộ đệm `qk.channels()` với bộ lọc sàn của trang, nên
 *   nút không thêm lượt gọi API nào lúc tải trang.
 * - Gạt BẬT → cùng hộp đổi sang màn xác nhận với câu anh chốt 04/11 (không chồng
 *   hộp thứ hai); gạt TẮT → tắt ngay.
 * - Chỉ chủ shop thấy nút (API `requireAdmin`) — trang gọi quyết định có vẽ hay không.
 */
export function AutoArrangeButton({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Channel | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.channels(),
    queryFn: () => fetchChannels(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Kênh offline không có sàn để chuẩn bị hàng → không liệt kê.
  const shops = (data ?? [])
    .filter((c) => c.channelName !== "OFFLINE")
    .sort(
      (a, b) =>
        PLATFORM_ORDER.indexOf(a.channelName) - PLATFORM_ORDER.indexOf(b.channelName) ||
        a.shopName.localeCompare(b.shopName, "vi")
    );
  const eligible = shops.filter(canAutoArrange);
  const onCount = eligible.filter((c) => c.autoArrangeEnabledAt).length;

  async function apply(channel: Channel, next: boolean) {
    setBusyId(channel.id);
    try {
      await setChannelAutoArrange(channel.id, next);
      toast.success(
        next
          ? `Đã bật tự chuẩn bị hàng cho gian ${channel.shopName} — lượt đầu chạy trong vài phút`
          : `Đã tắt tự chuẩn bị hàng cho gian ${channel.shopName}`
      );
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: qk.channels() });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không đổi được cài đặt");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
        title="Bật / tắt tự chuẩn bị hàng cho từng gian"
      >
        <Zap className="size-4" />
        Tự chuẩn bị hàng
        {eligible.length > 0 && (
          <span
            className={cn(
              "rounded-full px-1.5 text-xs tabular-nums",
              onCount > 0 ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
            )}
            aria-label={`${onCount} trên ${eligible.length} gian đang bật`}
          >
            {onCount}/{eligible.length}
          </span>
        )}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busyId) return;
          setOpen(o);
          if (!o) setConfirming(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {confirming ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8 leading-snug">
                  Bật tự chuẩn bị hàng cho gian {confirming.shopName}?
                </DialogTitle>
                <DialogDescription>
                  Hệ thống sẽ tự chuẩn bị hàng 30 phút 1 lần. Khách hàng cần cân nhắc xử lý đơn hỏa tốc và sản phẩm
                  hết hàng.
                </DialogDescription>
              </DialogHeader>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Đơn Chờ xử lý đã thanh toán sẽ được sắp xếp vận chuyển với sàn, rồi sang Đã xử lý · Chưa in
                  phiếu. Việc in phiếu vẫn do shop bấm.
                </li>
                <li>
                  Máy bỏ qua đơn hỏa tốc, đơn chưa thanh toán và đơn khách đang xin hủy — những đơn này shop tự xử
                  lý.
                </li>
                <li>Đơn sàn từ chối sẽ có chuông báo và nhãn ở tab Chờ xử lý để shop làm tay.</li>
              </ul>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(busyId)}
                  onClick={() => setConfirming(null)}
                >
                  Quay lại
                </Button>
                <Button type="button" disabled={Boolean(busyId)} onClick={() => apply(confirming, true)}>
                  {busyId ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                  Bật
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Zap className="size-4 text-muted-foreground" />
                  Tự chuẩn bị hàng
                </DialogTitle>
                <DialogDescription>
                  Gian nào bật, Hubsell tự bấm Chuẩn bị hàng cho đơn Chờ xử lý của gian đó 30 phút 1 lần. Việc in
                  phiếu vẫn do shop làm.
                </DialogDescription>
              </DialogHeader>

              {isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Đang tải gian hàng…</p>
              ) : shops.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  <p>Chưa có gian hàng nào trên sàn.</p>
                  <Link href="/channels" className="mt-1 inline-block font-medium text-foreground underline underline-offset-3">
                    Kết nối gian hàng
                  </Link>
                </div>
              ) : (
                <ul className="-mx-1 max-h-[60vh] divide-y overflow-y-auto">
                  {shops.map((c) => {
                    const enabled = Boolean(c.autoArrangeEnabledAt);
                    const ok = canAutoArrange(c);
                    return (
                      <li key={c.id} className="flex items-center gap-3 px-1 py-2.5">
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                            CHANNEL_META[c.channelName].className
                          )}
                        >
                          {CHANNEL_META[c.channelName].label}
                        </span>
                        <span
                          className={cn("min-w-0 flex-1 truncate", !ok && "text-muted-foreground")}
                          title={c.shopName}
                        >
                          {c.shopName}
                        </span>
                        {ok ? (
                          <span className="flex shrink-0 items-center gap-2">
                            {busyId === c.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                            <Switch
                              checked={enabled}
                              disabled={Boolean(busyId)}
                              aria-label={`Tự chuẩn bị hàng gian ${c.shopName}`}
                              onCheckedChange={(checked) => {
                                if (checked) setConfirming(c);
                                else void apply(c, false);
                              }}
                            />
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground">{blockedReason(c)}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
