"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, PauseCircle, PlayCircle, Trash2 } from "lucide-react";

import { BulkBar } from "@/components/data-table/bulk-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, bulkProducts, type Product } from "@/lib/api";
import { formatNumber } from "@/lib/format";

/**
 * THANH XỬ LÝ HÀNG LOẠT của bảng Hàng hóa (anh Trung 24/09: "thêm ô tích ở đầu
 * để tiện ngừng hoặc xóa hàng loạt"). Nổi đáy màn hình như bảng Đơn hàng.
 * Ngừng kinh doanh / Bán lại chỉ đếm SKU đang ở trạng thái ngược lại; Xóa thì
 * máy chủ tự bỏ qua SKU đã dính đơn / liên kết / còn tồn và báo lại từng mã.
 */
export function ProductBulkBar({
  selected,
  onClear,
  onDone,
}: {
  selected: Product[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<"deactivate" | "activate" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const active = selected.filter((p) => p.isActive !== false);
  const inactive = selected.filter((p) => p.isActive === false);

  async function run(action: "deactivate" | "activate" | "delete", ids: string[]) {
    setBusy(action);
    try {
      const res = await bulkProducts({ action, ids });
      if (action === "delete") {
        if (res.skipped.length) {
          toast.warning(
            `Đã xóa ${formatNumber(res.affected)} SKU, bỏ qua ${formatNumber(res.skipped.length)}: ` +
              res.skipped
                .slice(0, 3)
                .map((s) => `${s.skuCode} (${s.reason})`)
                .join("; ") +
              (res.skipped.length > 3 ? "…" : "") +
              '. SKU đã bán thì dùng "Ngừng kinh doanh".',
            { duration: 10000 }
          );
        } else {
          toast.success(`Đã xóa ${formatNumber(res.affected)} SKU`);
        }
      } else {
        toast.success(
          action === "deactivate"
            ? `Đã ngừng kinh doanh ${formatNumber(res.affected)} SKU — tồn, đơn cũ, liên kết sàn giữ nguyên`
            : `Đã bán lại ${formatNumber(res.affected)} SKU`
        );
      }
      setConfirmDelete(false);
      onClear();
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ", {
        duration: 8000,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <BulkBar count={selected.length} unitLabel="SKU" onClear={onClear}>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || active.length === 0}
          title={active.length === 0 ? "Các SKU đã chọn đều đang ngừng bán" : "Ẩn khỏi bảng, giữ đơn cũ và liên kết sàn"}
          onClick={() => run("deactivate", active.map((p) => p.id))}
        >
          {busy === "deactivate" ? <Loader2 className="size-4 animate-spin" /> : <PauseCircle className="size-4" />}
          Ngừng kinh doanh ({formatNumber(active.length)})
        </Button>
        {inactive.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => run("activate", inactive.map((p) => p.id))}
          >
            {busy === "activate" ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
            Bán lại ({formatNumber(inactive.length)})
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive"
          disabled={busy !== null}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-4" />
          Xóa ({formatNumber(selected.length)})
        </Button>
      </BulkBar>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa {formatNumber(selected.length)} SKU đã chọn?</DialogTitle>
            <DialogDescription>
              Chỉ SKU chưa có đơn hàng, chưa nối SKU sàn và tồn bằng 0 mới bị xóa. Các SKU
              còn lại được giữ nguyên và báo lý do từng mã. SKU đã bán rồi thì dùng
              &ldquo;Ngừng kinh doanh&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => run("delete", selected.map((p) => p.id))}
            >
              {busy === "delete" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
