"use client";

import type { LucideIcon } from "lucide-react";

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

interface BreakdownCardProps {
  title: string;
  subtitle?: string;
  total: number;
  icon: LucideIcon;
  tone?: CardTone;
  /** Card Ngôi Sao — dành cho chỉ số cốt lõi của trang */
  featured?: boolean;
  /** Tô màu số tổng theo tone (thẻ Ngôi Sao mặc định đã tô) */
  colorValue?: boolean;
  items: BreakdownItem[];
  /** Số tiền trong danh sách là khoản BỊ TRỪ → hiển thị dấu trừ, màu đỏ */
  itemsAreDeductions?: boolean;
  /** Tô màu số theo dấu (dương xanh / âm đỏ) — dùng cho khối Lợi nhuận */
  colorBySign?: boolean;
  footer?: React.ReactNode;
}

/**
 * Thẻ số liệu có bóc tách chi tiết (dùng ở Báo cáo dòng tiền).
 * Là lớp adapter dịch BreakdownItem của API sang định dạng DashboardCard,
 * nên tự động thừa hưởng toàn bộ quy chuẩn giao diện chung.
 */
export function BreakdownCard({
  title,
  subtitle,
  total,
  icon,
  tone = "neutral",
  featured,
  colorValue,
  items,
  itemsAreDeductions = false,
  colorBySign = false,
  footer,
}: BreakdownCardProps) {
  const cardTone = colorBySign ? toneBySign(total) : tone;

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
      title={title}
      value={<Money value={total} />}
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
