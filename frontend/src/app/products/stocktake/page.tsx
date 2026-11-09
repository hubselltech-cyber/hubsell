"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardCheck, Loader2, ScanBarcode } from "lucide-react";

import { LocationSelect } from "@/components/products/location-select";
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
  fetchStocktakeRows,
  fetchStocktakeSheet,
  getToken,
  submitStocktake,
  type StocktakeRow,
} from "@/lib/api";
import { productMatchesCode } from "@/lib/product-code";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { locationLabel } from "@/lib/stock-locations";
import {
  SCAN_CODE_RE,
  STOCKTAKE_PAGE_SIZE_DEFAULT,
  STOCKTAKE_PAGE_SIZES,
  STOCKTAKE_SUBMIT_CHUNK,
  clearStocktakeDraft,
  isCounted,
  readStocktakeDraft,
  readStocktakePageSize,
  stocktakeDraftId,
  validCount,
  writeStocktakeDraft,
  writeStocktakePageSize,
  type StocktakeCounts,
} from "@/lib/stocktake";
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
 *
 * QUÉT LIÊN TỤC (09/11/2026, khách thử máy quét thật): con trỏ LUÔN ở lại ô quét.
 * Bản đầu nhảy con trỏ sang ô "Thực đếm" sau mỗi lần quét → lần quét kế gõ nguyên
 * 13 số mã vạch vào ô đếm (thành số tồn nghìn tỷ) rồi Enter đẩy xuống dòng dưới.
 * Ba lớp chặn: (1) quét xong không chuyển con trỏ, chỉ cuộn + tô dòng vừa quét;
 * (2) con trỏ đang ở nút bấm / chỗ trống mà có phím gõ → tự về ô quét;
 * (3) con trỏ đang ở ô đếm mà Enter một dãy ≥ 8 chữ số → coi là mã quét, trả ô đếm
 * về số cũ rồi cộng 1 cho đúng mã.
 */

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
  const [counts, setCounts] = useState<StocktakeCounts>({});
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Ô quét KHÔNG giữ chữ đang gõ trong state: máy quét bắn 13 phím liền nhau, mỗi phím mà vẽ lại
  // cả bảng thì phiếu vài nghìn mã bị trễ thấy rõ. Đọc / xóa thẳng trên ô nhập qua `scanRef`.
  const [pending, setPending] = useState(0);
  const searching = pending > 0;
  /** Dòng vừa quét — `tick` đổi mỗi lần quét để cuộn lại cả khi quét trùng mã. */
  const [lastScan, setLastScan] = useState<{ id: string; tick: number } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const tableBoxRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  /** Số trong ô đếm lúc con trỏ vào — để trả lại khi máy quét bắn nhầm vào ô đó. */
  const focusValue = useRef<{ id: string; value: string; typed: boolean } | null>(null);
  /** Khóa bản nháp đã nạp xong — chưa nạp thì chưa được ghi đè (xem "Nhớ bản nháp"). */
  const hydratedKey = useRef<string | null>(null);
  /** Mã do máy chủ trả trong phiếu — dòng nào ngoài tập này là dòng thêm bằng quét. */
  const sheetIds = useRef<Set<string>>(new Set());
  /** Tăng để tải lại phiếu tại chỗ (sau khi chốt / chốt dở / có mã đã bị xóa khỏi kho). */
  const [reloadTick, setReloadTick] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(STOCKTAKE_PAGE_SIZE_DEFAULT);
  /** Dòng chờ cuộn vào giữa khung / ô chờ nhận con trỏ — làm sau khi trang chứa nó vẽ xong. */
  const pendingScroll = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // Tải phiếu khi đổi vị trí (đợi danh sách vị trí về trước nếu shop có vị trí).
  useEffect(() => {
    if (locationsQ.loading) return;
    let cancelled = false;
    setLoading(true);
    fetchStocktakeSheet(effectiveLocationId || undefined)
      .then(async (r) => {
        if (cancelled) return;
        // Nạp bản nháp đang đếm dở (nếu có) — chỉ giữ mã còn trong phiếu, cộng các dòng
        // đã thêm bằng quét mà vẫn còn số đếm (mã nay đã vào phiếu thì dùng dòng của phiếu).
        const draft = readStocktakeDraft(effectiveLocationId);
        const ids = new Set(r.rows.map((x) => x.productId));
        const stored = draft.extraRows.filter((x) => !ids.has(x.productId) && isCounted(draft.counts, x.productId));
        // Dòng thêm bằng quét: hỏi lại máy chủ số sổ HIỆN TẠI (sổ nhớ trong máy có thể đã cũ,
        // mà "lệch" = đếm ≠ sổ — sổ sai là sót điều chỉnh). Mã đã bị xóa khỏi kho thì máy chủ
        // không trả về → bỏ dòng. Hỏi không được (mất mạng…) thì tạm dùng sổ đã nhớ.
        let extra = stored;
        if (stored.length) {
          try {
            const fresh = await fetchStocktakeRows(
              effectiveLocationId || undefined,
              stored.map((x) => x.productId)
            );
            extra = fresh.rows.filter((x) => !ids.has(x.productId));
          } catch {
            extra = stored;
          }
          if (cancelled) return;
        }
        setTruncated(r.truncated);
        sheetIds.current = new Set(ids);
        for (const x of extra) ids.add(x.productId);
        setRows([...r.rows, ...extra]);
        setCounts(Object.fromEntries(Object.entries(draft.counts).filter(([id]) => ids.has(id))));
        setLastScan(null);
        hydratedKey.current = stocktakeDraftId(effectiveLocationId);
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : "Không tải được phiếu"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [effectiveLocationId, locationsQ.loading, reloadTick]);

  // Nhớ bản nháp — CHỈ ghi sau khi phiếu của đúng vị trí này đã nạp xong bản nháp cũ.
  // Trước 09/11/2026 hiệu ứng này chạy ngay lúc mở trang với `counts` còn rỗng, ghi đè
  // bản nháp trước khi kịp đọc → tải lại trang là mất hết số đang đếm.
  useEffect(() => {
    if (hydratedKey.current !== stocktakeDraftId(effectiveLocationId)) return;
    // Dòng thêm bằng quét: chỉ nhớ dòng còn số đếm (xóa trắng ô đếm = bỏ dòng ở lần tải sau).
    const extra = rows.filter((r) => !sheetIds.current.has(r.productId) && isCounted(counts, r.productId));
    writeStocktakeDraft(effectiveLocationId, counts, extra);
  }, [counts, rows, effectiveLocationId]);

  // Phiếu tải xong → con trỏ vào sẵn ô quét (máy có chuột; điện thoại thì không bật bàn phím).
  useEffect(() => {
    if (loading) return;
    if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) scanRef.current?.focus();
  }, [loading]);

  // Lớp chặn 2: con trỏ không nằm trong ô nhập nào (vừa bấm chip lọc, nút Chốt, chỗ trống…)
  // mà có phím gõ → đưa về ô quét TRƯỚC khi ký tự được nhập. Không có lớp này, Enter của
  // máy quét sẽ "bấm" luôn cái nút đang giữ con trỏ.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " ") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]')) return;
      scanRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Nhớ số dòng/trang theo trình duyệt (đọc sau khi gắn trang để khỏi lệch với bản dựng sẵn).
  useEffect(() => {
    setPageSize(readStocktakePageSize());
  }, []);

  const counted = useMemo(
    () => rows.filter((r) => isCounted(counts, r.productId)),
    [rows, counts]
  );
  const diffs = useMemo(
    () =>
      counted
        .map((r) => ({ row: r, n: validCount(counts[r.productId]) }))
        .filter((x): x is { row: StocktakeRow; n: number } => x.n !== null && x.n !== x.row.book),
    [counted, counts]
  );
  const invalid = counted.filter((r) => validCount(counts[r.productId]) === null);
  const visible = onlyDiff ? diffs.map((d) => d.row) : rows;

  // PHÂN TRANG CHỈ Ở PHẦN VẼ: số đếm, số lệch, dò mã quét vẫn tính trên TOÀN phiếu (dữ liệu
  // nằm sẵn trên máy), bảng chỉ vẽ một trang — quét mã ở trang khác thì tự lật tới trang đó.
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Quét xong: lật tới trang chứa dòng vừa quét, rồi (hiệu ứng dưới) cuộn dòng đó vào giữa khung.
  useEffect(() => {
    if (!lastScan) return;
    const idx = visible.findIndex((r) => r.productId === lastScan.id);
    if (idx < 0) return; // đang "Chỉ hiện lệch" mà mã vừa quét khớp sổ — không có dòng để nhảy tới
    pendingScroll.current = lastScan.id;
    setPage(Math.floor(idx / pageSize) + 1);
    // Chỉ chạy theo LẦN QUÉT; `visible` / `pageSize` đọc giá trị của đúng lượt vẽ đó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastScan]);

  // Sau mỗi lượt vẽ: dòng đang chờ cuộn / ô đang chờ nhận con trỏ đã lên màn thì làm ngay.
  // Cuộn TRONG khung bảng, không cuộn trang — ô quét phải luôn nằm trong tầm mắt.
  useEffect(() => {
    if (pendingScroll.current) {
      const box = tableBoxRef.current;
      const tr = inputRefs.current.get(pendingScroll.current)?.closest("tr");
      if (box && tr) {
        const b = box.getBoundingClientRect();
        const t = tr.getBoundingClientRect();
        box.scrollTop += t.top - b.top - box.clientHeight / 2 + t.height / 2;
        pendingScroll.current = null;
      }
    }
    if (pendingFocus.current) {
      const el = inputRefs.current.get(pendingFocus.current);
      if (el) {
        el.focus();
        pendingFocus.current = null;
      }
    }
  });

  /** Tới ô sai số đầu tiên (có thể đang nằm ở trang khác) — không thì khách không biết vì sao nút Chốt khóa. */
  function goToInvalid() {
    const first = invalid[0];
    if (!first) return;
    const idx = rows.findIndex((r) => r.productId === first.productId);
    pendingFocus.current = first.productId;
    setOnlyDiff(false);
    setPage(Math.floor(idx / pageSize) + 1);
  }

  function setCount(id: string, v: string) {
    setCounts((c) => ({ ...c, [id]: v }));
  }

  /** Cộng 1 cho một mã. Ô đang chứa số sai (rác do quét nhầm, số âm…) thì đếm lại từ 0. */
  function bump(id: string) {
    setCounts((c) => ({ ...c, [id]: String((validCount(c[id]) ?? 0) + 1) }));
    setLastScan((s) => ({ id, tick: (s?.tick ?? 0) + 1 }));
  }

  /** Enter ở ô đếm: nhảy sang ô kế tiếp trong danh sách đang hiện. */
  function focusNext(id: string) {
    const idx = visible.findIndex((r) => r.productId === id);
    const next = visible[idx + 1];
    if (!next) {
      scanRef.current?.focus();
      return;
    }
    const el = inputRefs.current.get(next.productId);
    if (el) {
      el.focus();
      return;
    }
    // Ô kế tiếp nằm ở trang sau → lật trang, vẽ xong thì nhận con trỏ.
    pendingFocus.current = next.productId;
    setPage(Math.floor((idx + 1) / pageSize) + 1);
  }

  /**
   * Quét/gõ mã: mã có trong phiếu → cộng 1; chưa có → thêm dòng sổ 0 rồi cộng 1.
   * Con trỏ Ở LẠI ô quét và ô quét được xóa NGAY (trước khi tra máy chủ) để lần quét
   * kế tiếp không nối vào mã cũ.
   */
  async function handleScan(code: string) {
    const q = code.trim();
    if (!q) return;
    if (scanRef.current) scanRef.current.value = "";
    scanRef.current?.focus();
    const hit = rows.find((r) => productMatchesCode(r, q));
    if (hit) {
      bump(hit.productId);
      return;
    }
    setPending((n) => n + 1);
    try {
      const res = await fetchProducts({ page: 1, pageSize: 5, search: q, status: "all" });
      // Gõ tay một phần mã SKU mà chỉ ra đúng một sản phẩm thì nhận luôn (tiện tay). Dãy số
      // kiểu mã vạch thì PHẢI trùng khít: mã đọc thiếu / mã lạ không được cộng nhầm vào
      // sản phẩm "gần giống" — kiểm kê đếm sai mà không ai hay.
      const p =
        res.items.find((x) => productMatchesCode(x, q)) ??
        (!SCAN_CODE_RE.test(q) && res.items.length === 1 ? res.items[0] : undefined);
      if (!p) {
        toast.error(`Không có SKU nào khớp "${q}"`);
        return;
      }
      // Mã không nằm trong phiếu → thêm dòng với số sổ THẬT: theo vị trí thì là tồn ở vị trí
      // đó (thường 0), không dùng vị trí thì là tồn của mã (mã ngừng bán / mã ngoài 2.000 dòng
      // đầu vẫn có tồn — trước 09/11 ghi cứng 0 nên cột Sổ, Lệch sai và đếm đúng bằng 0 bị bỏ sót).
      // Quét dồn dập cùng một mã mới có thể về hai lượt tra — chỉ thêm MỘT dòng, mỗi lượt vẫn cộng 1.
      const book = effectiveLocationId
        ? (p.stockLevels?.find((l) => l.locationId === effectiveLocationId)?.quantity ?? 0)
        : p.quantityInStock;
      setRows((cur) =>
        cur.some((r) => r.productId === p.id)
          ? cur
          : [
              ...cur,
              { productId: p.id, skuCode: p.skuCode, barcode: p.barcode, productName: p.productName, isActive: p.isActive !== false, book },
            ]
      );
      bump(p.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setPending((n) => n - 1);
    }
  }

  async function handleSubmit() {
    if (invalid.length || diffs.length === 0) return;
    setSubmitting(true);
    const items = diffs.map((d) => ({ productId: d.row.productId, counted: d.n }));
    let adjusted = 0;
    let sent = 0;
    try {
      // Máy chủ nhận tối đa 500 mã mỗi lần chốt (mỗi lần một giao dịch). Phiếu lệch nhiều hơn
      // — lần kiểm kê đầu của shop vài nghìn mã — thì gửi nối tiếp từng lượt 500.
      for (let i = 0; i < items.length; i += STOCKTAKE_SUBMIT_CHUNK) {
        const part = items.slice(i, i + STOCKTAKE_SUBMIT_CHUNK);
        const res = await submitStocktake({
          locationId: effectiveLocationId || undefined,
          items: part,
          note: note.trim() || undefined,
        });
        adjusted += res.adjusted;
        sent += part.length;
      }
      toast.success(
        `Đã chốt kiểm kê: điều chỉnh ${formatNumber(adjusted)} mã — mỗi mã một dòng trong Nhật ký kho, sàn nhận số mới`
      );
      clearStocktakeDraft(effectiveLocationId);
      setCounts({});
      setNote("");
      setOnlyDiff(false);
      setPage(1);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Không kết nối được máy chủ";
      // Hỏng giữa chừng: các lượt trước ĐÃ ghi. Số đếm vẫn giữ nguyên trong máy; phiếu tải lại
      // bên dưới sẽ cho các mã đã ghi thành "khớp", phần còn lại vẫn lệch để bấm Chốt tiếp.
      toast.error(
        sent > 0
          ? `Đã chốt ${formatNumber(sent)}/${formatNumber(items.length)} mã lệch thì gặp lỗi: ${msg}. Số đếm còn lại vẫn giữ — bấm Chốt lần nữa cho phần còn lại.`
          : msg,
        { duration: sent > 0 ? 15000 : 8000 }
      );
      // Chưa ghi được gì và không phải lỗi "mã không còn trong kho" → giữ nguyên màn, khỏi tải lại.
      if (sent === 0 && !(err instanceof ApiError && err.status === 404)) return;
    } finally {
      setSubmitting(false);
    }
    // Tải lại phiếu: sau khi chốt (sổ mới), sau khi chốt dở, hoặc khi có mã đã bị xóa khỏi kho
    // giữa lúc đếm (404 — tải lại là mã đó tự rời phiếu, số đếm các mã khác vẫn giữ).
    invalidate(["products"]);
    invalidate(["inventory-logs"]);
    invalidate(["stock-locations"]);
    setReloadTick((t) => t + 1);
  }

  const lastScanRow = lastScan ? rows.find((r) => r.productId === lastScan.id) : undefined;
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
                Tổng kho
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
                <LocationSelect
                  id="st-location"
                  locations={locations}
                  value={effectiveLocationId}
                  onChange={(v) => {
                    setLocationId(v);
                    setOnlyDiff(false);
                    setPage(1);
                  }}
                  suffix={(l) => ` · ${formatNumber(l.skuCount)} SKU`}
                />
              </div>
            )}
          </div>
        </PageHeaderBand>

        {/* ===== Ô QUÉT + CHIP LỌC ===== */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="w-full max-w-md space-y-1.5">
            <div className="relative">
              <ScanBarcode className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={scanRef}
                className="pl-9"
                placeholder="Quét mã vạch, hoặc gõ mã SKU rồi Enter: cộng 1 vào ô đếm…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleScan(e.currentTarget.value);
                  }
                }}
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            {lastScanRow && (
              <p className={cn(TEXT_SUB, "truncate")} aria-live="polite">
                Vừa quét: <span className="font-mono font-medium text-foreground">{lastScanRow.skuCode}</span> · đã đếm{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {formatNumber(validCount(counts[lastScanRow.productId]) ?? 0)}
                </span>
              </p>
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
                onClick={() => {
                  setOnlyDiff(c.key);
                  setPage(1);
                }}
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
            <div ref={tableBoxRef} className="max-h-[calc(100dvh-20rem)] overflow-auto">
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
                  {pageRows.map((r) => {
                    const raw = counts[r.productId];
                    const n = validCount(raw);
                    const bad = raw !== undefined && raw !== "" && n === null;
                    const diff = n === null ? null : n - r.book;
                    const justScanned = lastScan?.id === r.productId;
                    return (
                      <TableRow
                        key={r.productId}
                        className={cn(justScanned ? "bg-sky-100" : diff ? "bg-amber-50/60" : undefined)}
                      >
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
                            onChange={(e) => {
                              if (focusValue.current?.id === r.productId) focusValue.current.typed = true;
                              setCount(r.productId, e.target.value);
                            }}
                            onFocus={(e) => {
                              focusValue.current = { id: r.productId, value: raw ?? "", typed: false };
                              e.currentTarget.select();
                            }}
                            onKeyDown={(e) => {
                              // Lớp chặn 3b: số đếm chỉ gồm chữ số. Một phím in được KHÁC chữ số (chữ
                              // cái, gạch, chấm…) ở ô đếm = máy quét đang bắn tem in MÃ SKU có chữ
                              // (vd AT-DT-CT-NAU-L) — ô số sẽ nuốt mất chữ. Chuyển sang ô quét: phần
                              // chữ số vừa gõ vào ô này (nếu có) là đầu mã, ô đếm về lại số cũ.
                              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !/\d/.test(e.key)) {
                                e.preventDefault();
                                const before = focusValue.current;
                                const mine = before?.id === r.productId ? before : null;
                                const head = mine?.typed ? e.currentTarget.value : "";
                                if (mine?.typed) setCount(r.productId, mine.value);
                                if (scanRef.current) {
                                  scanRef.current.value = head + e.key;
                                  scanRef.current.focus();
                                }
                                return;
                              }
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const typed = e.currentTarget.value.trim();
                              // Lớp chặn 3: máy quét bắn vào ô đếm → trả số cũ, cộng 1 cho đúng mã.
                              if (SCAN_CODE_RE.test(typed)) {
                                const before = focusValue.current;
                                setCount(r.productId, before?.id === r.productId ? before.value : "");
                                void handleScan(typed);
                                return;
                              }
                              focusNext(r.productId);
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
        {/* Phân trang — chọn 20/50/100 dòng/trang như các bảng khác; phiếu ngắn thì không bày ra */}
        {!loading && visible.length > STOCKTAKE_PAGE_SIZES[0] && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hiển thị</span>
              <NativeSelect
                className="w-20"
                aria-label="Số dòng mỗi trang"
                value={String(pageSize)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setPageSize(n);
                  setPage(1);
                  writeStocktakePageSize(n);
                  // Trả con trỏ về ô quét: để ở ô chọn thì số máy quét bắn ra sẽ đổi lựa chọn.
                  scanRef.current?.focus();
                }}
              >
                {STOCKTAKE_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm text-muted-foreground tabular-nums">
                mã/trang · {formatNumber(visible.length)} mã · trang {safePage}/{pageCount}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                <ChevronLeft className="size-4" />
                Trang trước
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount}
                onClick={() => setPage(safePage + 1)}
              >
                Trang sau
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
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
              {invalid.length > 0 && (
                <button
                  type="button"
                  onClick={goToInvalid}
                  className="ml-2 text-rose-700 underline underline-offset-2 hover:text-rose-800"
                  title="Tới ô sai số đầu tiên"
                >
                  · {invalid.length} ô sai số
                </button>
              )}
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
