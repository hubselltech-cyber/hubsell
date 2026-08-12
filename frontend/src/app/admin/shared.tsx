// Đồ dùng chung của khu Quản trị nền tảng (/admin) — page.tsx và các tab
// (finance / marketing / audit) cùng một kiểu thẻ số liệu, định dạng số và
// bảng màu trạng thái chăm sóc, không bao giờ lệch nhau.

import { Card, CardContent } from "@/components/ui/card";
import type { PlatformCareStatus } from "@/lib/api";

export function formatCount(n: number): string {
  return n.toLocaleString("vi-VN");
}

export function formatMoney(n: number): string {
  return `${n.toLocaleString("vi-VN")}₫`;
}

export const pageCount = (total: number, pageSize: number) =>
  Math.max(1, Math.ceil(total / pageSize));

/** Thẻ số liệu to — dùng cho các tab tổng quan. */
export function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-muted-foreground">{props.label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{props.value}</p>
        {props.hint && (
          <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Nhãn + màu huy hiệu cho từng trạng thái chăm sóc (CRM nội bộ). */
export const CARE_STATUS_META: Record<
  PlatformCareStatus,
  { label: string; className: string }
> = {
  NEW: {
    label: "Mới đăng ký",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  CONTACTED: {
    label: "Đang tư vấn",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  ACTIVE: {
    label: "Đang dùng ổn định",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  CHURN_RISK: {
    label: "Nguy cơ rời bỏ",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  CHURNED: {
    label: "Đã rời bỏ",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

export const CARE_STATUSES = Object.keys(CARE_STATUS_META) as PlatformCareStatus[];
