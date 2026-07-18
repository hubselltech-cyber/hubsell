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
 * ─── TRIẾT LÝ: SẠCH SẼ TRƯỚC, TRANG TRÍ SAU ───
 * Đây là màn hình tài chính, không phải trang marketing. Chủ shop nhìn vào để
 * ra quyết định, nên ưu tiên khoảng trống và con số rõ ràng.
 *
 *  ❌ KHÔNG dùng thanh ngang (progress bar) ở các dòng chỉ số chi tiết. Đã thử
 *     và loại bỏ: một rừng vạch màu dưới mỗi dòng làm mắt bị nhiễu, hạ thấp
 *     tính chuyên nghiệp của ERP. Tỷ lệ % hiển thị bằng TEXT là đủ.
 *
 *  ✅ Phân cấp CHỈ bằng 3 công cụ:
 *     1. Màu chữ của số — xem VALUE_COLOR bên dưới, đúng 3 trạng thái.
 *     2. Khối nền của icon — cho phép nhiều màu, giúp nhận diện loại chỉ số.
 *     3. Nền + viền của cả thẻ — chỉ dành cho thẻ cảnh báo/lợi nhuận cốt lõi.
 */

/** Sắc thái ngữ nghĩa của một chỉ số. */
export type CardTone =
  | "neutral" // trung tính (số lượng, thông tin)
  | "info" // dữ liệu tham chiếu (xanh dương)
  | "positive" // tiền vào / lãi (xanh ngọc)
  | "negative" // tiền ra / lỗ (đỏ hồng)
  | "warning" // cần chú ý (hổ phách)
  | "accent"; // nhấn phụ (tím)

/** Khối nền của icon — được phép nhiều màu để phân biệt loại chỉ số. */
const ICON_BOX: Record<CardTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-sky-100 text-sky-700",
  positive: "bg-emerald-100 text-emerald-700",
  negative: "bg-rose-100 text-rose-700",
  warning: "bg-amber-100 text-amber-700",
  accent: "bg-violet-100 text-violet-700",
};

/**
 * Màu chữ của SỐ LIỆU — nghiêm ngặt 3 trạng thái, không tô màu trang trí:
 *   tiền vào / lãi  → xanh lá
 *   tiền ra / lỗ    → đỏ sắc nét (600, không dùng 700 sẫm xỉn)
 *   còn lại         → đen/xám mặc định
 */
const VALUE_COLOR: Record<CardTone, string> = {
  neutral: "text-foreground",
  info: "text-foreground",
  warning: "text-foreground",
  accent: "text-foreground",
  positive: "text-emerald-600",
  negative: "text-rose-600",
};

/** Nền + viền khi thẻ ở chế độ nổi bật. Chỉ có 2 sắc thái được phép. */
const FEATURED_BG: Partial<Record<CardTone, string>> = {
  positive: "bg-emerald-50/40 ring-emerald-200",
  negative: "bg-rose-50/40 ring-rose-200",
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
  /** Dòng chú thích nhỏ bên dưới giá trị — thường là "12.5% · 8 đơn" */
  note?: React.ReactNode;
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
   * Phủ nền + viền màu cho cả thẻ. CHỈ dùng cho khối Lợi nhuận và các thẻ
   * cảnh báo tiền bạc cốt lõi (tổng tiền lỗ, tiền cần đòi lại) — dùng tràn
   * lan sẽ mất tác dụng cảnh báo. Chỉ có hiệu lực với tone positive/negative.
   */
  featured?: boolean;
  /** Tô màu số tổng theo tone (thẻ featured mặc định đã tô) */
  colorValue?: boolean;
  subtitle?: React.ReactNode;
  /** Danh sách dòng chi tiết bên dưới */
  items?: DashboardCardItem[];
  footer?: React.ReactNode;
  className?: string;
}

export function DashboardCard({
  title,
  value,
  icon: Icon,
  tone = "neutral",
  featured = false,
  colorValue,
  subtitle,
  items,
  footer,
  className,
}: DashboardCardProps) {
  const highlight = featured ? FEATURED_BG[tone] : undefined;
  // Thẻ được phủ nền thì luôn tô màu số tổng, trừ khi bị ép tắt
  const tinted = colorValue ?? Boolean(highlight);

  return (
    <Card className={cn("h-full", highlight && cn("shadow-sm ring-1", highlight), className)}>
      <CardContent className="flex h-full flex-col gap-5 p-5">
        {/* ── Đầu thẻ: icon có khối nền + tiêu đề + số tổng ── */}
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl 2xl:size-12",
              ICON_BOX[tone]
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
                "mt-1 leading-tight break-words",
                tinted && VALUE_COLOR[tone]
              )}
            >
              {value}
            </p>
            {subtitle && <p className={cn(TEXT_SUB, "mt-1.5")}>{subtitle}</p>}
          </div>
        </div>

        {/* ── Các dòng chi tiết: chỉ số tiền + % dạng text, không đồ hoạ ── */}
        {items && items.length > 0 && (
          <div className="flex-1 space-y-3 border-t pt-4">
            {items.map((item) => (
              <div
                key={item.key}
                className="flex items-start justify-between gap-3"
              >
                <span className={cn(TEXT_SUB, "flex min-w-0 items-center gap-1")}>
                  {item.label}
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={cn(
                      "block text-sm font-semibold 2xl:text-base",
                      VALUE_COLOR[item.tone ?? tone]
                    )}
                  >
                    {item.value}
                  </span>
                  {item.note && (
                    <span className={cn(TEXT_SUB, "block")}>{item.note}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {footer && (
          <div className={cn(TEXT_SUB, "mt-auto border-t pt-4")}>{footer}</div>
        )}
      </CardContent>
    </Card>
  );
}
