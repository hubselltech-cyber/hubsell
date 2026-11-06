"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2, Printer } from "lucide-react";
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
  fetchSavedLabelPdf,
  setChannelLabelArchive,
  type Channel,
  type ChannelName,
  type Order,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime } from "@/lib/format";
import { printPdfBlob } from "@/lib/print-labels";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Giữ bản lưu ngần này ngày kể từ lúc in — khớp LABEL_ARCHIVE_DAYS ở backend/src/services/label-archive.ts. */
export const LABEL_ARCHIVE_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK"];

/**
 * Đơn này có bản lưu vận đơn để in lại không — cùng luật với backend (mayHaveSavedLabel):
 * gian đang bật công tắc, phiếu in SAU mốc bật và chưa quá 60 ngày. Chỉ vẽ nút khi hãng vận
 * chuyển đã lấy kiện (Đang giao / Đã giao / Hủy · hoàn): đơn Đã xử lý vẫn in thẳng từ sàn được.
 */
export function hasSavedLabel(o: Order, now: number = Date.now()): boolean {
  const enabledAt = o.channel.labelArchiveEnabledAt;
  if (!enabledAt || !o.labelPrintedAt) return false;
  if (o.shippingStatus === "PENDING" || o.shippingStatus === "PROCESSED") return false;
  const printed = new Date(o.labelPrintedAt).getTime();
  if (printed < new Date(enabledAt).getTime()) return false;
  return now - printed <= LABEL_ARCHIVE_DAYS * DAY_MS;
}

/**
 * NÚT "IN LẠI PHIẾU" trong ô Trạng thái của bảng Đơn hàng (06/11/2026, docs/LUU-VAN-DON-DA-IN.md).
 * Hãng vận chuyển đã lấy kiện thì sàn không trả vận đơn nữa (thăm dò prod 06/11) → in từ bản
 * Hubsell đã chép lúc khách in. Không có bản lưu thì không vẽ gì.
 */
export function ReprintSavedLabelButton({ order }: { order: Order }) {
  const [busy, setBusy] = useState(false);
  if (!hasSavedLabel(order)) return null;

  async function reprint() {
    setBusy(true);
    try {
      const { blob, meta } = await fetchSavedLabelPdf(order.id);
      if (!printPdfBlob(blob)) {
        toast.error("Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up cho trang này rồi bấm In lại phiếu.");
        return;
      }
      if (meta?.wholeBatch) {
        toast.warning(
          `Vận đơn của đơn ${order.orderCode} nằm trong tệp in gộp ${meta.count} đơn và không tách riêng được — ` +
            "hộp in đang mở cả tệp, hãy chọn đúng trang của đơn này trước khi in.",
          { duration: 12_000 }
        );
      } else {
        toast.success(`Đã mở lại vận đơn của đơn ${order.orderCode}`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lấy được vận đơn đã lưu", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={reprint}
      className={cn(
        TEXT_SUB,
        "mt-1 flex w-full items-center justify-center gap-1 text-sky-700 underline-offset-2 hover:underline disabled:opacity-60"
      )}
      title={`In lại từ bản Hubsell đã lưu lúc in (${formatDateTime(order.labelPrintedAt!)}) · bản lưu tự xóa sau ${LABEL_ARCHIVE_DAYS} ngày kể từ lúc in`}
    >
      {busy ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Printer className="size-3 shrink-0" />}
      In lại phiếu
    </button>
  );
}

/** Gian bật được: gian trên sàn (kênh offline không có vận đơn của sàn). */
function canArchive(c: Channel): boolean {
  return c.channelName !== "OFFLINE";
}

/**
 * NÚT + HỘP "LƯU VẬN ĐƠN" trên trang Đơn hàng (06/11/2026, anh Trung: "để cái công tắc gạt cho việc
 * giữ lịch sử vận đơn… sau này dùng chính công tắc này để thu thêm phí"). Cùng kiểu với nút Tự
 * chuẩn bị hàng: bấm nút hiện danh sách gian, gạt bật / tắt từng gian.
 *
 * - Đọc chung bộ đệm `qk.channels()` với bộ lọc sàn của trang → không thêm lượt gọi API lúc tải trang.
 * - Nút TỰ ẨN khi máy chủ báo shop chưa được mở tính năng (`labelArchiveAvailable`) — kho tệp chưa
 *   cấu hình, hoặc chưa mở cho chủ shop này.
 * - Chỉ chủ shop thấy nút (API `requireAdmin`) — trang gọi quyết định có vẽ hay không.
 */
export function LabelArchiveButton({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.channels(),
    queryFn: () => fetchChannels(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const shops = (data ?? [])
    .filter(canArchive)
    .sort(
      (a, b) =>
        PLATFORM_ORDER.indexOf(a.channelName) - PLATFORM_ORDER.indexOf(b.channelName) ||
        a.shopName.localeCompare(b.shopName, "vi")
    );
  const available = (data ?? []).some((c) => c.labelArchiveAvailable);
  const onCount = shops.filter((c) => c.labelArchiveEnabledAt).length;
  // Chưa mở tính năng và cũng không còn gian nào đang bật (để tắt) → không vẽ nút.
  if (!available && onCount === 0) return null;

  async function apply(channel: Channel, next: boolean) {
    setBusyId(channel.id);
    try {
      await setChannelLabelArchive(channel.id, next);
      toast.success(
        next
          ? `Đã bật lưu vận đơn cho gian ${channel.shopName} — phiếu in từ bây giờ được giữ ${LABEL_ARCHIVE_DAYS} ngày`
          : `Đã tắt lưu vận đơn cho gian ${channel.shopName}`
      );
      // Bảng đơn đọc mốc bật theo từng đơn → tải lại cả danh sách gian lẫn đơn.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.channels() }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
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
        title="Bật / tắt lưu vận đơn đã in cho từng gian"
      >
        <Archive className="size-4" />
        Lưu vận đơn
        {shops.length > 0 && (
          <span
            className={cn(
              "rounded-full px-1.5 text-xs tabular-nums",
              onCount > 0 ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
            )}
            aria-label={`${onCount} trên ${shops.length} gian đang bật`}
          >
            {onCount}/{shops.length}
          </span>
        )}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busyId) return;
          setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="size-4 text-muted-foreground" />
              Lưu vận đơn đã in
            </DialogTitle>
            <DialogDescription>
              Gian nào bật, mỗi lần in vận đơn qua Hubsell hệ thống giữ lại một bản trong {LABEL_ARCHIVE_DAYS} ngày.
              Khi hãng vận chuyển đã lấy kiện, sàn không cho in lại nữa — lúc đó bấm In lại phiếu ngay trên đơn.
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
            <>
              <ul className="-mx-1 max-h-[60vh] divide-y overflow-y-auto">
                {shops.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-1 py-2.5">
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        CHANNEL_META[c.channelName].className
                      )}
                    >
                      {CHANNEL_META[c.channelName].label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm" title={c.shopName}>
                      {c.shopName}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {busyId === c.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                      <Switch
                        checked={Boolean(c.labelArchiveEnabledAt)}
                        // Chưa mở tính năng: gian đang bật vẫn TẮT được, gian đang tắt không bật được.
                        disabled={Boolean(busyId) || (!available && !c.labelArchiveEnabledAt)}
                        aria-label={`Lưu vận đơn gian ${c.shopName}`}
                        onCheckedChange={(checked) => void apply(c, checked)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Chỉ phiếu in sau khi bật mới có bản lưu. Bản lưu tự xóa sau {LABEL_ARCHIVE_DAYS} ngày kể từ lúc in.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
