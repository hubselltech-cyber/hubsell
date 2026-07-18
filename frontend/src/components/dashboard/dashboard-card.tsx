"use client";

import type { LucideIcon } from "lucide-react";

import {
  TEXT_CARD_TITLE,
  TEXT_HERO_NUMBER,
  TEXT_SUB,
} from "@/lib/typography";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * ══ THẺ CHỈ SỐ CHUẨN CỦA HUBSELL ══
 *
 * Mọi khối số liệu trên mọi trang (Tổng quan, Báo cáo dòng tiền, Chi phí vận
 * hành, Cảnh báo đơn lỗ, Đối soát ship…) đều dùng component này, để giao diện
 * luôn nhất quán và chỉ cần sửa 1 chỗ khi muốn đổi phong cách.
 *
 * Ba quy tắc thị giác:
 *  1. ĐIỂM NEO — mỗi lưới thẻ nên có đúng MỘT thẻ `featured` (Card Ngôi Sao)
 *     cho chỉ số cốt lõi của trang. Thẻ này có nền màu nhạt + viền màu + đổ
 *     bóng, hút mắt ngay khi mở trang.
 *  2. ICON CÓ KHỐI NỀN — icon nằm trong ô bo góc nền màu đặc, không thả trôi
 *     nhạt nhoà, giúp phân biệt loại chỉ số chỉ bằng liếc mắt.
 *  3. SỐ BIẾT NÓI — mọi dòng có % đều kèm thanh tiến trình mảnh, để đọc tỷ
 *     trọng bằng hình ảnh thay vì phải nhẩm số.
 */

/** Sắc thái ngữ nghĩa của một chỉ số — quyết định toàn bộ bảng màu của thẻ. */
export type CardTone =
  | "neutral" // trung tính (số lượng, thông tin)
  | "info" // dữ liệu tham chiếu (xanh dương)
  | "positive" // tiền vào / lãi (xanh ngọc)
  | "negative" // tiền ra / lỗ (đỏ hồng)
  | "warning" // cần chú ý (hổ phách)
  | "accent"; // nhấn phụ (tím)

interface ToneStyle {
  /** Ô nền chứa icon */
  icon: string;
  /** Màu số tổng khi muốn tô theo sắc thái */
  value: string;
  /** Màu thanh tiến trình */
  bar: string;
  /** Nền + viền khi thẻ ở chế độ Ngôi Sao */
  featured: string;
}

const TONES: Record<CardTone, ToneStyle> = {
  neutral: {
    icon: "bg-slate-100 text-slate-700",
    value: "text-foreground",
    bar: "bg-slate-400",
    featured: "bg-slate-50/60 ring-slate-300/70",
  },
  info: {
    icon: "bg-sky-100 text-sky-700",
    value: "text-sky-700",
    bar: "bg-sky-500",
    featured: "bg-sky-50/50 ring-sky-300/70",
  },
  positive: {
    icon: "bg-emerald-100 text-emerald-700",
    value: "text-emerald-700",
    bar: "bg-emerald-500",
    featured: "bg-emerald-50/40 ring-emerald-300/70",
  },
  negative: {
    icon: "bg-rose-100 text-rose-700",
    // Đỏ tươi (600) chứ không phải đỏ sẫm (700/800): số lỗ phải đập vào mắt
    value: "text-rose-600",
    bar: "bg-rose-500",
    featured: "bg-rose-50/40 ring-rose-300/70",
  },
  warning: {
    icon: "bg-amber-100 text-amber-700",
    value: "text-amber-700",
    bar: "bg-amber-500",
    featured: "bg-amber-50/50 ring-amber-300/70",
  },
  accent: {
    icon: "bg-violet-100 text-violet-700",
    value: "text-violet-700",
    bar: "bg-violet-500",
    featured: "bg-violet-50/50 ring-violet-300/70",
  },
};

/** Dương → xanh, âm → đỏ. Dùng cho các chỉ số có thể lãi hoặc lỗ. */
export function toneBySign(value: number): CardTone {
  return value >= 0 ? "positive" : "negative";
}

export interface DashboardCardItem {
  key: string;
  /** Nhãn bên trái (có thể kèm icon gợi ý công thức) */
  label: React.ReactNode;
  /** Giá trị đã format sẵn (chuỗi tiền tệ, số đơn…) */
  value: React.ReactNode;
  /** Màu riêng cho giá trị — mặc định theo tone của dòng */
  valueClass?: string;
  /** Tỷ trọng 0–100. Có giá trị → tự vẽ thanh tiến trình bên dưới. */
  percent?: number;
  /** Ghi chú nhỏ nằm cạnh % (ví dụ "· 12 đơn") */
  note?: string;
  /** Sắc thái của riêng dòng này — mặc định kế thừa tone của thẻ */
  tone?: CardTone;
}

export interface DashboardCardProps {
  title: string;
  /** Số tổng, đã format sẵn */
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: CardTone;
  /**
   * Card Ngôi Sao — nền màu nhạt, viền màu, bóng đổ.
   * Mỗi lưới thẻ chỉ nên bật cho đúng một thẻ quan trọng nhất.
   */
  featured?: boolean;
  /** Tô màu số tổng theo tone (mặc định thẻ featured luôn tô) */
  colorValue?: boolean;
  subtitle?: React.ReactNode;
  /** Thanh tiến trình lớn ngay dưới số tổng (0–100) */
  progress?: number;
  /** Nhãn mô tả thanh tiến trình lớn */
  progressLabel?: React.ReactNode;
  /** Danh sách dòng chi tiết bên dưới */
  items?: DashboardCardItem[];
  footer?: React.ReactNode;
  className?: string;
}

/** Thanh tiến trình siêu mảnh — đọc tỷ trọng bằng mắt, không cần nhẩm số. */
export function MiniProgress({
  percent,
  tone = "neutral",
  className,
}: {
  percent: number;
  tone?: CardTone;
  className?: string;
}) {
  // Kẹp về 0–100: % có thể âm (khoản được cộng lại) hoặc vọt trên 100 khi lỗ
  const width = Math.min(100, Math.abs(percent));
  return (
    <div
      className={cn(
        "mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/10 2xl:h-1.5",
        className
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700 ease-out",
          TONES[tone].bar
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function DashboardCard({
  title,
  value,
  icon: Icon,
  tone = "neutral",
  featured = false,
  colorValue,
  subtitle,
  progress,
  progressLabel,
  items,
  footer,
  className,
}: DashboardCardProps) {
  const t = TONES[tone];
  // Thẻ Ngôi Sao luôn tô màu số tổng, trừ khi bị ép tắt
  const tinted = colorValue ?? featured;

  return (
    <Card
      className={cn(
        "h-full transition-shadow",
        featured && cn("shadow-md ring-2", t.featured),
        className
      )}
    >
      <CardContent className="flex h-full flex-col gap-4 p-5">
        {/* ── Đầu thẻ: icon có khối nền + tiêu đề + số tổng ── */}
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl 2xl:size-12",
              t.icon
            )}
          >
            <Icon className="size-5.5 2xl:size-6" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={TEXT_CARD_TITLE}>{title}</p>
            {/* break-words để số tiền dài không bị cắt mất chữ số */}
            <p
              className={cn(
                TEXT_HERO_NUMBER,
                "mt-0.5 leading-tight break-words",
                tinted && t.value
              )}
            >
              {value}
            </p>
            {subtitle && <p className={cn(TEXT_SUB, "mt-1")}>{subtitle}</p>}
          </div>
        </div>

        {/* ── Thanh tiến trình tổng ── */}
        {progress !== undefined && (
          <div>
            <MiniProgress percent={progress} tone={tone} className="mt-0" />
            {progressLabel && (
              <p className={cn(TEXT_SUB, "mt-1.5")}>{progressLabel}</p>
            )}
          </div>
        )}

        {/* ── Các dòng chi tiết, mỗi dòng có % thì kèm thanh tỷ trọng ── */}
        {items && items.length > 0 && (
          <div className="flex-1 space-y-3 border-t pt-3">
            {items.map((item) => {
              const itemTone = item.tone ?? tone;
              return (
                <div key={item.key}>
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(TEXT_SUB, "flex min-w-0 items-center gap-1")}
                    >
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-right text-sm font-semibold 2xl:text-base",
                        item.valueClass ?? TONES[itemTone].value
                      )}
                    >
                      {item.value}
                    </span>
                  </div>
                  {item.percent !== undefined && (
                    <>
                      <MiniProgress percent={item.percent} tone={itemTone} />
                      <p className={cn(TEXT_SUB, "mt-1 text-right")}>
                        {item.percent}%{item.note ? ` ${item.note}` : ""}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {footer && (
          <div className={cn(TEXT_SUB, "mt-auto border-t pt-3")}>{footer}</div>
        )}
      </CardContent>
    </Card>
  );
}
