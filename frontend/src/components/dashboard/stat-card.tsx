"use client";

import type { LucideIcon } from "lucide-react";

import {
  DashboardCard,
  type CardTone,
} from "@/components/dashboard/dashboard-card";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Sắc thái màu của chỉ số — xem CardTone trong dashboard-card.tsx */
  tone?: CardTone;
  /** Bật cho đúng MỘT thẻ quan trọng nhất trong lưới (Card Ngôi Sao) */
  featured?: boolean;
  /** Tô màu số tổng theo tone (thẻ Ngôi Sao mặc định đã tô) */
  colorValue?: boolean;
  subtitle?: React.ReactNode;
  /** Tỷ trọng 0–100 → hiện thanh tiến trình mảnh dưới số tổng */
  progress?: number;
  progressLabel?: React.ReactNode;
}

/**
 * Thẻ chỉ số đơn giản (chỉ có tiêu đề + số tổng), là lớp mỏng bọc quanh
 * DashboardCard để các trang cũ gọi cho ngắn gọn. Cần thêm dòng chi tiết,
 * thanh tỷ trọng hay footer thì dùng thẳng <DashboardCard>.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  featured,
  colorValue,
  subtitle,
  progress,
  progressLabel,
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
      progress={progress}
      progressLabel={progressLabel}
    />
  );
}
