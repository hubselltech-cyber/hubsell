"use client";

import { useState } from "react";
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
import { ApiError, setChannelAutoArrange, type Channel } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * CÔNG TẮC TỰ CHUẨN BỊ HÀNG của một gian (04/11/2026, docs/TU-CHUAN-BI-HANG.md).
 * Gạt bật → hộp xác nhận với câu anh Trung chốt; gạt tắt → tắt ngay.
 * Chỉ hiện với gian đang hoạt động và đã nối API sàn.
 */
export function AutoArrangeSwitch({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(channel.autoArrangeEnabledAt);

  async function apply(next: boolean) {
    setBusy(true);
    try {
      await setChannelAutoArrange(channel.id, next);
      toast.success(
        next
          ? `Đã bật tự chuẩn bị hàng cho gian ${channel.shopName} — lượt đầu chạy trong vài phút`
          : `Đã tắt tự chuẩn bị hàng cho gian ${channel.shopName}`
      );
      setConfirming(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không đổi được cài đặt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className={cn(TEXT_SUB, "mt-1 flex w-fit cursor-pointer items-center gap-2")}>
        <Switch
          checked={enabled}
          disabled={busy}
          aria-label={`Tự chuẩn bị hàng gian ${channel.shopName}`}
          onCheckedChange={(checked) => {
            if (checked) setConfirming(true);
            else void apply(false);
          }}
        />
        <span className={cn(enabled && "font-medium text-foreground")}>Tự chuẩn bị hàng</span>
      </label>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bật tự chuẩn bị hàng cho gian {channel.shopName}?</DialogTitle>
            <DialogDescription>
              Hệ thống sẽ tự chuẩn bị hàng 30 phút 1 lần. Khách hàng cần cân nhắc xử lý đơn hỏa tốc và sản phẩm
              hết hàng.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Đơn Chờ xử lý đã thanh toán sẽ được sắp xếp vận chuyển với sàn, rồi sang Đã xử lý · Chưa in phiếu. Việc in phiếu vẫn do shop bấm.</li>
            <li>Máy bỏ qua đơn hỏa tốc, đơn chưa thanh toán và đơn khách đang xin hủy — những đơn này shop tự xử lý.</li>
            <li>Đơn sàn từ chối sẽ có chuông báo và nhãn ở tab Chờ xử lý để shop làm tay.</li>
          </ul>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Để sau
            </Button>
            <Button type="button" disabled={busy} onClick={() => apply(true)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              Bật
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
