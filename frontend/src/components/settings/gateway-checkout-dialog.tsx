"use client";

// ============================================================
// HỘP THOẠI THANH TOÁN QUA CỔNG payOS (09/09) — chuẩn trang thanh toán VietQR
// (anh Trung 09/09 tối: "kỳ vọng như khi đi mua hàng"). 18/09 dựng lại sau khi
// anh xem bản thật chê xấu: MỘT lớp, không hộp lồng hộp — trái là tấm QR nền
// mờ (số tiền to + trạng thái chờ + đếm ngược), phải là tóm tắt đơn rồi các
// dòng chuyển khoản tay (nhãn trái, giá trị phải, nút chép dạng icon). Mã đơn
// chỉ hiện MỘT lần ở dòng mô tả. Anh góp ý tiếp "thiếu màu, popup chìm vào nền" →
// tấm QR + chip tiêu đề dùng xanh thương hiệu ĐẶC (emerald 500→600, hai bậc không
// bị lật ở dark mode), chữ trắng; ngoài ra chỉ số tiền tô xanh. Poll trạng thái 3s/lần khi đang mở (backend tự
// hỏi payOS nếu webhook lạc), PAID → màn "Thành công" + làm mới gói; hết
// hạn/hủy → cho tạo mã mới. Không có sandbox payOS: test bằng tiền thật số nhỏ.
//
// ★ 17/09 khuya — NHÚNG TRANG THANH TOÁN payOS: anh so với trang của payOS (logo
// VietQR PRO / Napas 247 / MB, QR gắn logo) và chốt "dùng của họ, làm popup là đẹp
// nhất". Đơn đang chờ có checkoutUrl → hộp thoại bày <iframe> chính trang
// pay.payos.vn/web/<id> (họ không chặn nhúng). KHÔNG dùng chế độ embedded/iframe
// chính thức (thư viện payos-checkout: /embedded/… hoặc ?iframe=true + postMessage)
// vì thử thật 17/09 cả hai đều trả "Thông tin truyền lên không hợp lệ". Kết quả lấy
// từ 2 nguồn của chính mình: (1) vòng poll 3s bên dưới; (2) lần `load` THỨ HAI của
// iframe = payOS vừa chuyển khung sang returnUrl/cancelUrl → gỡ iframe ngay (khỏi
// lồng app trong app), hỏi trạng thái liền. Màn QR tự vẽ bên dưới là DỰ PHÒNG: không
// có checkoutUrl, khách bấm "Dùng mã QR của Hubsell", hoặc khung đã rời payOS mà đơn
// vẫn PENDING.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
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

/** Một dòng thông tin chuyển khoản: nhãn trái, giá trị phải, nút chép dạng icon. */
function InfoRow({
  label,
  value,
  copy,
  strong,
  accent,
  hint,
}: {
  label: string;
  value: string;
  /** Có nút sao chép — chuỗi sẽ chép (mặc định = value). */
  copy?: string | true;
  /** Hai dòng khách phải nhập đúng (số tiền, nội dung) — đậm hơn phần còn lại. */
  strong?: boolean;
  /** Tô xanh thương hiệu — chỉ dùng cho số tiền. */
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <p className="shrink-0 pt-1 text-sm text-muted-foreground">{label}</p>
      <div className="flex min-w-0 items-start gap-1">
        <div className="min-w-0 pt-1 text-right">
          <p className={cn("break-words text-sm tabular-nums", strong && "font-semibold", accent && "text-emerald-700")}>{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {copy ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mr-1.5 shrink-0 text-muted-foreground"
            title={`Sao chép ${label.toLowerCase()}`}
            aria-label={`Sao chép ${label.toLowerCase()}`}
            onClick={() => copyText(label.toLowerCase(), copy === true ? value : copy)}
          >
            <Copy className="size-3.5" />
          </Button>
        ) : (
          // Giữ chỗ bằng đúng bề ngang nút chép (size-7 trừ -mr-1.5) để cột giá trị thẳng hàng.
          <span className="w-[1.375rem] shrink-0" />
        )}
      </div>
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
  const { data, refetch } = useQuery({
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

  // Khung nhúng payOS — trạng thái gắn với TỪNG đơn (đổi đơn là tính lại từ đầu):
  //   own    = khách chọn / buộc phải dùng màn QR tự vẽ
  //   left   = khung đã rời trang payOS (load lần 2) → đang hỏi kết quả
  const [frame, setFrame] = useState<{ code: string | null; own: boolean; left: boolean }>({
    code: null,
    own: false,
    left: false,
  });
  const frameState = frame.code === orderCode ? frame : { code: orderCode, own: false, left: false };
  const frameLoads = useRef<{ code: string | null; n: number }>({ code: null, n: 0 });

  function onFrameLoad() {
    if (frameLoads.current.code !== orderCode) frameLoads.current = { code: orderCode, n: 0 };
    frameLoads.current.n += 1;
    if (frameLoads.current.n < 2) return;
    setFrame({ code: orderCode, own: false, left: true });
    refetch().then((r) => {
      // Rời payOS mà đơn vẫn chờ (khách bấm link lạ trong khung…) → về màn QR tự vẽ.
      if (r.data?.checkout.status === "PENDING") {
        setFrame({ code: orderCode, own: true, left: false });
      }
    });
  }

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
  const embedded = isPending && !!current.checkoutUrl && !frameState.own;
  const amountStr = `${nf.format(current.amount)}₫`;

  return (
    <Dialog open={checkout !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          embedded
            ? "gap-0 overflow-hidden p-0 sm:max-w-[min(68rem,calc(100%-2rem))]"
            : isPending
              ? "max-h-[90vh] overflow-y-auto sm:max-w-[min(46rem,calc(100%-2rem))]"
              : "sm:max-w-md"
        )}
      >
        <DialogHeader
          className={cn(
            isPending && "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5",
            embedded && "border-b px-4 py-3 pr-12"
          )}
        >
          {isPending && (
            <span className="row-span-2 flex size-10 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <QrCode className="size-5" />
            </span>
          )}
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
            <button
              type="button"
              title="Sao chép mã đơn"
              className="tabular-nums text-foreground underline-offset-2 hover:underline"
              onClick={() => copyText("mã đơn", current.orderCode)}
            >
              {current.orderCode}
            </button>
          </DialogDescription>
        </DialogHeader>

        {embedded && (
          <>
            {frameState.left ? (
              <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Đang kiểm tra kết quả thanh toán…
              </div>
            ) : (
              <iframe
                key={current.orderCode}
                src={current.checkoutUrl!}
                title="Trang thanh toán payOS"
                allow="clipboard-write"
                onLoad={onFrameLoad}
                className="block h-[min(46rem,calc(90vh-7rem))] w-full border-0 bg-white"
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
              <span className="hidden items-center gap-1.5 sm:flex">
                <Loader2 className="size-3 animate-spin" /> Gói tự mở trong vài giây sau khi tiền về
              </span>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => setFrame({ code: orderCode, own: true, left: false })}
                >
                  Dùng mã QR của Hubsell
                </button>
                <a
                  href={current.checkoutUrl!}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                >
                  <ExternalLink className="size-3" /> Mở tab mới
                </a>
              </span>
            </div>
          </>
        )}

        {isPending && !embedded && (
          <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
            {/* ===== Tấm QR ===== */}
            <div className="flex flex-col items-center rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-5 py-5 text-center text-white">
              <div className="rounded-lg bg-white p-3 shadow-lg shadow-emerald-900/20">
                {current.qrCode ? (
                  <QRCodeSVG value={current.qrCode} size={184} level="M" includeMargin={false} />
                ) : (
                  <div className="flex size-[184px] items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Đang tạo mã…
                  </div>
                )}
              </div>
              <p className="mt-4 text-2xl font-semibold tabular-nums">{amountStr}</p>
              <p className="mt-0.5 text-sm text-white/85">Quét bằng app ngân hàng</p>
              <p className="mt-4 flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm ring-1 ring-inset ring-white/25">
                <Loader2 className="size-3.5 animate-spin" /> Đang chờ tiền về
              </p>
              {expiresIn !== null && (
                <p
                  className={cn(
                    "mt-1.5 flex items-center gap-1 text-xs tabular-nums text-white/85",
                    // Nền xanh đặc: chữ đỏ không đọc được — sắp hết hạn thì đổi sang viên đỏ chữ trắng.
                    expiresIn < 5 * 60_000 && "rounded-full bg-red-500 px-2 py-0.5 font-medium text-white"
                  )}
                >
                  <Clock className="size-3" /> Mã còn hiệu lực {fmtCountdown(expiresIn)}
                </p>
              )}
            </div>

            {/* ===== Tóm tắt đơn + chuyển khoản tay ===== */}
            <div className="flex min-w-0 flex-col">
              <div className="flex items-baseline justify-between gap-4 border-b pb-3">
                <div className="min-w-0">
                  <p className="text-sm">
                    Gói {current.planName} · {CYCLE_LABEL[current.cycle]}
                  </p>
                  <p className="text-xs text-muted-foreground">Thuê bao phần mềm Hubsell</p>
                </div>
                <p className="shrink-0 text-sm tabular-nums">{amountStr}</p>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">Hoặc chuyển khoản theo thông tin sau</p>
              <div className="mt-1">
                <InfoRow
                  label="Ngân hàng"
                  value={
                    current.bank?.name ??
                    (current.bank ? `BIN ${current.bank.bin}` : "Đang lấy thông tin…")
                  }
                />
                {current.bank && (
                  <>
                    <InfoRow label="Chủ tài khoản" value={current.bank.accountName || "—"} />
                    {/* Cổng cấp tài khoản định danh (có chữ) riêng cho từng đơn — nói rõ để
                        khách khỏi ngờ vì khác số tài khoản công ty in ở trang chính sách. */}
                    <InfoRow
                      label="Số tài khoản"
                      value={current.bank.accountNumber}
                      copy
                      hint={
                        /\D/.test(current.bank.accountNumber)
                          ? "Tài khoản định danh cấp riêng cho đơn này"
                          : undefined
                      }
                    />
                  </>
                )}
                <InfoRow label="Số tiền" value={amountStr} copy={String(current.amount)} strong accent />
                <InfoRow label="Nội dung" value={current.transferContent} copy strong />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Chuyển tay cần nhập đúng số tiền và nội dung. Gói tự mở trong vài giây sau khi tiền về.
              </p>

              <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                {current.checkoutUrl ? (
                  <a
                    href={current.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="size-3" /> Mở trang thanh toán payOS
                  </a>
                ) : (
                  <span />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(current.orderCode)}
                >
                  Hủy mã này
                </Button>
              </div>
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
