"use client";

import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import {
  DashboardCard,
  toneBySign,
  type CardTone,
  type DashboardCardItem,
} from "@/components/dashboard/dashboard-card";
import { HintIcon } from "@/components/finance/hint-icon";
import { Money } from "@/components/ui/money";
import type { BreakdownItem } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BreakdownCardProps {
  title: string;
  /** Giải thích công thức — ẩn trong tooltip dấu (?) cạnh tiêu đề cho gọn. */
  titleHint?: string;
  subtitle?: string;
  total: number;
  icon: LucideIcon;
  tone?: CardTone;
  /** Card Ngôi Sao — dành cho chỉ số cốt lõi của trang */
  featured?: boolean;
  /** Tô màu số tổng theo tone (thẻ Ngôi Sao mặc định đã tô) */
  colorValue?: boolean;
  /** Tỷ trọng % ở góc phải, song song số tổng (vd 88,4% "trên giá trị SP"). */
  share?: { percent: number; label: string };
  /**
   * % thay đổi so với KỲ LIỀN TRƯỚC cùng độ dài — hiện mũi tên tăng/giảm.
   * null/undefined = không có dữ liệu kỳ trước để so → ẩn mũi tên.
   */
  delta?: number | null;
  /** Với thẻ CHI PHÍ: tăng là XẤU → đảo màu (tăng đỏ, giảm xanh). */
  deltaInverted?: boolean;
  /** Tooltip của mũi tên — vd "so với kỳ trước (09/06 - 08/07)". */
  deltaHint?: string;
  items: BreakdownItem[];
  /** Số tiền trong danh sách là khoản BỊ TRỪ → hiển thị dấu trừ, màu đỏ */
  itemsAreDeductions?: boolean;
  /** Tô màu số theo dấu (dương xanh / âm đỏ) — dùng cho khối Lợi nhuận */
  colorBySign?: boolean;
  footer?: React.ReactNode;
}

/** Format % kiểu Việt: 1 số lẻ, bỏ .0 thừa (12,3% / 8%). */
function fmtPct(n: number): string {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

/**
 * Thẻ số liệu có bóc tách chi tiết (dùng ở Báo cáo dòng tiền).
 * Là lớp adapter dịch BreakdownItem của API sang định dạng DashboardCard,
 * nên tự động thừa hưởng toàn bộ quy chuẩn giao diện chung.
 */
export function BreakdownCard({
  title,
  titleHint,
  subtitle,
  total,
  icon,
  tone = "neutral",
  featured,
  colorValue,
  share,
  delta,
  deltaInverted = false,
  deltaHint,
  items,
  itemsAreDeductions = false,
  colorBySign = false,
  footer,
}: BreakdownCardProps) {
  const cardTone = colorBySign ? toneBySign(total) : tone;

  // Mũi tên so kỳ trước: màu theo Ý NGHĨA chứ không theo dấu — doanh thu/lãi
  // tăng là tốt (xanh), nhưng CHI PHÍ tăng là xấu (deltaInverted → đỏ).
  const deltaGood = delta != null && (deltaInverted ? delta < 0 : delta >= 0);
  const headerRight =
    share || delta != null ? (
      <>
        {share && (
          <>
            <p className="text-sm font-semibold text-slate-700">
              {fmtPct(share.percent)}
            </p>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {share.label}
            </p>
          </>
        )}
        {delta != null && (
          // Badge nền màu nhạt (thay chữ trần) — tách bạch hẳn với cụm tỷ
          // trọng % phía trên, liếc qua là thấy chiều tăng/giảm so kỳ trước.
          <p
            title={deltaHint}
            className={cn(
              "mt-1.5 inline-flex cursor-default items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              deltaGood
                ? "bg-emerald-50 text-emerald-600"
                : "bg-rose-50 text-red-500"
            )}
          >
            {delta >= 0 ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )}
            {fmtPct(Math.abs(delta))}
          </p>
        )}
      </>
    ) : undefined;

  const rows: DashboardCardItem[] = items.map((item) => {
    // Khoản trợ giá (amount âm trong nhóm khấu trừ) là khoản được CỘNG lại
    const isCredit = itemsAreDeductions && item.amount < 0;

    /*
     * MÀU CHỈ DÀNH CHO KẾT LUẬN LÃI–LỖ.
     *
     * Các dòng khấu trừ (phí sàn, voucher, phí ship…) là số đối chiếu, không
     * phải phán quyết lãi hay lỗ — dấu "−" phía trước đã nói rõ tiền đang đi ra.
     * Tô đỏ hết thì cả thẻ đỏ rực và mắt không phân biệt được đâu mới là khoản
     * đáng lo. Chỉ nhóm có colorBySign (cột Lợi nhuận) mới được tô màu.
     */
    const rowTone: CardTone = colorBySign ? toneBySign(item.amount) : "neutral";

    return {
      key: item.key,
      label: (
        <>
          <span className="truncate">{item.label}</span>
          <HintIcon hint={item.hint} />
        </>
      ),
      value: (
        <>
          {itemsAreDeductions
            ? isCredit
              ? "+ "
              : "− "
            : colorBySign
              ? item.amount >= 0
                ? "+ "
                : "− "
              : ""}
          <Money value={Math.abs(item.amount)} />
        </>
      ),
      // Tỷ lệ hiển thị bằng text thuần, không vẽ thanh đồ hoạ
      note: `${item.percent}%${
        item.count !== undefined ? ` · ${formatNumber(item.count)} đơn` : ""
      }`,
      tone: rowTone,
    };
  });

  return (
    <DashboardCard
      title={
        titleHint ? (
          <>
            <span>{title}</span>
            <HintIcon hint={titleHint} />
          </>
        ) : (
          title
        )
      }
      value={<Money value={total} />}
      headerRight={headerRight}
      icon={icon}
      tone={cardTone}
      featured={featured}
      colorValue={colorBySign || colorValue}
      subtitle={subtitle}
      items={rows}
      footer={footer}
    />
  );
}
