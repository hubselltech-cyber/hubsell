"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { ApiError, setInventoryQuantity, type Product } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface InlineStockEditorProps {
  product: Product;
  /** SKU đang ở/dưới ngưỡng cảnh báo → tô vàng. */
  low: boolean;
  /** Ngưỡng cảnh báo đang áp (0 = không đặt) — cho tooltip. */
  threshold: number;
  /** Người dùng có quyền sửa tồn không (nhân viên chỉ xem thì false). */
  editable: boolean;
  onSaved: () => void;
}

/**
 * Ô TỒN KHO SỬA TRỰC TIẾP (anh Trung 05/09: "phải sửa số lượng được trực tiếp
 * mới thực sự là trải nghiệm tốt"). Bấm vào số → ô nhập, gõ số mới, Enter lưu,
 * Esc hủy, bấm ra ngoài cũng hủy (tránh lưu nhầm). Server tự tính chênh lệch,
 * ghi sổ kho như nhập/xuất tay, rồi đẩy Có thể bán mới lên các gian đã nối.
 */
export function InlineStockEditor({
  product,
  low,
  threshold,
  editable,
  onSaved,
}: InlineStockEditorProps) {
  const qty = product.quantityInStock;
  const held = product.holdQuantity ?? 0;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(qty));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setValue(String(qty));
      // Focus + bôi đen sẵn để gõ đè số mới ngay.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, qty]);

  async function save() {
    const n = Number(value.trim());
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Tồn kho phải là số nguyên không âm");
      inputRef.current?.focus();
      return;
    }
    if (n === qty) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const r = await setInventoryQuantity(product.id, n);
      toast.success(
        `${product.skuCode}: ${formatNumber(qty)} → ${formatNumber(n)} (${r.delta > 0 ? "nhập" : "xuất"} ${formatNumber(Math.abs(r.delta))}) — đang đẩy lên các gian đã nối.`
      );
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được tồn kho");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (!saving) setEditing(false);
          }}
          aria-label={`Tồn kho mới của ${product.skuCode}`}
          className="h-8 w-20 rounded-md border border-primary bg-background px-2 text-center text-sm font-semibold tabular-nums outline-none ring-2 ring-primary/30"
        />
        <span className="text-[11px] text-muted-foreground">
          {saving ? (
            <Loader2 className="inline size-3 animate-spin" />
          ) : (
            "Enter lưu · Esc hủy"
          )}
        </span>
      </div>
    );
  }

  const tone =
    qty - held <= 0
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : low
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <div className="text-center">
      <button
        type="button"
        disabled={!editable}
        onClick={() => editable && setEditing(true)}
        title={
          (editable ? "Bấm để sửa tồn trực tiếp" : "Tồn kho") +
          (threshold > 0 ? ` · ngưỡng cảnh báo ${formatNumber(threshold)}` : "")
        }
        className={cn(
          "group inline-flex min-w-12 items-center justify-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold tabular-nums transition-colors",
          tone,
          editable && "cursor-text hover:ring-2 hover:ring-primary/30"
        )}
      >
        {formatNumber(qty)}
        {editable && (
          <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />
        )}
      </button>
      {held > 0 && (
        <p className="mt-1 text-xs text-amber-600">Giữ {formatNumber(held)}</p>
      )}
      {low && qty - held > 0 && (
        <p className="mt-0.5 text-xs font-medium text-amber-700">
          ≤ ngưỡng {formatNumber(threshold)}
        </p>
      )}
    </div>
  );
}
