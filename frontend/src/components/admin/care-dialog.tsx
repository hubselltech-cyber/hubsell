"use client";

// Hộp thoại CHĂM SÓC KHÁCH HÀNG (CRM nội bộ GĐ2) — Sale/CSKH đặt trạng thái,
// phân công người phụ trách và ghi chú cho một chủ shop. Mọi lần lưu đều được
// backend ghi vào Nhật ký thao tác.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HeartHandshake, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  updateCustomerCare,
  type HqMember,
  type PlatformCareStatus,
  type PlatformUserRow,
} from "@/lib/api";
import { CARE_STATUS_META, CARE_STATUSES } from "./shared";
import { cn } from "@/lib/utils";

export function CareDialog({
  customer,
  members,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: PlatformUserRow;
  /** Thành viên khu điều hành — ứng viên "người phụ trách". */
  members: HqMember[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<PlatformCareStatus>("NEW");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(customer.care?.status ?? "NEW");
    setAssigneeId(customer.care?.assignee?.id ?? "");
    setNote(customer.care?.note ?? "");
  }, [open, customer]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await updateCustomerCare(customer.id, {
        status,
        assigneeId: assigneeId || null,
        note,
      });
      toast.success(`Đã cập nhật chăm sóc — ${customer.fullName}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartHandshake className="size-5" />
            Chăm sóc — {customer.fullName}
          </DialogTitle>
          <DialogDescription>
            {customer.email} · đăng ký được theo dõi trong Nhật ký thao tác.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>Trạng thái</Label>
          {/* Chips trạng thái — nhìn một phát thấy cả vòng đời khách hàng */}
          <div className="flex flex-wrap gap-1.5">
            {CARE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  status === s
                    ? CARE_STATUS_META[s].className + " ring-1 ring-current"
                    : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                )}
              >
                {CARE_STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Người phụ trách</Label>
          <NativeSelect
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">— Chưa phân công —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
                {m.staffUsername ? ` (${m.staffUsername})` : ""}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-2">
          <Label>Ghi chú chăm sóc</Label>
          <textarea
            className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="vd: Đã gọi tư vấn liên kết Shopee, hẹn demo thứ 5…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Lưu chăm sóc
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
