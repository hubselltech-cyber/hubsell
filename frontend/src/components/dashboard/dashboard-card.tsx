"use client";

import type { LucideIcon } from "lucide-react";

import {
  MONEY_NEGATIVE,
  MONEY_POSITIVE,
  TEXT_CARD_TITLE,
  TEXT_HERO_NUMBER,
  TEXT_SUB,
} from "@/lib/typography";
import { Card, CardContent } from "@/components/ui/card";
import {
  KpiSparkline,
  type SparklineTone,
} from "@/components/dashboard/kpi-sparkline";
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
 *   tiền vào / lãi  → emerald-500 (#10B981)
 *   tiền ra / lỗ    → red-500 (#EF4444) — đỏ cam trầm, không dùng đỏ sẫm xỉn
 *   còn lại         → đen/xám mặc định
 */
const VALUE_COLOR: Record<CardTone, string> = {
  neutral: "text-foreground",
  info: "text-foreground",
  warning: "text-foreground",
  accent: "text-foreground",
  positive: MONEY_POSITIVE,
  negative: MONEY_NEGATIVE,
};

/**
 * Nền khi thẻ ở chế độ nổi bật — CHỈ đổi nền, KHÔNG đổi viền.
 *
 * Viền màu bo quanh thẻ tạo ra một khung đỏ/xanh đập vào mắt mạnh hơn cả con số
 * bên trong, và phá vỡ nhịp viền slate đồng nhất của cả lưới thẻ. Lớp nền siêu
 * nhạt là đủ để thẻ nổi lên mà không phá bố cục.
 */
const FEATURED_BG: Partial<Record<CardTone, string>> = {
  positive: "bg-emerald-50/30",
  negative: "bg-rose-50/20",
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
  /** Tiêu đề — nhận ReactNode để kèm được HintIcon giải thích công thức */
  title: React.ReactNode;
  /** Số tổng, đã format sẵn */
  value: React.ReactNode;
  /**
   * Khối góc PHẢI đầu thẻ, song song với số tổng — chỗ chuẩn cho tỷ trọng %
   * và mũi tên tăng/giảm so kỳ trước (Báo cáo dòng tiền).
   */
  headerRight?: React.ReactNode;
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
  /** Ghi đè cỡ chữ của số tổng (mặc định TEXT_HERO_NUMBER) */
  valueClassName?: string;
  /** Danh sách dòng chi tiết bên dưới */
  items?: DashboardCardItem[];
  footer?: React.ReactNode;
  /**
   * ĐƯỜNG SÓNG TRANG TRÍ chìm dưới đáy thẻ (opt-in — mặc định KHÔNG có, các
   * trang khác dùng DashboardCard không đổi gì). Chỉ dành cho thẻ KPI Hero có
   * chuỗi ngày đi kèm; con số chính xác vẫn là số to, sóng chỉ cho thấy nhịp.
   */
  sparkline?: { data: number[]; tone: SparklineTone };
  className?: string;
}

export function DashboardCard({
  title,
  value,
  headerRight,
  icon: Icon,
  tone = "neutral",
  featured = false,
  colorValue,
  subtitle,
  valueClassName,
  items,
  footer,
  sparkline,
  className,
}: DashboardCardProps) {
  const highlight = featured ? FEATURED_BG[tone] : undefined;
  // Thẻ được phủ nền thì luôn tô màu số tổng, trừ khi bị ép tắt
  const tinted = colorValue ?? Boolean(highlight);

  return (
    // relative để lớp sparkline absolute neo vào thẻ; Card đã overflow-hidden +
    // bo góc nên gradient tự cắt theo góc thẻ. Sóng render TRƯỚC trong DOM và
    // CardContent relative → nội dung luôn nằm trên sóng, không cần z-index.
    <Card className={cn("h-full", sparkline && "relative", highlight, className)}>
      {sparkline && <KpiSparkline data={sparkline.data} tone={sparkline.tone} />}
      <CardContent
        className={cn("flex h-full flex-col gap-4 p-5", sparkline && "relative")}
      >
        {/* ── Đầu thẻ: icon có khối nền + tiêu đề + số tổng ── */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              // Viền trong 1px cùng màu chữ ở 10% độ đục: khối màu nhạt có mép
              // sắc nét thay vì tan nhòe vào nền trắng (vẽ bằng inset shadow để
              // không đội kích thước như border)
              "flex size-9 shrink-0 items-center justify-center rounded-lg [box-shadow:inset_0_0_0_1px_color-mix(in_oklab,currentColor_12%,transparent)]",
              ICON_BOX
            )}
          >
            <Icon className="size-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn(TEXT_CARD_TITLE, "flex items-center gap-1")}>
              {title}
            </p>
            {/* break-words để số tiền dài không bị cắt mất chữ số */}
            <p
              className={cn(
                TEXT_HERO_NUMBER,
                "mt-1 leading-tight",
                tinted && VALUE_COLOR[tone],
                valueClassName
              )}
            >
              {value}
            </p>
            {subtitle && <p className={cn(TEXT_SUB, "mt-1.5")}>{subtitle}</p>}
          </div>
          {headerRight && <div className="shrink-0 text-right">{headerRight}</div>}
        </div>

        {/* ── Các dòng chi tiết: chỉ số tiền + % dạng text, không đồ hoạ ── */}
        {items && items.length > 0 && (
          <div className="flex-1 border-t pt-1">
            {items.map((item) => (
              <div
                key={item.key}
                // Kẻ mảnh giữa các dòng để mắt lần theo từng khoản; dòng cuối
                // bỏ kẻ vì đã có viền thẻ đỡ bên dưới
                className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-b-0 last:pb-0"
              >
                <span className={cn(TEXT_SUB, "flex min-w-0 items-center gap-1")}>
                  {item.label}
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={cn(
                      "block text-sm",
                      // Dòng mang sắc thái lãi–lỗ mới được tô màu và in đậm;
                      // còn lại là số đối chiếu, để chữ thường xám đen
                      VALUE_COLOR[item.tone ?? tone] === "text-foreground"
                        ? "text-slate-900"
                        : cn("font-semibold", VALUE_COLOR[item.tone ?? tone])
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
