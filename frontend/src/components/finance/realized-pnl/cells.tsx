"use client";

import { Money } from "@/components/ui/money";
import type { PnlItemLine } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Ô & hằng dùng chung cho các bảng Lãi/Lỗ theo sàn (Shopee, TikTok…). Gom về một
 * chỗ để hai bảng nhất quán nền màu block, định dạng số và cách hiển thị dòng
 * sản phẩm.
 */

/** Nền nhẹ theo block cột — dùng cho ô DỮ LIỆU (giữ mã màu để quét theo cột). */
export const BLOCK = {
  info: "",
  revenue: "bg-emerald-50/60",
  ship: "bg-sky-50/60",
  fee: "bg-rose-50/50",
  result: "bg-slate-100/70",
} as const;

/**
 * Class cho VÙNG TIÊU ĐỀ bảng — đồng bộ 3 bảng (Shopee/TikTok/Generic).
 * Cả header dùng chung một nền xám nhạt để tách hẳn với vùng dữ liệu trắng bên
 * dưới; mã màu nhóm chuyển sang thể hiện bằng MÀU CHỮ của tầng trên.
 *
 * - HEADER_GROUP: tầng trên (tên nhóm) — in đậm, có border-bottom phân tách tầng.
 * - HEADER_COL:   tầng dưới (tên cột) — border-bottom đậm ngăn cách với dữ liệu.
 * Cả hai đệm dọc py-3 cho thoáng.
 */
export const HEADER_GROUP =
  "border-b border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold uppercase tracking-wide";
export const HEADER_COL =
  "border-b-2 border-slate-200 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-500";

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

/**
 * Cột "Chi tiết sản phẩm" — mini-list gọn: chỉ Mã SKU (hoặc mã phân loại) × SL,
 * xếp chồng dọc từng dòng. BỎ tên sản phẩm cho bảng gọn nhất.
 */
export function ProductLines({ items }: { items: PnlItemLine[] }) {
  if (items.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <div className="space-y-0.5">
      {items.map((it, i) => (
        <div key={`${it.sku}-${i}`} className="whitespace-nowrap leading-tight">
          <span className="font-mono text-[11px] text-slate-600">
            {it.variation || it.sku}
          </span>
          <span className="text-slate-400"> × {it.quantity}</span>
        </div>
      ))}
    </div>
  );
}
