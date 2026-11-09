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
import { ApiError, bulkProductStockSettings, type Product } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";

/** Máy chủ nhận tối đa 500 SKU mỗi lần gọi `/api/products/bulk` — tích nhiều hơn thì gửi nối tiếp. */
const BULK_CHUNK = 500;

/**
 * CÀI NHANH CHO NHIỀU SKU ĐÃ TÍCH (09/11/2026, khách xin: "tích vào nhiều sản phẩm và cài đặt cảnh
 * báo, tồn an toàn" thay vì mở ⋯ từng dòng). Hai ô giống hộp cài đặt của một SKU; ô nào ĐỂ TRỐNG thì
 * giữ nguyên số đang có của từng SKU (khác hộp một SKU, nơi để trống = về mặc định toàn shop).
 */
export function BulkStockSettingsDialog({
  selected,
  shopDefaults,
  open,
  onOpenChange,
  onSaved,
}: {
  selected: Product[];
  /** Mặc định toàn shop — chỉ để gợi ý trong ô. */
  shopDefaults: { safetyStock: number; lowStock: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [lowStock, setLowStock] = useState("");
  const [safety, setSafety] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLowStock("");
    setSafety("");
  }, [open]);

  /** undefined = để trống (giữ nguyên); false = nhập sai. */
  function parse(raw: string, label: string): number | undefined | false {
    const v = raw.trim();
    if (v === "") return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      toast.error(`${label} phải là số nguyên không âm`);
      return false;
    }
    return n;
  }

  const linkedCount = selected.filter((p) => (p.channelLinks ?? []).length > 0).length;
  const nothingTyped = lowStock.trim() === "" && safety.trim() === "";

  async function handleSave() {
    const low = parse(lowStock, "Ngưỡng cảnh báo");
    if (low === false) return;
    const safe = parse(safety, "Tồn an toàn");
    if (safe === false) return;
    if (low === undefined && safe === undefined) return;
    setSaving(true);
    const ids = selected.map((p) => p.id);
    let done = 0;
    try {
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const res = await bulkProductStockSettings({
          ids: ids.slice(i, i + BULK_CHUNK),
          ...(low !== undefined ? { lowStockThreshold: low } : {}),
          ...(safe !== undefined ? { safetyStock: safe } : {}),
        });
        done += res.affected;
      }
      const parts = [
        low !== undefined ? `ngưỡng cảnh báo ${low === 0 ? "tắt" : formatNumber(low)}` : null,
        safe !== undefined ? `tồn an toàn ${formatNumber(safe)}` : null,
      ].filter(Boolean);
      toast.success(`Đã cài ${parts.join(", ")} cho ${formatNumber(done)} SKU`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Không lưu được cài đặt";
      toast.error(done > 0 ? `Đã cài ${formatNumber(done)}/${formatNumber(ids.length)} SKU thì gặp lỗi: ${msg}` : msg, {
        duration: 8000,
      });
      if (done > 0) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="size-5 text-slate-500" />
            Cài cảnh báo &amp; tồn an toàn cho {formatNumber(selected.length)} SKU
          </DialogTitle>
          <DialogDescription>
            Áp cho các SKU đang tích. Ô nào để trống thì giữ nguyên số đang có của từng SKU.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-low-stock">Ngưỡng cảnh báo sắp hết hàng</Label>
            <div className="flex items-center gap-2">
              <Input
                id="bulk-low-stock"
                type="number"
                min={0}
                step={1}
                value={lowStock}
                onChange={(e) => setLowStock(e.target.value)}
                placeholder="giữ nguyên"
                className="w-32"
                autoFocus
              />
              <span className={TEXT_SUB}>
                chiếc · 0 = tắt · mặc định shop {shopDefaults.lowStock ? formatNumber(shopDefaults.lowStock) : "tắt"}
              </span>
            </div>
            <p className={TEXT_SUB}>
              Khả dụng (tồn − đang giữ) rơi xuống ≤ ngưỡng là báo chuông và lên thẻ Trung tâm điều hành.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-safety">Tồn an toàn (giữ lại, không bán trên sàn)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="bulk-safety"
                type="number"
                min={0}
                step={1}
                value={safety}
                onChange={(e) => setSafety(e.target.value)}
                placeholder="giữ nguyên"
                className="w-32"
              />
              <span className={TEXT_SUB}>chiếc · mặc định shop {formatNumber(shopDefaults.safetyStock)}</span>
            </div>
            <p className={TEXT_SUB}>
              Có thể bán = tồn − giữ − tồn an toàn.
              {safety.trim() !== "" && linkedCount > 0 && (
                <span className="ml-1 font-medium text-amber-700">
                  {formatNumber(linkedCount)} SKU đang nối sàn sẽ được đẩy lại số Có thể bán lên các gian đang bật
                  đồng bộ.
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Hủy
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || nothingTyped}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Áp cho {formatNumber(selected.length)} SKU
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
