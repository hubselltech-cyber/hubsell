"use client";

// GHI NHẬN APPLE ĐÃ CHUYỂN TIỀN (lát B phải thu Apple, 17/11/2026) — hộp mở từ
// thẻ "Apple chưa chuyển về" của Sổ quỹ HQ. HQ chọn các khoản bán qua App Store
// mà lần chuyển này trả, nhập số tiền ngân hàng nhận + thuế Apple trừ (theo báo
// cáo tài chính Apple); máy tính hoa hồng = tổng khách trả − tiền về − thuế và
// ghi 2–3 bút toán sổ quỹ cùng ngày tiền về (backend services/apple-settlement.ts).
// Tỷ lệ hoa hồng lạ → hộp cảnh báo + "Vẫn ghi", không chặn.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Apple, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  createAppleSettlement,
  fetchAppleReceivables,
  type AppleReceivableItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatMoney } from "./shared";

/** Dải hoa hồng "bình thường" — khớp COMMISSION_RATE_NORMAL ở backend (ngưỡng tự chọn quanh 15 % / 30 % của Apple). */
const NORMAL_RATE = { min: 0.1, max: 0.35 };

function keyToVn(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

export function AppleSettlementDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<AppleReceivableItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receivedOn, setReceivedOn] = useState(todayKey());
  const [bankAmount, setBankAmount] = useState("");
  const [taxAmount, setTaxAmount] = useState("0");
  const [bankRef, setBankRef] = useState("");
  const [reportRef, setReportRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmUnusual, setConfirmUnusual] = useState(false);

  useEffect(() => {
    fetchAppleReceivables()
      .then(({ items }) => {
        setItems(items);
        // Mặc định chọn đợt dự kiến SỚM NHẤT — thường là đúng lần Apple vừa chuyển.
        const first = items.find((i) => i.applePayout)?.applePayout?.expected;
        setSelected(
          new Set(items.filter((i) => !first || i.applePayout?.expected === first).map((i) => i.id))
        );
      })
      .catch((err) => {
        toast.error(err instanceof ApiError ? err.message : "Không tải được danh sách khoản chờ");
        setItems([]);
      });
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, AppleReceivableItem[]>();
    for (const it of items ?? []) {
      const k = it.applePayout?.expected ?? "none";
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()];
  }, [items]);

  const gross = (items ?? []).filter((i) => selected.has(i.id)).reduce((s, i) => s + i.amount, 0);
  const bank = Math.round(Number(bankAmount) || 0);
  const tax = Math.round(Number(taxAmount) || 0);
  const commission = gross - bank - tax;
  const rate = gross > 0 ? commission / gross : 0;
  const ready = selected.size > 0 && bank > 0 && tax >= 0 && commission >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(receivedOn);
  const unusual = ready && (rate < NORMAL_RATE.min || rate > NORMAL_RATE.max);

  function toggle(id: string) {
    setConfirmUnusual(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(list: AppleReceivableItem[], on: boolean) {
    setConfirmUnusual(false);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of list) {
        if (on) next.add(i.id);
        else next.delete(i.id);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!ready) return;
    if (unusual && !confirmUnusual) {
      setConfirmUnusual(true);
      return;
    }
    setSubmitting(true);
    try {
      await createAppleSettlement({
        entryIds: [...selected],
        receivedOn,
        bankAmount: bank,
        taxWithheldAmount: tax,
        bankRef: bankRef.trim() || undefined,
        reportRef: reportRef.trim() || undefined,
      });
      toast.success(`Đã ghi nhận Apple chuyển ${formatMoney(bank)} cho ${selected.size} khoản`);
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không ghi nhận được");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Apple className="size-5" />
            Ghi nhận Apple đã chuyển tiền
          </DialogTitle>
          <DialogDescription>
            Chọn các khoản lần chuyển này trả, nhập số tiền ngân hàng nhận theo sổ phụ và thuế Apple
            trừ theo báo cáo tài chính Apple. Hoa hồng tự tính = tổng khách trả − tiền về − thuế.
          </DialogDescription>
        </DialogHeader>

        {items === null ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Đang tải khoản chờ…
          </p>
        ) : items.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">Không còn khoản App Store nào chờ Apple chuyển.</p>
        ) : (
          <>
            <div className="grid min-w-0 gap-3">
              {groups.map(([k, list]) => {
                const allOn = list.every((i) => selected.has(i.id));
                return (
                  <div key={k} className="min-w-0 rounded-md border">
                    <label className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                      <input type="checkbox" checked={allOn} onChange={(e) => toggleGroup(list, e.target.checked)} />
                      {k === "none" ? "Chưa có lịch Apple" : `Đợt dự kiến ~${keyToVn(k)}`}
                      <span className="ml-auto text-muted-foreground">
                        {list.length} khoản · {formatMoney(list.reduce((s, i) => s + i.amount, 0))}
                      </span>
                    </label>
                    <ul className="divide-y">
                      {list.map((i) => (
                        <li key={i.id}>
                          <label className="flex items-center gap-2 px-3 py-1.5 text-sm">
                            <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                            <span className="w-12 shrink-0 text-muted-foreground">{shortDate(i.occurredAt)}</span>
                            <span className="min-w-0 flex-1 truncate" title={i.customer?.fullName ?? undefined}>
                              {i.customer?.fullName ?? i.note ?? "—"}
                            </span>
                            {i.invoiceNo && (
                              <span className="shrink-0 text-xs text-muted-foreground">HĐ {i.invoiceNo}</span>
                            )}
                            <span className="w-24 shrink-0 text-right font-medium">{formatMoney(i.amount)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Ngày tiền về</Label>
                <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Số tiền ngân hàng nhận (₫)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="theo sổ phụ"
                  value={bankAmount}
                  onChange={(e) => {
                    setBankAmount(e.target.value);
                    setConfirmUnusual(false);
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label>Thuế Apple trừ (₫)</Label>
                <Input
                  type="number"
                  min={0}
                  value={taxAmount}
                  onChange={(e) => {
                    setTaxAmount(e.target.value);
                    setConfirmUnusual(false);
                  }}
                />
                <p className="text-xs text-muted-foreground">Theo báo cáo Apple; để 0 nếu báo cáo không tách.</p>
              </div>
              <div className="grid gap-2">
                <Label>Mã giao dịch sổ phụ</Label>
                <Input placeholder="vd: FT26365…" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
              </div>
              <div className="col-span-2 grid gap-2">
                <Label>Báo cáo Apple (kỳ / mã)</Label>
                <Input
                  placeholder="vd: Financial report tháng tài chính 11/2026"
                  value={reportRef}
                  onChange={(e) => setReportRef(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1 rounded-md border px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tổng khách trả ({selected.size} khoản)</span>
                <span className="font-medium">{formatMoney(gross)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ngân hàng nhận</span>
                <span>{bank > 0 ? formatMoney(bank) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Thuế Apple trừ</span>
                <span>{formatMoney(tax)}</span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="font-medium">Hoa hồng Apple giữ</span>
                <span className={cn("font-semibold", commission < 0 && "text-rose-600")}>
                  {bank > 0 ? `${formatMoney(commission)} · ${(rate * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
              {bank > 0 && commission < 0 && (
                <p className="text-xs text-rose-600">
                  Tiền về + thuế lớn hơn tổng khách trả của các khoản đã chọn — kiểm lại khoản chọn hoặc số tiền.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Sổ quỹ sẽ có: phiếu thu {formatMoney(gross)}, phiếu chi hoa hồng
                {tax > 0 ? ", phiếu chi thuế" : ""} — cùng ngày tiền về; thu − chi = đúng số ngân hàng nhận.
              </p>
            </div>

            {confirmUnusual && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Hoa hồng tính ra {(rate * 100).toFixed(1)}% tổng khách trả, trong khi Apple thường giữ 15% hoặc 30%.
                Kiểm lại số tiền về, thuế và các khoản đã chọn theo báo cáo Apple. Đúng rồi thì bấm “Vẫn ghi”.
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Đóng
              </Button>
              {confirmUnusual && (
                <Button variant="outline" onClick={() => setConfirmUnusual(false)} disabled={submitting}>
                  Sửa lại
                </Button>
              )}
              <Button onClick={handleSave} disabled={!ready || submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {confirmUnusual ? "Vẫn ghi" : "Ghi nhận"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
