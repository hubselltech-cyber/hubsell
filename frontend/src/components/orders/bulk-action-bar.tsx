"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, PackageCheck, Printer } from "lucide-react";

import { BulkBar } from "@/components/data-table/bulk-bar";
import { Button } from "@/components/ui/button";
import { ApiError, type Order } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { ArrangeShipmentDialog, printLabels } from "@/components/orders/arrange-shipment-dialog";
import { PrintOptionsDialog } from "@/components/orders/print-options";

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
  const [busy, setBusy] = React.useState<"print" | null>(null);
  const [arrangeOpen, setArrangeOpen] = React.useState(false);
  const [printOpen, setPrintOpen] = React.useState(false);

  const packable = selected.filter((o) => o.shippingStatus === "PENDING");
  // Vận đơn sàn chỉ có sau khi chuẩn bị; đơn Chờ xử lý vẫn in được phiếu nhặt
  const withLabel = selected.filter(
    (o) => o.shippingStatus === "PROCESSED" || o.shippingStatus === "SHIPPING"
  );
  // Đơn đã in rồi mà chọn in lại — cảnh báo trước để tránh in trùng cả xấp
  const reprinting = selected.filter((o) => o.labelPrintedAt !== null);

  async function handlePrint(opts: { labels: boolean; pickList: boolean }) {
    setBusy("print");
    try {
      await printLabels(
        selected.map((o) => o.id),
        opts
      );
      onClear();
      onDone(); // tải lại để nhãn "Đã in" hiện ngay
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lấy được vận đơn");
    } finally {
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
          onClick={() => setArrangeOpen(true)}
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
      </BulkBar>

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
