"use client";

import * as React from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError, syncProductsFromChannels } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * NÚT "ĐỒNG BỘ TỪ SÀN" — kéo danh mục từ gian hàng về TẦNG ĐỆM.
 *
 * KHÔNG tạo sản phẩm gốc. Tên và mã trên các shop sàn thường lệch nhau, đẩy
 * thẳng vào kho vật lý là sinh rác không dọn nổi; sản phẩm gốc chỉ do người
 * dùng tạo ở trang Sản phẩm rồi nối tay tại trang Liên kết SP.
 *
 * Dùng ở trang Liên kết SP (nơi làm việc chính với tầng đệm) và trang Cấu hình
 * Giá vốn (đồng bộ tại chỗ khi đang duyệt tài chính mà thiếu SKU).
 */
export function SyncChannelProductsButton({
  channelId,
  onSynced,
  className,
}: {
  /** Chỉ đồng bộ một gian hàng. Bỏ trống = quét mọi gian hàng đang hoạt động. */
  channelId?: string;
  onSynced: () => void | Promise<void>;
  className?: string;
}) {
  const [syncing, setSyncing] = React.useState(false);

  async function handleSync() {
    setSyncing(true);
    toast.info("Đang kéo danh mục từ các gian hàng về…", { duration: 4000 });
    try {
      const res = await syncProductsFromChannels(channelId);
      await onSynced();
      toast.success(
        `Đồng bộ xong: thêm mới ${formatNumber(res.created)} sản phẩm sàn, cập nhật ${formatNumber(res.updated)}.`,
        { duration: 6000 }
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không đồng bộ được danh mục"
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button
      onClick={handleSync}
      disabled={syncing}
      className={cn("bg-teal-600 text-white hover:bg-teal-700", className)}
    >
      <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
      {syncing ? "Đang đồng bộ…" : "Đồng bộ từ sàn"}
    </Button>
  );
}
