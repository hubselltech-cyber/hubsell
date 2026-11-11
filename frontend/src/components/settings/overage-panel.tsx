"use client";

// ============================================================
// KHỐI PHÍ VƯỢT TRẦN ĐƠN ở trang Gói dịch vụ (11/11/2026, anh Trung chốt "tính thẳng"):
// vượt bao nhiêu đơn × đơn giá của gói đang dùng, thu đầu tháng sau, hạn hết mùng 5.
//   · Phiếu tháng trước chờ trả → MỘT nút Thanh toán (payOS; cổng tắt thì hướng dẫn
//     chuyển khoản, Hubsell ghi nhận tay). Quá hạn thì khối đổi đỏ, vẫn nút đó.
//   · Tháng này đang vượt → một dòng tạm tính, không có nút (chưa tới kỳ trả).
// Mọi lời nhắc khác (dải dưới header, màn khóa, chuông) đều dẫn về neo #phi-vuot ở đây.
// Số liệu đọc từ /api/subscription/me (overage) — cùng phép tính sẽ chốt đầu tháng sau.
// ============================================================

import { useMutation } from "@tanstack/react-query";
import { CreditCard, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import {
  ApiError,
  createOverageCheckout,
  type GatewayCheckout,
  type MySubscriptionResponse,
} from "@/lib/api";
import { overageLastPayDay, overageMonthLabel } from "@/lib/overage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const nf = new Intl.NumberFormat("vi-VN");

export function OveragePanel({
  data,
  canPay,
  onCheckout,
}: {
  data: MySubscriptionResponse;
  /** Chỉ chủ shop trả tiền — nhân viên thấy số, không thấy nút. */
  canPay: boolean;
  onCheckout: (checkout: GatewayCheckout) => void;
}) {
  const overage = data.overage;
  const payMutation = useMutation({
    mutationFn: (chargeId: string) => createOverageCheckout(chargeId),
    onSuccess: (res) => onCheckout(res.checkout),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Không tạo được mã thanh toán — thử lại sau."),
  });

  if (!overage) return null;
  const { openCharges } = overage;
  const estimating = overage.billable && overage.estOverOrders > 0;
  if (openCharges.length === 0 && !estimating) return null;

  return (
    <div id="phi-vuot" className="scroll-mt-24 space-y-2">
      {openCharges.map((c) => (
        <div
          key={c.id}
          className={cn(
            "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 text-sm",
            c.overdue
              ? "border-rose-300 bg-rose-50 text-rose-900"
              : "border-amber-300 bg-amber-50 text-amber-900"
          )}
        >
          <ReceiptText className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold tabular-nums">
              Tháng {overageMonthLabel(c.month)} vượt {nf.format(c.overOrders)} đơn × {nf.format(c.unitPrice)} ₫ ={" "}
              {nf.format(c.amount)} ₫
            </p>
            <p className="text-xs">
              {c.overdue
                ? "Đã quá hạn thanh toán — các tính năng nâng cao đang tạm dừng, thanh toán là mở lại ngay. Đơn hàng và tồn kho vẫn đồng bộ."
                : `Thanh toán trước hết ngày ${overageLastPayDay(c.dueAt)}. Hóa đơn ghi "mua thêm ${nf.format(c.overOrders)} đơn hàng", xuất ngay khi tiền về.`}
              {canPay && !data.gateway
                ? data.payment
                  ? ` Chuyển khoản tới ${data.payment.bankName} — STK ${data.payment.bankAccount} (${data.payment.bankHolder}), nội dung: HUBSELL + số điện thoại của bạn; Hubsell ghi nhận khi tiền về.`
                  : " Liên hệ Hubsell qua kênh hỗ trợ để được hướng dẫn thanh toán."
                : ""}
            </p>
          </div>
          {canPay && data.gateway && (
            <Button
              size="sm"
              disabled={payMutation.isPending}
              onClick={() => payMutation.mutate(c.id)}
            >
              <CreditCard className="size-4" />
              {payMutation.isPending && payMutation.variables === c.id ? "Đang tạo mã…" : "Thanh toán"}
            </Button>
          )}
        </div>
      ))}
      {estimating && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm tabular-nums text-muted-foreground">
          Tháng này đang vượt{" "}
          <span className="font-semibold text-foreground">{nf.format(overage.estOverOrders)} đơn</span>
          {overage.unitPrice != null && <> × {nf.format(overage.unitPrice)} ₫</>} ≈{" "}
          <span className="font-semibold text-foreground">{nf.format(overage.estAmount)} ₫</span> (tạm tính).
          Hubsell chốt số ngày mùng 2 tháng sau, thanh toán trước hết ngày mùng {overage.dueDay}; trong
          tháng mọi tính năng vẫn dùng bình thường.
          {overage.breakEvenOrder != null &&
            overage.nextPlanName != null &&
            data.orders.used >= overage.breakEvenOrder &&
            ` Từ mức này nâng lên gói ${overage.nextPlanName} rẻ hơn trả phần vượt — nâng trong tháng thì số đơn của gói mới áp cho cả tháng.`}
        </p>
      )}
    </div>
  );
}
