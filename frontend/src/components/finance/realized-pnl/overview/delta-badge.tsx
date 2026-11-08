"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * % thay đổi so kỳ liền trước. Kỳ trước = 0 / thiếu → null (không so được).
 * Mẫu số lấy trị tuyệt đối: lỗ −10 tr → −5 tr là "+50 %".
 */
export function deltaPercent(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Ngưỡng coi như "đi ngang" — |Δ| dưới mức này tô xám (mặc định tự chọn, không nguồn nào nêu số). */
const FLAT_THRESHOLD = 1;

/**
 * Huy hiệu tăng/giảm so kỳ trước — MÀU THEO Ý NGHĨA, không theo hướng: lãi
 * tăng là xanh, nhưng thất thu / tỷ lệ hoàn tăng là đỏ (`inverted`). Đi ngang
 * (|Δ| < 1 %) tô xám để mắt không bị kéo vào thay đổi vặt.
 *   unit "%"  → "+12,4 %"   (tỷ lệ thay đổi)
 *   unit "pt" → "+2,3 điểm" (chênh lệch giữa hai tỷ lệ %)
 */
export function DeltaBadge({
  delta,
  inverted = false,
  unit = "%",
  hint,
  className,
}: {
  delta: number | null | undefined;
  inverted?: boolean;
  unit?: "%" | "pt";
  hint?: string;
  className?: string;
}) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const flat = Math.abs(delta) < FLAT_THRESHOLD;
  const good = inverted ? delta <= 0 : delta >= 0;
  const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  // Kỳ trước quá nhỏ (vài trăm nghìn → vài chục triệu) cho ra "+17.722 %" vô nghĩa — kẹp hiển thị.
  const capped = unit === "%" && Math.abs(delta) > 999;
  const abs = capped ? "999" : Math.abs(delta).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
  const text = `${capped ? (delta > 0 ? ">+" : "<−") : delta > 0 ? "+" : delta < 0 ? "−" : ""}${abs}${unit === "pt" ? " điểm" : " %"}`;
  return (
    <span
      title={hint}
      className={cn(
        "inline-flex cursor-default items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        flat
          ? "bg-slate-100 text-slate-600"
          : good
            ? "bg-emerald-50 text-emerald-600"
            : "bg-rose-50 text-red-500",
        className
      )}
    >
      <Icon className="size-3" />
      {text}
    </span>
  );
}

/** Huy hiệu "Mới" — mã không bán ở kỳ trước nên không có gì để so. */
export function NewBadge({ className }: { className?: string }) {
  return (
    <span
      title="Kỳ trước chưa bán mã này"
      className={cn(
        "inline-flex cursor-default items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700",
        className
      )}
    >
      Mới
    </span>
  );
}
