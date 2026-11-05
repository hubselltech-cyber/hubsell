"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";

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
import { ApiError, updateProductBarcode, updateProductStockSettings, type Product } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface SkuSettingsDialogProps {
  product: Product;
  /** Mặc định toàn shop — hiện làm gợi ý khi SKU để trống. */
  shopDefaults: { safetyStock: number; lowStock: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * CÀI ĐẶT RIÊNG CỦA MỘT SKU: mã vạch quản lý + ngưỡng cảnh báo sắp hết hàng + tồn an toàn.
 * Ô ngưỡng / tồn an toàn để trống = dùng mặc định toàn shop (Cài đặt đồng bộ); nhập 0 = tắt/không đệm.
 * Ô mã vạch (05/11/2026): hệ thống đã tự sinh 13 số; khách thay bằng mã có sẵn trên hàng, xóa trắng
 * = nhờ máy sinh mã mới. Chỉ gọi lưu mã vạch khi ô thật sự đổi.
 */
export function SkuSettingsDialog({
  product,
  shopDefaults,
  open,
  onOpenChange,
  onSaved,
}: SkuSettingsDialogProps) {
  const [lowStock, setLowStock] = useState("");
  const [safety, setSafety] = useState("");
  const [barcode, setBarcode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLowStock(product.lowStockThreshold == null ? "" : String(product.lowStockThreshold));
    setSafety(product.safetyStock == null ? "" : String(product.safetyStock));
    setBarcode(product.barcode ?? "");
  }, [open, product]);

  function parse(raw: string, label: string): number | null | false {
    const v = raw.trim();
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      toast.error(`${label} phải là số nguyên không âm`);
      return false;
    }
    return n;
  }

  async function handleSave() {
    const low = parse(lowStock, "Ngưỡng cảnh báo");
    if (low === false) return;
    const safe = parse(safety, "Tồn an toàn");
    if (safe === false) return;
    setSaving(true);
    try {
      // Mã vạch lưu TRƯỚC: trùng mã thì dừng ở đây, chưa đổi gì khác.
      if (barcode.trim() !== (product.barcode ?? "")) {
        await updateProductBarcode(product.id, barcode.trim());
      }
      await updateProductStockSettings(product.id, {
        lowStockThreshold: low,
        safetyStock: safe,
      });
      toast.success(`Đã lưu cài đặt cho SKU ${product.skuCode}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được cài đặt");
    } finally {
      setSaving(false);
    }
  }

  const available = product.quantityInStock - (product.holdQuantity ?? 0);
  const lowEff = lowStock.trim() === "" ? shopDefaults.lowStock : Number(lowStock) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="size-5 text-slate-500" />
            Cài đặt SKU {product.skuCode}
          </DialogTitle>
          <DialogDescription>
            {product.productName} — tồn {formatNumber(product.quantityInStock)}, khả dụng{" "}
            {formatNumber(available)}. Để trống ô nào là dùng mặc định toàn shop.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sku-barcode">Mã vạch quản lý</Label>
            <Input
              id="sku-barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="để trống = hệ thống sinh mã 13 số mới"
              className="font-mono"
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
            />
            <p className={TEXT_SUB}>
              Mã để kho quét và in tem. Hệ thống đã tự sinh sẵn; hàng có mã in trên bao bì thì nhập mã
              đó vào đây. Đổi mã thì tem đã in theo mã cũ sẽ quét không ra.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sku-low-stock">Ngưỡng cảnh báo sắp hết hàng</Label>
            <div className="flex items-center gap-2">
              <Input
                id="sku-low-stock"
                type="number"
                min={0}
                step={1}
                value={lowStock}
                onChange={(e) => setLowStock(e.target.value)}
                placeholder={`mặc định ${shopDefaults.lowStock || "tắt"}`}
                className="w-32"
              />
              <span className={TEXT_SUB}>chiếc · 0 = tắt</span>
            </div>
            <p className={cn(TEXT_SUB)}>
              Khả dụng (tồn − đang giữ) rơi xuống ≤ ngưỡng là báo chuông và lên thẻ
              Trung tâm điều hành; nhập kho vượt ngưỡng thì thẻ tự đóng.
              {lowEff > 0 && available <= lowEff && (
                <span className="ml-1 font-medium text-amber-700">
                  SKU này đang ở dưới ngưỡng {formatNumber(lowEff)}.
                </span>
              )}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sku-safety">Tồn an toàn (giữ lại, không bán trên sàn)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="sku-safety"
                type="number"
                min={0}
                step={1}
                value={safety}
                onChange={(e) => setSafety(e.target.value)}
                placeholder={`mặc định ${shopDefaults.safetyStock}`}
                className="w-32"
              />
              <span className={TEXT_SUB}>chiếc</span>
            </div>
            <p className={TEXT_SUB}>
              Đệm chống bán vượt khi nhiều gian nổ đơn sát nhau. Có thể bán = tồn −
              giữ − tồn an toàn; đổi số này là đẩy lại lên sàn ngay.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Hủy
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Lưu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
