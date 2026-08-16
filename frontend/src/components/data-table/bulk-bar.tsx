"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * KHUNG THANH XỬ LÝ HÀNG LOẠT DÙNG CHUNG (Tầng 2 kế hoạch UI).
 *
 * Nổi lên đáy màn hình khi có dòng được tích chọn — đặt nổi thay vì gắn trên
 * đầu bảng vì người dùng thường cuộn xuống giữa danh sách rồi mới tích; nút ở
 * trên đầu thì phải cuộn ngược lên mới bấm được.
 *
 * Đây chỉ là KHUNG (đếm + nút bỏ chọn + chỗ cắm nút): mỗi bảng tự cắm các nút
 * nghiệp vụ của mình vào `children` — xem orders/bulk-action-bar.tsx làm mẫu.
 * Trang dùng khung này nhớ chừa đệm đáy (vd pb-28) kẻo thanh che dòng cuối.
 */
export function BulkBar({
  count,
  unitLabel = "dòng",
  subtitle,
  onClear,
  children,
}: {
  /** Số dòng đang chọn — bằng 0 thì thanh tự ẩn. */
  count: number;
  /** Đơn vị đếm hiện sau con số ("đơn", "sản phẩm"…). */
  unitLabel?: string;
  /** Dòng phụ nhỏ dưới số đếm (vd cảnh báo in trùng). */
  subtitle?: React.ReactNode;
  onClear: () => void;
  /** Các nút nghiệp vụ của bảng. */
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Thao tác hàng loạt"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5"
    >
      <div className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-background shadow-lg ring-1 ring-black/10">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Đã chọn {formatNumber(count)} {unitLabel}
          </p>
          {subtitle && (
            <p className={cn(TEXT_SUB, "text-background/70")}>{subtitle}</p>
          )}
        </div>

        {children}

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClear}
          aria-label="Bỏ chọn tất cả"
          className="text-background hover:bg-background/15 hover:text-background"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
