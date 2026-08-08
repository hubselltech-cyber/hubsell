"use client";

import { useEffect, useState } from "react";
import { HandCoins } from "lucide-react";

import {
  KOC_PARTNERS,
  KOC_PLATFORM_META,
  type KocExpenseType,
} from "@/components/koc/koc-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatNumber } from "@/lib/format";

/**
 * MODAL GHI NHẬN CHI PHÍ BOOKING NGOÀI SÀN — nhánh "Seller nhập tay" của
 * Net-ROI (phí booking chuyển khoản tay cho KOC/MCN, sàn không hề biết).
 *
 * Bản preview: cộng thẳng vào bookingFee của KOC trong state trang để bảng
 * Net-ROI đổi số ngay. Bản thật sẽ POST /koc/expenses: ghi sổ Booking &
 * Hợp đồng + 1 dòng CHI_PHI_MARKETING sang Thu chi vận hành khi thanh toán.
 */
export function BookingExpenseModal({
  open,
  onOpenChange,
  initialKocId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Chọn sẵn KOC khi mở từ nút thao tác nhanh trên bảng Hiệu quả. */
  initialKocId?: string;
  onSave: (input: { kocId: string; amount: number; type: KocExpenseType }) => void;
}) {
  const [kocId, setKocId] = useState(KOC_PARTNERS[0]?.id ?? "");
  const [type, setType] = useState<KocExpenseType>("BOOKING");
  const [amountRaw, setAmountRaw] = useState("");

  useEffect(() => {
    if (open && initialKocId) setKocId(initialKocId);
  }, [open, initialKocId]);

  const amount = Number(amountRaw.replace(/\D/g, ""));
  const valid = kocId !== "" && amount > 0;

  function handleSave() {
    if (!valid) return;
    onSave({ kocId, amount, type });
    onOpenChange(false);
    setAmountRaw("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="size-5 text-violet-600" />
            Ghi nhận chi phí Booking
          </DialogTitle>
          <DialogDescription>
            Khoản chi ngoài sàn (chuyển khoản tay cho KOC/MCN) — cộng vào chi
            phí của KOC để Net-ROI phản ánh đủ tiền đã bỏ ra.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="booking-koc">KOC / MCN nhận tiền</Label>
            <NativeSelect
              id="booking-koc"
              value={kocId}
              onChange={(e) => setKocId(e.target.value)}
            >
              {KOC_PARTNERS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} — {KOC_PLATFORM_META[k.platform].label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="booking-type">Loại chi phí</Label>
            <NativeSelect
              id="booking-type"
              value={type}
              onChange={(e) => setType(e.target.value as KocExpenseType)}
            >
              <option value="BOOKING">Booking lẻ theo bài/phiên live</option>
              <option value="MCN_CONTRACT">Hợp đồng MCN theo kỳ</option>
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="booking-amount">Số tiền</Label>
            <div className="relative">
              <Input
                id="booking-amount"
                inputMode="numeric"
                placeholder="VD: 3.000.000"
                value={amountRaw ? formatNumber(amount) : ""}
                onChange={(e) => setAmountRaw(e.target.value)}
                className="pr-8 text-right tabular-nums"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                ₫
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={!valid}>
            Ghi nhận chi phí
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
