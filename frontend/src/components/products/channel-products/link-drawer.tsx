"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Link2, Loader2, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  fetchProducts,
  linkMappingPairs,
  unlinkChannelProducts,
  type ChannelProduct,
  type Product,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import {
  groupWarehouseProducts,
  isStandardSku,
  suggestVariantMapping,
  variantLabel,
  type ChannelGroup,
  type WarehouseGroup,
} from "./shared";

/**
 * NGĂN KÉO "NỐI SẢN PHẨM" (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md mục 6.2).
 *
 * Trái = các phân loại của MỘT sản phẩm sàn; phải = chọn MỘT sản phẩm kho (tìm theo tên / mã,
 * gợi ý sẵn theo mã trùng) → máy ghép từng phân loại theo mã rồi theo tên; khách chỉ sửa chỗ lệch
 * bằng dropdown (chỉ liệt kê phân loại của sản phẩm kho đã chọn). Một nút Xác nhận.
 *
 * CHỈ NỐI, KHÔNG TẠO SKU KHO (anh Trung 05/11: "việc kiểm soát sản phẩm kho hoàn toàn nằm ở bên
 * Tổng kho") — ô "Tạo SKU" đã gỡ. Phân loại chưa có SKU kho tương ứng thì để "chưa ghép" + dòng chỉ
 * sang Tổng kho; đừng thêm lại đường tạo ở đây.
 *
 * Chiều ngược (Tổng kho › Nối gian): mở với `target` = SKU kho cố định; sản phẩm kho đã chọn sẵn.
 * Nối trên đơn hàng: `group` dựng từ /mappings/lookup, `source="order"`.
 */
type RowChoice = { kind: "keep" } | { kind: "product"; productId: string } | { kind: "none" };

export function LinkDrawer({
  open,
  onOpenChange,
  group,
  target,
  source = "manual",
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ChannelGroup | null;
  /** SKU kho đích cố định (chiều ngược từ Tổng kho). */
  target?: Product | null;
  source?: "manual" | "order";
  onDone?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<WarehouseGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<WarehouseGroup | null>(null);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [busy, setBusy] = useState(false);

  // Phân loại CHƯA nối lên đầu (ca "Nối nốt" 50/51: việc cần làm phải thấy ngay, không phải cuộn tìm).
  const rows = useMemo(
    () => [...(group?.rows ?? [])].sort((a, b) => Number(Boolean(a.productId)) - Number(Boolean(b.productId))),
    [group]
  );

  // Mở lần nào dựng lại lần đó: từ khóa mồi = mã sàn chuẩn đầu tiên, không có thì 4 chữ đầu tên.
  useEffect(() => {
    if (!open || !group) return;
    const firstStd = rows.find((r) => !r.productId && isStandardSku(r.channelSku))?.channelSku;
    const seed = firstStd ?? group.title.trim().split(/\s+/).slice(0, 4).join(" ");
    setQuery(seed);
    setDebounced(seed);
    setChoices({});
    if (target) {
      setPicked({ key: target.groupKey ?? target.id, title: target.productName, imageUrl: target.imageUrl ?? null, variants: [target], rootGuess: target.skuCode });
    } else {
      setPicked(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.key]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open || !debounced) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    fetchProducts({ search: debounced, page: 1, pageSize: 60, view: "grouped" })
      .then((res) => {
        if (cancelled) return;
        const groups = groupWarehouseProducts(res.items);
        setResults(groups.slice(0, 8));
        // Chưa chọn gì mà có đúng MỘT nhóm trùng mã với dòng sàn → chọn luôn (gợi ý chắc).
        if (!picked && !target) {
          const skus = new Set(rows.map((r) => r.channelSku.trim().toUpperCase()));
          const hits = groups.filter((g) => g.variants.some((v) => skus.has(v.skuCode.toUpperCase())));
          if (hits.length === 1) setPicked(hits[0]);
        }
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debounced]);

  // Đổi sản phẩm kho đã chọn → gợi ý lại toàn bộ ghép.
  useEffect(() => {
    if (!picked) {
      setChoices({});
      return;
    }
    const sug = suggestVariantMapping(
      rows.filter((r) => !r.productId),
      picked.variants
    );
    const next: Record<string, RowChoice> = {};
    for (const r of rows) {
      if (r.productId && !target) next[r.id] = { kind: "keep" };
      else if (sug.has(r.id)) next[r.id] = { kind: "product", productId: sug.get(r.id)! };
      else if (target) next[r.id] = r.productId === target.id ? { kind: "keep" } : { kind: "product", productId: target.id };
      else next[r.id] = { kind: "none" };
    }
    setChoices(next);
  }, [picked, rows, target]);

  const pendingPairs = rows.filter((r) => choices[r.id]?.kind === "product").map((r) => ({ channelProductId: r.id, productId: (choices[r.id] as { productId: string }).productId }));
  const pendingCount = pendingPairs.length;
  const unresolved = rows.filter((r) => choices[r.id]?.kind === "none").length;

  // Cùng một SKU kho gán cho ≥2 dòng → cảnh báo (vẫn cho nối: 2 phân loại sàn cùng về một mã là ca có thật).
  const dupTargets = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of pendingPairs) count.set(p.productId, (count.get(p.productId) ?? 0) + 1);
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [pendingPairs]);

  function setRow(id: string, c: RowChoice) {
    setChoices((m) => ({ ...m, [id]: c }));
  }

  async function confirm() {
    if (!group || pendingCount === 0) return;
    setBusy(true);
    try {
      await linkMappingPairs(pendingPairs, source);
      toast.success(`Đã nối ${formatNumber(pendingCount)} phân loại — ${group.title}`);
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không nối được", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  async function unlinkOne(r: ChannelProduct) {
    setBusy(true);
    try {
      await unlinkChannelProducts([r.id]);
      toast.success(`Đã gỡ nối ${variantLabel(r)}`);
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gỡ được");
    } finally {
      setBusy(false);
    }
  }

  if (!group) return null;
  const meta = CHANNEL_META[group.channelName];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-8">
            <Link2 className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="line-clamp-2" title={group.title}>
              Nối kho: {group.title}
            </span>
          </DialogTitle>
          <DialogDescription>
            {meta.label} · {group.shopName} · {formatNumber(group.total)} phân loại
            {target ? (
              <>
                {" "}
                → SKU kho <b className="font-mono text-foreground">{target.skuCode}</b>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {/* ===== Chọn sản phẩm kho ===== */}
        {!target && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Tìm sản phẩm kho theo tên hoặc mã SKU…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </div>
            {picked ? (
              <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <Check className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{picked.title}</span>
                  <span className={cn(TEXT_SUB, "block truncate font-mono")}>
                    {picked.variants.length === 1 ? picked.variants[0].skuCode : `${picked.rootGuess || picked.variants[0].skuCode}… · ${picked.variants.length} phân loại`}
                  </span>
                </span>
                <Button size="xs" variant="ghost" onClick={() => setPicked(null)}>
                  Chọn khác
                </Button>
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                {searching && results.length === 0 ? (
                  <p className={cn(TEXT_SUB, "px-3 py-3")}>Đang tìm…</p>
                ) : results.length === 0 ? (
                  <p className={cn(TEXT_SUB, "px-3 py-3")}>
                    {debounced ? (
                      <>
                        Không có sản phẩm kho nào khớp. Đổi từ khóa, hoặc tạo sản phẩm này ở{" "}
                        <Link href="/products" target="_blank" className="font-medium text-primary hover:underline">
                          Tổng kho
                        </Link>{" "}
                        trước rồi quay lại nối.
                      </>
                    ) : (
                      "Gõ tên hoặc mã để tìm."
                    )}
                  </p>
                ) : (
                  results.map((g) => {
                    const skuHit = g.variants.some((v) => rows.some((r) => r.channelSku.trim().toUpperCase() === v.skuCode.toUpperCase()));
                    return (
                      <button
                        key={g.key}
                        type="button"
                        className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                        onClick={() => setPicked(g)}
                      >
                        <Thumb src={g.imageUrl} alt={g.title} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{g.title}</span>
                          <span className={cn(TEXT_SUB, "block truncate font-mono")}>
                            {g.variants.length === 1 ? g.variants[0].skuCode : `${g.rootGuess || g.variants[0].skuCode}… · ${g.variants.length} phân loại`}
                          </span>
                        </span>
                        {skuHit && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                            <Sparkles className="size-3" /> trùng mã
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== Bảng ghép phân loại ===== */}
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted/40">
              <tr className={cn(TEXT_SUB, "text-left")}>
                <th className="w-[34%] px-3 py-2 font-medium">Phân loại sàn</th>
                <th className="w-[12%] px-2 py-2 text-right font-medium">Tồn sàn</th>
                <th className="px-3 py-2 font-medium">SKU kho</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = choices[r.id] ?? { kind: "none" as const };
                const std = isStandardSku(r.channelSku);
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="truncate font-medium" title={variantLabel(r)}>
                        {variantLabel(r)}
                      </div>
                      <div className={cn(TEXT_SUB, "truncate font-mono")} title={r.channelSku}>
                        {r.channelSku}
                        {!std && <span className="ml-1 text-amber-700"> · mã máy</span>}
                        {r.status === "DELISTED" && <span className="ml-1 text-rose-700"> · sàn đã gỡ</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.channelStock ?? "—"}</td>
                    <td className="px-3 py-2">
                      {c.kind === "keep" && r.product ? (
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-mono text-emerald-700">{r.product.skuCode}</span>
                            <span className={cn(TEXT_SUB, "ml-1")}>đã nối</span>
                          </span>
                          {picked && !target && (
                            <Button size="xs" variant="ghost" onClick={() => setRow(r.id, { kind: "none" })}>
                              Đổi
                            </Button>
                          )}
                          <Button size="xs" variant="ghost" className="text-rose-700" disabled={busy} onClick={() => void unlinkOne(r)}>
                            Gỡ
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <NativeSelect
                            className={cn("h-8 min-w-0 flex-1 text-xs", c.kind === "none" && "border-amber-400")}
                            value={c.kind === "product" ? c.productId : ""}
                            disabled={!picked}
                            onChange={(e) => (e.target.value ? setRow(r.id, { kind: "product", productId: e.target.value }) : setRow(r.id, { kind: "none" }))}
                          >
                            <option value="">{picked ? "— chọn SKU kho —" : "Chọn sản phẩm kho ở trên trước"}</option>
                            {picked?.variants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.skuCode}
                                {v.variantName ? ` · ${v.variantName}` : ""}
                                {dupTargets.has(v.id) && c.kind === "product" && c.productId === v.id ? " (trùng dòng khác)" : ""}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unresolved > 0 && (
          <p className={TEXT_SUB}>
            Phân loại chưa có SKU kho tương ứng thì tạo ở{" "}
            <Link href="/products" target="_blank" className="font-medium text-primary hover:underline">
              Tổng kho
            </Link>{" "}
            trước rồi quay lại nối. Trang này chỉ nối, không tạo sản phẩm kho.
          </p>
        )}
        {dupTargets.size > 0 && (
          <p className="text-xs text-amber-700">Có {dupTargets.size} SKU kho được gán cho nhiều phân loại — vẫn nối được nếu đúng là cùng một mã hàng.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className={cn(TEXT_SUB, "tabular-nums")}>
            {pendingCount > 0 ? `${pendingCount} phân loại sẽ nối` : "Chưa có phân loại nào được ghép"}
            {unresolved > 0 && ` · ${unresolved} chưa ghép (có thể nối sau)`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Đóng
            </Button>
            <Button disabled={pendingCount === 0 || busy} onClick={() => void confirm()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              Nối {pendingCount > 0 ? formatNumber(pendingCount) : ""} phân loại
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="size-9 shrink-0 rounded-md border object-cover" />
  ) : (
    <div className="size-9 shrink-0 rounded-md border border-dashed bg-muted/40" />
  );
}
