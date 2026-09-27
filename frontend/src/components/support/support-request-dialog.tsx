"use client";

// ============================================================
// HỘP GỬI YÊU CẦU HỖ TRỢ — phía khách (anh Trung 27/09/2026).
//
// Khách SaaS rất ít khi chịu gửi yêu cầu, nên hộp này cực ngắn: MỘT ô nội
// dung + nút Gửi. Tên/email/gian/gói hệ thống tự đính kèm từ tài khoản; chỉ
// hỏi thêm SĐT khi tài khoản chưa có số (gửi kèm, backend lưu luôn vào tài
// khoản để lần sau khỏi hỏi). Dưới ô là danh sách yêu cầu đã gửi của shop kèm
// trạng thái + câu trả lời của Hubsell — khách không phải đoán yêu cầu đi đâu.
// Mở từ menu avatar và trang Hướng dẫn sử dụng; không thêm mục sidebar.
// ============================================================

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LifeBuoy, Loader2 } from "lucide-react";

import { PhoneInput } from "@/components/auth/phone-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  createSupportRequest,
  fetchMySupportRequests,
  getStoredUser,
  notifyUserChanged,
  type MySupportRequest,
  type SupportRequestStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const STATUS_META: Record<SupportRequestStatus, { label: string; className: string }> = {
  NEW: { label: "Đã tiếp nhận", className: "border-orange-200 bg-orange-50 text-orange-700" },
  IN_PROGRESS: { label: "Đang xử lý", className: "border-sky-200 bg-sky-50 text-sky-700" },
  DONE: { label: "Đã xong", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

export function SupportRequestDialog({
  open,
  onOpenChange,
  initialContent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Điền sẵn ô nội dung khi mở (vd: câu khách vừa hỏi trợ lý AI). */
  initialContent?: string;
}) {
  const queryClient = useQueryClient();
  const user = getStoredUser();
  const needPhone = !user?.phone;
  const [content, setContent] = useState("");
  const [country, setCountry] = useState(user?.country ?? "VN");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<MySupportRequest[] | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialContent) setContent(initialContent);
    let alive = true;
    fetchMySupportRequests()
      .then((r) => {
        if (!alive) return;
        setHistory(r.requests);
        // Backend vừa đóng dấu "đã xem" → tắt chấm đỏ trên avatar ngay.
        void queryClient.invalidateQueries({ queryKey: qk.supportUnread() });
      })
      .catch(() => {
        if (alive) setHistory([]);
      });
    return () => {
      alive = false;
    };
  }, [open, initialContent, queryClient]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (content.trim().length < 5) {
      toast.error("Mô tả ngắn điều bạn cần hỗ trợ giúp Hubsell xử lý đúng ngay lần đầu");
      return;
    }
    if (needPhone && phone && !/^\d{6,15}$/.test(phone)) {
      toast.error("Số điện thoại chưa hợp lệ (6-15 chữ số)");
      return;
    }
    setSubmitting(true);
    try {
      const res = await createSupportRequest({
        content: content.trim(),
        ...(needPhone && phone ? { phoneNumber: phone, country } : {}),
      });
      // Backend lưu SĐT vào tài khoản nếu đang trống → cập nhật user local để
      // dải nhắc / menu avatar đổi ngay, lần sau không hỏi SĐT nữa.
      if (res.phoneSaved && user && !user.phone) {
        notifyUserChanged({ ...user, phone: res.phoneSaved });
      }
      setHistory((h) => [res.request, ...(h ?? [])]);
      setContent("");
      setPhone("");
      toast.success("Đã nhận yêu cầu — Hubsell sẽ liên hệ với bạn sớm.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="size-5" />
            Gửi yêu cầu hỗ trợ
          </DialogTitle>
          <DialogDescription>
            Hubsell đã có thông tin tài khoản của bạn, chỉ cần mô tả điều bạn cần.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <textarea
            autoFocus
            className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="vd: Gian Shopee ANO không kéo được đơn từ sáng nay…"
            maxLength={2000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {needPhone && (
            <div className="space-y-1.5">
              <Label>Số điện thoại để Hubsell gọi lại (không bắt buộc)</Label>
              <PhoneInput
                country={country}
                phone={phone}
                onCountryChange={setCountry}
                onPhoneChange={setPhone}
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || content.trim().length < 5}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Gửi
            </Button>
          </div>
        </form>

        {history && history.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Yêu cầu đã gửi</p>
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {history.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(r.createdAt)}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          meta.className
                        )}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{r.content}</p>
                    {r.reply && (
                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-emerald-50 px-2.5 py-1.5 text-emerald-900">
                        <span className="font-medium">Hubsell:</span> {r.reply}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
