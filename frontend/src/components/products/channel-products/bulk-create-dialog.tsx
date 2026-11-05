"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, PackagePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, checkCopyListingSkus, createProductsFromMappings } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { isStandardSku, skuFromRoot, variantLabel, type ChannelGroup } from "./shared";

/**
 * "ĐƯA VÀO TỔNG KHO" THEO LÔ — BẢNG RÀ MÃ (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md mục 6.4).
 * Mỗi sản phẩm sàn một dòng: mã sàn chuẩn giữ nguyên; mã máy / trống → ô Mã gốc bắt buộc, máy sinh
 * MÃ-GỐC-ĐUÔI theo phân loại. Mã đã có trong Tổng kho → nối vào SKU đó thay vì tạo (backend tự làm).
 * Đây là chỗ áp "SKU chuẩn là việc của mình" (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 0).
 * Tạo xong là NỐI luôn (khác "Sao chép từ sàn" ở Tổng kho = hàng độc lập).
 */
export function BulkCreateDialog({
  open,
  onOpenChange,
  groups,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ChannelGroup[];
  onDone?: () => void;
}) {
  const [roots, setRoots] = useState<Record<string, string>>({});
  const [taken, setTaken] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [skipZero, setSkipZero] = useState(false);

  // Chỉ các phân loại CHƯA nối; sản phẩm không còn gì để tạo thì không hiện.
  const items = useMemo(
    () =>
      groups
        .map((g) => {
          const pending = g.rows.filter((r) => !r.productId && (!skipZero || r.channelStock !== 0));
          const needsRoot = pending.some((r) => !isStandardSku(r.channelSku));
          const rootable = Boolean(g.itemId);
          return { g, pending, needsRoot, rootable };
        })
        .filter((x) => x.pending.length > 0),
    [groups, skipZero]
  );

  useEffect(() => {
    if (open) {
      setRoots({});
      setTaken({});
    }
  }, [open]);

  /** Mã dự kiến từng dòng theo ô Mã gốc hiện tại. */
  const planned = useMemo(() => {
    const out: { key: string; rowId: string; sku: string; ok: boolean }[] = [];
    for (const it of items) {
      const root = (roots[it.g.key] ?? "").trim();
      for (const r of it.pending) {
        if (isStandardSku(r.channelSku)) out.push({ key: it.g.key, rowId: r.id, sku: r.channelSku.trim().toUpperCase(), ok: true });
        else if (root && it.rootable) out.push({ key: it.g.key, rowId: r.id, sku: skuFromRoot(root, r.variantName), ok: /^[A-Za-z0-9._-]{1,50}$/.test(skuFromRoot(root, r.variantName)) });
        else out.push({ key: it.g.key, rowId: r.id, sku: "", ok: false });
      }
    }
    return out;
  }, [items, roots]);

  // Kiểm mã đã có trong kho / gian (đợi 500 ms) — chỉ để báo "nối vào có sẵn", không chặn.
  const skuListJson = JSON.stringify([...new Set(planned.filter((p) => p.ok).map((p) => p.sku))].slice(0, 200));
  useEffect(() => {
    const skus = JSON.parse(skuListJson) as string[];
    if (!open || skus.length === 0) {
      setTaken({});
      return;
    }
    const t = setTimeout(() => {
      checkCopyListingSkus(skus)
        .then((r) => setTaken(Object.fromEntries(r.taken.filter((x) => x.kind !== "channel").map((x) => [x.sku.toUpperCase(), x.where]))))
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [open, skuListJson]);

  const missing = planned.filter((p) => !p.ok).length;
  const willReuse = planned.filter((p) => p.ok && taken[p.sku]).length;
  const willCreate = planned.filter((p) => p.ok && !taken[p.sku]).length;
  const dupInPlan = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of planned) if (p.ok) c.set(p.sku, (c.get(p.sku) ?? 0) + 1);
    return [...c.values()].filter((n) => n > 1).length;
  }, [planned]);

  async function run() {
    if (missing > 0 || planned.length === 0) return;
    setBusy(true);
    try {
      const ids = planned.map((p) => p.rowId);
      const rootSkus: Record<string, string> = {};
      for (const it of items) {
        const root = (roots[it.g.key] ?? "").trim();
        if (root && it.g.itemId) rootSkus[it.g.itemId] = root;
      }
      let created = 0;
      let reused = 0;
      let linked = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const r = await createProductsFromMappings(ids.slice(i, i + 200), { rootSkus, skipZeroStock: skipZero });
        created += r.createdProducts;
        reused += r.reusedProducts;
        linked += r.linked;
      }
      toast.success(`Đã đưa vào Tổng kho: tạo ${formatNumber(created)} SKU, nối vào có sẵn ${formatNumber(reused)} — ${formatNumber(linked)} phân loại đã nối.`);
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tạo được", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="size-4 text-primary" />
            Đưa vào Tổng kho — rà mã trước khi tạo
          </DialogTitle>
          <DialogDescription>
            Mỗi phân loại chưa nối thành một SKU kho rồi nối luôn. Mã sàn chuẩn giữ nguyên; sản phẩm sàn không có mã (Hubsell đang đặt mã máy
            SPE-/TTK-/LZD-) phải điền <b className="text-foreground">mã gốc</b>, máy ghép đuôi phân loại. Mã đã có trong Tổng kho thì nối vào SKU đó.
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <p className={TEXT_SUB}>Các sản phẩm đã chọn không còn phân loại nào chưa nối.</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-muted/40">
                  <tr className={cn(TEXT_SUB, "text-left")}>
                    <th className="w-[34%] px-3 py-2 font-medium">Sản phẩm sàn</th>
                    <th className="w-[10%] px-2 py-2 text-right font-medium">Phân loại</th>
                    <th className="w-[22%] px-3 py-2 font-medium">Mã gốc kho</th>
                    <th className="px-3 py-2 font-medium">Mã sẽ tạo</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(({ g, pending, needsRoot, rootable }) => {
                    const root = (roots[g.key] ?? "").trim();
                    const mine = planned.filter((p) => p.key === g.key);
                    const preview = mine.slice(0, 3).map((p) => p.sku || "?").join(", ") + (mine.length > 3 ? ` +${mine.length - 3}` : "");
                    const reuse = mine.filter((p) => p.ok && taken[p.sku]).length;
                    return (
                      <tr key={g.key} className="border-t align-top">
                        <td className="px-3 py-2">
                          <div className="truncate font-medium" title={g.title}>
                            {g.title}
                          </div>
                          <div className={cn(TEXT_SUB, "truncate")}>
                            {CHANNEL_META[g.channelName].label} · {g.shopName}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{pending.length}</td>
                        <td className="px-3 py-2">
                          {needsRoot ? (
                            rootable ? (
                              <Input
                                className={cn("h-8 font-mono text-xs uppercase", !root && "border-amber-400")}
                                placeholder="Vd: TUI002"
                                value={roots[g.key] ?? ""}
                                onChange={(e) => setRoots((m) => ({ ...m, [g.key]: e.target.value }))}
                              />
                            ) : (
                              <span className="text-xs text-rose-700">Sàn không cấp id sản phẩm — nối tay từng dòng</span>
                            )
                          ) : (
                            <span className={TEXT_SUB}>giữ mã sàn</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="truncate font-mono text-xs" title={mine.map((p) => p.sku || "?").join(", ")}>
                            {preview}
                          </div>
                          <div className={TEXT_SUB}>
                            {needsRoot && !root ? (
                              <span className="text-amber-700">Điền mã gốc để tạo {pending.filter((r) => !isStandardSku(r.channelSku)).length} mã</span>
                            ) : reuse > 0 ? (
                              <>
                                tạo {mine.length - reuse}, nối vào có sẵn {reuse}
                              </>
                            ) : (
                              <>tạo {mine.length} SKU, nối {mine.length}</>
                            )}
                          </div>
                          {pending.length <= 3 && (
                            <div className={cn(TEXT_SUB, "truncate")}>{pending.map((r) => variantLabel(r)).join(" · ")}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={skipZero} onChange={(e) => setSkipZero(e.target.checked)} />
              Bỏ phân loại sàn đang báo tồn 0 (không còn bán thì khỏi vào kho)
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className={cn(TEXT_SUB, "tabular-nums")}>
                {missing > 0
                  ? `Còn ${missing} phân loại chưa có mã — điền mã gốc`
                  : `Sẽ tạo ${formatNumber(willCreate)} SKU mới, nối vào có sẵn ${formatNumber(willReuse)}${dupInPlan ? ` · ${dupInPlan} mã trùng nhau trong lô (gộp về một SKU)` : ""}`}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                  Hủy
                </Button>
                <Button disabled={busy || missing > 0 || planned.length === 0} onClick={() => void run()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
                  Tạo {formatNumber(planned.length)} SKU & nối
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
