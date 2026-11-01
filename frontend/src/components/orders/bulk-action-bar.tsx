"use client";

import * as React from "react";
import { toast } from "sonner";
import { ClipboardList, Loader2, PackageCheck, Printer } from "lucide-react";

import { BulkBar } from "@/components/data-table/bulk-bar";
import { Button } from "@/components/ui/button";
import { ApiError, createHandoverSheets, type Order } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import {
  ArrangeShipmentDialog,
  printLabels,
  waitForLabelsReady,
} from "@/components/orders/arrange-shipment-dialog";
import { PrintOptionsDialog } from "@/components/orders/print-options";
import { HandoverSheetsDialog, type CreatedSheet } from "@/components/orders/handover-sheets-dialog";

/**
 * THANH XỬ LÝ HÀNG LOẠT
 *
 * Nổi lên đáy màn hình khi có đơn được tích chọn. Đặt nổi thay vì gắn trên đầu
 * bảng vì shop soát đơn thường cuộn xuống giữa danh sách rồi mới tích — nút ở
 * trên đầu thì phải cuộn ngược lên mới bấm được.
 *
 * Hai nút bám đúng hai bước thật của kho (04/09 — bỏ "Bàn giao": Shopee không
 * có API bàn giao, trạng thái Đang giao do sàn phát khi shipper quét kiện):
 *   Chờ xử lý --[Chuẩn bị hàng: sàn sắp xếp vận chuyển]--> Đã xử lý --[In vận đơn]
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
  const [busy, setBusy] = React.useState<"print" | "handover" | null>(null);
  const [arrangeOpen, setArrangeOpen] = React.useState(false);
  const [printOpen, setPrintOpen] = React.useState(false);
  const [sheets, setSheets] = React.useState<CreatedSheet[] | null>(null);
  const [sheetsSkipped, setSheetsSkipped] = React.useState(0);

  const packable = selected.filter((o) => o.shippingStatus === "PENDING");
  // Biên bản bàn giao (01/11/2026): chỉ đơn ĐÃ QUÉT ĐÓNG GÓI và chưa nằm ở biên
  // bản nào; đơn hủy / chưa quét bị bỏ qua và báo số trong hộp kết quả.
  const handoverable = selected.filter(
    (o) =>
      o.packingDoneAt &&
      !o.handoverSheetId &&
      (o.shippingStatus === "PROCESSED" || o.shippingStatus === "SHIPPING")
  );

  async function handleHandover() {
    if (handoverable.length === 0) return;
    setBusy("handover");
    try {
      const res = await createHandoverSheets(handoverable.map((o) => o.id));
      setSheetsSkipped(selected.length - handoverable.length);
      setSheets(res.sheets);
      onDone(); // nhãn "Đã bàn giao" hiện ngay trên bảng
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tạo được biên bản bàn giao");
    } finally {
      setBusy(null);
    }
  }
  // Vận đơn sàn chỉ có sau khi chuẩn bị; đơn Chờ xử lý vẫn in được phiếu nhặt
  const withLabel = selected.filter(
    (o) => o.shippingStatus === "PROCESSED" || o.shippingStatus === "SHIPPING"
  );
  // Đơn đã in rồi mà chọn in lại — cảnh báo trước để tránh in trùng cả xấp
  const reprinting = selected.filter((o) => o.labelPrintedAt !== null);

  async function handlePrint(opts: { labels: boolean; pickList: boolean }) {
    setBusy("print");
    const toastId = toast.loading("Đang chuẩn bị phiếu in…");
    try {
      // Đơn vừa chuẩn bị mà tắt "in ngay" có thể chưa có mã vận đơn → đợi sàn
      // cấp đủ trước khi xin PDF, y như hộp thoại Chuẩn bị hàng.
      if (opts.labels) {
        const needWait = withLabel.filter((o) => !o.trackingCode).map((o) => o.id);
        if (needWait.length > 0) {
          await waitForLabelsReady(needWait, (p) =>
            toast.loading(`Sàn đã cấp vận đơn ${formatNumber(p.ready)}/${formatNumber(p.total)}…`, {
              id: toastId,
            })
          );
        }
      }
      toast.loading("Đang lấy vận đơn…", { id: toastId });
      await printLabels(
        selected.map((o) => o.id),
        opts
      );
      onClear();
      onDone(); // tải lại để nhãn "Đã in" hiện ngay
    } catch (err) {
      console.error("[bulk-action-bar] in phiếu lỗi:", err);
      toast.error(
        err instanceof ApiError
          ? err.message
          : err instanceof Error && err.message
            ? `Không lấy được vận đơn — ${err.message}`
            : "Không lấy được vận đơn"
      );
    } finally {
      toast.dismiss(toastId);
      setBusy(null);
    }
  }

  return (
    <>
      <BulkBar
        count={selected.length}
        unitLabel="đơn"
        subtitle={
          reprinting.length > 0
            ? `${formatNumber(reprinting.length)} đơn đã in phiếu trước đó`
            : "Chưa đơn nào được in phiếu"
        }
        onClear={onClear}
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            // Cảnh báo, không khóa cứng: đơn khách đang xin hủy vẫn chuẩn bị
            // được, nhưng chủ shop phải biết mình đang gói đơn có thể bị hủy.
            const asking = packable.filter((o) => o.cancelRequestedAt);
            if (
              asking.length > 0 &&
              !window.confirm(
                `${formatNumber(asking.length)} đơn đang có KHÁCH XIN HỦY (${asking
                  .slice(0, 3)
                  .map((o) => o.orderCode)
                  .join(", ")}${asking.length > 3 ? "…" : ""}). Chuẩn bị hàng rồi mà sàn hủy thì kiện phải quay đầu.\n\nVẫn chuẩn bị cả các đơn này?`
              )
            ) {
              return;
            }
            setArrangeOpen(true);
          }}
          disabled={busy !== null || packable.length === 0}
          title={
            packable.length === 0
              ? "Chỉ đơn đang Chờ xử lý mới chuẩn bị hàng được"
              : "Báo sàn sắp xếp vận chuyển (như bấm Chuẩn bị hàng trên Seller Center) rồi in vận đơn"
          }
        >
          <PackageCheck className="size-4" />
          Chuẩn bị hàng ({formatNumber(packable.length)})
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPrintOpen(true)}
          disabled={busy !== null || selected.length === 0}
          title={
            "Chọn in vận đơn chính chủ của sàn (A6, có mã vạch/QR) và/hoặc phiếu xuất hàng Hubsell." +
            (withLabel.length < selected.length
              ? ` ${selected.length - withLabel.length} đơn chưa chuẩn bị chỉ có phiếu xuất hàng.`
              : "") +
            (reprinting.length > 0 ? ` ${reprinting.length} đơn đã in trước đó.` : "")
          }
        >
          {busy === "print" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Printer className="size-4" />
          )}
          In phiếu ({formatNumber(selected.length)})
          {reprinting.length > 0 && ` · ${formatNumber(reprinting.length)} in lại`}
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleHandover}
          disabled={busy !== null || handoverable.length === 0}
          title={
            handoverable.length === 0
              ? "Chỉ đơn đã quét Đã đóng gói (chưa bàn giao) mới lập được biên bản — lọc chip Đã đóng gói rồi tích"
              : "Mỗi đơn vị vận chuyển một tờ A4 có mã vạch từng đơn để ship ký; mở hoặc tải PDF về in"
          }
        >
          {busy === "handover" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ClipboardList className="size-4" />
          )}
          Tạo biên bản bàn giao ({formatNumber(handoverable.length)})
        </Button>
      </BulkBar>

      <HandoverSheetsDialog
        sheets={sheets}
        skipped={sheetsSkipped}
        onClose={() => {
          setSheets(null);
          onClear();
        }}
      />

      <PrintOptionsDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        count={selected.length}
        withoutLabel={selected.length - withLabel.length}
        onConfirm={handlePrint}
      />

      <ArrangeShipmentDialog
        open={arrangeOpen}
        onOpenChange={setArrangeOpen}
        orders={packable}
        onDone={() => {
          onClear();
          onDone();
        }}
      />
    </>
  );
}
