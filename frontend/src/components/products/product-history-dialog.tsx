"use client";

import { History } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Product } from "@/lib/api";
import { formatNumber } from "@/lib/format";

import { InventoryLogTable } from "./inventory-log-table";

/**
 * LỊCH SỬ KHO của MỘT SKU (24/09): tra cứu nhanh ngay trên bảng Hàng hóa —
 * "tồn 40 là vì đâu": đơn nào trừ, ai nhập, ai sửa. Sổ toàn shop nằm ở tab
 * Nhật ký kho.
 */
export function ProductHistoryDialog({
  product,
  open,
  onOpenChange,
}: {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-5 text-slate-600" />
            Lịch sử kho: {product.productName}
          </DialogTitle>
          <DialogDescription>
            Mã SKU: <span className="font-mono">{product.skuCode}</span> · Tồn hiện tại:{" "}
            <span className="font-semibold text-foreground">
              {formatNumber(product.quantityInStock)}
            </span>
          </DialogDescription>
        </DialogHeader>
        <InventoryLogTable productId={product.id} compact />
      </DialogContent>
    </Dialog>
  );
}
