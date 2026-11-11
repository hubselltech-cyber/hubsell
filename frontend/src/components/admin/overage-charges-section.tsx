"use client";

// ============================================================
// HQ → Gói dịch vụ: PHÍ VƯỢT TRẦN ĐƠN (11/11/2026, "tính thẳng").
// Worker chốt tháng trước lúc 06:00 mùng 2; khách tự trả qua payOS thì phiếu tự đóng.
// Ở đây kế toán chỉ làm hai việc ngoại lệ: GHI NHẬN khi khách chuyển khoản tay (cùng lõi
// chứng từ → sổ quỹ → hóa đơn "mua thêm N đơn hàng" → hoa hồng) và MIỄN (bắt buộc lý do,
// có nhật ký). Chưa có phiếu nào thì khối không hiện — trang không thêm chỗ trống.
// ============================================================

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";
import { toast } from "sonner";

import {
  ApiError,
  fetchPlatformOverageCharges,
  recordPlatformOveragePayment,
  waivePlatformOverageCharge,
  type PlatformOverageCharge,
} from "@/lib/api";
import { formatVND } from "@/lib/format";
import { overageLastPayDay, overageMonthLabel } from "@/lib/overage";
import { cn } from "@/lib/utils";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const nf = new Intl.NumberFormat("vi-VN");
const QUERY_KEY = ["admin-overage-charges"] as const;

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function StatusPill({ c }: { c: PlatformOverageCharge }) {
  const meta =
    c.status === "PAID"
      ? { label: "Đã trả", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" }
      : c.status === "WAIVED"
        ? { label: "Đã miễn", cls: "border-slate-200 bg-slate-50 text-slate-600" }
        : c.overdue
          ? { label: "Quá hạn, đang khóa", cls: "border-rose-200 bg-rose-50 text-rose-700" }
          : { label: "Chờ trả", cls: "border-amber-200 bg-amber-50 text-amber-800" };
  return (
    <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold", meta.cls)}>
      {meta.label}
    </span>
  );
}

export function OverageChargesSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchPlatformOverageCharges });
  const [waiveFor, setWaiveFor] = useState<PlatformOverageCharge | null>(null);
  const [waiveNote, setWaiveNote] = useState("");
  const [payFor, setPayFor] = useState<PlatformOverageCharge | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(todayInput);
  const [payNote, setPayNote] = useState("");

  const done = (msg: string) => {
    toast.success(msg);
    setWaiveFor(null);
    setPayFor(null);
    qc.invalidateQueries({ queryKey: QUERY_KEY });
  };
  const fail = (fallback: string) => (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : fallback);

  const waiveMutation = useMutation({
    mutationFn: () => waivePlatformOverageCharge(waiveFor!.id, waiveNote),
    onSuccess: () => done("Đã miễn phí vượt — khách được mở khóa ngay"),
    onError: fail("Không miễn được phiếu"),
  });
  const payMutation = useMutation({
    mutationFn: () =>
      recordPlatformOveragePayment(payFor!.id, {
        amount: Number(payAmount.replace(/[.,\s]/g, "")),
        occurredAt: payDate ? new Date(`${payDate}T12:00:00`).toISOString() : undefined,
        note: payNote.trim() || undefined,
      }),
    onSuccess: () => done("Đã ghi nhận thanh toán phí vượt — sổ quỹ + hóa đơn tự chạy"),
    onError: fail("Không ghi nhận được thanh toán"),
  });

  if (!data || data.charges.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">
          Phí vượt trần đơn
          {data.openCount > 0 && (
            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 tabular-nums">
              {nf.format(data.openCount)} chờ trả · {formatVND(data.openAmount)}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Chốt tự động 06:00 mùng 2 cho tháng trước: số đơn vượt × đơn giá của gói khách đang dùng. Khách
          tự trả qua payOS thì phiếu tự đóng; quá hạn chưa trả thì tính năng nâng cao của khách tạm khóa.
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Gộp cột (tháng + gói, vượt + số đơn) để bảng không cuộn ngang ở màn 1280 */}
                <TableHead>Tháng · gói</TableHead>
                <TableHead>Khách hàng</TableHead>
                <TableHead className="text-right">Vượt × đơn giá</TableHead>
                <TableHead className="text-right">Thành tiền</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.charges.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    <span className="tabular-nums">{overageMonthLabel(c.month)}</span>
                    <p className="text-xs text-muted-foreground">{c.planName}</p>
                  </TableCell>
                  <TableCell className="max-w-[14rem]">
                    <p className="truncate text-sm" title={c.owner.fullName}>
                      {c.owner.fullName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={c.owner.email ?? undefined}>
                      {c.owner.email ?? "—"}
                      {c.owner.phone ? ` · ${c.owner.phone}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                    {nf.format(c.overOrders)} × {nf.format(c.unitPrice)} ₫
                    <p className="text-xs text-muted-foreground">
                      {nf.format(c.ordersCounted)} / {nf.format(c.orderCap)} đơn
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">
                    {formatVND(c.amount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <StatusPill c={c} />
                    <p
                      className="mt-1 max-w-[12rem] truncate text-xs text-muted-foreground"
                      title={c.status === "WAIVED" ? (c.waivedNote ?? undefined) : undefined}
                    >
                      {c.status === "OPEN"
                        ? `Hạn hết ${overageLastPayDay(c.dueAt, true)}`
                        : c.status === "PAID" && c.paidAt
                          ? `Trả ngày ${dayLabel(c.paidAt)}`
                          : c.status === "WAIVED"
                            ? `${c.waivedByName ?? "HQ"}: ${c.waivedNote ?? ""}`
                            : ""}
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.status === "OPEN" && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPayAmount(nf.format(c.amount));
                            setPayDate(todayInput());
                            setPayNote("");
                            setPayFor(c);
                          }}
                        >
                          <CircleDollarSign className="size-4" />
                          Ghi nhận
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setWaiveNote("");
                            setWaiveFor(c);
                          }}
                        >
                          Miễn
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ===== Miễn — bắt buộc lý do ===== */}
      <Dialog open={waiveFor !== null} onOpenChange={(o) => !o && setWaiveFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Miễn phí vượt</DialogTitle>
            {waiveFor && (
              <DialogDescription>
                {waiveFor.owner.fullName} — tháng {overageMonthLabel(waiveFor.month)}: {nf.format(waiveFor.overOrders)} đơn,{" "}
                <span className="font-semibold tabular-nums text-foreground">{formatVND(waiveFor.amount)}</span>.
                Miễn là không thu, không xuất hóa đơn; khách được mở khóa ngay. Không hoàn tác được.
              </DialogDescription>
            )}
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!waiveNote.trim()) {
                toast.error("Vui lòng ghi lý do miễn");
                return;
              }
              waiveMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="waive-note">Lý do miễn</Label>
              <Input
                id="waive-note"
                value={waiveNote}
                onChange={(e) => setWaiveNote(e.target.value)}
                placeholder="VD: khách mới, tặng tháng đầu"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setWaiveFor(null)}>
                Thôi
              </Button>
              <Button type="submit" size="sm" disabled={waiveMutation.isPending}>
                {waiveMutation.isPending ? "Đang miễn…" : "Miễn phiếu này"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== Ghi nhận chuyển khoản tay ===== */}
      <Dialog open={payFor !== null} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ghi nhận thanh toán phí vượt</DialogTitle>
            {payFor && (
              <DialogDescription>
                {payFor.owner.fullName} — tháng {overageMonthLabel(payFor.month)}, mua thêm{" "}
                {nf.format(payFor.overOrders)} đơn hàng. Một xác nhận tự sinh: bút toán THU sổ quỹ, hóa đơn
                điện tử và hoa hồng giới thiệu. Không gia hạn thuê bao.
              </DialogDescription>
            )}
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(payAmount.replace(/[.,\s]/g, ""));
              if (!Number.isFinite(n) || n <= 0) {
                toast.error("Số tiền không hợp lệ");
                return;
              }
              payMutation.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ovg-amount">Số tiền thực thu (₫)</Label>
                <Input
                  id="ovg-amount"
                  inputMode="numeric"
                  className="tabular-nums"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ovg-date">Ngày nhận tiền</Label>
                <Input id="ovg-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ovg-note">Ghi chú (không bắt buộc)</Label>
              <Input id="ovg-note" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPayFor(null)}>
                Thôi
              </Button>
              <Button type="submit" size="sm" disabled={payMutation.isPending}>
                <CircleDollarSign className="size-4" />
                {payMutation.isPending ? "Đang ghi…" : "Ghi nhận"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
