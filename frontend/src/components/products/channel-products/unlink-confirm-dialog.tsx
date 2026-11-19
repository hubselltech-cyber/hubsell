"use client";

import { Link2Off, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatNumber } from "@/lib/format";

/**
 * HỘP HỎI LẠI TRƯỚC KHI GỠ NỐI (19/11/2026, anh Trung: "nối vào rồi nhưng không biết gỡ ra kiểu gì").
 * Gỡ nối nay có nút nhìn thấy ngay trên dòng (trước chỉ nằm trong menu ⋯), nên dễ bấm nhầm hơn — hỏi
 * lại một lần và nói rõ điều gì đổi, điều gì không. Mọi cửa gỡ nối của trang đi qua hộp này.
 */
export function UnlinkConfirmDialog({
  open,
  title,
  count,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Tên sản phẩm sàn (kèm phân loại khi gỡ một phân loại). */
  title: string;
  /** Số phân loại sắp gỡ. */
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gỡ nối {formatNumber(count)} phân loại khỏi Tổng kho?</DialogTitle>
          <DialogDescription className="line-clamp-2" title={title}>
            {title}
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Đơn mới của {count > 1 ? "các phân loại này" : "phân loại này"} không còn trừ tồn ở Tổng kho.</li>
          <li>Tồn trên sàn giữ nguyên số đang có và không còn đi theo kho.</li>
          <li>Sản phẩm kho, số tồn, giá vốn và đơn cũ không đổi. Muốn nối lại thì vào tab Cần nối.</li>
        </ul>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Hủy
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2Off className="size-4" />}
            Gỡ nối
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
