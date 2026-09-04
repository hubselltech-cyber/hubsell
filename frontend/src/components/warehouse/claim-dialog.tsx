"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  HandCoins,
  Loader2,
  TrendingDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, updateReturnClaim, type Order } from "@/lib/api";
import { carrierLabel } from "@/lib/carrier-meta";
import { formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

type Outcome = "COMPENSATED" | "REJECTED";

/**
 * CHỐT KẾT QUẢ KHIẾU NẠI cho đơn hàng hư hỏng / mất / bị tráo.
 *
 * Luồng hai bước: chọn kết quả trước → nhập số tiền (chỉ khi được đền) → xác
 * nhận. Tách hai bước vì ô tiền chỉ có nghĩa với một nhánh; để nó hiện sẵn cả
 * khi thua kiện chỉ khiến người dùng phân vân có phải điền không.
 *
 * ⚠️ CẢ HAI KẾT QUẢ ĐỀU KHÔNG CỘNG LẠI TỒN KHO. Hàng đã hỏng hoặc mất thật —
 * bưu cục đền bằng TIỀN chứ hàng không quay lại kệ. Cộng kho ở đây là tạo hàng
 * ma. Số tiền lưu lại là để module Tài chính hạch toán dòng tiền thu về.
 */
export function ClaimDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setOutcome(null);
      setAmount("");
      setNote("");
    }
  }, [open, order?.id]);

  if (!order) return null;

  const value = Number(amount);
  const orderValue = Number(order.totalAmount);
  const needAmount = outcome === "COMPENSATED";
  const amountValid = !needAmount || (amount !== "" && value > 0);
  // Gõ thừa số 0 là chuyện thường; cảnh báo mềm chứ không chặn, vì đền cao hơn
  // giá trị đơn vẫn có thật (cộng phí ship, phí đóng gói).
  const suspicious = needAmount && value > orderValue && orderValue > 0;

  async function submit() {
    if (!order || !outcome || !amountValid) return;
    setBusy(true);
    try {
      await updateReturnClaim(
        order.id,
        outcome,
        outcome === "COMPENSATED" ? value : undefined,
        note || undefined
      );
      toast.success(
        outcome === "COMPENSATED"
          ? `${order.orderCode}: đòi được ${formatVND(value)} từ bưu cục`
          : `${order.orderCode}: ghi nhận hao hụt, tính vào chi phí lỗ`,
        { duration: 6000 }
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không cập nhật được khiếu nại"
      );
    } finally {
      setBusy(false);
    }
  }

  const options: {
    key: Outcome;
    label: string;
    hint: string;
    icon: typeof HandCoins;
    active: string;
  }[] = [
    {
      key: "COMPENSATED",
      label: "Đã được đền bù",
      hint: "Đòi được tiền · không cộng kho",
      icon: HandCoins,
      active: "border-emerald-500 bg-emerald-50 text-emerald-900",
    },
    {
      key: "REJECTED",
      label: "Không được đền bù",
      hint: "Hao hụt · tính vào chi phí lỗ",
      icon: TrendingDown,
      active: "border-rose-500 bg-rose-50 text-rose-900",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{order.orderCode}</DialogTitle>
          <DialogDescription>
            {order.customerName} · {carrierLabel(order.carrier)}{" "}
            {order.trackingCode ?? ""} · Giá trị {formatVND(order.totalAmount)}
          </DialogDescription>
        </DialogHeader>

        {/* Lý do hư hỏng ghi lúc nhận hàng — bằng chứng để đối chiếu */}
        {order.returnNote && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className={cn(TEXT_SUB, "font-medium")}>
              Tình trạng ghi nhận khi nhận hàng
            </p>
            <p className="mt-1 text-sm">{order.returnNote}</p>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Cả hai lựa chọn đều <b>không cộng lại tồn kho</b> — hàng đã hỏng hoặc
            mất thật, được đền bằng tiền chứ không quay lại kệ.
          </p>
        </div>

        {/* Bước 1 — chọn kết quả */}
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const selected = outcome === o.key;
            return (
              <button
                key={o.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setOutcome(o.key)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-xl border-2 p-3 text-left transition-colors",
                  selected
                    ? o.active
                    : "border-input hover:border-primary/40 hover:bg-muted/50"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <o.icon className="size-4" />
                  {o.label}
                  {selected && <Check className="size-4" />}
                </span>
                <span className={cn(TEXT_SUB, selected && "text-inherit opacity-80")}>
                  {o.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bước 2 — số tiền, chỉ hiện khi được đền bù */}
        {needAmount && (
          <div className="grid gap-2">
            <Label htmlFor="claim-amount">Số tiền đền bù (VNĐ)</Label>
            <CurrencyInput
              id="claim-amount"
              className="text-right tabular-nums"
              placeholder="VD: 299.000"
              autoFocus
              value={amount}
              onValueChange={setAmount}
            />
            {suspicious ? (
              <p className="text-sm text-amber-700">
                Số tiền đền ({formatVND(value)}) lớn hơn giá trị đơn (
                {formatVND(orderValue)}) — kiểm tra lại xem có gõ thừa số 0 không.
              </p>
            ) : (
              <p className={TEXT_SUB}>
                Số này để module Tài chính hạch toán dòng tiền thu về từ bưu cục.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="claim-note">Ghi chú kết quả khiếu nại</Label>
          <Input
            id="claim-note"
            placeholder="VD: bưu cục đền 100% giá trị / sàn từ chối do quá hạn…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className={TEXT_SUB}>
            Ghi chú này được nối thêm vào tình trạng cũ, không ghi đè — giữ lại
            bằng chứng ban đầu.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Huỷ
          </Button>
          <Button
            onClick={submit}
            disabled={busy || outcome === null || !amountValid}
            title={
              outcome === null
                ? "Chọn kết quả khiếu nại trước"
                : !amountValid
                  ? "Nhập số tiền đền bù lớn hơn 0"
                  : undefined
            }
            className={cn(
              outcome === "REJECTED" && "bg-rose-600 hover:bg-rose-700"
            )}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Xác nhận
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
