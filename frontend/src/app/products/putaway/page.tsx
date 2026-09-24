"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, MapPin, PackageOpen, ScanBarcode, Trash2 } from "lucide-react";

import { LocationSelect } from "@/components/products/location-select";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeaderBand } from "@/components/ui/page-tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  fetchProducts,
  fetchStockLocations,
  getToken,
  putawayStock,
  type Product,
  type StockLocation,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { locationLabel } from "@/lib/stock-locations";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * CẤT HÀNG LÊN KỆ (anh Trung 24/09) — nối "nhập xong" với "biết hàng ở đâu".
 *
 * Kho thật: lô hàng về nằm ở Kho chính, dỡ ra rồi mới cất từng mã lên kệ. Trước
 * đây phải mở từng SKU bấm Chuyển vị trí. Nay MỘT ô quét: quét TEM KỆ (mã in trên
 * tem, vd KE-A1-T1) → đổi "Cất vào"; quét SKU → thêm dòng vào kệ đang chọn (quét
 * trùng thì cộng 1); sửa số nếu cần; một nút "Cất lên kệ" chuyển hàng loạt trong
 * một transaction. Nơi lấy mặc định = vị trí mặc định (Kho chính), đổi được.
 */

interface Line {
  product: Product;
  fromId: string;
  toId: string;
  quantity: string;
}

export default function PutawayPage() {
  const router = useRouter();
  const invalidate = useInvalidate();

  const locationsQ = useApiQuery({ queryKey: qk.stockLocations(), queryFn: fetchStockLocations });
  const locations: StockLocation[] = useMemo(() => locationsQ.data?.items ?? [], [locationsQ.data]);
  const enabled = locations.length > 0;
  const defaultId = locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? "";

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const effectiveFrom = fromId ?? defaultId;
  const effectiveTo = toId ?? "";

  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const labelOf = (id: string) => {
    const l = locations.find((x) => x.id === id);
    return l ? locationLabel(l) : "—";
  };

  /** Quét: khớp mã/tên vị trí → đổi kệ đích; không thì coi là SKU. */
  async function handleScan() {
    const q = query.trim();
    if (!q) return;
    const up = q.toUpperCase();
    const loc = locations.find(
      (l) => (l.code && l.code.toUpperCase() === up) || l.name.toUpperCase() === up || locationLabel(l).toUpperCase() === up
    );
    if (loc) {
      if (loc.id === effectiveFrom) {
        toast.error(`"${locationLabel(loc)}" đang là nơi lấy — chọn kệ khác để cất vào`);
      } else {
        setToId(loc.id);
        toast.success(`Cất vào: ${locationLabel(loc)}`);
      }
      setQuery("");
      return;
    }
    if (!effectiveTo) {
      toast.error("Quét tem kệ (hoặc chọn 'Cất vào') trước rồi mới quét SKU");
      return;
    }
    setSearching(true);
    try {
      const res = await fetchProducts({ page: 1, pageSize: 5, search: q, status: "all" });
      const p =
        res.items.find((x) => x.skuCode.toUpperCase() === up) ??
        (res.items.length === 1 ? res.items[0] : undefined);
      if (!p) {
        toast.error(`Không có SKU hay mã kệ nào khớp "${q}"`);
        return;
      }
      setLines((cur) => {
        const idx = cur.findIndex((l) => l.product.id === p.id && l.fromId === effectiveFrom && l.toId === effectiveTo);
        if (idx >= 0) {
          const next = [...cur];
          next[idx] = { ...next[idx], quantity: String((Number(next[idx].quantity) || 0) + 1) };
          return next;
        }
        if (cur.length >= 200) {
          toast.error("Một phiếu tối đa 200 dòng — cất phiếu này rồi làm tiếp");
          return cur;
        }
        return [...cur, { product: p, fromId: effectiveFrom, toId: effectiveTo, quantity: "1" }];
      });
      setQuery("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSearching(false);
      scanRef.current?.focus();
    }
  }

  const availableAt = (p: Product, locId: string) =>
    p.stockLevels?.find((l) => l.locationId === locId)?.quantity ?? 0;

  // Cùng SKU cùng nguồn trên nhiều dòng → tổng không được vượt tồn ở nguồn.
  const overdrawn = useMemo(() => {
    const need = new Map<string, number>();
    for (const l of lines) {
      const k = `${l.product.id}:${l.fromId}`;
      need.set(k, (need.get(k) ?? 0) + (Number(l.quantity) || 0));
    }
    return new Set(
      lines
        .filter((l) => (need.get(`${l.product.id}:${l.fromId}`) ?? 0) > availableAt(l.product, l.fromId))
        .map((l) => l.product.id + ":" + l.fromId)
    );
  }, [lines]);
  const invalid = lines.filter((l) => {
    const n = Number(l.quantity);
    return !Number.isInteger(n) || n <= 0;
  });
  const totalQty = lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
  const canSubmit = lines.length > 0 && invalid.length === 0 && overdrawn.size === 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await putawayStock({
        lines: lines.map((l) => ({
          productId: l.product.id,
          fromLocationId: l.fromId,
          toLocationId: l.toId,
          quantity: Number(l.quantity),
        })),
        reason: reason.trim() || undefined,
      });
      toast.success(`Đã cất ${formatNumber(res.totalQuantity)} chiếc của ${formatNumber(res.moved)} dòng lên kệ`);
      setLines([]);
      setReason("");
      invalidate(["products"]);
      invalidate(["inventory-logs"]);
      invalidate(["stock-locations"]);
      scanRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ", { duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeaderBand className="pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <Link href="/products" className={cn(TEXT_SUB, "inline-flex items-center gap-1 hover:text-foreground")}>
                <ArrowLeft className="size-3.5" />
                Hàng hóa
              </Link>
              <p className="text-sm text-muted-foreground">
                Quét tem kệ để chọn nơi cất, rồi quét từng SKU. Một nút chuyển hết lên kệ, nhật ký ghi từng dòng.
              </p>
            </div>
            {enabled && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid w-52 gap-1.5">
                  <Label htmlFor="pa-from">Lấy từ</Label>
                  <LocationSelect id="pa-from" locations={locations} value={effectiveFrom} onChange={setFromId} />
                </div>
                <ArrowRight className="mb-2.5 size-4 text-muted-foreground" />
                <div className="grid w-52 gap-1.5">
                  <Label htmlFor="pa-to">Cất vào</Label>
                  <LocationSelect id="pa-to" locations={locations} value={effectiveTo} onChange={setToId} exclude={effectiveFrom} placeholder="— quét tem kệ hoặc chọn —" />
                </div>
              </div>
            )}
          </div>
        </PageHeaderBand>

        {!enabled && !locationsQ.loading ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            Shop chưa có vị trí chứa hàng nào. Vào Hàng hóa → <b>Thêm vị trí chứa hàng</b> để tạo kho / kệ trước.
          </div>
        ) : (
          <>
            {/* ===== Ô QUÉT ===== */}
            <div className="relative max-w-xl">
              <ScanBarcode className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={scanRef}
                autoFocus
                className="pl-9"
                placeholder={effectiveTo ? `Quét SKU để cất vào ${labelOf(effectiveTo)}… (quét tem kệ khác để đổi)` : "Quét tem kệ (VD: KE-A1-T1) rồi quét SKU…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleScan();
                  }
                }}
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* ===== BẢNG DÒNG ===== */}
            <div className="overflow-hidden rounded-lg border bg-card">
              {lines.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Chưa có dòng nào. Quét tem kệ → quét SKU, hoặc chọn &ldquo;Cất vào&rdquo; rồi gõ mã SKU + Enter.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-center">#</TableHead>
                      <TableHead className="w-48">Cất vào</TableHead>
                      <TableHead className="w-40">Mã SKU</TableHead>
                      <TableHead>Tên sản phẩm</TableHead>
                      <TableHead className="w-32 text-right">Còn ở nơi lấy</TableHead>
                      <TableHead className="w-28 text-right">Số lượng</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => {
                      const avail = availableAt(l.product, l.fromId);
                      const bad = overdrawn.has(l.product.id + ":" + l.fromId) || !Number.isInteger(Number(l.quantity)) || Number(l.quantity) <= 0;
                      return (
                        <TableRow key={`${l.product.id}-${l.fromId}-${l.toId}`}>
                          <TableCell className="text-center text-sm text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="text-sm">
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="size-3.5 text-muted-foreground" />
                              {labelOf(l.toId)}
                            </span>
                            {l.fromId !== effectiveFrom && (
                              <p className={TEXT_SUB}>lấy từ {labelOf(l.fromId)}</p>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{l.product.skuCode}</TableCell>
                          <TableCell>
                            <span className="block max-w-[24rem] truncate" title={l.product.productName}>
                              {l.product.productName}
                            </span>
                          </TableCell>
                          <TableCell className={cn("text-right text-sm tabular-nums", avail <= 0 ? "text-rose-700" : "text-slate-700")}>
                            {formatNumber(avail)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={l.quantity}
                              onChange={(e) =>
                                setLines((cur) => cur.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)))
                              }
                              onFocus={(e) => e.currentTarget.select()}
                              className={cn("ml-auto h-8 w-24 text-right tabular-nums", bad && "border-rose-400")}
                              aria-label={`Số lượng ${l.product.skuCode}`}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-700"
                              aria-label={`Bỏ dòng ${l.product.skuCode}`}
                              onClick={() => setLines((cur) => cur.filter((_, k) => k !== i))}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* ===== GHI CHÚ + NÚT ===== */}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="grid w-full max-w-md gap-1.5">
                <Label htmlFor="pa-reason">Ghi chú (không bắt buộc)</Label>
                <Input
                  id="pa-reason"
                  placeholder="VD: cất lô hàng xưởng về sáng 25/09"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                {lines.length > 0 && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatNumber(lines.length)} dòng · {formatNumber(totalQty)} chiếc
                    {overdrawn.size > 0 && <span className="ml-2 text-rose-700">· có dòng vượt số còn ở nơi lấy</span>}
                  </span>
                )}
                <Button size="lg" disabled={!canSubmit} onClick={handleSubmit}>
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : <PackageOpen className="size-4" />}
                  Cất lên kệ
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
