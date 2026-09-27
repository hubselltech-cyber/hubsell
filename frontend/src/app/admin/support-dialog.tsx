"use client";

// Hộp thoại XỬ LÝ YÊU CẦU HỖ TRỢ (anh Trung 27/09): HQ đặt trạng thái, phân
// công, ghi CÂU TRẢ LỜI (khách thấy trong hộp Yêu cầu hỗ trợ) và GHI CHÚ nội
// bộ (khách không thấy). Mọi lần lưu ghi vào Nhật ký thao tác.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, Loader2 } from "lucide-react";

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
  updateAdminSupportRequest,
  type AdminSupportRequestRow,
  type HqMember,
  type SupportRequestStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SUPPORT_STATUS_META, SUPPORT_STATUSES } from "./shared";

const TEXTAREA =
  "min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export function SupportDialog({
  request,
  members,
  open,
  onOpenChange,
  onSaved,
}: {
  request: AdminSupportRequestRow;
  members: HqMember[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<SupportRequestStatus>("NEW");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(request.status);
    setAssigneeId(request.assignee?.id ?? "");
    setReply(request.reply ?? "");
    setNote(request.note ?? "");
  }, [open, request]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await updateAdminSupportRequest(request.id, {
        status,
        assigneeId: assigneeId || null,
        reply,
        note,
      });
      toast.success(`Đã cập nhật yêu cầu — ${request.account.fullName}`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setSubmitting(false);
    }
  }

  const acc = request.account;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="size-5" />
            Yêu cầu hỗ trợ — {acc.fullName}
          </DialogTitle>
          <DialogDescription>
            {acc.email ?? "—"} · {request.phone ?? acc.phone ?? "chưa có SĐT"} ·{" "}
            {acc.planName ?? "chưa có gói"}
            {acc.isTrial ? " (dùng thử)" : ""} · {acc.channelCount} gian · gửi lúc{" "}
            {formatDateTime(request.createdAt)}
            {request.requesterName !== acc.fullName
              ? ` · người gửi: ${request.requesterName}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
          {request.content}
        </div>

        <div className="grid gap-2">
          <Label>Trạng thái</Label>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  status === s
                    ? SUPPORT_STATUS_META[s].className + " ring-1 ring-current"
                    : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                )}
              >
                {SUPPORT_STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Người phụ trách</Label>
          <NativeSelect value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
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
          <Label>Trả lời khách</Label>
          <textarea
            className={TEXTAREA}
            placeholder="Khách sẽ thấy câu này trong hộp Yêu cầu hỗ trợ của họ."
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label>Ghi chú nội bộ</Label>
          <textarea
            className={TEXTAREA}
            placeholder="Chỉ đội HQ thấy — vd: đã gọi 2 lần chưa bắt máy…"
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
            Lưu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
