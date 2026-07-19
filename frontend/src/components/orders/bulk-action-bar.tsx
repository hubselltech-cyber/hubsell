"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, PackageCheck, Printer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ApiError,
  bulkConfirmOrders,
  fetchOrderLabels,
  type Order,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { printOrderLabels } from "@/lib/print-labels";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * THANH XỬ LÝ HÀNG LOẠT
 *
 * Nổi lên đáy màn hình khi có đơn được tích chọn. Đặt nổi thay vì gắn trên đầu
 * bảng vì shop soát đơn thường cuộn xuống giữa danh sách rồi mới tích — nút ở
 * trên đầu thì phải cuộn ngược lên mới bấm được.
 */
export function BulkActionBar({
  selected,
  onClear,
  onDone,
}: {
  /** Các đơn đang được tích chọn */
  selected: Order[];
  onClear: () => void;
  /** Gọi sau khi xử lý xong để trang tải lại danh sách */
  onDone: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);

  // Chỉ đơn Chờ xử lý mới xác nhận chuẩn bị hàng được — cho người dùng biết
  // trước con số thật thay vì để họ bấm rồi mới thấy "đã bỏ qua 8 đơn".
  const packable = selected.filter((o) => o.shippingStatus === "PENDING");

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await bulkConfirmOrders(packable.map((o) => o.id));
      const extra =
        res.skipped.length > 0 ? ` · bỏ qua ${res.skipped.length} đơn` : "";
      toast.success(
        `Đã xác nhận chuẩn bị ${formatNumber(res.confirmed)} đơn${extra}`,
        { duration: 6000 }
      );
      onClear();
      onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không xác nhận được đơn hàng"
      );
    } finally {
      setConfirming(false);
    }
  }

  async function handlePrint() {
    setPrinting(true);
    try {
      // Lấy lại từ máy chủ thay vì dùng dữ liệu đang có trên bảng: đảm bảo phiếu
      // in ra là số liệu mới nhất và có đủ chi tiết dòng hàng.
      const res = await fetchOrderLabels(selected.map((o) => o.id));
      const opened = printOrderLabels(res.labels);
      if (!opened) {
        toast.error(
          "Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up cho trang này rồi bấm lại."
        );
        return;
      }
      toast.success(`Đã mở ${formatNumber(res.labels.length)} phiếu để in`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không lấy được dữ liệu phiếu"
      );
    } finally {
      setPrinting(false);
    }
  }

  if (selected.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Thao tác hàng loạt"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5",
        "pointer-events-none"
      )}
    >
      <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-background shadow-lg ring-1 ring-black/10">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Đã chọn {formatNumber(selected.length)} đơn
          </p>
          <p className={cn(TEXT_SUB, "text-background/70")}>
            {packable.length > 0
              ? `${formatNumber(packable.length)} đơn đang Chờ xử lý có thể xác nhận`
              : "Không có đơn nào đang Chờ xử lý"}
          </p>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleConfirm}
          disabled={confirming || packable.length === 0}
          title={
            packable.length === 0
              ? "Chỉ đơn đang Chờ xử lý mới xác nhận chuẩn bị hàng được"
              : undefined
          }
        >
          {confirming ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PackageCheck className="size-4" />
          )}
          Xác nhận chuẩn bị ({formatNumber(packable.length)})
        </Button>

        <Button size="sm" variant="secondary" onClick={handlePrint} disabled={printing}>
          {printing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Printer className="size-4" />
          )}
          In phiếu giao hàng
        </Button>

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
