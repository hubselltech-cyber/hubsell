"use client";

// SỔ QUỸ NỘI BỘ (GĐ5) — khối trung tâm của trang Kế toán: mỗi dòng một khoản
// tiền vào/ra của CHÍNH công ty Hubsell theo tháng. Chi hoa hồng tự sinh từ
// duyệt lệnh rút; thu phí gói/khoản khác kế toán ghi tay. Mỗi khoản THU mang
// nghĩa vụ hóa đơn (Chưa xuất → Đã xuất kèm số HĐ). Xuất Excel đúng layout
// sổ thu/chi để nộp cho kế toán dịch vụ kê khai thuế.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FileSpreadsheet,
  Loader2,
  NotebookPen,
  Pencil,
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
  deleteLedgerEntry,
  updateLedgerEntry,
  type LedgerDirection,
  type LedgerInvoiceStatus,
  type PlatformLedgerEntry,
  type PlatformLedgerResponse,
} from "@/lib/api";
import { exportLedgerToExcel } from "@/lib/excel";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
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

function LedgerEntryDialog({
  entry,
  onClose,
  onSaved,
}: {
  /** Có entry = SỬA; không có = GHI MỚI. */
  entry: PlatformLedgerEntry | null;
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
    entry?.direction ?? "IN"
  );
  const [source, setSource] = useState<"SUBSCRIPTION" | "OTHER">(
    entry?.source === "OTHER" ? "OTHER" : "SUBSCRIPTION"
  );
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [occurredAt, setOccurredAt] = useState(
    entry ? toDateInput(entry.occurredAt) : toDateInput(new Date().toISOString())
  );
  const [customerEmail, setCustomerEmail] = useState(
    entry?.customer?.email ?? ""
  );
  const [note, setNote] = useState(entry?.note ?? "");
  const [invoiceStatus, setInvoiceStatus] = useState<LedgerInvoiceStatus>(
    entry?.invoiceStatus ?? "PENDING"
  );
  const [invoiceNo, setInvoiceNo] = useState(entry?.invoiceNo ?? "");
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

  async function handleSave() {
    const value = Math.floor(Number(amount));
    if (!autoLocked && !paymentLocked && (!Number.isFinite(value) || value <= 0)) {
      toast.error("Số tiền phải là số dương");
      return;
    }
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

            {!isEdit && (
              <div className="grid gap-2">
                <Label>Nguồn</Label>
                <NativeSelect
                  value={source}
                  onChange={(e) => setSource(e.target.value as "SUBSCRIPTION" | "OTHER")}
                >
                  {direction === "IN" && (
                    <option value="SUBSCRIPTION">Thu phí gói dịch vụ</option>
                  )}
                  <option value="OTHER">Khoản khác</option>
                </NativeSelect>
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

            {!isEdit && (
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
    { mode: "create" } | { mode: "edit"; entry: PlatformLedgerEntry } | null
  >(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
                      <p className="text-xs text-muted-foreground">
                        {SOURCE_LABEL[e.source] ?? e.source}
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
                        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                          Chưa xuất
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"
                          title={e.invoiceNo ?? undefined}
                        >
                          Đã xuất{e.invoiceNo ? ` · ${e.invoiceNo}` : ""}
                        </span>
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
          onClose={() => setDialog(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}
