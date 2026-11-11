"use client";

// ============================================================
// Ô CHỌN SỐ ĐƠN MỖI THÁNG cho gói tính theo đơn (Enterprise tự phục vụ, 11/11/2026).
// Anh Trung: "thiết kế lại giao diện cho khách dễ nhập… sau này có thể nhân rộng cho
// các gói bên trên" → thành phần ĐỘC LẬP, không biết gì về Enterprise: chỉ cần mức
// tối thiểu. Ba cách nhập cho khách: bấm mức gợi ý (chip), bấm − / + (bước theo cỡ
// số), hoặc gõ thẳng (tự chấm nghìn). Dưới mức tối thiểu báo đỏ ngay dưới ô.
// Kèm `CyclePicker` (bước 2 — chọn số tháng, anh Trung 11/11 "để số tháng bên dưới
// để khách dễ dùng") và `StepLabel` đánh số bước, để dải mua đi một mạch trái → phải.
// ============================================================

import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("vi-VN");

/**
 * Câu thông báo PHẦN VƯỢT của gói tính theo đơn (anh Trung 11/11/2026: "vượt trần gói
 * đã mua thì tính 65đ/1 đơn vượt và thanh toán vào mùng 5 của tháng tiếp theo") —
 * một nguồn chữ cho bảng giá, thẻ gói và thanh cảnh báo; giá + ngày đọc từ /me.
 */
export function overageNotice(pricePerOrder: number | null | undefined, dueDay: number): string {
  const price = pricePerOrder != null ? `${nf.format(pricePerOrder)} ₫` : "theo giá gói";
  return `Vượt số đơn đã mua: tính ${price} cho mỗi đơn vượt, thanh toán trước hết ngày mùng ${dueDay} tháng sau.`;
}

/** Mức gợi ý từ mức tối thiểu: ×1 · ×1,5 · ×2,5 · ×5 (20k → 20k/30k/50k/100k), tròn nghìn. */
export function volumePresets(min: number): number[] {
  return [1, 1.5, 2.5, 5].map((k) => Math.round((min * k) / 1000) * 1000);
}

/** Bước của nút − / +: 1.000 dưới 50k, 5.000 tới 200k, 10.000 từ đó trở lên. */
function stepOf(v: number): number {
  return v < 50_000 ? 1_000 : v < 200_000 ? 5_000 : 10_000;
}

/** Nhãn bước có số tròn (1 · 2 · …) — dải mua đọc theo thứ tự. */
export function StepLabel({ n, children, htmlFor }: { n?: number; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex items-center gap-2 text-sm font-semibold">
      {n !== undefined && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {n}
        </span>
      )}
      {children}
    </label>
  );
}

/** Chọn kỳ thanh toán (số tháng) — nút bấm 2 × 2, nhãn phụ "Tiết kiệm N%" do nơi gọi tính. */
export function CyclePicker<T extends string>({
  options,
  value,
  onChange,
  step,
  className,
}: {
  options: { value: T; label: string; note?: string | null; best?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  step?: number;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <StepLabel n={step}>Thanh toán mấy tháng?</StepLabel>
      <div className="mt-2 grid grid-cols-2 gap-2 2xl:grid-cols-4" role="radiogroup">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex h-12 flex-col items-center justify-center rounded-lg border px-2 leading-tight transition-colors",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/50 hover:bg-muted"
              )}
            >
              <span className="text-sm font-semibold">{o.label}</span>
              {o.note && (
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    on ? "opacity-90" : "text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  {o.note}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OrderVolumePicker({
  id,
  value,
  min,
  onChange,
  max = 9_999_999,
  step,
  minMessage,
  className,
}: {
  step?: number;
  /** Câu báo khi dưới mức tối thiểu (vd "Gói Enterprise chỉ áp dụng từ 20.000 đơn/tháng"). */
  minMessage?: string;
  id: string;
  value: number | null;
  min: number;
  onChange: (v: number | null) => void;
  max?: number;
  className?: string;
}) {
  const bad = value === null || value < min;
  const current = value ?? min;
  const dec = () => {
    const s = stepOf(current - 1);
    onChange(Math.max(min, Math.ceil(current / s) * s - s));
  };
  const inc = () => {
    const s = stepOf(current);
    onChange(Math.min(max, Math.floor(current / s) * s + s));
  };
  return (
    <div className={cn("min-w-0", className)}>
      <StepLabel n={step} htmlFor={id}>
        Shop bán khoảng bao nhiêu đơn mỗi tháng?
      </StepLabel>

      {/* Điện thoại: 4 chip chia đều một hàng (flex-wrap ở 375px rớt chip thứ 4 xuống dòng). */}
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5">
        {volumePresets(min).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-pressed={value === p}
            className={cn(
              "h-9 rounded-full border px-1 text-[13px] font-semibold tabular-nums transition-colors sm:px-3 sm:text-sm",
              value === p
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary/50 hover:bg-muted"
            )}
          >
            {nf.format(p)}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div
          className={cn(
            "flex h-11 items-stretch overflow-hidden rounded-lg border bg-card",
            bad ? "border-rose-400" : "border-input"
          )}
        >
          <button
            type="button"
            onClick={dec}
            disabled={current <= min}
            aria-label="Giảm số đơn"
            className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <input
            id={id}
            inputMode="numeric"
            autoComplete="off"
            className="w-28 border-x bg-transparent text-center text-lg font-bold tabular-nums outline-none focus:bg-muted/40 sm:w-32"
            value={value === null ? "" : nf.format(value)}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, String(max).length);
              onChange(digits ? Math.min(max, Number(digits)) : null);
            }}
            aria-invalid={bad}
          />
          <button
            type="button"
            onClick={inc}
            aria-label="Tăng số đơn"
            className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <span className="whitespace-nowrap text-sm text-muted-foreground">đơn / tháng</span>
      </div>

      <p
        className={cn(
          "mt-1.5 text-xs",
          bad ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground"
        )}
      >
        {bad
          ? (minMessage ?? `Tối thiểu ${nf.format(min)} đơn mỗi tháng`)
          : `Tối thiểu ${nf.format(min)} đơn — giá các kỳ tự đổi theo số bạn chọn.`}
      </p>
    </div>
  );
}
