"use client";

// HÓA ĐƠN ĐẦU VÀO của CHÍNH công ty Hubsell (tab trong /admin/finance, anh
// Trung 28/09/2026). Kế toán làm ĐÚNG MỘT VIỆC: thả tệp (PDF/XML/ảnh) vào ô
// đầu tab — HQ lưu vĩnh viễn, máy đọc (XML chuẩn → chính xác; PDF/ảnh → Claude),
// lên dòng + phiếu chi sổ quỹ. Cuối quý: chọn khoảng ngày → Xuất bộ chứng từ
// (zip tệp gốc + bảng kê CSV tách trong nước / nhà thầu NN) → tích "đã khai
// kỳ X". Lần sau chọn dính tờ đã khai → cảnh báo, mặc định loại, có nút Vẫn gồm.
// Mỗi tờ khai NGUYÊN SỐ một lần — không chia tháng.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingPeriodPicker } from "@/components/shared/accounting-period-picker";
import { PNL_STICKY_HEAD, PNL_TABLE_SCROLLER } from "@/components/finance/realized-pnl/cells";
import {
  ApiError,
  declareHqInputInvoices,
  deleteHqInputInvoice,
  exportHqInputInvoices,
  fetchHqInputInvoiceFileUrl,
  fetchHqInputInvoices,
  updateHqInputInvoice,
  uploadHqInputInvoices,
  type HqInputInvoice,
  type HqInputInvoiceListResponse,
  type HqPaymentMethod,
} from "@/lib/api";
import { rangeToQuery, type DateRange } from "@/lib/date-range";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CASH_DEDUCT_LIMIT, HQ_EXPENSE_CATEGORIES, HQ_EXPENSE_CATEGORY_LABEL } from "./hq-expense-categories";
import { StatCard, formatCount, formatMoney } from "./shared";

const ACCEPT = ".pdf,.xml,.jpg,.jpeg,.png,.webp";
const PAGE_SIZES = [20, 50, 100] as const;

type Chip = "all" | "undeclared" | "declared" | "pending" | "foreign";
type SortKey = "invoiceDate" | "sellerName" | "total";

const SOURCE_LABEL: Record<HqInputInvoice["source"], string> = {
  XML: "Máy đọc XML",
  AI: "Máy đọc AI",
  MANUAL: "Nhập tay",
};

/** Quý hiện tại của khoảng ngày (theo ngày cuối) → "2026-Q3". */
function suggestPeriod(range: DateRange | null): string {
  const d = range?.to ?? new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function currentQuarterRange(): DateRange {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  return { from: new Date(now.getFullYear(), q * 3, 1), to: new Date(now.getFullYear(), q * 3 + 3, 0) };
}

function formatDay(key: string | null): string {
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

function periodLabel(p: string): string {
  const m = p.match(/^(\d{4})-Q([1-4])$/);
  if (m) return `Q${m[2]}/${m[1]}`;
  const mm = p.match(/^(\d{4})-(\d{2})$/);
  return mm ? `${mm[2]}/${mm[1]}` : p;
}

// ---------------- Ô thả tệp ----------------

function DropZone({
  disabled,
  onFiles,
  busy,
}: {
  disabled: boolean;
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled || busy) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
      }}
      className={cn(
        "flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-slate-300 bg-slate-50/60 hover:border-slate-400",
        (disabled || busy) && "cursor-not-allowed opacity-60"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {busy ? (
        <Loader2 className="size-5 animate-spin text-primary" />
      ) : (
        <UploadCloud className="size-5 text-primary" />
      )}
      <div>
        <p className="text-sm font-semibold">
          {busy ? "Đang lưu và đọc hóa đơn…" : "Thả hóa đơn vào đây hoặc bấm để chọn"}
        </p>
        <p className="text-xs text-muted-foreground">
          PDF, XML hoặc ảnh chụp — nhiều tệp một lúc. HQ lưu vĩnh viễn, tự đọc số và ghi
          vào sổ quỹ; anh chỉ cần duyệt.
        </p>
      </div>
    </div>
  );
}

// ---------------- Dialog sửa một tờ ----------------

function EditDialog({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: HqInputInvoice;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    invoiceNo: invoice.invoiceNo ?? "",
    invoiceSerial: invoice.invoiceSerial ?? "",
    invoiceDate: invoice.invoiceDate ?? "",
    sellerName: invoice.sellerName ?? "",
    sellerTaxCode: invoice.sellerTaxCode ?? "",
    isForeign: invoice.isForeign,
    description: invoice.description ?? "",
    subtotal: String(invoice.subtotal),
    vatRate: invoice.vatRate ?? "",
    vatAmount: String(invoice.vatAmount),
    total: String(invoice.total),
    paymentMethod: (invoice.paymentMethod ?? "BANK") as HqPaymentMethod,
    expenseCategory: invoice.expenseCategory ?? "OTHER_EXPENSE",
  });
  const [saving, setSaving] = useState(false);
  const cashWarn = f.paymentMethod === "CASH" && Number(f.total) >= CASH_DEDUCT_LIMIT;

  async function save(approve: boolean) {
    setSaving(true);
    try {
      await updateHqInputInvoice(invoice.id, {
        invoiceNo: f.invoiceNo || null,
        invoiceSerial: f.invoiceSerial || null,
        invoiceDate: f.invoiceDate || null,
        sellerName: f.sellerName || null,
        sellerTaxCode: f.sellerTaxCode || null,
        isForeign: f.isForeign,
        description: f.description || null,
        subtotal: Number(f.subtotal) || 0,
        vatRate: f.vatRate || null,
        vatAmount: Number(f.vatAmount) || 0,
        total: Number(f.total) || 0,
        paymentMethod: f.paymentMethod,
        expenseCategory: f.expenseCategory,
        ...(approve ? { approve: true as const } : {}),
      });
      toast.success(approve ? "Đã duyệt hóa đơn" : "Đã lưu");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, key: keyof typeof f, type = "text") => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={String(f[key])}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Hóa đơn đầu vào</DialogTitle>
          <DialogDescription>
            {SOURCE_LABEL[invoice.source]}
            {invoice.readerNote ? ` · ${invoice.readerNote}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("Ngày hóa đơn", "invoiceDate", "date")}
          <div className="grid grid-cols-2 gap-2">
            {field("Ký hiệu", "invoiceSerial")}
            {field("Số HĐ", "invoiceNo")}
          </div>
          {field("Nhà cung cấp", "sellerName")}
          {field("Mã số thuế NCC", "sellerTaxCode")}
          <div className="sm:col-span-2">{field("Nội dung", "description")}</div>
          {field("Giá chưa thuế (₫)", "subtotal", "number")}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Thuế suất</Label>
              <NativeSelect
                value={f.vatRate}
                onChange={(e) => setF({ ...f, vatRate: e.target.value })}
              >
                <option value="">—</option>
                <option value="KCT">KCT</option>
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="8">8%</option>
                <option value="10">10%</option>
              </NativeSelect>
            </div>
            {field("Tiền thuế (₫)", "vatAmount", "number")}
          </div>
          {field("Tổng thanh toán (₫)", "total", "number")}
          <div className="space-y-1">
            <Label className="text-xs">Thanh toán</Label>
            <NativeSelect
              value={f.paymentMethod}
              onChange={(e) => setF({ ...f, paymentMethod: e.target.value as HqPaymentMethod })}
            >
              <option value="BANK">Chuyển khoản / thẻ</option>
              <option value="CASH">Tiền mặt</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Khoản mục chi</Label>
            <NativeSelect
              value={f.expenseCategory}
              onChange={(e) => setF({ ...f, expenseCategory: e.target.value })}
            >
              {HQ_EXPENSE_CATEGORIES.filter((c) => !c.autoOnly).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.isForeign}
              onChange={(e) => setF({ ...f, isForeign: e.target.checked })}
            />
            Nhà cung cấp nước ngoài (thuế nhà thầu)
          </label>
        </div>
        {invoice.currency && (
          <p className="text-xs text-muted-foreground">
            Số gốc {invoice.amountOriginal?.toLocaleString("vi-VN")} {invoice.currency}
            {invoice.fxRate ? ` × tỷ giá tham khảo ${invoice.fxRate.toLocaleString("vi-VN")}` : ""} —
            sửa Tổng theo số ngân hàng trừ thật trên sao kê.
          </p>
        )}
        {cashWarn && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Tiền mặt từ {formatMoney(CASH_DEDUCT_LIMIT)} trở lên KHÔNG được khấu trừ thuế GTGT.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Đóng
          </Button>
          <Button variant="outline" onClick={() => save(false)} disabled={saving}>
            Lưu
          </Button>
          <Button onClick={() => save(true)} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Lưu & duyệt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Dialog xuất bộ chứng từ ----------------

function ExportDialog({
  rows,
  range,
  onClose,
  onDone,
}: {
  rows: HqInputInvoice[];
  range: DateRange | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const declared = rows.filter((r) => r.declaredPeriod);
  const [includeDeclared, setIncludeDeclared] = useState(false);
  const [mark, setMark] = useState(true);
  const [period, setPeriod] = useState(suggestPeriod(range));
  const [busy, setBusy] = useState(false);
  const chosen = includeDeclared ? rows : rows.filter((r) => !r.declaredPeriod);
  const pendingCount = chosen.filter((r) => r.reviewStatus === "PENDING").length;

  async function run() {
    if (chosen.length === 0) {
      toast.info("Không còn hóa đơn nào để xuất");
      return;
    }
    if (mark && !/^\d{4}-(Q[1-4]|(0[1-9]|1[0-2]))$/.test(period)) {
      toast.error("Kỳ khai phải dạng 2026-Q3 hoặc 2026-09");
      return;
    }
    setBusy(true);
    try {
      const ids = chosen.map((r) => r.id);
      const blob = await exportHqInputInvoices(ids, mark ? period : "chung-tu");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hubsell-hoa-don-dau-vao-${mark ? period : "chung-tu"}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      if (mark) {
        await declareHqInputInvoices(ids, period);
        toast.success(`Đã xuất ${ids.length} hóa đơn và tích "đã khai kỳ ${periodLabel(period)}"`);
      } else {
        toast.success(`Đã xuất ${ids.length} hóa đơn (chưa tích đã khai)`);
      }
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xuất được");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xuất bộ chứng từ</DialogTitle>
          <DialogDescription>
            Zip gồm tệp gốc + bảng kê CSV (GTGT trong nước và nhà thầu nước ngoài tách riêng) để
            gửi kế toán.
          </DialogDescription>
        </DialogHeader>
        {declared.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-semibold">
              {declared.length} hóa đơn trong khoảng này ĐÃ khai thuế (
              {[...new Set(declared.map((r) => periodLabel(r.declaredPeriod!)))].join(", ")}) — mặc
              định loại khỏi bản xuất để không khai hai lần.
            </p>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeDeclared}
                onChange={(e) => setIncludeDeclared(e.target.checked)}
              />
              Vẫn gồm các tờ đã khai
            </label>
          </div>
        )}
        <p className="text-sm">
          Sẽ xuất <b>{chosen.length}</b> hóa đơn · tổng {formatMoney(chosen.reduce((s, r) => s + r.total, 0))}
          {pendingCount > 0 && (
            <span className="text-amber-700"> · {pendingCount} tờ máy đọc chưa duyệt</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} />
            <span>
              Đánh dấu các tờ này là <b>đã khai thuế</b> kỳ
            </span>
          </label>
          <Input className="w-28" value={period} onChange={(e) => setPeriod(e.target.value)} disabled={!mark} />
        </div>
        <p className="text-xs text-muted-foreground">
          Không tích = vẫn coi là chưa khai. Tích rồi thì lần xuất sau sẽ cảnh báo và loại các tờ này.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Hủy
          </Button>
          <Button onClick={run} disabled={busy || chosen.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Tải zip{mark ? " & tích đã khai" : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tiêu đề cột bấm để sắp xếp (cao→thấp, bấm nữa thấp→cao). */
function SortHead({
  k,
  sort,
  onToggle,
  className,
  children,
}: {
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onToggle: (k: SortKey) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableHead className={className}>
      <button type="button" className="inline-flex items-center gap-1" onClick={() => onToggle(k)}>
        {children}
        {sort.key === k &&
          (sort.dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </TableHead>
  );
}

// ---------------- Tab chính ----------------

export function InputInvoicesSection() {
  const [range, setRange] = useState<DateRange | null>(currentQuarterRange);
  const [data, setData] = useState<HqInputInvoiceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [chip, setChip] = useState<Chip>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "invoiceDate", dir: "desc" });
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<HqInputInvoice | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchHqInputInvoices({ ...rangeToQuery(range ?? undefined) }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tải được danh sách");
    } finally {
      setLoading(false);
    }
  }, [range]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setPage(1), [chip, range, pageSize]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: items.length,
      undeclared: items.filter((r) => !r.declaredPeriod).length,
      declared: items.filter((r) => r.declaredPeriod).length,
      pending: items.filter((r) => r.reviewStatus === "PENDING").length,
      foreign: items.filter((r) => r.isForeign).length,
    }),
    [items]
  );
  const filtered = useMemo(() => {
    const list = items.filter((r) => {
      if (chip === "undeclared") return !r.declaredPeriod;
      if (chip === "declared") return Boolean(r.declaredPeriod);
      if (chip === "pending") return r.reviewStatus === "PENDING";
      if (chip === "foreign") return r.isForeign;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      // Giá trị thiếu (chưa đọc được ngày/tên) xếp cuối ở cả hai chiều
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || av === "") return 1;
      if (bv === null || bv === "") return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "vi") * dir;
    });
  }, [items, chip, sort]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));

  function toggleSort(key: SortKey) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  }

  async function handleFiles(files: File[]) {
    setUploading(true);
    try {
      const { results } = await uploadHqInputInvoices(files);
      const created = results.filter((r) => r.status === "created").length;
      const merged = results.filter((r) => r.status === "merged").length;
      const errors = results.filter((r) => r.status === "error");
      const warn = results.filter((r) => r.status === "created" && r.message);
      if (created || merged) {
        toast.success(
          [`Đã nạp ${created} hóa đơn`, merged ? `${merged} tệp gộp vào tờ có sẵn` : null]
            .filter(Boolean)
            .join(" · ")
        );
      }
      for (const w of warn) toast.warning(`${w.fileName}: ${w.message}`);
      for (const e of errors) toast.error(`${e.fileName}: ${e.message}`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không nạp được tệp");
    } finally {
      setUploading(false);
    }
  }

  async function openFile(inv: HqInputInvoice, fileId: string) {
    try {
      const { url } = await fetchHqInputInvoiceFileUrl(inv.id, fileId);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không mở được tệp");
    }
  }

  async function approve(inv: HqInputInvoice) {
    setBusyId(inv.id);
    try {
      await updateHqInputInvoice(inv.id, { approve: true });
      toast.success("Đã duyệt");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không duyệt được");
    } finally {
      setBusyId(null);
    }
  }

  async function undeclare(inv: HqInputInvoice) {
    if (!window.confirm(`Bỏ dấu "đã khai kỳ ${periodLabel(inv.declaredPeriod!)}" của hóa đơn này? (có ghi nhật ký)`)) return;
    setBusyId(inv.id);
    try {
      await updateHqInputInvoice(inv.id, { declaredPeriod: null });
      toast.success("Đã bỏ dấu khai thuế");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không bỏ được");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(inv: HqInputInvoice) {
    if (!window.confirm("Xóa hóa đơn này cùng tệp gốc và phiếu chi trong sổ quỹ?")) return;
    setBusyId(inv.id);
    try {
      await deleteHqInputInvoice(inv.id);
      toast.success("Đã xóa");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xóa được");
    } finally {
      setBusyId(null);
    }
  }

  const exportRows = selected.size > 0 ? items.filter((r) => selected.has(r.id)) : filtered;
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  const chips: [Chip, string, number][] = [
    ["all", "Tất cả", counts.all],
    ["undeclared", "Chưa khai thuế", counts.undeclared],
    ["pending", "Máy đọc chờ duyệt", counts.pending],
    ["foreign", "Nhà thầu nước ngoài", counts.foreign],
    ["declared", "Đã khai", counts.declared],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Hóa đơn đầu vào của công ty</p>
          <p className="text-xs text-muted-foreground">
            Chứng từ mua vào (chữ ký số, Supabase, Render…) — lưu vĩnh viễn, máy đọc số, xuất
            bộ chứng từ theo kỳ để kế toán khai thuế.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountingPeriodPicker allowAll value={range} onChange={setRange} disabled={loading} />
          <Button variant="outline" onClick={() => setExporting(true)} disabled={loading || exportRows.length === 0}>
            <Download className="size-4" />
            Xuất bộ chứng từ{selected.size > 0 ? ` (${selected.size} đã chọn)` : ""}
          </Button>
        </div>
      </div>

      <DropZone disabled={!(data?.storageReady ?? true)} busy={uploading} onFiles={handleFiles} />
      {data && !data.storageReady && (
        <p className="text-xs text-rose-600">Kho tệp Supabase Storage chưa cấu hình trên máy chủ — chưa nạp được.</p>
      )}
      {data && data.storageReady && !data.aiReady && (
        <p className="text-xs text-amber-700">
          Chưa đặt ANTHROPIC_API_KEY_HQ — XML vẫn đọc được, PDF/ảnh chỉ lưu tệp rồi chờ nhập tay.
        </p>
      )}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Số hóa đơn" value={formatCount(data.totals.count)} hint="Trong khoảng đang xem" />
          <StatCard label="Tổng thanh toán" value={formatMoney(data.totals.total)} hint="Đã quy đổi VND" />
          <StatCard label="Thuế GTGT đầu vào" value={formatMoney(data.totals.vat)} hint="Hóa đơn trong nước — số được khấu trừ tối đa" />
          <StatCard
            label="Chưa khai thuế"
            value={formatCount(data.totals.undeclared)}
            hint={data.totals.pending > 0 ? `${data.totals.pending} tờ máy đọc chờ duyệt` : "Duyệt xong là sẵn sàng xuất"}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {chips.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setChip(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              chip === key ? "border-primary bg-primary text-primary-foreground" : "border-slate-200 bg-card text-slate-600 hover:bg-slate-50"
            )}
          >
            {label} <span className="opacity-70">{n}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>Dòng/trang</span>
          <NativeSelect className="w-20" value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number])}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading && !data ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải…</p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Chưa có hóa đơn nào trong khoảng này — thả tệp vào ô phía trên.
            </p>
          ) : (
            <div className={PNL_TABLE_SCROLLER}>
              <Table>
                <TableHeader className={cn(PNL_STICKY_HEAD, "bg-card")}>
                  <TableRow>
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={(e) => {
                          const next = new Set(selected);
                          for (const r of pageRows) {
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                          }
                          setSelected(next);
                        }}
                      />
                    </TableHead>
                    <SortHead k="invoiceDate" sort={sort} onToggle={toggleSort}>Ngày HĐ</SortHead>
                    <TableHead>Số · Ký hiệu</TableHead>
                    <SortHead k="sellerName" sort={sort} onToggle={toggleSort}>Nhà cung cấp</SortHead>
                    <TableHead>Nội dung</TableHead>
                    <TableHead className="text-right">
                      Chưa thuế
                      <span className="block font-normal text-muted-foreground">Thuế GTGT</span>
                    </TableHead>
                    <SortHead k="total" sort={sort} onToggle={toggleSort} className="text-right">
                      Tổng
                    </SortHead>
                    <TableHead>Tệp</TableHead>
                    <TableHead>Nguồn</TableHead>
                    <TableHead>Khai thuế</TableHead>
                    <TableHead className="text-right">Sửa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => {
                    const busy = busyId === r.id;
                    return (
                      <TableRow key={r.id} className={cn(r.reviewStatus === "PENDING" && "bg-amber-50/40")}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(r.id);
                              else next.delete(r.id);
                              setSelected(next);
                            }}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{formatDay(r.invoiceDate)}</TableCell>
                        <TableCell className="text-sm">
                          {r.invoiceNo ? (
                            <span className="inline-flex items-center gap-1 font-mono">
                              {r.invoiceNo}
                              <CopyIconButton value={r.invoiceNo} what="số hóa đơn" />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {r.invoiceSerial && <p className="text-xs text-muted-foreground">{r.invoiceSerial}</p>}
                        </TableCell>
                        <TableCell className="max-w-[190px] text-sm">
                          <p className="truncate" title={r.sellerName ?? undefined}>
                            {r.sellerName ?? <span className="text-muted-foreground">(chưa rõ)</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.isForeign ? (
                              <span className="rounded border border-violet-200 bg-violet-50 px-1.5 text-violet-700">Nhà thầu NN</span>
                            ) : r.sellerTaxCode ? (
                              <span className="inline-flex items-center gap-1">
                                MST {r.sellerTaxCode}
                                <CopyIconButton value={r.sellerTaxCode} what="MST" />
                              </span>
                            ) : (
                              "—"
                            )}
                          </p>
                        </TableCell>
                        <TableCell className="max-w-[200px] text-sm">
                          <p className="truncate" title={r.description ?? undefined}>
                            {r.description ?? "—"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {r.expenseCategory ? HQ_EXPENSE_CATEGORY_LABEL[r.expenseCategory] : "Chưa phân khoản mục"}
                            {r.paymentMethod === "CASH" ? " · Tiền mặt" : ""}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                          {formatMoney(r.subtotal)}
                          <p className="text-xs text-muted-foreground">
                            {formatMoney(r.vatAmount)}
                            {r.vatRate ? ` (${r.vatRate === "KCT" ? "KCT" : `${r.vatRate}%`})` : ""}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">
                          {formatMoney(r.total)}
                          {r.currency && (
                            <p className="text-xs font-normal text-muted-foreground">
                              {r.amountOriginal?.toLocaleString("vi-VN")} {r.currency}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {r.files.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                title={f.fileName}
                                onClick={() => openFile(r, f.id)}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs hover:bg-slate-50"
                              >
                                <FileText className="size-3" />
                                {f.kind}
                                <ExternalLink className="size-2.5 opacity-60" />
                              </button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.reviewStatus === "APPROVED" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="size-3.5" /> Đã duyệt
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => approve(r)}
                              title={r.readerNote ?? "Xác nhận số máy đọc là đúng"}
                              className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-100"
                            >
                              {busy ? "…" : "Duyệt"}
                            </button>
                          )}
                          <p className="text-muted-foreground" title={r.readerNote ?? undefined}>
                            {SOURCE_LABEL[r.source]}
                            {r.readerNote ? " · có ghi chú" : ""}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.declaredPeriod ? (
                            <div>
                              <span
                                className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"
                                title={`${r.declaredAt ? formatDateTime(r.declaredAt) : ""} · ${r.declaredByName ?? ""}`}
                              >
                                Đã khai {periodLabel(r.declaredPeriod)}
                              </span>
                              <button type="button" disabled={busy} onClick={() => undeclare(r)} className="ml-1 text-muted-foreground underline-offset-2 hover:underline">
                                bỏ
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Chưa khai</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                            <Button variant="ghost" size="icon" title="Sửa" onClick={() => setEditing(r)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Xóa" disabled={busy || Boolean(r.declaredPeriod)} onClick={() => remove(r)}>
                              <Trash2 className="size-4 text-rose-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Trước
          </Button>
          <span>
            Trang {page}/{pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Sau
          </Button>
        </div>
      )}

      {editing && <EditDialog invoice={editing} onClose={() => setEditing(null)} onSaved={load} />}
      {exporting && (
        <ExportDialog
          rows={exportRows}
          range={range}
          onClose={() => setExporting(false)}
          onDone={() => {
            setSelected(new Set());
            void load();
          }}
        />
      )}
    </div>
  );
}
