"use client";

import {
  Archive,
  FileCheck2,
  Gauge,
  ShoppingBag,
  ShoppingCart,
  TriangleAlert,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INVOICE_PLAN_SECTION_ID } from "@/components/settings/invoice-plan-purchase";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * BÁO CÁO & GIÁM SÁT PHÔI HÓA ĐƠN — dashboard thu nhỏ 3 chỉ số, LUÔN MỞ (không
 * phụ thuộc công tắc module) để chủ shop thấy tồn phôi và chủ động nạp thêm.
 *
 * Khi "Số lượng còn lại" xuống dưới ngưỡng LOW_QUOTA_THRESHOLD → cảnh báo đỏ
 * nhấp nháy, thúc đẩy kéo xuống mua gói phôi ở section ngay bên dưới.
 */

// TODO(API): thay bằng số liệu thật từ backend (tổng phôi đã mua qua các đơn
// hàng + số hóa đơn đã phát hành từ NCC).
const QUOTA_MOCK = {
  purchased: 2_500,
  issued: 2_460,
};

/** Dưới ngưỡng này thì cảnh báo sắp hết phôi. */
const LOW_QUOTA_THRESHOLD = 50;

/** Cuộn mượt tới khối "Mua gói phôi hóa đơn điện tử" ở cuối trang. */
function scrollToPurchaseSection() {
  document
    .getElementById(INVOICE_PLAN_SECTION_ID)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Một thẻ chỉ số nhanh trong dashboard thu nhỏ. */
function StatCard({
  icon,
  label,
  value,
  danger = false,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  /** Tô đỏ giá trị khi ở trạng thái nguy hiểm (sắp hết phôi). */
  danger?: boolean;
  /** Nút hành động nhỏ hiển thị dưới chỉ số (vd "Nạp thêm"). */
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          danger && "text-red-600",
        )}
      >
        {formatNumber(value)}
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className={TEXT_SUB}>hóa đơn</p>
        {action}
      </div>
    </div>
  );
}

export function InvoiceQuotaMonitorSection() {
  const { purchased, issued } = QUOTA_MOCK;
  const remaining = purchased - issued;
  const lowQuota = remaining < LOW_QUOTA_THRESHOLD;

  return (
    <Card className="max-w-2xl shadow-sm">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Gauge className="size-5 text-slate-500" />
          Báo cáo &amp; Giám sát phôi hóa đơn
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            icon={<ShoppingBag className="size-3.5" />}
            label="Tổng số phôi đã mua"
            value={purchased}
          />
          <StatCard
            icon={<FileCheck2 className="size-3.5" />}
            label="Đã phát hành"
            value={issued}
          />
          <StatCard
            icon={<Archive className="size-3.5" />}
            label="Số lượng còn lại"
            value={remaining}
            danger={lowQuota}
            action={
              <button
                type="button"
                onClick={scrollToPurchaseSection}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 text-xs font-medium transition-colors",
                  lowQuota
                    ? "text-red-600 hover:text-red-700"
                    : "text-primary hover:underline",
                )}
              >
                <ShoppingCart className="size-3" />
                Nạp thêm
              </button>
            }
          />
        </div>

        {lowQuota && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            <TriangleAlert className="size-4 shrink-0 animate-pulse" />
            ⚠️ Sắp hết phôi - Hãy nạp thêm để không gián đoạn xuất hóa đơn!
          </div>
        )}
      </CardContent>
    </Card>
  );
}
