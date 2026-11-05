"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { BarcodeSvg } from "@/components/products/barcode-svg";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Product } from "@/lib/api";
import { barcodeShape } from "@/lib/barcode";
import { formatNumber } from "@/lib/format";
import {
  LABEL_SIZES,
  MAX_LABELS_PER_JOB,
  MIN_MODULE_MM,
  barcodeModuleMm,
  labelSizeOf,
  readSavedLabelSize,
  saveLabelJob,
  saveLabelSize,
  type LabelItem,
} from "@/lib/label-print";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * HỘP "IN MÃ VẠCH" (05/11/2026, anh Trung: nút in đặt ngay cạnh mã vạch) — chọn khổ tem + số tem
 * rồi mở trang in ở tab mới. Mở từ nút máy in cạnh mã vạch của một dòng (một mã) hoặc từ thanh
 * hàng loạt (nhiều mã). Mã chưa có mã vạch / mã có ký tự không vẽ được thì bỏ qua và nói rõ.
 */
export function PrintLabelsDialog({
  products,
  open,
  onOpenChange,
}: {
  products: Product[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const printable = useMemo(
    () => products.filter((p) => p.barcode && barcodeShape(p.barcode) !== null),
    [products]
  );
  const skipped = products.length - printable.length;
  const [sizeKey, setSizeKey] = useState(LABEL_SIZES[0].key);
  const [qty, setQty] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setSizeKey(readSavedLabelSize());
    setQty(Object.fromEntries(printable.map((p) => [p.id, "1"])));
  }, [open, printable]);

  const numOf = (id: string) => {
    const n = Number(qty[id] ?? "");
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const total = printable.reduce((s, p) => s + numOf(p.id), 0);
  const invalid = printable.some((p) => {
    const raw = (qty[p.id] ?? "").trim();
    return raw !== "" && !(Number.isInteger(Number(raw)) && Number(raw) >= 0);
  });
  const fill = (by: "one" | "stock") =>
    setQty(Object.fromEntries(printable.map((p) => [p.id, String(by === "one" ? 1 : Math.max(0, p.quantityInStock))])));

  function handlePrint() {
    if (invalid) {
      toast.error("Số tem phải là số nguyên không âm");
      return;
    }
    if (total === 0) {
      toast.error("Chưa có tem nào để in");
      return;
    }
    if (total > MAX_LABELS_PER_JOB) {
      toast.error(`Mỗi lượt in tối đa ${formatNumber(MAX_LABELS_PER_JOB)} tem — hãy chia thành nhiều lượt`);
      return;
    }
    const items: LabelItem[] = printable
      .filter((p) => numOf(p.id) > 0)
      .map((p) => ({
        skuCode: p.skuCode,
        barcode: p.barcode as string,
        productName: p.productName,
        variantName: p.variantName ?? null,
        quantity: numOf(p.id),
      }));
    if (!saveLabelJob({ sizeKey, items, createdAt: Date.now() })) {
      toast.error("Trình duyệt không cho lưu lệnh in — hãy tắt chế độ ẩn danh rồi thử lại");
      return;
    }
    saveLabelSize(sizeKey);
    window.open("/print/product-labels", "_blank");
    onOpenChange(false);
  }

  const sample = printable[0];
  // Mã khách tự nhập quá dài so với khổ tem → vạch in ra quá mảnh. Cảnh báo, vẫn cho in.
  const size = labelSizeOf(sizeKey);
  const tooThin = printable.filter((p) => {
    const shape = barcodeShape(p.barcode ?? "");
    if (!shape) return false;
    return barcodeModuleMm(shape.quietLeft + shape.modules.length + shape.quietRight, size) < MIN_MODULE_MM;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-5 text-slate-500" />
            In mã vạch
          </DialogTitle>
          <DialogDescription>
            {printable.length === 1
              ? `${printable[0].skuCode} — ${printable[0].productName}${printable[0].variantName ? ` · ${printable[0].variantName}` : ""}`
              : `${formatNumber(printable.length)} mã sản phẩm kho`}
            {skipped > 0 && ` · bỏ qua ${formatNumber(skipped)} mã chưa có mã vạch in được`}
          </DialogDescription>
        </DialogHeader>

        {printable.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Không có mã nào in được tem.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Khổ tem</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {LABEL_SIZES.map((s) => {
                  const active = s.key === sizeKey;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSizeKey(s.key)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted"
                      )}
                    >
                      <span className="block font-medium">{s.label}</span>
                      <span className={cn(TEXT_SUB, "block")}>{s.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Số tem</div>
                <div className="flex items-center gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => fill("one")}>
                    Mỗi mã 1 tem
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => fill("stock")}>
                    Theo tồn kho
                  </Button>
                </div>
              </div>
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                {printable.map((p) => (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm font-medium" title={p.skuCode}>
                        {p.skuCode}
                      </span>
                      <span className={cn(TEXT_SUB, "block truncate")} title={`${p.productName}${p.variantName ? ` · ${p.variantName}` : ""}`}>
                        <span className="font-mono">{p.barcode}</span> · tồn {formatNumber(p.quantityInStock)}
                        {p.variantName ? ` · ${p.variantName}` : ""}
                      </span>
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Số tem của ${p.skuCode}`}
                      value={qty[p.id] ?? ""}
                      onChange={(e) => setQty((cur) => ({ ...cur, [p.id]: e.target.value }))}
                      className="w-24 text-right tabular-nums"
                    />
                  </li>
                ))}
              </ul>
            </div>

            {tooThin.length > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {formatNumber(tooThin.length)} mã có mã vạch quá dài so với khổ tem này ({tooThin
                  .slice(0, 3)
                  .map((p) => p.skuCode)
                  .join(", ")}
                {tooThin.length > 3 ? "…" : ""}): vạch in ra quá mảnh, máy quét có thể không đọc được. Chọn khổ tem
                rộng hơn hoặc rút ngắn mã vạch.
              </p>
            )}

            {sample?.barcode && (
              // Ô xem trước là "tờ giấy": nền trắng + chữ tối bằng mã màu CỐ ĐỊNH (lớp màu của giao diện bị
              // lật ở chế độ tối → chữ sáng trên nền trắng, không đọc được).
              <div
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
                style={{ background: "#ffffff", color: "#475569" }}
              >
                <BarcodeSvg code={sample.barcode} style={{ width: 150, height: 34 }} />
                <span className="min-w-0 text-xs">
                  <span className="block font-mono" style={{ color: "#0f172a" }}>
                    {sample.barcode}
                  </span>
                  Tem in mã vạch này kèm tên và mã SKU. Chọn đúng khổ giấy trong hộp in của trình duyệt, tỷ lệ 100%, không lề.
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={TEXT_SUB}>
            Tổng <b className="tabular-nums text-foreground">{formatNumber(total)}</b> tem
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button onClick={handlePrint} disabled={printable.length === 0 || total === 0}>
              <Printer className="size-4" />
              In {formatNumber(total)} tem
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
