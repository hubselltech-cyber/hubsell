"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  BellRing,
  History,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiError, deleteProduct, setProductActive, type Product } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * MENU "⋯" của một dòng Hàng hóa (24/09): việc thỉnh thoảng mới làm gom vào
 * một nút để hàng nút chính (Nhập · Xuất) không phình.
 *   - Lịch sử kho (ai cũng xem được)
 *   - Cài đặt cảnh báo / tồn an toàn (chủ shop)
 *   - Ngừng kinh doanh ⇄ Bán lại (chủ shop) — ẩn khỏi bảng, giữ đơn cũ + liên kết
 *   - Xóa SKU (chủ shop) — backend chỉ cho khi chưa dính đơn / liên kết / tồn = 0,
 *     ngược lại báo lý do và chỉ sang Ngừng kinh doanh.
 */
export function ProductRowMenu({
  product,
  isAdmin,
  onHistory,
  onSettings,
  onChanged,
}: {
  product: Product;
  isAdmin: boolean;
  onHistory: () => void;
  onSettings: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = product.isActive !== false;

  async function toggleActive() {
    setBusy(true);
    try {
      await setProductActive(product.id, !active);
      toast.success(
        active
          ? `Đã ngừng kinh doanh ${product.skuCode} — tồn, đơn cũ và liên kết sàn giữ nguyên`
          : `${product.skuCode} đã bán lại`
      );
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteProduct(product.id);
      toast.success(`Đã xóa ${product.skuCode}`);
      setConfirmDelete(false);
      setOpen(false);
      onChanged();
    } catch (err) {
      // 409 mang lý do đích danh (đã có đơn / đang nối / còn tồn) — hiện nguyên câu
      // và đóng hộp xác nhận: không có gì để thử lại ở đây, việc kế tiếp là
      // "Ngừng kinh doanh" trong menu.
      setConfirmDelete(false);
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ", {
        duration: 8000,
      });
    } finally {
      setBusy(false);
    }
  }

  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground"
              title={`Thao tác khác với ${product.skuCode}`}
              aria-label={`Thao tác khác với ${product.skuCode}`}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onHistory();
            }}
          >
            <History className="size-4 text-slate-500" />
            Lịch sử kho
          </button>
          {isAdmin && (
            <>
              <button
                type="button"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onSettings();
                }}
              >
                <BellRing
                  className={cn("size-4", product.isLowStock ? "text-amber-600" : "text-slate-500")}
                />
                Cảnh báo & tồn an toàn
              </button>
              <div className="my-1 border-t" />
              <button type="button" className={item} disabled={busy} onClick={toggleActive}>
                {active ? (
                  <PauseCircle className="size-4 text-slate-500" />
                ) : (
                  <PlayCircle className="size-4 text-emerald-600" />
                )}
                {active ? "Ngừng kinh doanh" : "Bán lại"}
              </button>
              <button
                type="button"
                className={cn(item, "text-rose-700 hover:bg-rose-50")}
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setConfirmDelete(true);
                }}
              >
                <Trash2 className="size-4" />
                Xóa SKU
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa SKU {product.skuCode}?</DialogTitle>
            <DialogDescription>
              Chỉ xóa được SKU chưa có đơn hàng, chưa nối SKU sàn và tồn bằng 0. SKU đã
              bán rồi thì dùng &ldquo;Ngừng kinh doanh&rdquo; để ẩn khỏi bảng mà vẫn giữ
              lịch sử và Lãi/Lỗ.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
