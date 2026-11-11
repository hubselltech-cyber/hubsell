"use client";

// ============================================================
// POPUP PHIẾU PHÍ VƯỢT (anh Trung 11/11/2026: "Thêm popup") — mount một lần trong dải
// cảnh báo gói (plan-quota-guard), chỉ chủ shop thấy.
//
// Hiện MỘT lần cho mỗi phiếu khi khách mở app sau lúc có phiếu, và một lần nữa nếu phiếu
// đó sang quá hạn (mức nặng hơn). Gạt đi là thôi — dải nhắc vẫn đứng đó. Một nút: mở
// thẳng mã QR tại trang đang đứng, không vòng qua trang Gói dịch vụ. Trong tháng đang
// vượt (chưa có phiếu) thì KHÔNG có popup.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { CreditCard, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import {
  ApiError,
  createOverageCheckout,
  type GatewayCheckout,
  type MySubscriptionResponse,
} from "@/lib/api";
import { OVERAGE_PAY_HREF, overageLastPayDay, overageMonthLabel } from "@/lib/overage";
import { cn } from "@/lib/utils";
import { GatewayCheckoutDialog } from "@/components/settings/gateway-checkout-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const nf = new Intl.NumberFormat("vi-VN");
const SEEN_KEY = "hubsell_overage_popup_seen";

function readSeen(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function markSeen(key: string): void {
  // Chỉ giữ các khóa gần đây — danh sách không phình theo năm tháng.
  localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), key])].slice(-20)));
}

export function OverageChargePopup({ data }: { data: MySubscriptionResponse }) {
  // Phiếu quá hạn (đang khóa) được ưu tiên báo trước phiếu còn hạn.
  const charge =
    data.overage?.openCharges.find((c) => c.overdue) ?? data.overage?.openCharges[0] ?? null;
  const popupKey = charge ? `${charge.id}:${charge.overdue ? "overdue" : "open"}` : null;
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState<GatewayCheckout | null>(null);

  useEffect(() => {
    if (!popupKey || readSeen().includes(popupKey)) return;
    // Không chồng lên hộp khác của trang (đã dẫm 11/11: trùng lúc với hộp nhắc nhập giá vốn
    // ở Tổng quan → hai hộp đè nhau). Chờ trang bày xong hộp của nó; còn hộp nào đang mở thì
    // đợi khách đóng rồi mới hiện, và chỉ đánh dấu "đã xem" khi thật sự hiện.
    const tryOpen = () => {
      if (document.querySelector('[role="dialog"]')) return false;
      markSeen(popupKey);
      setOpen(true);
      return true;
    };
    let poll: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      if (tryOpen()) return;
      poll = setInterval(() => {
        if (tryOpen()) clearInterval(poll);
      }, 2000);
    }, 1500);
    return () => {
      clearTimeout(first);
      if (poll) clearInterval(poll);
    };
  }, [popupKey]);

  const pay = useMutation({
    mutationFn: (chargeId: string) => createOverageCheckout(chargeId),
    onSuccess: (res) => {
      setOpen(false);
      setCheckout(res.checkout);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Không tạo được mã thanh toán — thử lại sau."),
  });

  const month = charge ? overageMonthLabel(charge.month) : "";
  return (
    <>
      {charge && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ReceiptText className="size-5 shrink-0 text-amber-600" />
                Tháng {month} vượt {nf.format(charge.overOrders)} đơn
              </DialogTitle>
              <DialogDescription>
                Số đơn tháng {month} nhiều hơn số đơn của gói. Phần vượt tính theo đúng đơn giá của gói
                bạn đang dùng.
              </DialogDescription>
            </DialogHeader>

            <dl className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm tabular-nums">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Số đơn vượt</dt>
                <dd>{nf.format(charge.overOrders)} đơn</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Đơn giá</dt>
                <dd>{nf.format(charge.unitPrice)} ₫ / đơn</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t pt-2">
                <dt className="font-medium">Cần thanh toán</dt>
                <dd className="text-xl font-bold">{nf.format(charge.amount)} ₫</dd>
              </div>
            </dl>

            <p
              className={cn(
                "rounded-md border px-3 py-2 text-xs",
                charge.overdue
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : "border-amber-300 bg-amber-50 text-amber-900"
              )}
            >
              {charge.overdue
                ? "Đã quá hạn thanh toán — các tính năng nâng cao đang tạm dừng. Thanh toán là mở lại ngay; đơn hàng và tồn kho vẫn được đồng bộ đầy đủ."
                : `Thanh toán trước hết ngày ${overageLastPayDay(charge.dueAt)}. Quá hạn chưa thanh toán thì các tính năng nâng cao tạm dừng; đơn hàng và tồn kho vẫn được đồng bộ đầy đủ.`}
            </p>

            {data.gateway ? (
              <Button className="w-full" disabled={pay.isPending} onClick={() => pay.mutate(charge.id)}>
                <CreditCard className="size-4" />
                {pay.isPending ? "Đang tạo mã…" : `Thanh toán ${nf.format(charge.amount)} ₫`}
              </Button>
            ) : (
              // Cổng thanh toán tắt: dẫn về khối phí vượt, nơi có hướng dẫn chuyển khoản.
              <Button
                className="w-full"
                nativeButton={false}
                onClick={() => setOpen(false)}
                render={<Link href={OVERAGE_PAY_HREF} />}
              >
                <CreditCard className="size-4" />
                Xem cách thanh toán
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
      <GatewayCheckoutDialog
        checkout={checkout}
        onClose={() => setCheckout(null)}
        onRetry={(c) => {
          setCheckout(null);
          if (c.overageChargeId) pay.mutate(c.overageChargeId);
        }}
      />
    </>
  );
}
