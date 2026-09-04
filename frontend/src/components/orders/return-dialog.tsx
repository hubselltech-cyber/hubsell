"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, ImageIcon, Loader2, PackageCheck, PackageX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, processOrderReturn, type Order } from "@/lib/api";
import { carrierLabel } from "@/lib/carrier-meta";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatVND, formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * XỬ LÝ LẺ KIỆN HÀNG ĐÃ NHẬN — công đoạn 2 của luồng đối soát.
 *
 * Mở từ nút "Báo hỏng/Khiếu nại" trên dòng đơn Đã nhận (quét nhận giờ là bước
 * TỰ ĐỘNG, không mở dialog nữa). Nhân viên đối chiếu hàng trong tay với danh
 * sách trên màn hình rồi chọn một trong hai:
 *
 *   Nhập kho    → cộng NGƯỢC tồn kho cho từng SKU, hàng bán lại được
 *   Hư hỏng/mất → KHÔNG cộng kho, gắn cờ chờ khiếu nại sàn/đơn vị vận chuyển
 *
 * Hai nút cố ý tách rời và ghi rõ hệ quả ngay trên nút, vì chọn nhầm "nhập
 * kho" cho kiện hàng vỡ là bơm hàng ma vào kho — bán ra rồi mới biết không có
 * hàng để giao.
 */
export function ReturnDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"INTACT" | "DAMAGED" | null>(null);

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, order?.id]);

  if (!order) return null;

  const lines = order.items ?? [];
  const alreadyRestored = order.stockRestoredAt !== null;

  async function submit(condition: "INTACT" | "DAMAGED") {
    if (!order) return;
    setBusy(condition);
    try {
      const res = await processOrderReturn(order.id, condition, note || undefined);
      if (res.restored.length > 0) {
        toast.success(
          `Đã nhận hoàn ${order.orderCode} · cộng kho: ${res.restored
            .map((r) => `${r.productName} +${r.restoredQuantity} (còn ${r.newQuantity})`)
            .join("; ")}`,
          { duration: 8000 }
        );
      } else if (res.stockSkippedReason) {
        toast.warning(`${order.orderCode}: ${res.stockSkippedReason}`, {
          duration: 8000,
        });
      } else {
        toast.success(`Đã ghi nhận hoàn cho đơn ${order.orderCode}`);
      }
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không xử lý được hàng hoàn"
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{order.orderCode}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                CHANNEL_META[order.channel.channelName].className
              )}
            >
              {CHANNEL_META[order.channel.channelName].label}
            </span>
          </DialogTitle>
          <DialogDescription>
            {order.customerName}
            {order.customerPhone ? ` · ${order.customerPhone}` : ""} ·{" "}
            {carrierLabel(order.carrier)} {order.trackingCode ?? ""}
          </DialogDescription>
        </DialogHeader>

        {/* Danh sách hàng cần đối chiếu với kiện đang cầm trên tay */}
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
          <p className={cn(TEXT_SUB, "font-medium")}>
            Đối chiếu {formatNumber(lines.length)} mặt hàng
          </p>
          {lines.length === 0 ? (
            <p className={TEXT_SUB}>
              Đơn này không có chi tiết dòng hàng — sẽ không cộng lại tồn kho.
            </p>
          ) : (
            lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2.5">
                {l.product?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.product.imageUrl}
                    alt={l.productName}
                    className="size-9 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <ImageIcon className="size-4" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{l.productName}</p>
                  <p className={cn(TEXT_SUB, "font-mono")}>{l.channelSku}</p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  ×{l.quantity}
                </span>
              </div>
            ))
          )}
          <p className={cn(TEXT_SUB, "border-t pt-2")}>
            Giá trị đơn: <b>{formatVND(order.totalAmount)}</b>
          </p>
        </div>

        {/* Cảnh báo khi đơn đã được cộng kho từ lúc hủy */}
        {alreadyRestored && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              Đơn này <b>đã được cộng lại tồn kho từ trước</b> (lúc hủy đơn). Chọn
              “Nguyên vẹn” sẽ chỉ ghi nhận trạng thái, <b>không cộng thêm</b> — để
              tồn kho không bị phình ảo.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="return-note">Ghi chú tình trạng kiện hàng</Label>
          <Input
            id="return-note"
            placeholder="VD: hộp bị bẹp, thiếu 1 sản phẩm, bị tráo hàng…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            onClick={() => submit("INTACT")}
            disabled={busy !== null}
            className="h-auto flex-col items-start gap-0.5 bg-emerald-600 py-3 text-left hover:bg-emerald-700"
          >
            <span className="flex items-center gap-2 font-semibold">
              {busy === "INTACT" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PackageCheck className="size-4" />
              )}
              📦 Nhập kho
            </span>
            <span className="text-xs font-normal opacity-90">
              {alreadyRestored
                ? "Chỉ ghi nhận trạng thái"
                : "Hàng nguyên vẹn · cộng lại tồn kho"}
            </span>
          </Button>

          <Button
            onClick={() => submit("DAMAGED")}
            disabled={busy !== null}
            className="h-auto flex-col items-start gap-0.5 bg-rose-600 py-3 text-left hover:bg-rose-700"
          >
            <span className="flex items-center gap-2 font-semibold">
              {busy === "DAMAGED" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PackageX className="size-4" />
              )}
              Hư hỏng / Mất / Tráo
            </span>
            <span className="text-xs font-normal opacity-90">
              Không cộng kho · chờ khiếu nại
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
