"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ApiError, fetchStockVoucher, updateStockVoucher, type StockVoucherDetail } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { SupplierPicker, supplierChoiceToParams, type SupplierChoice } from "./supplier-picker";

/**
 * SỬA NHÀ CUNG CẤP / GIÁ NHẬP trên phiếu NHẬP đã lập (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 5).
 * Không sửa số lượng (số lượng là sổ kho). Có đường này vì chưa có hủy phiếu — gõ nhầm giá một lần
 * là báo cáo sai mãi — và vì thủ kho lập phiếu thường không biết giá, chủ shop bổ sung sau.
 * Chỉ người thấy tài chính mới mở được (nút chỉ hiện với họ; API cũng chặn).
 */
export function VoucherEditDialog({
  voucherId,
  onOpenChange,
}: {
  /** null = đóng. */
  voucherId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={voucherId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">{voucherId && <Loader key={voucherId} id={voucherId} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function Loader({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApiQuery({ queryKey: qk.stockVoucher(id), queryFn: () => fetchStockVoucher(id), staleTime: 0 });
  if (q.error) return <p className="py-6 text-center text-sm text-amber-700">{q.error}</p>;
  if (!q.data) {
    return (
      <p className={cn(TEXT_SUB, "inline-flex items-center gap-2 py-6")}>
        <Loader2 className="size-4 animate-spin" /> Đang tải phiếu…
      </p>
    );
  }
  return <EditBody data={q.data} onClose={onClose} />;
}

function EditBody({ data, onClose }: { data: StockVoucherDetail; onClose: () => void }) {
  const invalidate = useInvalidate();
  const v = data.voucher;
  const [supplier, setSupplier] = useState<SupplierChoice | null>(v.supplierName ? { id: v.supplierId, name: v.supplierName } : null);
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(v.lines.map((l) => [l.productId, l.purchasePrice != null ? String(l.purchasePrice) : ""]))
  );
  const [busy, setBusy] = useState(false);

  const changedPrices = v.lines
    .filter((l) => (prices[l.productId] ?? "") !== (l.purchasePrice != null ? String(l.purchasePrice) : ""))
    .map((l) => ({ productId: l.productId, purchasePrice: prices[l.productId] ? Number(prices[l.productId]) : null }));
  const supplierChanged = (supplier?.id ?? null) !== (v.supplierId ?? null) || (supplier?.name.trim() ?? "") !== (v.supplierName ?? "");
  const dirty = changedPrices.length > 0 || supplierChanged;
  const total = v.lines.reduce((a, l) => a + (prices[l.productId] ? Number(prices[l.productId]) * l.quantity : 0), 0);

  async function save() {
    if (!dirty) return;
    setBusy(true);
    try {
      const sp = supplierChoiceToParams(supplier);
      await updateStockVoucher(v.id, {
        ...(supplierChanged ? (sp.supplierId || sp.supplierName ? sp : { supplierId: null }) : {}),
        ...(changedPrices.length > 0 ? { prices: changedPrices } : {}),
      });
      toast.success(`Đã lưu phiếu ${v.code}`);
      await invalidate(qk.stockVouchersAll(), qk.stockVoucher(v.id), qk.suppliersAll(), qk.purchaseStatsAll());
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Phiếu nhập <span className="font-mono">{v.code}</span>
        </DialogTitle>
        <DialogDescription>Sửa nhà cung cấp và giá nhập. Số lượng không sửa ở đây. Giá nhập chỉ để đọc báo cáo, không đổi giá vốn.</DialogDescription>
      </DialogHeader>

      <div className="grid max-w-sm gap-1.5">
        <Label htmlFor="voucher-supplier">Nhà cung cấp</Label>
        <SupplierPicker id="voucher-supplier" value={supplier} onChange={setSupplier} />
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-muted/40">
            <tr className={cn(TEXT_SUB, "text-left")}>
              <th className="px-3 py-2 font-medium">Sản phẩm</th>
              <th className="w-24 px-2 py-2 text-right font-medium">Số lượng</th>
              <th className="w-36 px-3 py-2 text-right font-medium">Giá nhập</th>
            </tr>
          </thead>
          <tbody>
            {v.lines.map((l) => (
              <tr key={l.productId} className="border-t align-middle">
                <td className="px-3 py-2">
                  <div className="truncate font-medium" title={l.productName}>
                    {l.productName}
                  </div>
                  <div className={cn(TEXT_SUB, "truncate font-mono")}>
                    {l.skuCode}
                    {l.variantName ? ` · ${l.variantName}` : ""}
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.quantity)}</td>
                <td className="px-3 py-2 text-right">
                  <CurrencyInput
                    value={prices[l.productId] ?? ""}
                    onValueChange={(d) => setPrices((m) => ({ ...m, [l.productId]: d }))}
                    placeholder="—"
                    className="ml-auto h-8 w-28 text-right tabular-nums"
                    aria-label={`Giá nhập ${l.skuCode}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DialogFooter className="sm:justify-between">
        <span className={cn(TEXT_SUB, "self-center tabular-nums")}>{total > 0 ? `Giá trị nhập: ${formatNumber(total)} đ` : "Chưa dòng nào ghi giá nhập"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Lưu
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
