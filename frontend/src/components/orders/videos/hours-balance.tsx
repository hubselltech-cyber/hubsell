"use client";

import * as React from "react";
import { Clock, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchPackVideoHours, type PackVideoHours } from "@/lib/api";
import { formatVND } from "@/lib/format";
import { formatHoursBalance, hoursLevel, type HoursLevel } from "@/lib/pack-video";
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
  if (hours.remainingSeconds < 0) return `Quay lố ${formatHoursBalance(hours.remainingSeconds)}`;
  if (hours.remainingSeconds === 0) return "Đã hết giờ quay";
  return `Còn ${formatHoursBalance(hours.remainingSeconds)}`;
}

/**
 * Khối gọn ghim mép phải hàng tab: "Còn 999 giờ 44 phút / 1.000 giờ" + thanh đã dùng + nút
 * "Mua thêm giờ quay". Hiện ở MỌI tab để khách luôn thấy mình còn bao nhiêu giờ.
 */
export function HoursBalanceBar() {
  const q = usePackVideoHours();
  const [buying, setBuying] = React.useState(false);
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
      <Button size="sm" onClick={() => setBuying(true)}>
        <Plus className="size-4" />
        Mua thêm giờ quay
      </Button>
      <BuyHoursDialog open={buying} onClose={() => setBuying(false)} hours={hours ?? null} />
    </div>
  );
}

/**
 * Hộp MUA THÊM GIỜ QUAY. Gói và giá do máy chủ trả (backend/src/config/pack-video.ts). Khi máy chủ
 * báo chưa mở bán (`salesOpen = false`) hoặc gói chưa có giá thì hộp nói thẳng như vậy — không vẽ
 * giá giả, không có nút thanh toán dẫn vào ngõ cụt.
 */
function BuyHoursDialog({
  open,
  onClose,
  hours,
}: {
  open: boolean;
  onClose: () => void;
  hours: PackVideoHours | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mua thêm giờ quay</DialogTitle>
          <DialogDescription>
            Giờ quay trừ theo thời lượng các video đã tải lên. Mỗi video quay bao lâu là tùy bạn.
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
                label={hours.remainingSeconds < 0 ? "Quay lố" : "Còn lại"}
                value={formatHoursBalance(hours.remainingSeconds)}
                className={LEVEL_TEXT[hoursLevel(hours.purchasedSeconds, hours.usedSeconds)]}
              />
            </dl>

            <ul className="grid gap-2 sm:grid-cols-2">
              {hours.packages.map((p) => (
                <li key={p.hours} className="rounded-lg border p-3">
                  <p className="text-base font-semibold tabular-nums">{p.hours.toLocaleString("vi-VN")} giờ quay</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {p.priceVnd === null ? "Giá chưa công bố" : formatVND(p.priceVnd)}
                  </p>
                </li>
              ))}
            </ul>

            {!hours.salesOpen && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Giờ quay chưa mở bán. Khi mở bán, bạn chọn gói và thanh toán ngay tại hộp này.
              </p>
            )}

            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Hết giờ thì không mở được video mới; video đang quay dở vẫn quay nốt.</li>
              <li>Phần quay lố được trừ vào lần mua sau.</li>
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
