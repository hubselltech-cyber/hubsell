"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiError, setStockLevel, type Product, type StockLocation } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { locationLabel, locationTree } from "@/lib/stock-locations";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Ô "ĐANG Ở" (đợt B): mỗi vị trí MỘT DÒNG "Kho 2 › Kệ A1   15" ngay trên bảng
 * (tối đa 3 + "+n vị trí khác"), bấm mở chi tiết mọi vị trí theo cây — sửa số tại
 * vị trí và nút Chuyển. Ô "không bán" in nghiêng, không tính vào tồn bán.
 * Cột chỉ hiện khi shop đã tạo vị trí (ẩn bằng sự vắng mặt).
 */
export function StockLevelsCell({
  product,
  locations,
  editable,
  onTransfer,
  onSaved,
}: {
  product: Product;
  locations: StockLocation[];
  editable: boolean;
  onTransfer: (fromId?: string) => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const qtyById = new Map((product.stockLevels ?? []).map((l) => [l.locationId, l.quantity]));
  // Tóm tắt: các vị trí có hàng theo thứ tự ưu tiên, MỖI VỊ TRÍ MỘT DÒNG (anh
  // Trung 24/09 xem prod: "mỗi kho 1 dòng vì sau này còn có vị trí kệ, tầng
  // bên cạnh nữa"), tối đa 3 dòng + "+n khác".
  const stocked = locations.filter((l) => (qtyById.get(l.id) ?? 0) !== 0);
  const summary = stocked.slice(0, 3);
  const more = stocked.length - summary.length;

  async function save(locationId: string) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Số lượng phải là số nguyên không âm");
      return;
    }
    setSaving(true);
    try {
      const r = await setStockLevel({ productId: product.id, locationId, quantity: n });
      const name = locations.find((l) => l.id === locationId)?.name ?? "vị trí";
      if (r.delta === 0) toast.info("Số không đổi");
      else toast.success(`${name}: ${formatNumber(r.previous)} → ${formatNumber(n)} · tổng ${formatNumber(r.quantityInStock)}`);
      setEditingId(null);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="w-[11rem] max-w-[14rem] rounded text-left text-xs leading-5 hover:bg-muted"
            title="Bấm xem tồn theo từng vị trí"
          />
        }
      >
        {stocked.length === 0 ? (
          <span className={TEXT_SUB}>chưa có ở đâu</span>
        ) : (
          <span className="flex flex-col tabular-nums">
            {summary.map((l) => (
              <span key={l.id} className="flex items-baseline justify-between gap-3">
                <span
                  className={cn("truncate text-muted-foreground", !l.sellable && "italic")}
                  title={l.sellable ? locationLabel(l) : `${locationLabel(l)} — không tính vào tồn bán`}
                >
                  {locationLabel(l)}
                </span>
                <span className={cn("font-medium", (qtyById.get(l.id) ?? 0) < 0 && "text-rose-700")}>
                  {formatNumber(qtyById.get(l.id) ?? 0)}
                </span>
              </span>
            ))}
            {more > 0 && <span className="text-muted-foreground">+{more} vị trí khác</span>}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className={cn(TEXT_SUB, "px-1 pb-1")}>
          Đang ở · tồn bán <b className="text-foreground">{formatNumber(product.quantityInStock)}</b>
          {locations.some((l) => !l.sellable && (qtyById.get(l.id) ?? 0) !== 0) && (
            <>
              {" "}
              · chờ kiểm{" "}
              <b className="text-foreground">
                {formatNumber(
                  locations
                    .filter((l) => !l.sellable)
                    .reduce((s, l) => s + (qtyById.get(l.id) ?? 0), 0)
                )}
              </b>
            </>
          )}
        </p>
        <div className="divide-y">
          {locationTree(locations).map(({ loc: l, depth }) => {
            const q = qtyById.get(l.id) ?? 0;
            const editing = editingId === l.id;
            return (
              <div key={l.id} className="flex items-center gap-2 px-1 py-1.5 text-sm">
                <span
                  className={cn("min-w-0 flex-1 truncate", !l.sellable && "text-slate-500")}
                  style={{ paddingLeft: depth * 12 }}
                  title={locationLabel(l)}
                >
                  {depth > 0 && <span className="text-muted-foreground">› </span>}
                  {l.name}
                  {l.isDefault && <span className={cn(TEXT_SUB, "ml-1")}>(mặc định)</span>}
                  {!l.sellable && (
                    <span className={cn(TEXT_SUB, "ml-1")} title="Không tính vào tồn bán">
                      (không bán)
                    </span>
                  )}
                </span>
                {editing ? (
                  <>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      autoFocus
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void save(l.id);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-7 w-20 text-right tabular-nums"
                      aria-label={`Số tại ${l.name}`}
                    />
                    <Button size="sm" className="h-7 px-2" disabled={saving} onClick={() => save(l.id)}>
                      {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Lưu"}
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!editable}
                    title={editable ? "Bấm để sửa số tại vị trí này" : undefined}
                    onClick={() => {
                      setEditingId(l.id);
                      setValue(String(q));
                    }}
                    className={cn(
                      "group inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold tabular-nums",
                      editable && "hover:bg-muted",
                      q < 0 && "text-rose-700"
                    )}
                  >
                    {formatNumber(q)}
                    {editable && (
                      <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {editable && locations.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              setOpen(false);
              onTransfer(stocked[0]?.id);
            }}
          >
            <ArrowLeftRight className="size-3.5" />
            Chuyển vị trí
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
