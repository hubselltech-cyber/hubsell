"use client";

import type { LucideIcon } from "lucide-react";

import {
  DashboardCard,
  type CardTone,
} from "@/components/dashboard/dashboard-card";

interface StatCardProps {
  label: string;
  /** Số đã format sẵn — thường là <Money value={…} /> */
  value: React.ReactNode;
  icon: LucideIcon;
  /** Sắc thái màu của chỉ số — xem CardTone trong dashboard-card.tsx */
  tone?: CardTone;
  /** Phủ nền cảnh báo — chỉ dùng cho khối Lợi nhuận / cảnh báo tiền bạc */
  featured?: boolean;
  /** Tô màu số tổng theo tone (thẻ featured mặc định đã tô) */
  colorValue?: boolean;
  subtitle?: React.ReactNode;
}

/**
 * Thẻ chỉ số đơn giản (chỉ có tiêu đề + số tổng), là lớp mỏng bọc quanh
 * DashboardCard để các trang gọi cho ngắn gọn. Cần thêm dòng chi tiết hay
 * footer thì dùng thẳng <DashboardCard>.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  featured,
  colorValue,
  subtitle,
}: StatCardProps) {
  return (
    <DashboardCard
      title={label}
      value={value}
      icon={icon}
      tone={tone}
      featured={featured}
      colorValue={colorValue}
      subtitle={subtitle}
    />
  );
}
