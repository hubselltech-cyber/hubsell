"use client";

import { useEffect, useState } from "react";
import { HandCoins } from "lucide-react";
import { toast } from "sonner";

import { kocPlatformMeta } from "@/components/koc/koc-data";
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
import {
  ApiError,
  createKocExpense,
  type KocExpenseKind,
  type KocExpenseState,
  type KocPartnerRow,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";

/**
 * MODAL GHI CHI PHÍ BOOKING/HỢP ĐỒNG (số thật) — POST /api/koc/expenses.
 *
 * Khoản chi ngoài sàn (chuyển khoản tay cho KOC/MCN, sàn không hề biết) —
 * nhánh "seller nhập tay" của Net-ROI. Khoản KHÔNG gắn 1 KOC cụ thể (hợp đồng
 * MCN nhiều bạn) chọn "— MCN / đơn vị khác" rồi nhập tên. LƯU Ý: sổ này KHÔNG
 * tự ghi sang Thu chi vận hành (tránh đếm đôi nếu anh chị đã nhập bên đó).
 */
export function BookingExpenseModal({
  open,
  onOpenChange,
  partners,
  initialKocId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  partners: KocPartnerRow[];
  /** Chọn sẵn KOC khi mở từ nút thao tác nhanh trên bảng Hiệu quả. */
  initialKocId?: string;
  onDone: () => void;
}) {
  const [kocId, setKocId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [kind, setKind] = useState<KocExpenseKind>("BOOKING");
  const [state, setState] = useState<KocExpenseState>("PAID");
  const [contractCode, setContractCode] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setKocId(initialKocId ?? partners[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKocId]);

  const amount = Number(amountRaw.replace(/\D/g, ""));
  const valid =
    amount > 0 && (kocId !== "" || displayName.trim() !== "");

  async function handleSave() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await createKocExpense({
        kocId: kocId || undefined,
        displayName: kocId ? undefined : displayName.trim(),
        contractCode: contractCode.trim() || undefined,
        kind,
        amount,
        state,
        dueDate: dueDate || undefined,
      });
      toast.success("Đã ghi khoản chi vào Sổ Booking & Hợp đồng");
      onOpenChange(false);
      setAmountRaw("");
      setContractCode("");
      setDueDate("");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không ghi được khoản chi");
    } finally {
      setSubmitting(false);
    }
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
            Cộng vào chi phí của KOC để Net-ROI phản ánh đủ tiền đã bỏ ra.
            Khoản này KHÔNG tự chảy sang Thu chi vận hành — tránh đếm đôi.
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
              {partners.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} — {kocPlatformMeta(k.platform).label}
                </option>
              ))}
              <option value="">— MCN / đơn vị khác (nhập tên)</option>
            </NativeSelect>
            {kocId === "" && (
              <Input
                aria-label="Tên đơn vị nhận tiền"
                placeholder="VD: MCN VieNetwork (5 KOC)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="booking-type">Loại chi phí</Label>
              <NativeSelect
                id="booking-type"
                value={kind}
                onChange={(e) => setKind(e.target.value as KocExpenseKind)}
              >
                <option value="BOOKING">Booking lẻ</option>
                <option value="MCN_CONTRACT">Hợp đồng MCN</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-state">Trạng thái</Label>
              <NativeSelect
                id="booking-state"
                value={state}
                onChange={(e) => setState(e.target.value as KocExpenseState)}
              >
                <option value="PAID">Đã thanh toán</option>
                <option value="PENDING">Chờ thanh toán</option>
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="booking-contract">Mã hợp đồng (tuỳ chọn)</Label>
              <Input
                id="booking-contract"
                placeholder="HD-KOC-3008"
                value={contractCode}
                onChange={(e) => setContractCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-due">
                {state === "PENDING" ? "Hạn thanh toán" : "Ngày đã chi"}
              </Label>
              <Input
                id="booking-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
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
          <Button onClick={handleSave} disabled={!valid || submitting}>
            {submitting ? "Đang ghi…" : "Ghi nhận chi phí"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
