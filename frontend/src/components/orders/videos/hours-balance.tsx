"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GatewayCheckoutDialog } from "@/components/settings/gateway-checkout-dialog";
import {
  ApiError,
  createPackHoursCheckout,
  fetchPackVideoHours,
  fetchPlanCheckout,
  type GatewayCheckout,
  type PackVideoHours,
} from "@/lib/api";
import { formatVND } from "@/lib/format";
import {
  approxOneMinuteClips,
  formatHoursBalance,
  hoursLevel,
  quoteHoursForDisplay,
  type HoursLevel,
} from "@/lib/pack-video";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * SỐ GIỜ QUAY của chủ shop — một nguồn cho cả dải đầu trang lẫn tab Thống kê (cùng khóa truy vấn
 * nên chỉ gọi máy chủ một lần). Anh Trung 16/11: "khách mua 1000 giờ, đã quay 400 thì còn lại 600".
 */
export function usePackVideoHours() {
  return useApiQuery({ queryKey: qk.packVideoHours(), queryFn: fetchPackVideoHours });
}

const LEVEL_TEXT: Record<HoursLevel, string> = {
  none: "text-muted-foreground",
  ok: "text-foreground",
  low: "text-amber-600",
  out: "text-rose-600",
};

const LEVEL_BAR: Record<HoursLevel, string> = {
  none: "bg-muted-foreground/30",
  ok: "bg-emerald-500",
  low: "bg-amber-500",
  out: "bg-rose-500",
};

/** Câu chính của số dư: còn bao nhiêu, đã hết, quay lố, hay chưa mua. */
export function remainingLabel(hours: PackVideoHours): string {
  if (hours.purchasedSeconds <= 0 && hours.usedSeconds <= 0) return "Chưa mua giờ quay";
  if (hours.remainingSeconds < 0) return `Vượt gói ${formatHoursBalance(hours.remainingSeconds)}`;
  if (hours.remainingSeconds === 0) return "Đã hết giờ quay";
  return `Còn ${formatHoursBalance(hours.remainingSeconds)}`;
}

/**
 * Khối gọn ghim mép phải hàng tab: "Còn 999 giờ 44 phút / 1.000 giờ" + thanh đã dùng + nút
 * "Mua thêm giờ quay". Hiện ở MỌI tab để khách luôn thấy mình còn bao nhiêu giờ.
 */
export function HoursBalanceBar() {
  const q = usePackVideoHours();
  const hours = q.data;

  // Chưa có số thì giữ chỗ bằng đúng nút mua — không nhảy bố cục khi số về.
  const level = hours ? hoursLevel(hours.purchasedSeconds, hours.usedSeconds) : "none";
  const usedPct =
    hours && hours.purchasedSeconds > 0
      ? Math.min(100, Math.max(0, (hours.usedSeconds / hours.purchasedSeconds) * 100))
      : 0;

  return (
    <div className="flex items-center gap-3 pb-1.5">
      {hours && (
        <div
          className="hidden min-w-0 flex-col items-end sm:flex"
          title={
            hours.purchasedSeconds > 0
              ? `Đã mua ${formatHoursBalance(hours.purchasedSeconds)} · đã quay ${formatHoursBalance(hours.usedSeconds)}`
              : undefined
          }
        >
          <p className="flex items-center gap-1.5 whitespace-nowrap text-sm">
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("font-semibold tabular-nums", LEVEL_TEXT[level])}>{remainingLabel(hours)}</span>
            {hours.purchasedSeconds > 0 && (
              <span className="text-muted-foreground tabular-nums">
                / {formatHoursBalance(hours.purchasedSeconds)}
              </span>
            )}
          </p>
          {hours.purchasedSeconds > 0 && (
            <div
              className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Phần giờ quay đã dùng"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(usedPct)}
            >
              <div className={cn("h-full rounded-full", LEVEL_BAR[level])} style={{ width: `${usedPct}%` }} />
            </div>
          )}
        </div>
      )}
      <BuyHoursButton hours={hours ?? null} resumeFromUrl />
    </div>
  );
}

/**
 * Nút "Mua thêm giờ quay" + hộp mua + hộp QR payOS — dùng ở hàng tab và trên màn quay khi hết giờ.
 * Luồng: chọn / nhập số giờ → "Thanh toán" → máy chủ tính tiền, trả mã QR → hộp QR dùng chung với mua gói
 * (poll 3 giây) → tiền về là giờ tự cộng, số dư ở hàng tab đổi ngay.
 */
export function BuyHoursButton({
  hours,
  variant = "default",
  resumeFromUrl = false,
}: {
  hours: PackVideoHours | null;
  variant?: "default" | "outline";
  /** Chỉ MỘT nút trên trang bật: mở lại hộp QR khi payOS chuyển khách về (?checkout=<mã đơn>). */
  resumeFromUrl?: boolean;
}) {
  const qc = useQueryClient();
  const [buying, setBuying] = React.useState(false);
  const [checkout, setCheckout] = React.useState<GatewayCheckout | null>(null);

  const pay = useMutation({
    mutationFn: (h: number) => createPackHoursCheckout(h),
    onSuccess: (res) => {
      setBuying(false);
      setCheckout(res.checkout);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Không tạo được mã thanh toán — thử lại sau."),
  });

  // Khách trả ở tab payOS riêng rồi được chuyển về trang này → mở lại đúng đơn để thấy kết quả. Đọc
  // window thay vì useSearchParams để khỏi bọc Suspense cho cả trang (cùng cách trang Gói dịch vụ).
  React.useEffect(() => {
    if (!resumeFromUrl || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("checkout");
    if (!code) return;
    params.delete("checkout");
    params.delete("result");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    fetchPlanCheckout(code)
      .then((res) => {
        if (res.checkout.packHours != null) setCheckout(res.checkout);
      })
      .catch(() => {});
  }, [resumeFromUrl]);

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setBuying(true)}>
        <Plus className="size-4" />
        Mua thêm giờ quay
      </Button>
      <BuyHoursDialog
        open={buying}
        onClose={() => setBuying(false)}
        hours={hours}
        paying={pay.isPending}
        onPay={(h) => pay.mutate(h)}
      />
      <GatewayCheckoutDialog
        checkout={checkout}
        onClose={() => {
          setCheckout(null);
          qc.invalidateQueries({ queryKey: qk.packVideoHours() });
        }}
        onRetry={(c) => {
          setCheckout(null);
          if (c.packHours != null) pay.mutate(c.packHours);
        }}
      />
    </>
  );
}

/**
 * Hộp MUA THÊM GIỜ QUAY (phác thảo anh Trung duyệt 16/11; 18/11 anh: "thêm cả việc nhập số lượng giờ quay
 * video muốn mua, từ đó tính ra tiền"): số dư · ba gói sẵn (lối tắt) · Ô "SỐ GIỜ MUỐN MUA" · dòng
 * "n giờ × 1.500 đ" · nút "Thanh toán X đ" · hai dòng luật hết giờ.
 *
 * MỘT nguồn số: ô nhập. Bấm một gói sẵn chỉ là điền số của gói vào ô; khách sửa số thì tiền đổi theo
 * ngay. Đơn giá, gói, tối thiểu / tối đa do MÁY CHỦ trả (backend/src/config/pack-video.ts); số tiền lúc
 * thanh toán cũng do máy chủ tính — web chỉ gửi SỐ GIỜ. `salesOpen = false` → nút báo "chưa mở thanh toán".
 */
function BuyHoursDialog({
  open,
  onClose,
  hours,
  paying,
  onPay,
}: {
  open: boolean;
  onClose: () => void;
  hours: PackVideoHours | null;
  paying: boolean;
  onPay: (hours: number) => void;
}) {
  const [value, setValue] = React.useState("");
  const ready = hours !== null;
  const defaultHours = hours ? (hours.pricing.presets[1] ?? hours.pricing.presets[0] ?? hours.pricing.minHours) : null;

  // Mỗi lần MỞ hộp: điền sẵn gói giữa (gói hay mua nhất trong phác thảo). Không đặt lại khi số dư tự làm
  // mới lúc hộp đang mở — khách đang gõ dở thì giữ nguyên số đang gõ.
  React.useEffect(() => {
    if (open && ready && defaultHours !== null) setValue(String(defaultHours));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy lúc mở hộp / lúc số về lần đầu
  }, [open, ready]);

  const quote = React.useMemo(
    () => (hours ? quoteHoursForDisplay(value, hours.pricing) : null),
    [hours, value]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mua thêm giờ quay</DialogTitle>
          <DialogDescription>
            Giờ quay trừ theo thời lượng các video đã tải lên. Giờ đã mua không hết hạn.
          </DialogDescription>
        </DialogHeader>

        {!hours ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Đang tải số giờ…</p>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/40 p-3 text-center">
              <BalanceCell label="Đã mua" value={formatHoursBalance(hours.purchasedSeconds)} />
              <BalanceCell label="Đã quay" value={formatHoursBalance(hours.usedSeconds)} />
              <BalanceCell
                label={hours.remainingSeconds < 0 ? "Vượt gói" : "Còn lại"}
                value={formatHoursBalance(hours.remainingSeconds)}
                className={LEVEL_TEXT[hoursLevel(hours.purchasedSeconds, hours.usedSeconds)]}
              />
            </dl>

            <div role="group" aria-label="Gói sẵn" className="grid grid-cols-3 gap-2">
              {hours.pricing.presets.map((h) => {
                const active = quote?.ok === true && quote.hours === h;
                return (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setValue(String(h))}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted"
                    )}
                  >
                    <p className="text-base font-semibold tabular-nums">{h.toLocaleString("vi-VN")} giờ</p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums">{formatVND(h * hours.pricing.priceVnd)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{approxOneMinuteClips(h)}</p>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pack-hours-custom" className="text-sm font-medium">
                Số giờ muốn mua
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="pack-hours-custom"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={`Từ ${hours.pricing.minHours.toLocaleString("vi-VN")} giờ`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && quote?.ok && hours.salesOpen && !paying) onPay(quote.hours);
                  }}
                  className="w-40 text-sm tabular-nums"
                  aria-invalid={quote !== null && !quote.ok && quote.error !== null}
                  aria-describedby="pack-hours-custom-hint"
                />
                <span className="text-sm text-muted-foreground">giờ</span>
              </div>
              {quote && !quote.ok && quote.error ? (
                <p id="pack-hours-custom-hint" className="text-sm text-rose-600">
                  {quote.error}
                </p>
              ) : (
                <p id="pack-hours-custom-hint" className="text-xs text-muted-foreground tabular-nums">
                  Nhập số giờ bất kỳ từ {hours.pricing.minHours.toLocaleString("vi-VN")} đến{" "}
                  {hours.pricing.maxHours.toLocaleString("vi-VN")} giờ
                  {quote?.ok ? ` · ${approxOneMinuteClips(quote.hours)}` : ""}
                </p>
              )}
            </div>

            <div className="flex items-baseline justify-between rounded-lg border p-3">
              <span className="text-sm text-muted-foreground tabular-nums">
                {quote?.ok
                  ? `${quote.hours.toLocaleString("vi-VN")} giờ × ${formatVND(hours.pricing.priceVnd)}`
                  : `Đơn giá ${formatVND(hours.pricing.priceVnd)} / giờ`}
              </span>
              <span className="text-lg font-semibold tabular-nums">{quote?.ok ? formatVND(quote.amountVnd) : "—"}</span>
            </div>

            <div className="space-y-1.5">
              <Button
                className="w-full"
                disabled={!quote?.ok || !hours.salesOpen || paying}
                onClick={() => {
                  if (quote?.ok) onPay(quote.hours);
                }}
              >
                {paying && <Loader2 className="size-4 animate-spin" />}
                {quote?.ok ? `Thanh toán ${formatVND(quote.amountVnd)}` : "Thanh toán"}
              </Button>
              {!hours.salesOpen && (
                <p className="text-center text-xs text-muted-foreground">
                  Chưa mở thanh toán giờ quay — sắp có.
                </p>
              )}
            </div>

            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Hết giờ thì không mở được video mới; video đang quay dở vẫn quay nốt.</li>
              <li>Phần thời gian vượt gói sẽ khấu trừ vào lần thanh toán tiếp theo.</li>
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BalanceCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm font-semibold tabular-nums", className)} title={value}>
        {value}
      </dd>
    </div>
  );
}
