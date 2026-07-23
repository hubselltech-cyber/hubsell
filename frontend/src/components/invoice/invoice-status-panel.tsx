"use client";

import { toast } from "sonner";
import {
  FileCheck2,
  FileClock,
  FileDown,
  FileOutput,
  FileWarning,
  FileX2,
  PackageCheck,
  RotateCcw,
  Send,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRẠNG THÁI HÓA ĐƠN ĐIỆN TỬ — khu vực dùng chung (giữ chỗ).
 *
 * Dùng trong Dialog cập nhật đơn hàng, nơi chủ shop tương tác với từng đơn cụ
 * thể. Gói lại một chỗ để hành động luôn bám đúng TRẠNG THÁI phát hành:
 *
 *   - "none"    Chưa xuất  → chỉ có nút CHỦ ĐỘNG "Xuất hóa đơn điện tử".
 *   - "signing" Đang chờ ký số → hệ thống đang xử lý, không có nút thao tác.
 *   - "issued"  Đã xuất   → "Gửi lại HĐĐT cho khách" + "Tải hóa đơn (PDF)".
 *   - "error"   Lỗi xuất  → badge đỏ + nút "Thử lại (Xuất lại hóa đơn)".
 *
 * ⚠️ Đây là HÓA ĐƠN ĐIỆN TỬ PHÁP LÝ (HĐĐT) — KHÁC với "Phiếu đóng gói / Phiếu
 * bán hàng" mà nhân viên kho in ra để soạn hàng. Các nút hiện là GIỮ CHỖ: chưa
 * gọi API phát hành/ký số thật, mới dựng khung giao diện cho luồng.
 */

/** Trạng thái phát hành hóa đơn của một đơn. */
export type InvoiceStatus = "none" | "signing" | "issued" | "error";

const STATUS_META: Record<
  InvoiceStatus,
  { label: string; badge: string; icon: LucideIcon }
> = {
  none: {
    label: "Chưa xuất hóa đơn",
    badge: "bg-zinc-100 text-zinc-600 border-zinc-200",
    icon: FileX2,
  },
  signing: {
    label: "Đang chờ ký số",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    icon: FileClock,
  },
  issued: {
    label: "Đã xuất hóa đơn",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: FileCheck2,
  },
  error: {
    label: "Lỗi xuất hóa đơn",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    icon: FileWarning,
  },
};

export function InvoiceStatusPanel({
  status = "none",
  reference,
  className,
}: {
  /** Trạng thái phát hành hiện tại. Mặc định "Chưa xuất". */
  status?: InvoiceStatus;
  /** Ngữ cảnh để ghi vào thông báo giữ chỗ, VD mã đơn. */
  reference?: string;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;
  const suffix = reference ? ` (${reference})` : "";

  function handleExport() {
    toast.info(
      `Giữ chỗ: luồng chủ động xuất hóa đơn điện tử${suffix} đang được dựng.`
    );
  }

  function handleRetry() {
    toast.info(
      `Giữ chỗ: đang thử xuất lại hóa đơn điện tử${suffix} sau khi lỗi.`
    );
  }

  function handleResend() {
    toast.info(
      `Giữ chỗ: luồng gửi lại HĐĐT qua Email/SMS cho khách${suffix} đang được dựng.`
    );
  }

  function handleDownload() {
    toast.info(
      `Giữ chỗ: luồng tải hóa đơn (PDF) để in ra giấy${suffix} đang được dựng.`
    );
  }

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-slate-50/60 p-3", className)}>
      {/* Hàng trạng thái */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusIcon
            className={cn(
              "size-4",
              status === "error" ? "text-rose-500" : "text-slate-500"
            )}
          />
          <span className="text-sm font-medium text-slate-700">
            Hóa đơn điện tử (HĐĐT)
          </span>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
            meta.badge
          )}
        >
          {meta.label}
        </span>
      </div>

      {/* Hành động — bám theo trạng thái phát hành */}
      <div className="mt-3 flex flex-wrap gap-2">
        {status === "none" && (
          <Button
            type="button"
            size="sm"
            className="flex-1"
            onClick={handleExport}
          >
            <FileOutput className="size-4" />
            Xuất hóa đơn điện tử
          </Button>
        )}

        {status === "issued" && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={handleResend}
            >
              <Send className="size-4" />
              Gửi lại HĐĐT cho khách
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={handleDownload}
            >
              <FileDown className="size-4" />
              Tải hóa đơn (PDF)
            </Button>
          </>
        )}

        {status === "error" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1 border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            onClick={handleRetry}
          >
            <RotateCcw className="size-4" />
            Thử lại (Xuất lại hóa đơn)
          </Button>
        )}

        {status === "signing" && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700">
            <FileClock className="size-3.5" />
            Hệ thống đang ký số — chờ hoàn tất để gửi & tải hóa đơn.
          </p>
        )}
      </div>

      {/* Phân biệt với phiếu kho để nhân viên không thao tác nhầm */}
      <p className={cn(TEXT_SUB, "mt-2 flex items-start gap-1.5")}>
        <PackageCheck className="mt-0.5 size-3.5 shrink-0" />
        Đây là hóa đơn thuế pháp lý — khác với <b>Phiếu đóng gói / Phiếu bán
        hàng</b> mà kho in ra khi soạn hàng.
      </p>
    </div>
  );
}
