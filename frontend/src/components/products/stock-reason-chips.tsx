"use client";

import { STOCK_REASONS, type StockReasonCode } from "@/lib/stock-reason";
import { cn } from "@/lib/utils";

/**
 * HÀNG CHIP "LÝ DO" của hộp Nhập / Xuất và trang phiếu nhiều mã — kho chuẩn quốc tế lát 4 (20/11/2026).
 * Một chạm chọn lý do; bấm lại chip đang chọn = bỏ chọn (lý do không bắt buộc — dòng không lý do vẫn
 * ghi được, báo cáo xếp vào "Xuất không ghi lý do"). Ghi chú tự do là ô riêng bên dưới.
 */
export function StockReasonChips({
  type,
  value,
  onChange,
  disabled,
}: {
  type: "IMPORT" | "EXPORT";
  value: StockReasonCode | "";
  onChange: (next: StockReasonCode | "") => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lý do">
      {STOCK_REASONS[type].map((r) => {
        const active = value === r.code;
        return (
          <button
            key={r.code}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(active ? "" : r.code)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
