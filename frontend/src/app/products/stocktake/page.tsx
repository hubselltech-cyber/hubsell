"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ClipboardCheck, Loader2, ScanBarcode } from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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
  fetchStocktakeSheet,
  getToken,
  submitStocktake,
  type StocktakeRow,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { locationLabel } from "@/lib/stock-locations";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * KIỂM KÊ (đợt 2, 24/09/2026) — trang riêng, không popup.
 *
 * Chọn vị trí (nếu shop dùng vị trí) → bảng chỉ liệt kê MÃ ĐANG CÓ HÀNG ở đó
 * (tránh bẫy Zoho bắt điền 0 cho mọi ô) → gõ số thực đếm (Enter nhảy ô tiếp) →
 * bật "Chỉ hiện lệch" để đếm lại riêng những mã lệch → một nút Chốt. Mỗi mã lệch
 * thành một dòng ADJUST "Kiểm kê …: sổ a → đếm b" trong Nhật ký kho, sàn nhận
 * số mới. Số đang gõ dở được nhớ trong trình duyệt theo vị trí (kiểm kho lâu,
 * lỡ tải lại trang không mất công đếm).
 */

type Counts = Record<string, string>;

function draftKey(locationId: string) {
  return `hubsell_stocktake_draft_${locationId || "all"}`;
}

export default function StocktakePage() {
  const router = useRouter();
  const invalidate = useInvalidate();

  const locationsQ = useApiQuery({ queryKey: qk.stockLocations(), queryFn: fetchStockLocations });
  const locations = locationsQ.data?.items ?? [];
  const locationsEnabled = locations.length > 0;

  const [locationId, setLocationId] = useState<string | null>(null);
  const effectiveLocationId =
    locationId ?? (locationsEnabled ? (locations.find((l) => l.isDefault)?.id ?? locations[0].id) : "");

  const [rows, setRows] = useState<StocktakeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [counts, setCounts] = useState<Counts>({});
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // Tải phiếu khi đổi vị trí (đợi danh sách vị trí về trước nếu shop có vị trí).
  useEffect(() => {
    if (locationsQ.loading) return;
    let cancelled = false;
    setLoading(true);
    fetchStocktakeSheet(effectiveLocationId || undefined)
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setTruncated(r.truncated);
        // Nạp bản nháp đang đếm dở (nếu có) — chỉ giữ mã còn trong phiếu.
        let draft: Counts = {};
        try {
          draft = JSON.parse(localStorage.getItem(draftKey(effectiveLocationId)) ?? "{}");
        } catch {
          draft = {};
        }
        const ids = new Set(r.rows.map((x) => x.productId));
        setCounts(Object.fromEntries(Object.entries(draft).filter(([id]) => ids.has(id))));
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : "Không tải được phiếu"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [effectiveLocationId, locationsQ.loading]);

  // Nhớ bản nháp
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(effectiveLocationId), JSON.stringify(counts));
    } catch {
      // bị chặn — bỏ qua
    }
  }, [counts, effectiveLocationId]);

  const counted = useMemo(
    () => rows.filter((r) => counts[r.productId] !== undefined && counts[r.productId] !== ""),
    [rows, counts]
  );
  const diffs = useMemo(
    () =>
      counted
        .map((r) => ({ row: r, n: Number(counts[r.productId]) }))
        .filter((x) => Number.isInteger(x.n) && x.n >= 0 && x.n !== x.row.book),
    [counted, counts]
  );
  const invalid = counted.filter((r) => {
    const n = Number(counts[r.productId]);
    return !Number.isInteger(n) || n < 0;
  });
  const visible = onlyDiff ? diffs.map((d) => d.row) : rows;

  function setCount(id: string, v: string) {
    setCounts((c) => ({ ...c, [id]: v }));
  }

  /** Enter ở ô đếm: nhảy sang ô kế tiếp trong danh sách đang hiện. */
  function focusNext(id: string) {
    const idx = visible.findIndex((r) => r.productId === id);
    const next = visible[idx + 1];
    if (next) inputRefs.current.get(next.productId)?.focus();
    else scanRef.current?.focus();
  }

  /** Quét/gõ mã: mã có trong phiếu → nhảy tới ô và cộng 1; chưa có → thêm dòng sổ 0. */
  async function handleScan() {
    const q = query.trim();
    if (!q) return;
    const hit = rows.find((r) => r.skuCode.toUpperCase() === q.toUpperCase());
    if (hit) {
      const cur = Number(counts[hit.productId] ?? 0) || 0;
      setCount(hit.productId, String(cur + 1));
      setQuery("");
      inputRefs.current.get(hit.productId)?.focus();
      return;
    }
    setSearching(true);
    try {
      const res = await fetchProducts({ page: 1, pageSize: 5, search: q, status: "all" });
      const p =
        res.items.find((x) => x.skuCode.toUpperCase() === q.toUpperCase()) ??
        (res.items.length === 1 ? res.items[0] : undefined);
      if (!p) {
        toast.error(`Không có SKU nào khớp "${q}"`);
        return;
      }
      // Mã không nằm trong phiếu (sổ 0 ở vị trí này) → thêm dòng, đếm 1.
      setRows((cur) => [
        ...cur,
        { productId: p.id, skuCode: p.skuCode, productName: p.productName, isActive: p.isActive !== false, book: 0 },
      ]);
      setCount(p.id, "1");
      setQuery("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmit() {
    if (invalid.length || diffs.length === 0) return;
    setSubmitting(true);
    try {
      const res = await submitStocktake({
        locationId: effectiveLocationId || undefined,
        items: diffs.map((d) => ({ productId: d.row.productId, counted: d.n })),
        note: note.trim() || undefined,
      });
      toast.success(
        `Đã chốt kiểm kê: điều chỉnh ${formatNumber(res.adjusted)} mã — mỗi mã một dòng trong Nhật ký kho, sàn nhận số mới`
      );
      try {
        localStorage.removeItem(draftKey(effectiveLocationId));
      } catch {
        // bỏ qua
      }
      setCounts({});
      setNote("");
      setOnlyDiff(false);
      invalidate(["products"]);
      invalidate(["inventory-logs"]);
      invalidate(["stock-locations"]);
      // Tải lại sổ sau khi chốt
      const r = await fetchStocktakeSheet(effectiveLocationId || undefined);
      setRows(r.rows);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ", { duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  }

  const locFound = locations.find((l) => l.id === effectiveLocationId);
  const locName = locFound ? locationLabel(locFound) : undefined;

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
                {locationsEnabled
                  ? "Chọn vị trí, đếm từng mã đang có hàng ở đó, rồi chốt. Chỉ mã lệch mới ghi vào nhật ký."
                  : "Đếm từng mã rồi chốt. Chỉ mã lệch mới ghi vào nhật ký, sàn nhận số mới."}
              </p>
            </div>
            {locationsEnabled && (
              <div className="grid w-64 gap-1.5">
                <Label htmlFor="st-location">Vị trí kiểm</Label>
                <NativeSelect
                  id="st-location"
                  value={effectiveLocationId}
                  onChange={(e) => {
                    setLocationId(e.target.value);
                    setOnlyDiff(false);
                  }}
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {locationLabel(l)} · {formatNumber(l.skuCount)} SKU{l.sellable ? "" : " · không bán"}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>
        </PageHeaderBand>

        {/* ===== Ô QUÉT + CHIP LỌC ===== */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-md">
            <ScanBarcode className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={scanRef}
              className="pl-9"
              placeholder="Quét hoặc gõ mã SKU rồi Enter: cộng 1 vào ô đếm…"
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
          <div className="flex items-center gap-1.5">
            {(
              [
                { key: false, label: `Tất cả ${formatNumber(rows.length)}` },
                { key: true, label: `Chỉ hiện lệch ${formatNumber(diffs.length)}` },
              ] as { key: boolean; label: string }[]
            ).map((c) => (
              <button
                key={String(c.key)}
                type="button"
                aria-pressed={onlyDiff === c.key}
                onClick={() => setOnlyDiff(c.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  onlyDiff === c.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* ===== BẢNG ĐẾM ===== */}
        <div className="overflow-hidden rounded-lg border bg-card">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải phiếu…</p>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {onlyDiff
                ? "Chưa có mã nào lệch."
                : locName
                  ? `${locName} chưa có mã nào có hàng. Quét mã để thêm dòng nếu thực tế có hàng ở đây.`
                  : "Chưa có SKU nào để đếm."}
            </p>
          ) : (
            <div className="max-h-[calc(100dvh-20rem)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-40">Mã SKU</TableHead>
                    <TableHead>Tên sản phẩm</TableHead>
                    <TableHead className="w-24 text-right">Sổ</TableHead>
                    <TableHead className="w-32 text-right">Thực đếm</TableHead>
                    <TableHead className="w-24 text-right">Lệch</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => {
                    const raw = counts[r.productId];
                    const n = raw === undefined || raw === "" ? null : Number(raw);
                    const bad = n !== null && (!Number.isInteger(n) || n < 0);
                    const diff = n === null || bad ? null : n - r.book;
                    return (
                      <TableRow key={r.productId} className={cn(diff ? "bg-amber-50/60" : undefined)}>
                        <TableCell className="font-mono text-sm">
                          {r.skuCode}
                          {!r.isActive && <span className={cn(TEXT_SUB, "ml-1")}>(ngừng bán)</span>}
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-[28rem] truncate" title={r.productName}>
                            {r.productName}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-slate-700">
                          {formatNumber(r.book)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            ref={(el) => {
                              if (el) inputRefs.current.set(r.productId, el);
                              else inputRefs.current.delete(r.productId);
                            }}
                            type="number"
                            min={0}
                            step={1}
                            placeholder="—"
                            value={raw ?? ""}
                            onChange={(e) => setCount(r.productId, e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                focusNext(r.productId);
                              }
                            }}
                            className={cn("ml-auto h-8 w-24 text-right tabular-nums", bad && "border-rose-400")}
                            aria-label={`Thực đếm ${r.skuCode}`}
                          />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right text-sm font-semibold tabular-nums",
                            diff === null ? "text-muted-foreground" : diff === 0 ? "text-emerald-700" : "text-amber-700"
                          )}
                        >
                          {diff === null ? "—" : diff === 0 ? "khớp" : `${diff > 0 ? "+" : "−"}${formatNumber(Math.abs(diff))}`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        {truncated && (
          <p className={TEXT_SUB}>Phiếu chỉ hiện 2.000 mã đầu — kiểm theo từng vị trí để đủ.</p>
        )}

        {/* ===== GHI CHÚ + CHỐT ===== */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid w-full max-w-md gap-1.5">
            <Label htmlFor="st-note">Ghi chú (không bắt buộc)</Label>
            <Input
              id="st-note"
              placeholder="VD: kiểm cuối tháng, tổ kho A"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatNumber(counted.length)}/{formatNumber(rows.length)} mã đã đếm ·{" "}
              <span className={diffs.length ? "text-amber-700" : ""}>{formatNumber(diffs.length)} lệch</span>
              {invalid.length > 0 && <span className="ml-2 text-rose-700">· {invalid.length} ô sai số</span>}
            </span>
            <Button
              size="lg"
              disabled={submitting || diffs.length === 0 || invalid.length > 0}
              onClick={handleSubmit}
              title={diffs.length === 0 ? "Chưa có mã nào lệch so với sổ" : undefined}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
              Chốt kiểm kê ({formatNumber(diffs.length)} lệch)
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
