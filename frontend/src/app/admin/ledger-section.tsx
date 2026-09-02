"use client";

// SỔ QUỸ NỘI BỘ (GĐ5) — khối trung tâm của trang Kế toán: mỗi dòng một khoản
// tiền vào/ra của CHÍNH công ty Hubsell theo tháng. Chi hoa hồng tự sinh từ
// duyệt lệnh rút; thu phí gói/khoản khác kế toán ghi tay. Mỗi khoản THU mang
// nghĩa vụ hóa đơn (Chưa xuất → Đã xuất kèm số HĐ). Mỗi khoản CHI mang KHOẢN
// MỤC (thuê VP/lương/bảo hiểm/phần mềm...) + chứng từ đầu vào (NCC, MST, số
// HĐ, CK/TM) — kế toán dịch vụ nhìn sổ là lên được bảng kê, không phải bới
// diễn giải. Chi phí CỐ ĐỊNH hàng tháng có checklist nhắc + "Ghi ngay" prefill
// (không tự sinh bút toán — số thật phải theo chứng từ từng tháng). Xuất Excel
// đúng layout sổ thu/chi kèm sheet tổng hợp khoản mục để nộp kê khai thuế.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  FileSpreadsheet,
  Loader2,
  NotebookPen,
  Pencil,
  ReceiptText,
  Settings2,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  ApiError,
  createLedgerEntry,
  createRecurringExpense,
  deleteLedgerEntry,
  deleteRecurringExpense,
  fetchRecurringExpenses,
  updateLedgerEntry,
  updateRecurringExpense,
  type HqPaymentMethod,
  type HqRecurringExpense,
  type HqRecurringStatusRow,
  type LedgerDirection,
  type LedgerInvoiceStatus,
  type PlatformLedgerEntry,
  type PlatformLedgerResponse,
} from "@/lib/api";
import { exportLedgerToExcel } from "@/lib/excel";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CASH_DEDUCT_LIMIT,
  HQ_EXPENSE_CATEGORIES,
  HQ_EXPENSE_CATEGORY_LABEL,
  displayExpenseCategory,
} from "./hq-expense-categories";
import {
  HqInvoiceConfigDialog,
  HqInvoicePdfButton,
  HqIssueInvoiceDialog,
} from "./hq-invoice";
import { StatCard, formatCount, formatMoney } from "./shared";

const SOURCE_LABEL: Record<string, string> = {
  SUBSCRIPTION: "Thu phí gói dịch vụ",
  REFERRAL_PAYOUT: "Chi hoa hồng giới thiệu",
  OTHER: "Khoản khác",
};

/** "yyyy-mm-dd" cho input type=date từ chuỗi ISO. */
function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Dialog phiếu thu/chi (ghi tay) + sửa bút toán ----------

/** Prefill phiếu CHI từ checklist chi cố định ("Ghi ngay"). */
export interface LedgerEntryPreset {
  amount: number;
  note: string;
  expenseCategory: string;
  vendorName: string | null;
  recurringExpenseId: string;
}

function LedgerEntryDialog({
  entry,
  preset,
  onClose,
  onSaved,
}: {
  /** Có entry = SỬA; không có = GHI MỚI. */
  entry: PlatformLedgerEntry | null;
  /** Chỉ dùng khi GHI MỚI — prefill phiếu chi cố định. */
  preset?: LedgerEntryPreset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = entry !== null;
  // Bút toán tự sinh từ lệnh rút: nguồn sự thật là lệnh rút — chỉ sửa diễn giải.
  const autoLocked = isEdit && entry.withdrawalRequestId !== null;
  // Bút toán tự sinh từ thanh toán gói: tiền/ngày theo chứng từ thanh toán —
  // khóa lại, nhưng VẪN cho đánh dấu hóa đơn (nghĩa vụ hóa đơn nằm trên sổ).
  const paymentLocked = isEdit && entry.packagePaymentId !== null;

  const [direction, setDirection] = useState<LedgerDirection>(
    entry?.direction ?? (preset ? "OUT" : "IN")
  );
  const [source, setSource] = useState<"SUBSCRIPTION" | "OTHER">(
    entry ? (entry.source === "OTHER" ? "OTHER" : "SUBSCRIPTION") : preset ? "OTHER" : "SUBSCRIPTION"
  );
  const [amount, setAmount] = useState(
    entry ? String(entry.amount) : preset ? String(preset.amount) : ""
  );
  const [occurredAt, setOccurredAt] = useState(
    entry ? toDateInput(entry.occurredAt) : toDateInput(new Date().toISOString())
  );
  const [customerEmail, setCustomerEmail] = useState(
    entry?.customer?.email ?? ""
  );
  const [note, setNote] = useState(entry?.note ?? preset?.note ?? "");
  const [invoiceStatus, setInvoiceStatus] = useState<LedgerInvoiceStatus>(
    entry ? entry.invoiceStatus : preset ? "NONE" : "PENDING"
  );
  const [invoiceNo, setInvoiceNo] = useState(entry?.invoiceNo ?? "");
  // Khoản mục + chứng từ đầu vào của phiếu CHI.
  const [expenseCategory, setExpenseCategory] = useState(
    entry
      ? entry.direction === "OUT"
        ? displayExpenseCategory(entry)
        : "OTHER_EXPENSE"
      : preset?.expenseCategory ?? "OTHER_EXPENSE"
  );
  const [vendorName, setVendorName] = useState(
    entry?.vendorName ?? preset?.vendorName ?? ""
  );
  const [vendorTaxCode, setVendorTaxCode] = useState(entry?.vendorTaxCode ?? "");
  const [inputInvoiceNo, setInputInvoiceNo] = useState(entry?.inputInvoiceNo ?? "");
  const [paymentMethod, setPaymentMethod] = useState<HqPaymentMethod>(
    entry?.paymentMethod ?? "BANK"
  );
  const [submitting, setSubmitting] = useState(false);

  // Đổi chiều dòng tiền lúc GHI MỚI → nguồn & nghĩa vụ hóa đơn đổi theo cho hợp lý.
  useEffect(() => {
    if (isEdit) return;
    if (direction === "OUT") {
      setSource("OTHER");
      setInvoiceStatus("NONE");
    } else {
      setSource("SUBSCRIPTION");
      setInvoiceStatus("PENDING");
    }
  }, [direction, isEdit]);

  const isOut = direction === "OUT";
  const categoryHint = HQ_EXPENSE_CATEGORIES.find((c) => c.key === expenseCategory)?.hint;
  // Luật GTGT: mua vào ≥5tr trả tiền mặt là mất quyền khấu trừ — nhắc ngay lúc ghi.
  const cashWarning =
    isOut && paymentMethod === "CASH" && Math.floor(Number(amount)) >= CASH_DEDUCT_LIMIT;

  async function handleSave() {
    const value = Math.floor(Number(amount));
    if (!autoLocked && !paymentLocked && (!Number.isFinite(value) || value <= 0)) {
      toast.error("Số tiền phải là số dương");
      return;
    }
    // Trường phiếu CHI — chỉ gửi khi bút toán là chiều OUT (backend chặn chiều IN).
    const expenseFields = isOut
      ? {
          expenseCategory,
          vendorName: vendorName.trim() || undefined,
          vendorTaxCode: vendorTaxCode.trim() || undefined,
          inputInvoiceNo: inputInvoiceNo.trim() || undefined,
          paymentMethod,
        }
      : {};
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateLedgerEntry(entry.id, {
          note,
          ...(autoLocked
            ? {}
            : paymentLocked
              ? { invoiceStatus, invoiceNo }
              : {
                  amount: value,
                  occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
                  invoiceStatus,
                  invoiceNo,
                  ...expenseFields,
                }),
        });
        toast.success("Đã cập nhật bút toán");
      } else {
        await createLedgerEntry({
          direction,
          source,
          amount: value,
          note: note.trim() || undefined,
          customerEmail: customerEmail.trim() || undefined,
          occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
          invoiceStatus,
          invoiceNo: invoiceNo.trim() || undefined,
          recurringExpenseId: preset?.recurringExpenseId,
          ...expenseFields,
        });
        toast.success(direction === "IN" ? "Đã ghi phiếu thu" : "Đã ghi phiếu chi");
      }
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="size-5" />
            {isEdit ? "Sửa bút toán" : "Ghi phiếu thu / phiếu chi"}
          </DialogTitle>
          <DialogDescription>
            {autoLocked
              ? "Bút toán tự sinh từ lệnh rút — chỉ sửa được diễn giải."
              : paymentLocked
                ? "Bút toán tự sinh từ thanh toán gói — số tiền/ngày theo chứng từ; sửa được diễn giải và hóa đơn."
                : "Khoản THU từ khách sẽ tự mang nghĩa vụ xuất hóa đơn (Chưa xuất) cho tới khi anh/chị điền số hóa đơn."}
          </DialogDescription>
        </DialogHeader>

        {!autoLocked && !paymentLocked && (
          <>
            <div className="grid gap-2">
              <Label>Loại</Label>
              <div className="flex gap-1.5">
                {(
                  [
                    ["IN", "Tiền VÀO (thu)"],
                    ["OUT", "Tiền RA (chi)"],
                  ] as [LedgerDirection, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={isEdit}
                    onClick={() => setDirection(value)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60",
                      direction === value
                        ? value === "IN"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-rose-300 bg-rose-50 text-rose-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {!isEdit && !isOut && (
              <div className="grid gap-2">
                <Label>Nguồn</Label>
                <NativeSelect
                  value={source}
                  onChange={(e) => setSource(e.target.value as "SUBSCRIPTION" | "OTHER")}
                >
                  <option value="SUBSCRIPTION">Thu phí gói dịch vụ</option>
                  <option value="OTHER">Khoản khác</option>
                </NativeSelect>
              </div>
            )}

            {isOut && (
              <div className="grid gap-2">
                <Label>Khoản mục chi</Label>
                <NativeSelect
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                >
                  {HQ_EXPENSE_CATEGORIES.filter((c) => !c.autoOnly).map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
                {categoryHint && (
                  <p className="text-xs text-muted-foreground">{categoryHint}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Số tiền (₫)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="vd: 199000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Ngày phát sinh</Label>
                <Input
                  type="date"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              </div>
            </div>

            {isOut && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Nhà cung cấp / người nhận</Label>
                    <Input
                      placeholder="vd: Cty CP ABC"
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>MST nhà cung cấp</Label>
                    <Input
                      placeholder="vd: 0101234567"
                      value={vendorTaxCode}
                      onChange={(e) => setVendorTaxCode(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Số HĐ đầu vào (nếu có)</Label>
                    <Input
                      placeholder="vd: 1C26TAB-102"
                      value={inputInvoiceNo}
                      onChange={(e) => setInputInvoiceNo(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Hình thức thanh toán</Label>
                    <div className="flex gap-1.5">
                      {(
                        [
                          ["BANK", "Chuyển khoản"],
                          ["CASH", "Tiền mặt"],
                        ] as [HqPaymentMethod, string][]
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPaymentMethod(value)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                            paymentMethod === value
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-slate-200 text-slate-500 hover:border-slate-300"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {cashWarning && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    Khoản mua từ 5 triệu trả TIỀN MẶT sẽ không được khấu trừ thuế
                    GTGT / tính chi phí được trừ — nên chuyển khoản từ tài khoản
                    công ty.
                  </p>
                )}
              </>
            )}

            {!isEdit && !isOut && (
              <div className="grid gap-2">
                <Label>Email khách hàng (nếu có)</Label>
                <Input
                  type="email"
                  placeholder="Email chủ shop trả tiền / nhận tiền"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                />
              </div>
            )}
          </>
        )}

        <div className="grid gap-2">
          <Label>Diễn giải</Label>
          <Input
            placeholder="vd: Thu phí gói Professional 12 tháng — CK Vietcombank"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {!autoLocked && direction === "IN" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Hóa đơn</Label>
              <NativeSelect
                value={invoiceStatus}
                onChange={(e) => setInvoiceStatus(e.target.value as LedgerInvoiceStatus)}
              >
                <option value="PENDING">Chưa xuất</option>
                <option value="ISSUED">Đã xuất</option>
                <option value="NONE">Không cần</option>
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label>Số hóa đơn</Label>
              <Input
                placeholder="vd: 1C26THY-25"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "Lưu bút toán" : "Ghi vào sổ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Checklist chi phí cố định hàng tháng ----------

/** Trạng thái một khoản cố định trong THÁNG đang xem. */
function recurringStatus(
  row: HqRecurringStatusRow,
  month: string
): { label: string; tone: "done" | "late" | "wait" | "future" } {
  if (row.loggedEntry) return { label: "Đã chi", tone: "done" };
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (month < current) return { label: "Chưa ghi sổ", tone: "late" };
  if (month > current) return { label: "Chưa tới kỳ", tone: "future" };
  if (now.getDate() > row.dayOfMonth)
    return { label: `Quá hạn (ngày ${row.dayOfMonth})`, tone: "late" };
  return { label: `Hạn ngày ${row.dayOfMonth}`, tone: "wait" };
}

const RECURRING_TONE_CLASS: Record<string, string> = {
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  late: "border-rose-200 bg-rose-50 text-rose-700",
  wait: "border-amber-300 bg-amber-50 text-amber-700",
  future: "border-slate-200 bg-slate-50 text-slate-500",
};

function RecurringPanel({
  rows,
  month,
  onLog,
  onManage,
}: {
  rows: HqRecurringStatusRow[];
  month: string;
  onLog: (preset: LedgerEntryPreset) => void;
  onManage: () => void;
}) {
  const totalExpected = rows.reduce((s, r) => s + r.expectedAmount, 0);
  const pending = rows.filter((r) => !r.loggedEntry).length;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="size-4" />
            Chi phí cố định tháng {month.slice(5)}
          </p>
          <p className="text-xs text-muted-foreground">
            {rows.length === 0
              ? "Khai một lần các khoản lặp hàng tháng (thuê VP, lương, bảo hiểm, phần mềm…) — mỗi tháng chỉ việc bấm ghi."
              : pending === 0
                ? `Đủ ${rows.length}/${rows.length} khoản đã ghi sổ — dự kiến ${formatMoney(totalExpected)}/tháng.`
                : `Còn ${pending}/${rows.length} khoản chưa ghi — dự kiến ${formatMoney(totalExpected)}/tháng.`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onManage}>
          <Settings2 className="size-4" />
          Danh mục
        </Button>
      </div>
      {rows.length > 0 && (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => {
            const st = recurringStatus(r, month);
            return (
              <div key={r.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {HQ_EXPENSE_CATEGORY_LABEL[r.category] ?? r.category}
                    {r.vendorName ? ` · ${r.vendorName}` : ""}
                  </p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold tabular-nums">
                  {formatMoney(r.loggedEntry ? r.loggedEntry.amount : r.expectedAmount)}
                  {!r.loggedEntry && (
                    <span className="font-normal text-muted-foreground"> dự kiến</span>
                  )}
                </p>
                <span
                  className={cn(
                    "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                    RECURRING_TONE_CLASS[st.tone]
                  )}
                >
                  {st.label}
                </span>
                {!r.loggedEntry && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onLog({
                        amount: r.expectedAmount,
                        note: `${r.name} — tháng ${month.slice(5)}/${month.slice(0, 4)}`,
                        expenseCategory: r.category,
                        vendorName: r.vendorName,
                        recurringExpenseId: r.id,
                      })
                    }
                  >
                    Ghi ngay
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      </CardContent>
    </Card>
  );
}

// ---------- Cơ cấu chi theo khoản mục ----------

function CategoryBreakdown({
  byCategory,
  totalOut,
  month,
}: {
  byCategory: { key: string; out: number }[];
  totalOut: number;
  month: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold">Cơ cấu chi tháng {month.slice(5)}</p>
          <p className="text-xs text-muted-foreground">
            Tiền ra gom theo khoản mục — đúng nhóm kế toán cần khi kê khai.
          </p>
        </div>
        {byCategory.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Tháng này chưa có khoản chi nào.
          </p>
        ) : (
          <div className="space-y-2">
            {byCategory.map((c) => {
              const pct = totalOut > 0 ? Math.round((c.out / totalOut) * 100) : 0;
              return (
                <div key={c.key}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">
                      {HQ_EXPENSE_CATEGORY_LABEL[c.key] ?? c.key}
                    </span>
                    <span className="whitespace-nowrap font-semibold tabular-nums">
                      {formatMoney(c.out)}
                      <span className="ml-1 font-normal text-muted-foreground">{pct}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-rose-400/80"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Dialog quản lý danh mục chi cố định ----------

const EMPTY_RECURRING_FORM = {
  id: null as string | null,
  name: "",
  category: "RENT",
  expectedAmount: "",
  dayOfMonth: "5",
  vendorName: "",
  note: "",
};

function RecurringManageDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** Gọi khi danh mục thay đổi — trang ngoài refetch để checklist cập nhật. */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<HqRecurringExpense[] | null>(null);
  const [form, setForm] = useState(EMPTY_RECURRING_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetchRecurringExpenses();
      setItems(res.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tải được danh mục");
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function handleSubmit() {
    const value = Math.floor(Number(form.expectedAmount));
    if (!form.name.trim()) {
      toast.error("Nhập tên khoản chi (vd: Thuê văn phòng)");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Số tiền dự kiến phải là số dương");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        expectedAmount: value,
        dayOfMonth: Math.floor(Number(form.dayOfMonth)) || 5,
        vendorName: form.vendorName.trim() || undefined,
        note: form.note.trim() || undefined,
      };
      if (form.id) {
        await updateRecurringExpense(form.id, payload);
        toast.success("Đã cập nhật khoản chi cố định");
      } else {
        await createRecurringExpense(payload);
        toast.success("Đã thêm khoản chi cố định");
      }
      setForm(EMPTY_RECURRING_FORM);
      await reload();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(item: HqRecurringExpense) {
    setBusyId(item.id);
    try {
      await updateRecurringExpense(item.id, { active: !item.active });
      await reload();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không cập nhật được");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(item: HqRecurringExpense) {
    setBusyId(item.id);
    try {
      await deleteRecurringExpense(item.id);
      toast.success("Đã xoá khỏi danh mục — bút toán đã ghi không bị ảnh hưởng");
      await reload();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xoá được");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5" />
            Danh mục chi phí cố định hàng tháng
          </DialogTitle>
          <DialogDescription>
            Khai một lần — mỗi tháng checklist sẽ nhắc và bấm &ldquo;Ghi ngay&rdquo;
            là ra phiếu chi điền sẵn. Số tiền ở đây chỉ là DỰ KIẾN, số thật sửa
            lúc ghi theo chứng từ.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 rounded-lg border border-slate-200/80 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Tên khoản chi</Label>
              <Input
                placeholder="vd: Thuê văn phòng tầng 3"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Khoản mục</Label>
              <NativeSelect
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {HQ_EXPENSE_CATEGORIES.filter((c) => !c.autoOnly).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Dự kiến (₫/tháng)</Label>
              <Input
                type="number"
                min={1}
                placeholder="vd: 8000000"
                value={form.expectedAmount}
                onChange={(e) => setForm({ ...form, expectedAmount: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Hạn chi (ngày 1–28)</Label>
              <Input
                type="number"
                min={1}
                max={28}
                value={form.dayOfMonth}
                onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Nhà cung cấp</Label>
              <Input
                placeholder="vd: Chủ nhà A"
                value={form.vendorName}
                onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div className="grid flex-1 gap-2">
              <Label>Ghi chú</Label>
              <Input
                placeholder="vd: HĐ thuê số 12/2026, hết hạn 31/12"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            {form.id && (
              <Button
                variant="outline"
                onClick={() => setForm(EMPTY_RECURRING_FORM)}
                disabled={saving}
              >
                Huỷ sửa
              </Button>
            )}
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {form.id ? "Lưu thay đổi" : "Thêm khoản chi"}
            </Button>
          </div>
        </div>

        {items === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Đang tải…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa có khoản chi cố định nào — thêm khoản đầu tiên ở trên.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", !item.active && "text-muted-foreground line-through")}>
                    {item.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {HQ_EXPENSE_CATEGORY_LABEL[item.category] ?? item.category} · hạn
                    ngày {item.dayOfMonth}
                    {item.vendorName ? ` · ${item.vendorName}` : ""}
                  </p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold tabular-nums">
                  {formatMoney(item.expectedAmount)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === item.id}
                  onClick={() =>
                    setForm({
                      id: item.id,
                      name: item.name,
                      category: item.category,
                      expectedAmount: String(item.expectedAmount),
                      dayOfMonth: String(item.dayOfMonth),
                      vendorName: item.vendorName ?? "",
                      note: item.note ?? "",
                    })
                  }
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === item.id}
                  title={item.active ? "Tạm ngưng (không nhắc nữa)" : "Bật nhắc lại"}
                  onClick={() => handleToggle(item)}
                >
                  {item.active ? "Tạm ngưng" : "Bật lại"}
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-red-500"
                  disabled={busyId === item.id}
                  title="Xoá khỏi danh mục (bút toán đã ghi giữ nguyên)"
                  onClick={() => handleDelete(item)}
                >
                  {busyId === item.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Khối Sổ quỹ ----------

export function LedgerSection({
  data,
  loading,
  month,
  onMonthChange,
  onChanged,
}: {
  data: PlatformLedgerResponse | null;
  loading: boolean;
  month: string;
  onMonthChange: (m: string) => void;
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<
    | { mode: "create"; preset?: LedgerEntryPreset }
    | { mode: "edit"; entry: PlatformLedgerEntry }
    | null
  >(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [invoiceConfigOpen, setInvoiceConfigOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [issueEntry, setIssueEntry] = useState<PlatformLedgerEntry | null>(null);

  async function handleDelete(entry: PlatformLedgerEntry) {
    setDeletingId(entry.id);
    try {
      await deleteLedgerEntry(entry.id);
      toast.success("Đã xoá bút toán");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xoá được");
    } finally {
      setDeletingId(null);
    }
  }

  function handleExport() {
    if (!data || data.entries.length === 0) {
      toast.info("Sổ quỹ tháng này chưa có bút toán nào để xuất");
      return;
    }
    exportLedgerToExcel(data.entries, data.month);
    toast.success(`Đã xuất sổ quỹ tháng ${data.month} ra Excel`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Sổ quỹ Hubsell</p>
          <p className="text-xs text-muted-foreground">
            Tiền vào/ra của CHÍNH công ty — chi hoa hồng tự ghi khi duyệt lệnh
            rút, khoản thu ghi tay cho tới khi có cổng thanh toán.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            className="w-40"
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
          />
          <Button variant="outline" onClick={handleExport} disabled={loading}>
            <FileSpreadsheet className="size-4" />
            Xuất Excel
          </Button>
          <Button
            variant="outline"
            title="Cấu hình meInvoice của Hubsell (xuất HĐĐT bán gói)"
            onClick={() => setInvoiceConfigOpen(true)}
          >
            <Settings2 className="size-4" />
            meInvoice
          </Button>
          <Button onClick={() => setDialog({ mode: "create" })}>
            <NotebookPen className="size-4" />
            Ghi phiếu thu/chi
          </Button>
        </div>
      </div>

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`Tổng THU tháng ${data.month.slice(5)}`}
            value={formatMoney(data.totals.in)}
            hint="Tiền vào trong tháng"
          />
          <StatCard
            label={`Tổng CHI tháng ${data.month.slice(5)}`}
            value={formatMoney(data.totals.out)}
            hint="Tiền ra trong tháng"
          />
          <StatCard
            label="Chênh lệch thu − chi"
            value={formatMoney(data.totals.net)}
            hint={data.totals.net >= 0 ? "Dương — thu nhiều hơn chi" : "Âm — chi nhiều hơn thu"}
          />
          <StatCard
            label="Khoản thu CHƯA xuất hóa đơn"
            value={formatCount(data.totals.pendingInvoices)}
            hint="Phải bằng 0 trước khi chốt sổ tháng"
          />
        </div>
      )}

      {data && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <RecurringPanel
            rows={data.recurring}
            month={data.month}
            onLog={(preset) => setDialog({ mode: "create", preset })}
            onManage={() => setRecurringOpen(true)}
          />
          <CategoryBreakdown
            byCategory={data.byCategory}
            totalOut={data.totals.out}
            month={data.month}
          />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading && !data ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Đang tải dữ liệu…
            </p>
          ) : data && data.entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Tháng này chưa có bút toán nào — bấm &ldquo;Ghi phiếu thu/chi&rdquo; để
              ghi khoản đầu tiên.
            </p>
          ) : data ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ngày phát sinh</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Diễn giải</TableHead>
                  <TableHead>Khách hàng / Người nhận</TableHead>
                  <TableHead className="text-right">Số tiền</TableHead>
                  <TableHead>Hóa đơn</TableHead>
                  <TableHead>Người ghi</TableHead>
                  <TableHead className="text-right">Sửa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(e.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          e.direction === "IN"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        )}
                      >
                        {e.direction === "IN" ? "THU" : "CHI"}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[260px] text-sm">
                      <p className="truncate" title={e.note ?? undefined}>
                        {e.note ?? SOURCE_LABEL[e.source] ?? e.source}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {e.direction === "OUT"
                          ? HQ_EXPENSE_CATEGORY_LABEL[displayExpenseCategory(e)]
                          : SOURCE_LABEL[e.source] ?? e.source}
                        {e.direction === "OUT" && e.paymentMethod === "CASH"
                          ? " · Tiền mặt"
                          : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.customer ? (
                        <>
                          {e.customer.fullName}
                          <p className="text-xs text-muted-foreground">
                            {e.customer.email}
                          </p>
                        </>
                      ) : e.vendorName ? (
                        <>
                          {e.vendorName}
                          <p className="text-xs text-muted-foreground">
                            {[
                              e.vendorTaxCode ? `MST ${e.vendorTaxCode}` : null,
                              e.inputInvoiceNo ? `HĐ ${e.inputInvoiceNo}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Nhà cung cấp"}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap text-right font-semibold",
                        e.direction === "IN" ? "text-emerald-600" : "text-rose-600"
                      )}
                    >
                      {e.direction === "IN" ? "+" : "−"}
                      {formatMoney(e.amount)}
                    </TableCell>
                    <TableCell>
                      {e.invoiceStatus === "NONE" ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : e.invoiceStatus === "PENDING" ? (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                            Chưa xuất
                          </span>
                          {e.direction === "IN" && (
                            <Button
                              variant="outline"
                              size="icon-sm"
                              title="Xuất hóa đơn điện tử qua meInvoice"
                              onClick={() => setIssueEntry(e)}
                            >
                              <ReceiptText className="size-4" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span
                            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"
                            title={e.invoiceNo ?? undefined}
                          >
                            Đã xuất{e.invoiceNo ? ` · ${e.invoiceNo}` : ""}
                          </span>
                          {e.einvoiceTransactionId && <HqInvoicePdfButton entry={e} />}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {e.createdByName}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          title="Sửa bút toán"
                          onClick={() => setDialog({ mode: "edit", entry: e })}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {e.withdrawalRequestId === null && e.packagePaymentId === null && (
                          <Button
                            variant="outline"
                            size="icon-sm"
                            title="Xoá bút toán (chỉ bút toán ghi tay)"
                            className="text-muted-foreground hover:text-red-500"
                            disabled={deletingId === e.id}
                            onClick={() => handleDelete(e)}
                          >
                            {deletingId === e.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {dialog && (
        <LedgerEntryDialog
          entry={dialog.mode === "edit" ? dialog.entry : null}
          preset={dialog.mode === "create" ? dialog.preset ?? null : null}
          onClose={() => setDialog(null)}
          onSaved={onChanged}
        />
      )}

      {recurringOpen && (
        <RecurringManageDialog
          onClose={() => setRecurringOpen(false)}
          onChanged={onChanged}
        />
      )}

      {invoiceConfigOpen && (
        <HqInvoiceConfigDialog onClose={() => setInvoiceConfigOpen(false)} />
      )}

      {issueEntry && (
        <HqIssueInvoiceDialog
          entry={issueEntry}
          onClose={() => setIssueEntry(null)}
          onIssued={onChanged}
        />
      )}
    </div>
  );
}
