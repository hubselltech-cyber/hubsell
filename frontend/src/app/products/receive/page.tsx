"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Loader2,
  ScanBarcode,
  Trash2,
} from "lucide-react";

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
  adjustInventoryBulk,
  ApiError,
  fetchProducts,
  fetchStockLocations,
  getToken,
  type Product,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { readLastLocation, rememberLocation } from "@/lib/stock-location-pref";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * PHIẾU NHẬP / XUẤT NHIỀU MÃ (24/09/2026) — trang riêng, không popup (khẩu vị
 * anh Trung: màn làm việc chính cần chỗ cho bảng + thao tác hàng loạt).
 *
 * Luồng một ô: gõ hoặc QUÉT mã → Enter → dòng tự thêm (quét trùng thì cộng
 * dồn) → sửa số lượng nếu cần → một lý do chung → MỘT nút. Cộng thêm / trừ
 * bớt trên tồn hiện có, không đè tổng như Excel. Tối đa 200 mã một phiếu.
 */

type SheetType = "IMPORT" | "EXPORT";

interface Line {
  product: Product;
  quantity: string;
}

const MAX_LINES = 200;

export default function ReceiveStockPage() {
  const router = useRouter();
  const invalidate = useInvalidate();

  const [type, setType] = useState<SheetType>("IMPORT");
  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Vị trí chứa hàng (đợt B): có thì hiện ô chọn, nhớ lần chọn cuối.
  const locationsQ = useApiQuery({
    queryKey: qk.stockLocations(),
    queryFn: fetchStockLocations,
  });
  const locations = locationsQ.data?.items ?? [];
  const [locationId, setLocationId] = useState<string | null>(null);
  const effectiveLocationId =
    locationId ?? (locations.length ? readLastLocation(locations) : "");

  // Ô tìm / quét mã + gợi ý
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // Gợi ý theo mã / tên, chờ 200ms sau lượt gõ cuối; máy quét gõ rất nhanh rồi
  // Enter nên thường không kịp hiện gợi ý — Enter tự tra đúng mã.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetchProducts({ page: 1, pageSize: 8, search: q });
        if (my === seq.current) {
          setSuggestions(res.items);
          setHighlight(0);
        }
      } catch {
        if (my === seq.current) setSuggestions([]);
      } finally {
        if (my === seq.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  function addProduct(p: Product, qty = 1) {
    setLines((cur) => {
      const idx = cur.findIndex((l) => l.product.id === p.id);
      if (idx >= 0) {
        const next = [...cur];
        const old = Number(next[idx].quantity) || 0;
        next[idx] = { ...next[idx], quantity: String(old + qty) };
        return next;
      }
      if (cur.length >= MAX_LINES) {
        toast.error(`Một phiếu tối đa ${MAX_LINES} mã — lập phiếu mới cho phần còn lại`);
        return cur;
      }
      return [...cur, { product: p, quantity: String(qty) }];
    });
    setQuery("");
    setSuggestions([]);
    searchRef.current?.focus();
  }

  /** Enter ở ô mã: đúng mã → thêm ngay; chưa rõ → tra máy chủ đúng mã đó. */
  async function handleEnter() {
    const q = query.trim();
    if (!q) return;
    const exact = suggestions.find((p) => p.skuCode.toUpperCase() === q.toUpperCase());
    if (exact) {
      addProduct(exact);
      return;
    }
    if (suggestions.length > 0 && suggestions[highlight]) {
      addProduct(suggestions[highlight]);
      return;
    }
    // Máy quét gõ xong Enter trước khi gợi ý về — tra thẳng.
    seq.current++;
    setSearching(true);
    try {
      const res = await fetchProducts({ page: 1, pageSize: 8, search: q });
      const hit =
        res.items.find((p) => p.skuCode.toUpperCase() === q.toUpperCase()) ??
        (res.items.length === 1 ? res.items[0] : undefined);
      if (hit) addProduct(hit);
      else if (res.items.length === 0) toast.error(`Không có SKU nào khớp "${q}" trong kho`);
      else setSuggestions(res.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSearching(false);
    }
  }

  function setQty(id: string, value: string) {
    setLines((cur) => cur.map((l) => (l.product.id === id ? { ...l, quantity: value } : l)));
  }
  function removeLine(id: string) {
    setLines((cur) => cur.filter((l) => l.product.id !== id));
  }

  const isImport = type === "IMPORT";
  const totalQty = lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
  const invalid = lines.filter((l) => {
    const n = Number(l.quantity);
    return !Number.isInteger(n) || n <= 0;
  });
  const insufficient = isImport
    ? []
    : lines.filter((l) => (Number(l.quantity) || 0) > l.product.quantityInStock);
  const canSubmit =
    lines.length > 0 && invalid.length === 0 && insufficient.length === 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await adjustInventoryBulk({
        type,
        items: lines.map((l) => ({ productId: l.product.id, quantity: Number(l.quantity) })),
        reason: reason.trim() || undefined,
        locationId: effectiveLocationId || undefined,
      });
      if (effectiveLocationId) rememberLocation(effectiveLocationId);
      toast.success(
        `${isImport ? "Đã nhập" : "Đã xuất"} ${formatNumber(res.totalQuantity)} chiếc của ${formatNumber(res.count)} mã — Có thể bán mới đang đẩy lên các gian đã nối`
      );
      setLines([]);
      setReason("");
      invalidate(["products"]);
      invalidate(["inventory-logs"]);
      searchRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ", {
        duration: 8000,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const typeChip = (key: SheetType, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={type === key}
      onClick={() => setType(key)}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
        type === key
          ? key === "IMPORT"
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-rose-600 bg-rose-600 text-white"
          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeaderBand className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Link
                href="/products"
                className={cn(TEXT_SUB, "inline-flex items-center gap-1 hover:text-foreground")}
              >
                <ArrowLeft className="size-3.5" />
                Hàng hóa
              </Link>
              <p className="text-sm text-muted-foreground">
                Gõ hoặc quét mã SKU, mỗi mã một dòng, một lý do chung, một nút. Số cộng
                thêm / trừ bớt vào tồn hiện có.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {typeChip("IMPORT", "Nhập hàng", <ArrowDownToLine className="size-4" />)}
              {typeChip("EXPORT", "Xuất hàng", <ArrowUpFromLine className="size-4" />)}
            </div>
          </div>
        </PageHeaderBand>

        {/* ===== Ô MÃ + GỢI Ý ===== */}
        <div className="relative max-w-xl">
          <ScanBarcode className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            autoFocus
            className="pl-9"
            placeholder="Gõ hoặc quét mã SKU rồi Enter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleEnter();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === "Escape") {
                setSuggestions([]);
              }
            }}
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
          {suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
              {suggestions.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addProduct(p)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted",
                      i === highlight && "bg-muted"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="font-mono">{p.skuCode}</span>
                      <span className={cn(TEXT_SUB, "ml-2 truncate")}>{p.productName}</span>
                    </span>
                    <span className={cn(TEXT_SUB, "shrink-0 tabular-nums")}>
                      tồn {formatNumber(p.quantityInStock)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ===== BẢNG DÒNG PHIẾU ===== */}
        <div className="overflow-hidden rounded-lg border bg-card">
          {lines.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Chưa có dòng nào. Gõ hoặc quét mã SKU phía trên — quét cùng một mã nhiều
              lần thì số lượng tự cộng dồn.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead className="w-40">Mã SKU</TableHead>
                  <TableHead>Tên sản phẩm</TableHead>
                  <TableHead className="w-28 text-right">Tồn hiện tại</TableHead>
                  <TableHead className="w-32 text-right">
                    {isImport ? "Nhập thêm" : "Xuất ra"}
                  </TableHead>
                  <TableHead className="w-28 text-right">Tồn sau</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => {
                  const n = Number(l.quantity) || 0;
                  const after = isImport
                    ? l.product.quantityInStock + n
                    : l.product.quantityInStock - n;
                  const bad =
                    !Number.isInteger(Number(l.quantity)) ||
                    n <= 0 ||
                    (!isImport && n > l.product.quantityInStock);
                  return (
                    <TableRow key={l.product.id}>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {i + 1}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{l.product.skuCode}</TableCell>
                      <TableCell>
                        <span className="block max-w-[26rem] truncate" title={l.product.productName}>
                          {l.product.productName}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-slate-700">
                        {formatNumber(l.product.quantityInStock)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={l.quantity}
                          onChange={(e) => setQty(l.product.id, e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          className={cn(
                            "ml-auto h-8 w-24 text-right tabular-nums",
                            bad && "border-rose-400 focus-visible:ring-rose-300"
                          )}
                          aria-label={`Số lượng ${l.product.skuCode}`}
                        />
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-sm font-semibold tabular-nums",
                          after < 0 ? "text-rose-700" : "text-foreground"
                        )}
                      >
                        {formatNumber(after)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-700"
                          aria-label={`Bỏ dòng ${l.product.skuCode}`}
                          onClick={() => removeLine(l.product.id)}
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

        {/* ===== VỊ TRÍ + LÝ DO + NÚT ===== */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          {locations.length > 0 && (
            <div className="grid w-56 gap-1.5">
              <Label htmlFor="bulk-location">{isImport ? "Nhập vào" : "Xuất từ"}</Label>
              <LocationSelect
                id="bulk-location"
                locations={locations}
                value={effectiveLocationId}
                onChange={setLocationId}
                placeholder={isImport ? undefined : "Tự trừ theo thứ tự ưu tiên"}
              />
            </div>
          )}
          <div className="grid w-full max-w-md gap-1.5">
            <Label htmlFor="bulk-reason">Lý do (không bắt buộc)</Label>
            <Input
              id="bulk-reason"
              placeholder={
                isImport ? "VD: Nhập lô hàng xưởng ngày 24/09" : "VD: Xuất bán sỉ cho đại lý A"
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            {lines.length > 0 && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatNumber(lines.length)} mã · {formatNumber(totalQty)} chiếc
                {insufficient.length > 0 && (
                  <span className="ml-2 text-rose-700">
                    · {insufficient.length} mã không đủ hàng
                  </span>
                )}
              </span>
            )}
            <Button
              size="lg"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className={cn(isImport ? "bg-emerald-600 hover:bg-emerald-600/90" : "bg-rose-600 hover:bg-rose-600/90")}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isImport ? (
                <ArrowDownToLine className="size-4" />
              ) : (
                <ArrowUpFromLine className="size-4" />
              )}
              {isImport ? "Nhập kho" : "Xuất kho"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
