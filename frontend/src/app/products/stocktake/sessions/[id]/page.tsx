"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, EyeOff, Loader2, Printer, RotateCcw, ScanBarcode, Send, X } from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeaderBand } from "@/components/ui/page-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ApiError,
  approveStocktakeSession,
  countStocktakeSession,
  fetchProducts,
  fetchStocktakeSession,
  fetchStocktakeSheet,
  getStoredUser,
  getToken,
  moveStocktakeSession,
  type StocktakeSessionDetail,
  type StocktakeSessionLine,
} from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { productMatchesCode } from "@/lib/product-code";
import { qk } from "@/lib/query-keys";
import { SCAN_CODE_RE, validCount } from "@/lib/stocktake";
import { SESSION_STATUS_META } from "@/lib/stocktake-session";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * MỘT PHIÊN KIỂM KÊ (kho chuẩn quốc tế lát 5, 20/11/2026, docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 17).
 *
 *   Đang đếm  — bảng mọi mã cần đếm (phiếu của vị trí + mã thêm bằng quét). Số đếm ghi THẲNG lên máy
 *               chủ sau mỗi ô / mỗi lần quét, nên nhiều máy cùng đếm một phiên; trang tự đọc lại 15 giây
 *               một lần để thấy số của người khác. Quét cộng dồn ở máy chủ (hai người cùng quét một mã
 *               không mất lượt). Đếm mù: người không phải chủ shop không thấy cột Sổ và Lệch.
 *   Chờ duyệt — chỉ còn các mã đã đếm, kèm sổ lúc đếm, lệch, và biến động từ lúc đếm. Chủ shop duyệt
 *               (hộp xác nhận) thì phần chênh mới ghi vào kho.
 *   Đã duyệt  — phần chênh đã ghi + nút In biên bản.
 *
 * Ô quét theo đúng ba lớp chặn của trang Kiểm kê nhanh (con trỏ ở lại ô quét; phím gõ khi không ở ô
 * nhập nào thì về ô quét; máy quét bắn nhầm vào ô đếm thì trả số cũ rồi tính là một lần quét). Ô quét
 * không bao giờ bị khóa trong lúc chờ máy chủ.
 */
const PAGE_SIZE = 100;
const POLL_MS = 15_000;

/** "giảm 3, tăng 1" — bỏ vế bằng 0 để câu không có "tăng 0". */
function downUpText(down: number, up: number): string {
  return [down > 0 ? `giảm ${formatNumber(down)}` : "", up > 0 ? `tăng ${formatNumber(up)}` : ""].filter(Boolean).join(", ");
}

interface Row {
  productId: string;
  skuCode: string;
  barcode?: string | null;
  productName: string;
  /** Số sổ hiện tại (từ phiếu của vị trí) — không có với mã thêm bằng quét hoặc khi đếm mù. */
  book?: number;
  line?: StocktakeSessionLine;
}

type Filter = "all" | "counted" | "uncounted" | "diff";

export default function StocktakeSessionPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const invalidate = useInvalidate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const q = useApiQuery({
    queryKey: qk.stocktakeSession(id),
    queryFn: () => fetchStocktakeSession(id),
    enabled: Boolean(id),
    refetchInterval: POLL_MS,
    staleTime: 0,
  });
  const data = q.data;
  const session = data?.session;
  const counting = session?.status === "COUNTING";
  const hideBook = data?.hideBook ?? false;

  // Phiếu của vị trí: danh sách mã cần đếm. Chỉ cần khi đang đếm.
  const sheetQ = useApiQuery({
    queryKey: ["stocktake-sheet", session?.locationId ?? ""],
    queryFn: () => fetchStocktakeSheet(session?.locationId ?? undefined),
    enabled: Boolean(session) && counting,
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  /** Số đang gõ dở ở một ô (chưa gửi). */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(0);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [busy, setBusy] = useState<"submit" | "reopen" | "cancel" | "approve" | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  /** Số trong ô đếm lúc con trỏ vào — trả lại khi máy quét bắn nhầm vào ô đó. */
  const focusValue = useRef<{ id: string; value: string } | null>(null);
  /** Số vừa gửi của từng ô (chống gửi lặp khi Enter kéo theo sự kiện rời ô) — xóa khi ô được gõ lại. */
  const sentRef = useRef<Map<string, string>>(new Map());

  // Lớp chặn 1 + 2 của ô quét (xem chú thích đầu tệp).
  useEffect(() => {
    if (!counting) return;
    if (window.matchMedia("(pointer: fine)").matches) scanRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " ") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]')) return;
      scanRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [counting]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.lines.map((l) => [l.productId, l]));
    if (!counting) {
      return data.lines.map((l) => ({ productId: l.productId, skuCode: l.skuCode, productName: l.productName, line: l }));
    }
    const sheet = sheetQ.data?.rows ?? [];
    const seen = new Set<string>();
    const out: Row[] = sheet.map((r) => {
      seen.add(r.productId);
      return {
        productId: r.productId,
        skuCode: r.skuCode,
        barcode: r.barcode,
        productName: r.productName,
        book: r.book,
        line: byId.get(r.productId),
      };
    });
    // Mã đã đếm mà không nằm trong phiếu (thêm bằng quét) — xếp cuối.
    for (const l of data.lines) {
      if (!seen.has(l.productId)) out.push({ productId: l.productId, skuCode: l.skuCode, productName: l.productName, line: l });
    }
    return out;
  }, [data, sheetQ.data, counting]);

  const diffOf = (r: Row): number | null =>
    r.line && r.line.bookAtCount !== undefined ? r.line.counted - r.line.bookAtCount : null;
  const countedRows = rows.filter((r) => r.line);
  const diffRows = countedRows.filter((r) => (diffOf(r) ?? 0) !== 0);
  const visible =
    filter === "counted"
      ? countedRows
      : filter === "uncounted"
        ? rows.filter((r) => !r.line)
        : filter === "diff"
          ? diffRows
          : rows;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const down = diffRows.reduce((a, r) => a + Math.max(0, -(diffOf(r) ?? 0)), 0);
  const up = diffRows.reduce((a, r) => a + Math.max(0, diffOf(r) ?? 0), 0);

  /** Vá bộ nhớ đệm của phiên bằng kết quả máy chủ vừa trả — không chờ lượt đọc lại. */
  function patchLines(
    saved: { productId: string; counted: number; bookAtCount?: number }[],
    cleared: string[],
    meta: Map<string, { skuCode: string; productName: string }>
  ) {
    qc.setQueryData<StocktakeSessionDetail>(qk.stocktakeSession(id), (old) => {
      if (!old) return old;
      const gone = new Set(cleared);
      const next = old.lines.filter((l) => !gone.has(l.productId));
      for (const s of saved) {
        const i = next.findIndex((l) => l.productId === s.productId);
        const base: StocktakeSessionLine =
          i >= 0
            ? next[i]
            : {
                productId: s.productId,
                skuCode: meta.get(s.productId)?.skuCode ?? "",
                productName: meta.get(s.productId)?.productName ?? "",
                counted: 0,
                countedAt: new Date().toISOString(),
                countedByName: null,
              };
        const merged: StocktakeSessionLine = {
          ...base,
          counted: s.counted,
          // Người vừa ghi là mình — hiện ngay, lượt đọc lại 15 giây sau lấy tên chuẩn từ máy chủ.
          countedByName: getStoredUser()?.fullName ?? base.countedByName,
          ...(s.bookAtCount !== undefined ? { bookAtCount: s.bookAtCount, drift: 0 } : {}),
        };
        if (i >= 0) next[i] = merged;
        else next.push(merged);
      }
      return { ...old, lines: next };
    });
  }

  async function send(
    items: Parameters<typeof countStocktakeSession>[1],
    meta: Map<string, { skuCode: string; productName: string }>
  ) {
    setPending((n) => n + 1);
    try {
      const res = await countStocktakeSession(id, items);
      patchLines(res.lines, res.cleared, meta);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
      void invalidate(qk.stocktakeSession(id));
    } finally {
      setPending((n) => n - 1);
    }
  }

  /** Gửi số của một ô khi rời ô / Enter. Ô trống = bỏ dòng đã đếm. */
  function commit(r: Row) {
    const raw = edits[r.productId];
    if (raw === undefined) return;
    // Enter gửi rồi trả con trỏ về ô quét → ô đếm mất con trỏ và gọi lại hàm này TRƯỚC khi màn vẽ lại
    // (số đang gõ vẫn còn trong `edits`). Đánh dấu đã gửi để không gửi hai lần cùng một số.
    if (sentRef.current.get(r.productId) === raw) return;
    sentRef.current.set(r.productId, raw);
    setEdits((e) => {
      const { [r.productId]: _drop, ...rest } = e;
      void _drop;
      return rest;
    });
    const meta = new Map([[r.productId, { skuCode: r.skuCode, productName: r.productName }]]);
    if (raw.trim() === "") {
      if (r.line) void send([{ productId: r.productId, counted: null }], meta);
      return;
    }
    const n = validCount(raw.trim());
    if (n === null) {
      toast.error(`Số đếm của ${r.skuCode} không hợp lệ`);
      return;
    }
    if (r.line?.counted === n) return;
    void send([{ productId: r.productId, counted: n }], meta);
  }

  /** Quét / gõ mã rồi Enter: cộng 1 cho mã đó. Ô quét xóa ngay, không khóa trong lúc chờ máy chủ. */
  async function handleScan(code: string) {
    const qv = code.trim();
    if (!qv) return;
    if (scanRef.current) scanRef.current.value = "";
    scanRef.current?.focus();
    let hit: { productId: string; skuCode: string; productName: string } | undefined = rows.find((r) =>
      productMatchesCode(r, qv)
    );
    if (!hit) {
      setPending((n) => n + 1);
      try {
        const res = await fetchProducts({ page: 1, pageSize: 5, search: qv, status: "all" });
        // Dãy số kiểu mã vạch phải trùng khít; gõ tay một phần mã SKU mà chỉ ra một sản phẩm thì nhận.
        const p =
          res.items.find((x) => productMatchesCode(x, qv)) ??
          (!SCAN_CODE_RE.test(qv) && res.items.length === 1 ? res.items[0] : undefined);
        if (p) hit = { productId: p.id, skuCode: p.skuCode, productName: p.productName };
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
        return;
      } finally {
        setPending((n) => n - 1);
      }
    }
    if (!hit) {
      toast.error(`Không có SKU nào khớp "${qv}"`);
      return;
    }
    setLastScan(hit.productId);
    await send([{ productId: hit.productId, add: 1 }], new Map([[hit.productId, hit]]));
  }

  async function move(action: "submit" | "reopen" | "cancel") {
    setBusy(action);
    try {
      await moveStocktakeSession(id, action);
      await invalidate(qk.stocktakeSessions());
      setFilter("all");
      setPage(1);
      if (action === "submit") toast.success("Đã gửi duyệt. Chủ shop duyệt thì phần chênh mới ghi vào kho.");
      if (action === "cancel") toast.success("Đã hủy phiên. Không ghi gì vào kho.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
      void invalidate(qk.stocktakeSession(id));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setConfirmApprove(false);
    setBusy("approve");
    try {
      const res = await approveStocktakeSession(id);
      // Tồn đã đổi → làm tươi Tổng kho, Nhật ký kho và danh sách phiên.
      await invalidate(qk.stocktakeSessions(), ["products"], ["inventory-logs"]);
      toast.success(
        res.adjustedCount === 0
          ? `Đã duyệt ${formatNumber(res.lineCount)} mã — khớp sổ, không điều chỉnh gì.`
          : `Đã duyệt: ${formatNumber(res.adjustedCount)} mã chênh đã ghi vào kho.`,
        { duration: 8000 }
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
      void invalidate(qk.stocktakeSession(id));
    } finally {
      setBusy(null);
    }
  }

  const meta = session ? SESSION_STATUS_META[session.status] : null;
  const showBook = !hideBook;
  const chips: { key: Filter; label: string }[] = counting
    ? [
        { key: "all", label: `Tất cả ${formatNumber(rows.length)}` },
        { key: "counted", label: `Đã đếm ${formatNumber(countedRows.length)}` },
        { key: "uncounted", label: `Chưa đếm ${formatNumber(rows.length - countedRows.length)}` },
        ...(showBook ? [{ key: "diff" as Filter, label: `Lệch ${formatNumber(diffRows.length)}` }] : []),
      ]
    : [
        { key: "all", label: `Tất cả ${formatNumber(rows.length)}` },
        { key: "diff", label: `Chỉ hiện lệch ${formatNumber(diffRows.length)}` },
      ];

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeaderBand className="pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Link
                href="/products/stocktake/sessions"
                className={cn(TEXT_SUB, "inline-flex items-center gap-1 hover:text-foreground")}
              >
                <ArrowLeft className="size-3.5" />
                Các phiên kiểm kê
              </Link>
              {session && meta ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-semibold">{session.code}</span>
                    <span
                      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", meta.className)}
                    >
                      {meta.label}
                    </span>
                    {session.blind && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-slate-700"
                        title="Người đếm không thấy số sổ và phần lệch khi đang đếm. Chủ shop vẫn thấy."
                      >
                        <EyeOff className="size-3" />
                        Đếm mù
                      </span>
                    )}
                  </div>
                  <p className={cn(TEXT_SUB, "max-w-[44rem] truncate")}>
                    {session.locationName ? `${session.locationName} · ` : ""}
                    mở {formatDateTime(session.createdAt)}
                    {session.createdByName ? ` bởi ${session.createdByName}` : ""}
                    {session.approvedAt
                      ? ` · duyệt ${formatDateTime(session.approvedAt)}${session.approvedByName ? ` bởi ${session.approvedByName}` : ""}`
                      : session.submittedAt
                        ? ` · gửi duyệt ${formatDateTime(session.submittedAt)}${session.submittedByName ? ` bởi ${session.submittedByName}` : ""}`
                        : ""}
                    {session.note ? ` · ${session.note}` : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{q.error ?? "Đang tải phiên…"}</p>
              )}
            </div>

            {session && (
              <div className="flex flex-wrap items-center gap-2">
                {counting && (
                  <>
                    <Button variant="outline" onClick={() => void move("cancel")} disabled={busy !== null}>
                      <X className="size-4" />
                      Hủy phiên
                    </Button>
                    <Button onClick={() => void move("submit")} disabled={busy !== null || countedRows.length === 0 || pending > 0}>
                      {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      Gửi duyệt ({formatNumber(countedRows.length)} mã)
                    </Button>
                  </>
                )}
                {session.status === "PENDING" && (
                  <>
                    <Button variant="outline" onClick={() => void move("reopen")} disabled={busy !== null}>
                      {busy === "reopen" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                      Mở lại để đếm tiếp
                    </Button>
                    {data?.canApprove ? (
                      <Button onClick={() => setConfirmApprove(true)} disabled={busy !== null}>
                        {busy === "approve" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        Duyệt, ghi vào kho
                      </Button>
                    ) : (
                      <span className={TEXT_SUB}>Đang chờ chủ shop duyệt</span>
                    )}
                  </>
                )}
                {session.status === "APPROVED" && (
                  <Button variant="outline" onClick={() => window.open(`/print/stocktake/${session.id}`, "_blank", "noopener")}>
                    <Printer className="size-4" />
                    In biên bản
                  </Button>
                )}
              </div>
            )}
          </div>
        </PageHeaderBand>

        {session && (
          <>
            {/* ===== Ô QUÉT (chỉ khi đang đếm) + CHIP LỌC ===== */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              {counting ? (
                <div className="w-full max-w-md space-y-1.5">
                  <div className="relative">
                    <ScanBarcode className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={scanRef}
                      className="pl-9"
                      placeholder="Quét mã vạch, hoặc gõ mã SKU rồi Enter: cộng 1 vào số đếm…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleScan(e.currentTarget.value);
                        }
                      }}
                    />
                    {pending > 0 && (
                      <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <p className={TEXT_SUB}>
                    Số đếm lưu ngay lên máy chủ. Nhiều người mở cùng phiên này để đếm chung; quét cùng một mã thì cộng dồn.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {session.status === "PENDING" &&
                    `${formatNumber(countedRows.length)} mã đã đếm, ${formatNumber(diffRows.length)} mã lệch${
                      diffRows.length ? ` (${downUpText(down, up)})` : ""
                    }. Duyệt sẽ ghi đúng phần lệch này vào kho; hàng bán sau lúc đếm không bị tính lại.`}
                  {session.status === "APPROVED" &&
                    (session.adjustedCount === 0
                      ? "Mọi mã khớp sổ, không điều chỉnh gì."
                      : `Đã ghi vào kho ${formatNumber(session.adjustedCount)} mã chênh: ${downUpText(session.totalDown, session.totalUp)}.`)}
                  {session.status === "CANCELLED" && "Phiên đã hủy. Không ghi gì vào kho."}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={filter === c.key}
                    onClick={() => {
                      setFilter(c.key);
                      setPage(1);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      filter === c.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ===== BẢNG ===== */}
            <div className="overflow-hidden rounded-lg border bg-card">
              {counting && sheetQ.loading ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Đang tải phiếu…</p>
              ) : pageRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {filter !== "all"
                    ? "Không có mã nào ở bộ lọc này."
                    : counting
                      ? "Chưa có mã nào. Quét mã để bắt đầu đếm."
                      : "Phiên không có mã nào được đếm."}
                </p>
              ) : (
                <div className="max-h-[calc(100dvh-20rem)] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead className="w-40">Mã SKU</TableHead>
                        <TableHead>Tên sản phẩm</TableHead>
                        {showBook && (
                          <TableHead
                            className="w-24 text-right"
                            title={
                              counting
                                ? "Số sổ hiện tại. Mã đã đếm: số sổ lúc đếm."
                                : "Số sổ tại thời điểm đếm mã này"
                            }
                          >
                            {counting ? "Sổ" : "Sổ lúc đếm"}
                          </TableHead>
                        )}
                        <TableHead className="w-32 text-right">Thực đếm</TableHead>
                        {showBook && <TableHead className="w-28 text-right">Lệch</TableHead>}
                        <TableHead className="w-36">Người đếm</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.map((r) => {
                        const diff = diffOf(r);
                        const drift = r.line?.drift;
                        const book = r.line?.bookAtCount ?? r.book;
                        const applied = session.status === "APPROVED";
                        const skipped = applied && r.line?.applied && r.line.delta === null;
                        return (
                          <TableRow
                            key={r.productId}
                            className={cn(lastScan === r.productId && counting ? "bg-sky-100" : diff ? "bg-amber-50/60" : undefined)}
                          >
                            <TableCell className="font-mono text-sm">
                              <span className="inline-block max-w-[16rem] truncate align-bottom" title={r.skuCode}>
                                {r.skuCode}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="block max-w-xs truncate 2xl:max-w-md" title={r.productName}>
                                {r.productName}
                              </span>
                            </TableCell>
                            {showBook && (
                              <TableCell className="text-right text-sm tabular-nums text-slate-700">
                                {book === undefined ? "—" : formatNumber(book)}
                              </TableCell>
                            )}
                            <TableCell className="text-right">
                              {counting ? (
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  placeholder="—"
                                  value={edits[r.productId] ?? (r.line ? String(r.line.counted) : "")}
                                  onChange={(e) => {
                                    sentRef.current.delete(r.productId);
                                    setEdits((cur) => ({ ...cur, [r.productId]: e.target.value }));
                                  }}
                                  onFocus={(e) => {
                                    focusValue.current = { id: r.productId, value: e.currentTarget.value };
                                    e.currentTarget.select();
                                  }}
                                  onBlur={() => commit(r)}
                                  onKeyDown={(e) => {
                                    if (e.key !== "Enter") return;
                                    e.preventDefault();
                                    const typed = e.currentTarget.value.trim();
                                    // Lớp chặn 3: máy quét bắn vào ô đếm → trả số cũ, tính là một lần quét.
                                    if (SCAN_CODE_RE.test(typed)) {
                                      const before = focusValue.current;
                                      setEdits((cur) => {
                                        const { [r.productId]: _drop, ...rest } = cur;
                                        void _drop;
                                        return before?.id === r.productId && before.value !== (r.line ? String(r.line.counted) : "")
                                          ? { ...rest, [r.productId]: before.value }
                                          : rest;
                                      });
                                      void handleScan(typed);
                                      return;
                                    }
                                    commit(r);
                                    scanRef.current?.focus();
                                  }}
                                  className="ml-auto h-8 w-24 text-right tabular-nums"
                                  aria-label={`Thực đếm ${r.skuCode}`}
                                />
                              ) : (
                                <span className="text-sm font-semibold tabular-nums">{formatNumber(r.line?.counted ?? 0)}</span>
                              )}
                            </TableCell>
                            {showBook && (
                              <TableCell
                                className={cn(
                                  "text-right text-sm font-semibold tabular-nums",
                                  diff === null ? "text-muted-foreground" : diff === 0 ? "text-emerald-700" : "text-amber-700"
                                )}
                              >
                                {skipped
                                  ? "không áp"
                                  : diff === null
                                    ? "—"
                                    : diff === 0
                                      ? "khớp"
                                      : `${diff > 0 ? "+" : "−"}${formatNumber(Math.abs(diff))}`}
                                {skipped && (
                                  <span className={cn(TEXT_SUB, "block font-normal")}>mã đã xóa khỏi kho</span>
                                )}
                                {!applied && drift != null && drift !== 0 && (
                                  <span
                                    className="mt-0.5 block text-xs font-normal text-sky-700"
                                    title="Số sổ đã đổi từ lúc đếm mã này (hàng rời kho, nhập thêm…). Duyệt chỉ ghi phần lệch so với sổ lúc đếm."
                                  >
                                    sổ đã {drift > 0 ? "tăng" : "giảm"} {formatNumber(Math.abs(drift))}
                                  </span>
                                )}
                              </TableCell>
                            )}
                            <TableCell className="text-sm">
                              {r.line ? (
                                <span className="block max-w-[9rem] truncate" title={r.line.countedByName ?? undefined}>
                                  {r.line.countedByName ?? "—"}
                                </span>
                              ) : (
                                <span className={TEXT_SUB}>—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {pageCount > 1 && (
                <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
                  <span className={cn(TEXT_SUB, "tabular-nums")}>
                    Trang {safePage}/{pageCount} · {formatNumber(visible.length)} mã
                  </span>
                  <Button variant="outline" size="icon-sm" aria-label="Trang trước" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button variant="outline" size="icon-sm" aria-label="Trang sau" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </div>
            {counting && sheetQ.data?.truncated && (
              <p className={TEXT_SUB}>
                Phiếu chỉ liệt kê 2.000 mã đầu. Mã ngoài danh sách vẫn đếm được bằng cách quét hoặc gõ mã.
              </p>
            )}
          </>
        )}
      </div>

      {/* Hộp xác nhận duyệt — duyệt là ghi vào kho, không hoàn tác bằng một nút. */}
      <Dialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Duyệt phiên {session?.code}?</DialogTitle>
            <DialogDescription>
              {diffRows.length === 0
                ? `${formatNumber(countedRows.length)} mã đều khớp sổ — duyệt sẽ không điều chỉnh gì.`
                : `Ghi vào kho phần lệch của ${formatNumber(diffRows.length)} mã: ${downUpText(down, up)}. Số tồn mới được đẩy lên các gian đã nối. Muốn sửa sau khi duyệt phải kiểm kê lại.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmApprove(false)}>
              Chưa duyệt
            </Button>
            <Button onClick={() => void approve()}>
              <Check className="size-4" />
              Duyệt, ghi vào kho
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
