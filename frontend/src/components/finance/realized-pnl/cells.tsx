"use client";

import { Money } from "@/components/ui/money";
import type { PnlItemLine } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Ô & hằng dùng chung cho các bảng Lãi/Lỗ theo sàn (Shopee, TikTok…). Gom về một
 * chỗ để hai bảng nhất quán nền màu block, định dạng số và cách hiển thị dòng
 * sản phẩm.
 */

/** Nền nhẹ theo block cột — dùng cho cả ô tiêu đề và ô dữ liệu. */
export const BLOCK = {
  info: "",
  revenue: "bg-emerald-50/60",
  ship: "bg-sky-50/60",
  fee: "bg-rose-50/50",
  result: "bg-slate-100/70",
} as const;

export const PNL_STATUS_LABEL: Record<string, string> = {
  PENDING: "Chờ xử lý",
  PROCESSED: "Đã xử lý",
  SHIPPING: "Đang giao",
  DELIVERED: "Đã giao",
  CANCELLED: "Đã hủy",
};

/** Ô phí/khấu trừ (âm): hiện dấu trừ khi > 0, gạch mờ khi = 0. */
export function Deduction({
  value,
  tone = "text-rose-600",
}: {
  value: number;
  tone?: string;
}) {
  if (!value) return <span className="text-slate-300">—</span>;
  return <Money value={value} negative className={tone} />;
}

/** Ô số dương (doanh thu). */
export function Amount({ value, tone }: { value: number; tone?: string }) {
  if (!value) return <span className="text-slate-300">—</span>;
  return <Money value={value} className={tone} />;
}

/** Ô LỢI NHUẬN THỰC TẾ: xanh đậm nếu > 0, đỏ đậm (có dấu −) nếu < 0. */
export function ProfitCell({ value }: { value: number }) {
  if (value === 0)
    return <span className="font-bold text-slate-400">0 ₫</span>;
  const positive = value > 0;
  return (
    <Money
      value={Math.abs(value)}
      negative={!positive}
      className={cn("font-bold", positive ? "text-emerald-600" : "text-rose-600")}
    />
  );
}

/** Cột "Chi tiết sản phẩm" — xếp chồng từng dòng: SKU · Tên · Phân loại × SL. */
export function ProductLines({ items }: { items: PnlItemLine[] }) {
  if (items.length === 0)
    return <span className="text-slate-300">—</span>;
  const shown = items.slice(0, 3);
  return (
    <div className="min-w-[220px] space-y-1">
      {shown.map((it, i) => (
        <div key={`${it.sku}-${i}`} className="leading-tight">
          <span className="font-mono text-[11px] text-slate-400">{it.sku}</span>
          <span className="ml-1.5 text-slate-700">{it.name}</span>
          <span className={cn(TEXT_SUB)}>
            {it.variation ? ` · ${it.variation}` : ""} × {it.quantity}
          </span>
        </div>
      ))}
      {items.length > 3 && (
        <div className={cn(TEXT_SUB)}>+{items.length - 3} sản phẩm khác</div>
      )}
    </div>
  );
}
