"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import {
  ApiError,
  deleteSupplierPayment,
  fetchStockVoucher,
  markVoucherUnpaid,
  recordSupplierPayment,
  type StockVoucherDetail,
  type StockVoucherType,
} from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * CÔNG NỢ NHÀ CUNG CẤP — BẢN HẸP (08/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 8).
 * Anh Trung chốt "Làm bản hẹp NCC": công nợ chỉ là đuôi của PHIẾU NHẬP ("đã trả / còn nợ"), không menu riêng.
 * Hộp này = thanh toán MỘT phiếu: ba con số (giá trị · đã trả · còn nợ), ghi một lần trả, lịch sử các lần
 * trả (xóa được khi ghi nhầm). Phiếu chưa theo dõi (lập trước 08/11 / nhân viên lập) có thêm nút "Ghi nợ toàn
 * bộ". Chỉ người thấy tài chính mở được (nút chỉ hiện với họ; API cũng chặn). KHÔNG đụng Dòng tiền.
 */
export function SupplierPaymentDialog({ voucherId, onOpenChange }: { voucherId: string | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={voucherId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        {voucherId && <Loader key={voucherId} id={voucherId} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** Ô "Thanh toán" trong bảng Phiếu kho — một nhãn ngắn, chi tiết ở hộp. */
export function VoucherPayStatus({
  type,
  supplierId,
  paidAmount,
  debt,
}: {
  type: StockVoucherType;
  supplierId: string | null;
  paidAmount: number | null;
  debt: number | null;
}) {
  if (type !== "IMPORT" || !supplierId) return <span className="text-muted-foreground">—</span>;
  if (paidAmount == null) return <span className={TEXT_SUB}>Chưa ghi</span>;
  if ((debt ?? 0) > 0) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium tabular-nums text-amber-800">
        Còn nợ <Money value={debt ?? 0} />
      </span>
    );
  }
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      Đã trả đủ
    </span>
  );
}

function Loader({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApiQuery({ queryKey: qk.stockVoucher(id), queryFn: () => fetchStockVoucher(id), staleTime: 0 });
  if (q.error) return <p className="py-6 text-center text-sm text-amber-700">{q.error}</p>;
  if (!q.data) {
    return (
      <p className={cn(TEXT_SUB, "inline-flex items-center gap-2 py-6")}>
        <Loader2 className="size-4 animate-spin" /> Đang tải phiếu…
      </p>
    );
  }
  return <Body data={q.data} onClose={onClose} />;
}

function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Body({ data, onClose }: { data: StockVoucherDetail; onClose: () => void }) {
  const invalidate = useInvalidate();
  const v = data.voucher;
  const total = v.totalCost ?? 0;
  const tracked = v.paidAmount != null;
  const paid = v.paidAmount ?? 0;
  const remaining = tracked ? (v.debt ?? 0) : total;

  const [amount, setAmount] = useState(() => (remaining > 0 ? String(remaining) : ""));
  const [date, setDate] = useState(todayInput);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const amountNum = Number(amount) || 0;
  const amountInvalid = amountNum <= 0 || amountNum > remaining;

  async function refresh() {
    await invalidate(qk.stockVoucher(v.id), qk.stockVouchersAll(), qk.suppliersAll());
  }

  async function pay() {
    if (amountInvalid) return;
    setBusy(true);
    try {
      const paidAt = date ? new Date(`${date}T12:00:00`).toISOString() : undefined;
      const r = await recordSupplierPayment(v.id, { amount: amountNum, paidAt, note: note.trim() || undefined });
      toast.success((r.debt ?? 0) > 0 ? `Đã ghi trả ${formatNumber(amountNum)} đ — còn nợ ${formatNumber(r.debt ?? 0)} đ` : `Phiếu ${v.code} đã trả đủ`);
      await refresh();
      setNote("");
      setAmount((r.debt ?? 0) > 0 ? String(r.debt) : "");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không ghi được", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  async function markUnpaid() {
    setBusy(true);
    try {
      await markVoucherUnpaid(v.id);
      toast.success(`Đã ghi nợ toàn bộ phiếu ${v.code}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không ghi được", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  async function remove(paymentId: string) {
    setBusy(true);
    try {
      const r = await deleteSupplierPayment(v.id, paymentId);
      toast.success(`Đã xóa lần trả — còn nợ ${formatNumber(r.debt ?? 0)} đ`);
      setConfirmId(null);
      await refresh();
      setAmount((r.debt ?? 0) > 0 ? String(r.debt) : "");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xóa được", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Thanh toán phiếu <span className="font-mono">{v.code}</span>
        </DialogTitle>
        <DialogDescription>
          Nhà cung cấp: <b className="text-foreground">{v.supplierName ?? "—"}</b>. Ghi từng lần trả tiền cho phiếu này; không ảnh hưởng Dòng tiền.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
        <Figure label="Giá trị phiếu" value={total} />
        <Figure label="Đã trả" value={paid} muted={!tracked} />
        <Figure label="Còn nợ" value={remaining} tone={remaining > 0 ? "warn" : "ok"} />
      </div>

      {!tracked && (
        <p className={TEXT_SUB}>
          Phiếu này chưa theo dõi công nợ (lập trước khi có tính năng, hoặc do người không thấy tài chính lập). Ghi một lần trả bên dưới, hoặc
          bấm <b>Ghi nợ toàn bộ</b> nếu chưa trả đồng nào.
        </p>
      )}

      {remaining > 0 ? (
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_9.5rem]">
            <div className="grid gap-1.5">
              <Label htmlFor="pay-amount">Số tiền trả</Label>
              <CurrencyInput
                id="pay-amount"
                value={amount}
                onValueChange={setAmount}
                placeholder="—"
                className={cn("h-9 text-right tabular-nums", amount && amountInvalid && "border-rose-400")}
                aria-invalid={amountInvalid || undefined}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-date">Ngày trả</Label>
              <Input id="pay-date" type="date" className="h-9" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pay-note">Ghi chú (không bắt buộc)</Label>
            <Input id="pay-note" className="h-9" placeholder="VD: chuyển khoản VCB đợt 2" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn(TEXT_SUB, "tabular-nums")}>
              {amount && amountInvalid
                ? amountNum > remaining
                  ? `Phiếu chỉ còn nợ ${formatNumber(remaining)} đ`
                  : "Số tiền phải lớn hơn 0"
                : amountNum > 0
                  ? `Sau lần này còn nợ ${formatNumber(remaining - amountNum)} đ`
                  : ""}
            </span>
            <div className="flex items-center gap-2">
              {!tracked && (
                <Button variant="outline" disabled={busy} onClick={() => void markUnpaid()}>
                  Ghi nợ toàn bộ
                </Button>
              )}
              <Button disabled={busy || amountInvalid} onClick={() => void pay()}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Ghi trả tiền
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Phiếu này đã trả đủ cho nhà cung cấp.</p>
      )}

      {data.payments.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted/40">
              <tr className={cn(TEXT_SUB, "text-left")}>
                <th className="w-36 px-3 py-2 font-medium">Ngày trả</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Số tiền</th>
                <th className="px-3 py-2 font-medium">Ghi chú · người ghi</th>
                <th className="w-28 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t align-middle">
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">{formatDateTime(p.paidAt)}</td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">
                    <Money value={p.amount} />
                  </td>
                  <td className="truncate px-3 py-2 text-sm" title={[p.note, p.createdByName].filter(Boolean).join(" · ")}>
                    {p.note ?? <span className="text-muted-foreground">—</span>}
                    {p.createdByName && <span className={cn(TEXT_SUB, "ml-1")}>· {p.createdByName}</span>}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {confirmId === p.id ? (
                      <Button variant="destructive" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void remove(p.id)}>
                        Xác nhận xóa
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-700"
                        title="Xóa lần trả này (ghi nhầm)"
                        aria-label="Xóa lần trả này"
                        disabled={busy}
                        onClick={() => setConfirmId(p.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Đóng
        </Button>
      </DialogFooter>
    </>
  );
}

function Figure({ label, value, tone, muted }: { label: string; value: number; tone?: "warn" | "ok"; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={TEXT_SUB}>{label}</div>
      <div
        className={cn(
          "truncate font-semibold tabular-nums",
          muted && "text-muted-foreground",
          tone === "warn" && "text-amber-700",
          tone === "ok" && "text-emerald-700"
        )}
      >
        <Money value={value} />
      </div>
    </div>
  );
}
