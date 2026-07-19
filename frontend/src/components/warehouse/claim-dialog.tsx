"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, HandCoins, Loader2, TrendingDown } from "lucide-react";

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
import { ApiError, updateReturnClaim, type Order } from "@/lib/api";
import { carrierLabel } from "@/lib/carrier-meta";
import { formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * CHỐT KẾT QUẢ KHIẾU NẠI cho đơn hàng hư hỏng / mất / bị tráo.
 *
 * ⚠️ CẢ HAI KẾT QUẢ ĐỀU KHÔNG CỘNG LẠI TỒN KHO. Hàng đã hỏng hoặc mất thật —
 * bưu cục đền bằng TIỀN chứ hàng không quay lại kệ. Cộng kho ở đây là tạo hàng
 * ma. Hai nút ghi rõ điều đó để không ai hiểu nhầm "được đền" là "có hàng".
 */
export function ClaimDialog({
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
  const [busy, setBusy] = React.useState<"COMPENSATED" | "REJECTED" | null>(null);

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, order?.id]);

  if (!order) return null;

  async function submit(outcome: "COMPENSATED" | "REJECTED") {
    if (!order) return;
    setBusy(outcome);
    try {
      await updateReturnClaim(order.id, outcome, note || undefined);
      toast.success(
        outcome === "COMPENSATED"
          ? `${order.orderCode}: đã ghi nhận được đền bù`
          : `${order.orderCode}: ghi nhận hao hụt, tính vào chi phí lỗ`,
        { duration: 6000 }
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không cập nhật được khiếu nại"
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{order.orderCode}</DialogTitle>
          <DialogDescription>
            {order.customerName} · {carrierLabel(order.carrier)}{" "}
            {order.trackingCode ?? ""} · Giá trị {formatVND(order.totalAmount)}
          </DialogDescription>
        </DialogHeader>

        {/* Lý do hư hỏng ghi lúc nhận hàng — bằng chứng để đối chiếu */}
        {order.returnNote && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className={cn(TEXT_SUB, "font-medium uppercase")}>
              Tình trạng ghi nhận khi nhận hàng
            </p>
            <p className="mt-1 text-sm">{order.returnNote}</p>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Cả hai lựa chọn đều <b>không cộng lại tồn kho</b> — hàng đã hỏng hoặc
            mất thật, được đền bằng tiền chứ không quay lại kệ.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="claim-note">Ghi chú kết quả khiếu nại</Label>
          <Input
            id="claim-note"
            placeholder="VD: bưu cục đền 100% giá trị / sàn từ chối do quá hạn…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className={TEXT_SUB}>
            Ghi chú này được nối thêm vào tình trạng cũ, không ghi đè — giữ lại
            bằng chứng ban đầu.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            onClick={() => submit("COMPENSATED")}
            disabled={busy !== null}
            className="h-auto flex-col items-start gap-0.5 bg-emerald-600 py-3 text-left hover:bg-emerald-700"
          >
            <span className="flex items-center gap-2 font-semibold">
              {busy === "COMPENSATED" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <HandCoins className="size-4" />
              )}
              Đã được đền bù
            </span>
            <span className="text-xs font-normal opacity-90">
              Đòi được tiền · không cộng kho
            </span>
          </Button>

          <Button
            onClick={() => submit("REJECTED")}
            disabled={busy !== null}
            className="h-auto flex-col items-start gap-0.5 bg-rose-600 py-3 text-left hover:bg-rose-700"
          >
            <span className="flex items-center gap-2 font-semibold">
              {busy === "REJECTED" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <TrendingDown className="size-4" />
              )}
              Không được đền bù
            </span>
            <span className="text-xs font-normal opacity-90">
              Hao hụt · tính vào chi phí lỗ
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
