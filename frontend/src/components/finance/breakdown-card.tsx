"use client";

import type { LucideIcon } from "lucide-react";
import { HelpCircle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BreakdownItem } from "@/lib/api";
import { formatVND, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BreakdownCardProps {
  title: string;
  subtitle?: string;
  total: number;
  icon: LucideIcon;
  accentClass: string; // màu ô icon
  valueClass?: string; // màu số lớn
  items: BreakdownItem[];
  /** Số tiền trong danh sách là khoản BỊ TRỪ → hiển thị dấu trừ, màu đỏ */
  itemsAreDeductions?: boolean;
  /** Tô màu số theo dấu (dương xanh / âm đỏ) — dùng cho cột Lợi nhuận */
  colorBySign?: boolean;
  footer?: React.ReactNode;
}

// Icon dấu hỏi + tooltip giải thích công thức
function HintIcon({ hint }: { hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Giải thích"
            className="text-muted-foreground/60 transition-colors hover:text-foreground"
          />
        }
      >
        <HelpCircle className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs leading-relaxed">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

export function BreakdownCard({
  title,
  subtitle,
  total,
  icon: Icon,
  accentClass,
  valueClass,
  items,
  itemsAreDeductions = false,
  colorBySign = false,
  footer,
}: BreakdownCardProps) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        {/* Tiêu đề + số lớn */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              accentClass
            )}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <p
              className={cn(
                "text-xl font-bold leading-tight tracking-tight break-words",
                valueClass,
                colorBySign &&
                  (total >= 0 ? "text-emerald-700" : "text-rose-700")
              )}
            >
              {formatVND(total)}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Danh sách chi tiết */}
        <div className="flex-1 space-y-2 border-t pt-3">
          {items.map((item) => {
            // Khoản trợ giá (amount âm trong nhóm khấu trừ) là khoản được CỘNG lại
            const isCredit = itemsAreDeductions && item.amount < 0;
            const display = Math.abs(item.amount);
            return (
              <div key={item.key} className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">{item.label}</span>
                  <HintIcon hint={item.hint} />
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      itemsAreDeductions
                        ? isCredit
                          ? "text-emerald-600"
                          : "text-rose-600"
                        : colorBySign
                          ? item.amount >= 0
                            ? "text-emerald-700"
                            : "text-rose-700"
                          : "text-foreground"
                    )}
                  >
                    {itemsAreDeductions && (isCredit ? "+ " : "− ")}
                    {formatVND(display)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {item.percent}%
                    {item.count !== undefined
                      ? ` · ${formatNumber(item.count)} đơn`
                      : ""}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {footer && (
          <div className="border-t pt-3 text-xs text-muted-foreground">
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
