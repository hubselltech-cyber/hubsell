"use client";

// ============================================================
// HỘP THOẠI THANH TOÁN QUA CỔNG payOS (09/09) — chuẩn trang thanh toán VietQR
// (anh Trung 09/09 tối: "kỳ vọng như khi đi mua hàng"): khối Chi tiết đơn hàng
// + mã đơn để đối soát, QR bên trái, thông tin chuyển khoản thủ công bên phải
// (ngân hàng / chủ TK / STK / số tiền / nội dung — mỗi dòng có Sao chép), lưu ý
// nhập đúng số tiền & nội dung. Poll trạng thái 3s/lần khi đang mở (backend tự
// hỏi payOS nếu webhook lạc), PAID → màn "Thành công" + làm mới gói; hết
// hạn/hủy → cho tạo mã mới. Không có sandbox payOS: test bằng tiền thật số nhỏ.
// ============================================================

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Landmark,
  Loader2,
  RefreshCw,
  ScanLine,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  cancelPlanCheckout,
  fetchPlanCheckout,
  type BillingCycle,
  type GatewayCheckout,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("vi-VN");

const CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: "1 tháng",
  QUARTERLY: "3 tháng",
  SEMIANNUAL: "6 tháng",
  YEARLY: "12 tháng",
};

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

async function copyText(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`Đã sao chép ${label}`);
  } catch {
    toast.error("Trình duyệt không cho sao chép — bạn chép tay giúp nhé.");
  }
}

/** Một dòng thông tin chuyển khoản: nhãn nhỏ, giá trị đậm, nút Sao chép. */
function InfoRow({
  label,
  value,
  copy,
  highlight,
}: {
  label: string;
  value: string;
  /** Có nút sao chép — chuỗi sẽ chép (mặc định = value). */
  copy?: string | true;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "truncate text-sm font-semibold tabular-nums",
            highlight && "text-base text-emerald-700 dark:text-emerald-400"
          )}
        >
          {value}
        </p>
      </div>
      {copy && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={() => copyText(label.toLowerCase(), copy === true ? value : copy)}
        >
          <Copy className="size-3" /> Sao chép
        </Button>
      )}
    </div>
  );
}

export function GatewayCheckoutDialog({
  checkout,
  onClose,
  onRetry,
}: {
  /** Đơn đang mở — null = đóng hộp thoại. */
  checkout: GatewayCheckout | null;
  onClose: () => void;
  /** Tạo mã mới cùng gói/kỳ (khi hết hạn/hủy). */
  onRetry: (planId: string, cycle: BillingCycle) => void;
}) {
  const qc = useQueryClient();
  const orderCode = checkout?.orderCode ?? null;

  // Poll trạng thái — dừng khi đã chốt (PAID/CANCELLED/EXPIRED/MISMATCH).
  const { data } = useQuery({
    queryKey: ["plan-checkout", orderCode],
    queryFn: () => fetchPlanCheckout(orderCode!),
    enabled: orderCode !== null,
    initialData: checkout ? { checkout } : undefined,
    refetchInterval: (q) => {
      const st = q.state.data?.checkout.status;
      return st === "PENDING" ? 3000 : false;
    },
    refetchIntervalInBackground: true,
  });
  const current = data?.checkout ?? checkout;

  // Đếm ngược hạn QR — nhắc khách quét trước khi mã chết.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (current?.status !== "PENDING") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [current?.status]);

  // PAID → làm mới gói + báo một lần.
  const [celebrated, setCelebrated] = useState<string | null>(null);
  useEffect(() => {
    if (current?.status === "PAID" && celebrated !== current.orderCode) {
      setCelebrated(current.orderCode);
      qc.invalidateQueries({ queryKey: qk.mySubscription() });
      toast.success(`Thanh toán thành công — gói ${current.planName} đã kích hoạt.`);
    }
  }, [current, celebrated, qc]);

  const cancelMutation = useMutation({
    mutationFn: (code: string) => cancelPlanCheckout(code),
    onSuccess: (res) => {
      qc.setQueryData(["plan-checkout", res.checkout.orderCode], res);
      qc.invalidateQueries({ queryKey: qk.mySubscription() });
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Hủy mã thanh toán thất bại."),
  });

  if (!current) return null;
  const expiresIn = current.expiresAt ? new Date(current.expiresAt).getTime() - now : null;
  const isPending = current.status === "PENDING";
  const amountStr = `${nf.format(current.amount)}₫`;

  return (
    <Dialog open={checkout !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(isPending ? "sm:max-w-3xl" : "sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle>
            {current.status === "PAID"
              ? "Thanh toán thành công"
              : current.status === "MISMATCH"
                ? "Cần Hubsell kiểm tra"
                : isPending
                  ? "Thanh toán gói dịch vụ"
                  : "Mã thanh toán đã đóng"}
          </DialogTitle>
          <DialogDescription>
            Gói <span className="text-foreground">{current.planName}</span> — kỳ{" "}
            {CYCLE_LABEL[current.cycle]} · Mã đơn{" "}
            <span className="font-mono text-foreground">{current.orderCode}</span>
          </DialogDescription>
        </DialogHeader>

        {isPending && (
          <div className="space-y-4">
            {/* ===== Chi tiết đơn hàng ===== */}
            <div className="rounded-xl border">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <p className="text-sm font-semibold">Chi tiết đơn hàng</p>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => copyText("mã đơn", current.orderCode)}
                >
                  Mã đơn {current.orderCode}
                </button>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <p className="font-medium">
                    Gói {current.planName} — {CYCLE_LABEL[current.cycle]}
                  </p>
                  <p className="text-xs text-muted-foreground">Thuê bao phần mềm Hubsell × 1</p>
                </div>
                <p className="tabular-nums">{amountStr}</p>
              </div>
              <div className="flex items-center justify-between border-t px-4 py-2.5">
                <p className="text-sm font-semibold">Tổng cộng</p>
                <p className="text-lg font-bold tabular-nums">{amountStr}</p>
              </div>
            </div>

            {/* ===== Quét QR | Chuyển khoản thủ công ===== */}
            <div className="rounded-xl border">
              <p className="flex items-center gap-2 border-b px-4 py-2.5 text-sm text-muted-foreground">
                <ScanLine className="size-4 shrink-0" />
                Mở app ngân hàng bất kỳ để <b className="text-foreground">quét mã VietQR</b> hoặc{" "}
                <b className="text-foreground">chuyển khoản</b> đúng số tiền, nội dung bên dưới.
              </p>
              <div className="grid gap-4 p-4 md:grid-cols-[auto_1fr]">
                <div className="flex flex-col items-center gap-2">
                  <div className="rounded-xl border bg-white p-3 shadow-sm">
                    {current.qrCode ? (
                      <QRCodeSVG value={current.qrCode} size={208} level="M" includeMargin={false} />
                    ) : (
                      <div className="flex size-[208px] items-center justify-center text-sm text-muted-foreground">
                        <Loader2 className="mr-2 size-4 animate-spin" /> Đang tạo mã…
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">VietQR · Napas 247 · qua payOS</p>
                  {current.checkoutUrl && (
                    <a
                      href={current.checkoutUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="size-3" /> Mở trang thanh toán payOS
                    </a>
                  )}
                </div>

                <div className="divide-y">
                  <div className="flex items-center gap-2 py-2">
                    <Landmark className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Ngân hàng</p>
                      <p className="text-sm font-semibold">
                        {current.bank?.name ?? (current.bank ? `BIN ${current.bank.bin}` : "Đang lấy thông tin…")}
                      </p>
                    </div>
                  </div>
                  {current.bank && (
                    <>
                      <InfoRow label="Chủ tài khoản" value={current.bank.accountName || "—"} />
                      <InfoRow label="Số tài khoản" value={current.bank.accountNumber} copy />
                    </>
                  )}
                  <InfoRow label="Số tiền" value={amountStr} copy={String(current.amount)} highlight />
                  <InfoRow label="Nội dung chuyển khoản" value={current.transferContent} copy />
                </div>
              </div>
              <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                <b className="text-foreground">Lưu ý:</b> nhập chính xác số tiền{" "}
                <b className="text-foreground">{amountStr}</b> và nội dung{" "}
                <b className="text-foreground">{current.transferContent}</b> khi chuyển tay. Gói tự mở
                trong vài giây sau khi tiền về; Hubsell lưu mã đơn và mã giao dịch ngân hàng để đối soát.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Đang chờ tiền về…
                {expiresIn !== null && (
                  <span
                    className={cn(
                      "ml-2 inline-flex items-center gap-1 tabular-nums",
                      expiresIn < 5 * 60_000 ? "text-rose-600" : ""
                    )}
                  >
                    <Clock className="size-3.5" /> mã còn hiệu lực {fmtCountdown(expiresIn)}
                  </span>
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(current.orderCode)}
              >
                Hủy
              </Button>
            </div>
          </div>
        )}

        {current.status === "PAID" && (
          <div className="space-y-4 py-2 text-center">
            <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
            <p className="text-sm text-muted-foreground">
              Đã nhận {amountStr}, gói {current.planName} có hiệu lực ngay. Chứng từ và hóa đơn được
              chuyển sang kế toán Hubsell tự động — bạn không cần làm gì thêm.
            </p>
            <Button onClick={onClose}>Xong</Button>
          </div>
        )}

        {(current.status === "EXPIRED" || current.status === "CANCELLED") && (
          <div className="space-y-4 py-2 text-center">
            <XCircle className="mx-auto size-14 text-slate-400" />
            <p className="text-sm text-muted-foreground">
              {current.status === "EXPIRED"
                ? "Mã QR đã hết hạn. Nếu bạn đã chuyển khoản, gói vẫn sẽ mở khi tiền về — hoặc tạo mã mới để thanh toán lại."
                : "Mã thanh toán đã hủy. Bạn có thể tạo mã mới bất cứ lúc nào."}
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Đóng
              </Button>
              <Button onClick={() => onRetry(current.planId, current.cycle)}>
                <RefreshCw className="size-4" /> Tạo mã mới
              </Button>
            </div>
          </div>
        )}

        {current.status === "MISMATCH" && (
          <div className="space-y-4 py-2 text-center">
            <Clock className="mx-auto size-14 text-amber-500" />
            <p className="text-sm text-muted-foreground">
              Hubsell đã nhận tiền nhưng số tiền không khớp giá gói. Đội Hubsell sẽ liên hệ bạn để
              xử lý trong thời gian sớm nhất — không cần chuyển lại. Mã đơn để đối chiếu:{" "}
              <span className="font-mono text-foreground">{current.orderCode}</span>.
            </p>
            <Button variant="outline" onClick={onClose}>
              Đóng
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
