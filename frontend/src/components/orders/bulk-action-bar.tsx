"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, PackageCheck, Printer, Truck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ApiError,
  bulkConfirmOrders,
  bulkHandoverOrders,
  fetchOrderLabels,
  markOrdersPrinted,
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
 *
 * Ba nút bám đúng ba bước của quy trình kho:
 *   Chờ xử lý --[Xác nhận & chuẩn bị]--> Đã xử lý --[Bàn giao]--> Đang giao
 *                                          ↑ in phiếu ở bước này
 * Mỗi nút hiện sẵn SỐ ĐƠN THỰC SỰ xử lý được và tự khoá khi bằng 0, để không ai
 * bấm xong mới biết "đã bỏ qua 8 đơn".
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
  const [busy, setBusy] = React.useState<"confirm" | "handover" | "print" | null>(
    null
  );

  const packable = selected.filter((o) => o.shippingStatus === "PENDING");
  const handoverable = selected.filter((o) => o.shippingStatus === "PROCESSED");
  // Đơn đã in rồi mà chọn in lại — cảnh báo trước để tránh in trùng cả xấp
  const reprinting = selected.filter((o) => o.labelPrintedAt !== null);

  async function run(
    kind: "confirm" | "handover",
    ids: string[],
    verb: string
  ) {
    setBusy(kind);
    try {
      const res =
        kind === "confirm"
          ? await bulkConfirmOrders(ids)
          : await bulkHandoverOrders(ids);
      const extra =
        res.skipped.length > 0 ? ` · bỏ qua ${res.skipped.length} đơn` : "";
      toast.success(`Đã ${verb} ${formatNumber(res.confirmed)} đơn${extra}`, {
        duration: 6000,
      });
      onClear();
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Không ${verb} được`);
    } finally {
      setBusy(null);
    }
  }

  async function handlePrint() {
    setBusy("print");
    const ids = selected.map((o) => o.id);
    try {
      // Bước 1 — LẤY dữ liệu (chỉ đọc, chưa đánh dấu gì).
      // Lấy lại từ máy chủ thay vì dùng dữ liệu đang có trên bảng: đảm bảo phiếu
      // in ra là số liệu mới nhất và có đủ chi tiết dòng hàng.
      const res = await fetchOrderLabels(ids);

      // Bước 2 — MỞ cửa sổ in.
      const opened = printOrderLabels(res.labels);
      if (!opened) {
        toast.error(
          "Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up cho trang này rồi bấm lại."
        );
        return; // chưa in được thì KHÔNG đánh dấu, đơn vẫn nằm ở nhóm "Chưa in"
      }

      // Bước 3 — chỉ khi in thành công mới đánh dấu ĐÃ IN.
      // Thứ tự này là chủ đích: đánh dấu sớm hơn thì lúc pop-up bị chặn, đơn
      // rơi khỏi nhóm "Chưa in" mà chẳng có tờ phiếu nào — kho sẽ bỏ sót đúng
      // những đơn đó.
      const marked = await markOrdersPrinted(ids);
      toast.success(
        `Đã mở ${formatNumber(res.labels.length)} phiếu để in` +
          (marked.markedPrinted > 0
            ? ` · đánh dấu ĐÃ IN cho ${marked.markedPrinted} đơn`
            : ""),
        { duration: 6000 }
      );
      onClear();
      onDone(); // tải lại để nhãn "Đã in" hiện ngay
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không lấy được dữ liệu phiếu"
      );
    } finally {
      setBusy(null);
    }
  }

  if (selected.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Thao tác hàng loạt"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5"
    >
      <div className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-background shadow-lg ring-1 ring-black/10">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Đã chọn {formatNumber(selected.length)} đơn
          </p>
          <p className={cn(TEXT_SUB, "text-background/70")}>
            {reprinting.length > 0
              ? `${formatNumber(reprinting.length)} đơn đã in phiếu trước đó`
              : "Chưa đơn nào được in phiếu"}
          </p>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            run("confirm", packable.map((o) => o.id), "xác nhận chuẩn bị")
          }
          disabled={busy !== null || packable.length === 0}
          title={
            packable.length === 0
              ? "Chỉ đơn đang Chờ xử lý mới xác nhận chuẩn bị hàng được"
              : undefined
          }
        >
          {busy === "confirm" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PackageCheck className="size-4" />
          )}
          Xác nhận chuẩn bị ({formatNumber(packable.length)})
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            run("handover", handoverable.map((o) => o.id), "bàn giao")
          }
          disabled={busy !== null || handoverable.length === 0}
          title={
            handoverable.length === 0
              ? "Chỉ đơn Đã xử lý mới bàn giao cho đơn vị vận chuyển được"
              : undefined
          }
        >
          {busy === "handover" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Truck className="size-4" />
          )}
          Bàn giao ({formatNumber(handoverable.length)})
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={handlePrint}
          disabled={busy !== null}
          title={
            reprinting.length > 0
              ? `${reprinting.length} đơn trong danh sách đã được in phiếu trước đó`
              : undefined
          }
        >
          {busy === "print" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Printer className="size-4" />
          )}
          In phiếu
          {reprinting.length > 0 && ` (${formatNumber(reprinting.length)} in lại)`}
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
