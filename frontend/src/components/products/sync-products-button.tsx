"use client";

import * as React from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError, syncProductsFromChannels } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * NÚT "ĐỒNG BỘ TỪ SÀN" — quét danh mục các gian hàng đang kết nối, tạo sản
 * phẩm gốc còn thiếu và nối mapping SKU sàn ↔ sản phẩm gốc.
 *
 * Đứng ở HAI nơi: trang Sản phẩm (chỗ đúng về nghiệp vụ kho) và trang Cấu hình
 * Giá vốn (tiện đồng bộ tại chỗ khi đang duyệt tài chính mà phát hiện thiếu
 * SKU). Tách thành component dùng chung thay vì chép hai bản — hai bản rời sẽ
 * trôi khác nhau, sau này sửa một chỗ quên chỗ kia.
 */
export function SyncProductsButton({
  onSynced,
  className,
}: {
  /** Gọi sau khi đồng bộ xong để trang tải lại danh sách */
  onSynced: () => void | Promise<void>;
  className?: string;
}) {
  const [syncing, setSyncing] = React.useState(false);

  async function handleSync() {
    setSyncing(true);
    toast.info(
      "Đang tiến hành đồng bộ sản phẩm từ các sàn, vui lòng đợi trong giây lát...",
      { duration: 4000 }
    );
    try {
      const res = await syncProductsFromChannels();
      await onSynced();
      toast.success(
        `Đồng bộ sản phẩm thành công! Thêm mới ${res.created} SKU, cập nhật ${res.updated} SKU.`,
        { duration: 6000 }
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không đồng bộ được sản phẩm"
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
