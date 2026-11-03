"use client";

import * as React from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError, fetchCatalogPending, syncProductsFromChannels } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { pollUntil } from "@/lib/poll";
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
 *
 * ★ 03/11/2026 (lát 3.7 giai đoạn 3): máy chủ KHÔNG kéo ngay trong lượt bấm nữa
 * (gian ~600 SP từng làm web sập 7 lần trong 25 phút). Bấm = xin kéo, máy chủ trả
 * lời trong tích tắc. Anh Trung thử 15:30: nút xoay khóa 5–6 phút "khó chịu hơn
 * cả báo lỗi" → nút TRẢ VỀ BÌNH THƯỜNG NGAY sau khi xin; việc chờ chạy nền: trang
 * Giá vốn tự hiện dải "Đang kéo danh mục…" (qua onSynced → nạp lại), nút chỉ hỏi
 * theo nhịp ở nền để nạp lại bảng + báo xong/lỗi khi kéo xong. Bấm lại trong lúc
 * đang kéo → máy chủ trả "already", chỉ toast nhắc.
 */
const WAIT_POLL_MS = 5_000;
const WAIT_MAX_MS = 30 * 60_000;

type PendingResponse = Awaited<ReturnType<typeof fetchCatalogPending>>;

export function SyncChannelProductsButton({
  channelId,
  onSynced,
  className,
  label = "Đồng bộ từ sàn",
}: {
  /** Chỉ đồng bộ một gian hàng. Bỏ trống = quét mọi gian hàng đang hoạt động. */
  channelId?: string;
  onSynced: () => void | Promise<void>;
  className?: string;
  /** Nhãn trên nút — nơi khác gọi cùng hành động nhưng theo ngữ cảnh riêng. */
  label?: string;
}) {
  const [syncing, setSyncing] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Chạy NỀN sau khi xin kéo: chờ worker xong → nạp lại bảng + báo kết quả. Không khóa nút. */
  async function waitInBackground(waitIds: string[], startedAt: number) {
    const last: { v: PendingResponse | null } = { v: null };
    const done = await pollUntil(
      async () => {
        last.v = await fetchCatalogPending();
        const pending = new Set(last.v.pending.map((p) => p.id));
        return waitIds.every((id) => !pending.has(id));
      },
      { intervalMs: WAIT_POLL_MS, maxMs: WAIT_MAX_MS }
    );
    if (!mounted.current) return; // đã rời trang — trang khác tự nạp khi mở
    await onSynced();
    if (!done) return; // trang Giá vốn vẫn còn dải "đang kéo" và tự nạp khi xong
    const failed = (last.v?.channels ?? []).filter(
      (c) =>
        waitIds.includes(c.id) &&
        c.productSyncError &&
        !(c.lastProductSyncAt && new Date(c.lastProductSyncAt).getTime() >= startedAt)
    );
    if (failed.length > 0) {
      toast.warning(
        `Có ${failed.length} gian lỗi: ${failed.map((c) => `${c.shopName} (${c.productSyncError})`).join("; ")}`,
        { duration: 10000 }
      );
    }
    const okCount = waitIds.length - failed.length;
    if (okCount > 0) {
      toast.success(
        okCount === 1 ? "Đã kéo xong danh mục từ sàn." : `Đã kéo xong danh mục từ ${okCount} gian.`,
        { duration: 6000 }
      );
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncProductsFromChannels(channelId);
      const per = res.perChannel ?? [];

      if (!res.queued) {
        // Máy chủ bản cũ (chưa deploy lát 3.7): vẫn kéo ngay và trả số đếm.
        await onSynced();
        const failed = per.filter((c) => c.error);
        if (failed.length > 0) {
          toast.warning(
            `Có ${failed.length} gian lỗi: ${failed.map((c) => `${c.shopName} (${c.error})`).join("; ")}`,
            { duration: 10000 }
          );
        }
        toast.success(
          `Đồng bộ xong: thêm mới ${formatNumber(res.created)} sản phẩm sàn, cập nhật ${formatNumber(res.updated)}.` +
            (res.costAutoFilled
              ? ` Tự điền giá vốn cho ${formatNumber(res.costAutoFilled)} SKU mới trùng mã.`
              : ""),
          { duration: 6000 }
        );
        return;
      }

      // Gian không đủ điều kiện (chưa ủy quyền / ngủ đông) — báo đích danh, các gian khác vẫn kéo.
      const ineligible = per.filter((c) => c.outcome === "ineligible");
      if (ineligible.length > 0) {
        toast.warning(
          `${ineligible.map((c) => c.shopName).join(", ")}: ${ineligible[0].message ?? "chưa có ủy quyền sàn."}`,
          { duration: 10000 }
        );
      }
      const waitIds = per
        .filter((c) => c.outcome === "queued" || c.outcome === "already")
        .map((c) => c.channelId);
      if (waitIds.length === 0) {
        if (per.some((c) => c.outcome === "recent")) {
          toast.info("Vừa kéo xong chưa tới 2 phút — danh sách đã là mới nhất.");
        }
        await onSynced();
        return;
      }

      toast.info("Đang kéo trong vài phút. Bảng tự cập nhật khi xong, không cần chờ ở đây.", {
        duration: 6000,
      });
      // Nạp lại ngay để trang hiện dải "Đang kéo danh mục…" (catalogPending); việc chờ chạy nền.
      await onSynced();
      void waitInBackground(waitIds, Date.now()).catch(() => {});
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không đồng bộ được danh mục"
      );
    } finally {
      if (mounted.current) setSyncing(false);
    }
  }

  return (
    <Button
      onClick={handleSync}
      disabled={syncing}
      className={cn("bg-teal-600 text-white hover:bg-teal-700", className)}
    >
      <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
      {label}
    </Button>
  );
}
