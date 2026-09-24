"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";

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
import {
  ApiError,
  fetchProductStockLevels,
  transferStock,
  type Product,
  type ProductStockLevelRow,
  type StockLocation,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * CHUYỂN VỊ TRÍ một SKU (đợt B): từ đâu → sang đâu → bao nhiêu, XEM TRƯỚC số
 * cũ → mới ở hai đầu rồi mới xác nhận. Không có trạng thái "đang chuyển" (kho
 * gần nhau, anh Trung 15/09). Tổng không đổi nên không đẩy sàn.
 */
export function StockTransferDialog({
  product,
  locations,
  defaultFromId,
  open,
  onOpenChange,
  onDone,
}: {
  product: Product;
  locations: StockLocation[];
  defaultFromId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [levels, setLevels] = useState<ProductStockLevelRow[] | null>(null);
  const [fromId, setFromId] = useState(defaultFromId ?? "");
  const [toId, setToId] = useState("");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLevels(null);
    fetchProductStockLevels(product.id)
      .then((r) => {
        setLevels(r.levels);
        // Nơi đi mặc định: vị trí truyền vào, không thì vị trí đang giữ nhiều nhất.
        const richest = [...r.levels].sort((a, b) => b.quantity - a.quantity)[0];
        setFromId((cur) => cur || defaultFromId || richest?.id || "");
      })
      .catch(() => toast.error("Không tải được tồn theo vị trí"));
  }, [open, product.id, defaultFromId]);

  const qtyById = useMemo(
    () => new Map((levels ?? []).map((l) => [l.id, l.quantity])),
    [levels]
  );
  const n = Number(qty);
  const fromQty = qtyById.get(fromId) ?? 0;
  const toQty = qtyById.get(toId) ?? 0;
  const valid =
    Boolean(fromId && toId) && fromId !== toId && Number.isInteger(n) && n > 0 && n <= fromQty;
  const nameOf = (id: string) => locations.find((l) => l.id === id)?.name ?? "—";
  const sellableOf = (id: string) => locations.find((l) => l.id === id)?.sellable !== false;
  // Qua lại giữa kho bán và ô không bán thì tồn bán đổi → nói rõ trước khi chuyển.
  const saleDelta =
    fromId && toId && sellableOf(fromId) !== sellableOf(toId) ? (sellableOf(toId) ? n : -n) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    try {
      await transferStock({
        fromLocationId: fromId,
        toLocationId: toId,
        items: [{ productId: product.id, quantity: n }],
        reason: reason.trim() || undefined,
      });
      toast.success(
        `Đã chuyển ${formatNumber(n)} ${product.skuCode}: ${nameOf(fromId)} → ${nameOf(toId)}`
      );
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chuyển vị trí: {product.productName}</DialogTitle>
          <DialogDescription>
            Mã SKU: <span className="font-mono">{product.skuCode}</span> · tổng{" "}
            <span className="font-semibold text-foreground">
              {formatNumber(product.quantityInStock)}
            </span>{" "}
            {saleDelta === 0 ? "không đổi sau khi chuyển." : "đổi theo khi qua ô không bán."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tr-from">Từ</Label>
              <NativeSelect id="tr-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="">— chọn —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({formatNumber(qtyById.get(l.id) ?? 0)}){l.sellable ? "" : " · không bán"}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <ArrowRight className="mb-2 size-4 text-muted-foreground" />
            <div className="grid gap-1.5">
              <Label htmlFor="tr-to">Sang</Label>
              <NativeSelect id="tr-to" value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">— chọn —</option>
                {locations
                  .filter((l) => l.id !== fromId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({formatNumber(qtyById.get(l.id) ?? 0)}){l.sellable ? "" : " · không bán"}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tr-qty">Số lượng</Label>
            <Input
              id="tr-qty"
              type="number"
              min={1}
              max={fromQty || undefined}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className={cn("w-32 tabular-nums", n > fromQty && "border-rose-400")}
            />
          </div>

          {/* XEM TRƯỚC — số cũ → mới ở hai đầu */}
          {fromId && toId && Number.isInteger(n) && n > 0 && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <div>
                <p className={TEXT_SUB}>{nameOf(fromId)}</p>
                <p className="tabular-nums">
                  {formatNumber(fromQty)} →{" "}
                  <span className={cn("font-semibold", fromQty - n < 0 && "text-rose-700")}>
                    {formatNumber(fromQty - n)}
                  </span>
                </p>
              </div>
              <div>
                <p className={TEXT_SUB}>{nameOf(toId)}</p>
                <p className="tabular-nums">
                  {formatNumber(toQty)} →{" "}
                  <span className="font-semibold">{formatNumber(toQty + n)}</span>
                </p>
              </div>
              {n > fromQty && (
                <p className="col-span-2 text-xs text-rose-700">
                  {nameOf(fromId)} chỉ còn {formatNumber(fromQty)}, không đủ để chuyển.
                </p>
              )}
              {saleDelta !== 0 && n <= fromQty && (
                <p className="col-span-2 text-xs text-amber-700">
                  {saleDelta < 0
                    ? `${nameOf(toId)} là ô không bán: tồn bán giảm ${formatNumber(n)} (${formatNumber(product.quantityInStock)} → ${formatNumber(product.quantityInStock + saleDelta)}), sàn nhận số mới.`
                    : `Đưa về kho bán: tồn bán tăng ${formatNumber(n)} (${formatNumber(product.quantityInStock)} → ${formatNumber(product.quantityInStock + saleDelta)}), sàn nhận số mới.`}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="tr-reason">Ghi chú (không bắt buộc)</Label>
            <Input
              id="tr-reason"
              placeholder="VD: dồn hàng về kho gần bưu cục"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Huỷ
            </Button>
            <Button type="submit" disabled={!valid || submitting || levels === null}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Chuyển
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
