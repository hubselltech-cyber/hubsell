"use client";

// Hộp thoại XỬ LÝ LEAD TƯ VẤN từ landing — sale đặt trạng thái gọi, phân công
// người phụ trách và ghi chú. Mọi lần lưu được ghi vào Nhật ký thao tác.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, PhoneCall } from "lucide-react";

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
  updateConsultLead,
  type ConsultLeadRow,
  type ConsultLeadStatus,
  type HqMember,
} from "@/lib/api";
import { LEAD_STATUS_META, LEAD_STATUSES } from "./shared";
import { cn } from "@/lib/utils";

export function LeadDialog({
  lead,
  members,
  open,
  onOpenChange,
  onSaved,
}: {
  lead: ConsultLeadRow;
  /** Thành viên khu điều hành — ứng viên "người phụ trách". */
  members: HqMember[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<ConsultLeadStatus>("NEW");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(lead.status);
    setAssigneeId(lead.assignee?.id ?? "");
    setNote(lead.note ?? "");
  }, [open, lead]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await updateConsultLead(lead.id, {
        status,
        assigneeId: assigneeId || null,
        note,
      });
      toast.success(`Đã cập nhật lead — ${lead.name}`);
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
            <PhoneCall className="size-5" />
            Lead tư vấn — {lead.name}
          </DialogTitle>
          <DialogDescription>
            {lead.email} · {lead.phone} · lần lưu được ghi vào Nhật ký thao tác.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>Trạng thái</Label>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  status === s
                    ? LEAD_STATUS_META[s].className + " ring-1 ring-current"
                    : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                )}
              >
                {LEAD_STATUS_META[s].label}
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
          <Label>Ghi chú tư vấn</Label>
          <textarea
            className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="vd: Đã gọi — shop ~5.000 đơn/tháng, quan tâm Business, hẹn demo thứ 5…"
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
            Lưu lead
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
