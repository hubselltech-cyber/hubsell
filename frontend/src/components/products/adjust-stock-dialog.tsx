"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { adjustInventory, ApiError, type Product, type StockLocation } from "@/lib/api";
import { readLastLocation, rememberLocation } from "@/lib/stock-location-pref";

interface AdjustStockDialogProps {
  product: Product;
  type: "IMPORT" | "EXPORT";
  /** Vị trí chứa hàng của shop (đợt B) — rỗng = không hiện ô chọn. */
  locations?: StockLocation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

// Hộp thoại Nhập/Xuất kho nhanh cho một sản phẩm
export function AdjustStockDialog({
  product,
  type,
  locations = [],
  open,
  onOpenChange,
  onDone,
}: AdjustStockDialogProps) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Vị trí: nhớ lần chọn cuối (anh Trung 15/09: "nhớ lần chọn cuối"); xuất để
  // trống = trừ theo thứ tự ưu tiên.
  const [locationId, setLocationId] = useState(() =>
    locations.length ? readLastLocation(locations) : ""
  );

  const isImport = type === "IMPORT";
  const qtyById = new Map((product.stockLevels ?? []).map((l) => [l.locationId, l.quantity]));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error("Số lượng phải là số nguyên dương");
      return;
    }
    if (!isImport && qty > product.quantityInStock) {
      toast.error(
        `Không đủ hàng để xuất: tồn kho hiện tại ${product.quantityInStock}`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await adjustInventory({
        productId: product.id,
        type,
        quantity: qty,
        reason: reason.trim() || undefined,
        locationId: locationId || undefined,
      });
      if (locationId) rememberLocation(locationId);
      toast.success(
        `${isImport ? "Nhập" : "Xuất"} kho thành công. Tồn kho mới: ${res.product.quantityInStock}`
      );
      setQuantity("1");
      setReason("");
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isImport ? (
              <ArrowDownToLine className="size-5 text-emerald-500" />
            ) : (
              <ArrowUpFromLine className="size-5 text-red-500" />
            )}
            {isImport ? "Nhập kho" : "Xuất kho"}: {product.productName}
          </DialogTitle>
          <DialogDescription>
            Mã SKU: {product.skuCode} · Tồn kho hiện tại:{" "}
            <span className="font-semibold">{product.quantityInStock}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="adjust-qty">
              Số lượng {isImport ? "nhập thêm" : "xuất ra"}
            </Label>
            <Input
              id="adjust-qty"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </div>
          {locations.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="adjust-location">{isImport ? "Nhập vào" : "Xuất từ"}</Label>
              <NativeSelect
                id="adjust-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {!isImport && <option value="">Tự trừ theo thứ tự ưu tiên</option>}
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {isImport ? "" : ` (đang có ${qtyById.get(l.id) ?? 0})`}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="adjust-reason">Lý do (không bắt buộc)</Label>
            <Input
              id="adjust-reason"
              placeholder={isImport ? "VD: Nhập thêm từ xưởng" : "VD: Xuất bán tại quầy"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Huỷ
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className={isImport ? "" : "bg-rose-600 hover:bg-rose-700"}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {isImport ? "Xác nhận nhập" : "Xác nhận xuất"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
