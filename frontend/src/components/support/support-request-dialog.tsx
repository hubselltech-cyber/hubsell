"use client";

// ============================================================
// HỘP GỬI YÊU CẦU HỖ TRỢ — phía khách (anh Trung 27/09/2026).
//
// Khách SaaS rất ít khi chịu gửi yêu cầu, nên hộp này cực ngắn: MỘT ô nội
// dung + nút Gửi. Tên/email/gian/gói hệ thống tự đính kèm từ tài khoản; chỉ
// hỏi thêm SĐT khi tài khoản chưa có số (gửi kèm, backend lưu luôn vào tài
// khoản để lần sau khỏi hỏi). Dưới ô là danh sách yêu cầu đã gửi của shop kèm
// trạng thái + câu trả lời của Hubsell — khách không phải đoán yêu cầu đi đâu.
// Mở từ menu avatar, trang Hướng dẫn sử dụng và bong bóng Trợ lý AI (điền
// sẵn câu vừa hỏi); không thêm mục sidebar.
//
// Ảnh đính kèm (anh chốt 27/09): tối đa 3 ảnh, NÉN NGAY TRÊN TRÌNH DUYỆT
// (cạnh dài 1600 px, ≤ ~400 KB) rồi tải lên Supabase Storage sau khi tạo yêu
// cầu; ảnh tự xóa 7 ngày sau khi xong. Ô chọn ảnh chỉ hiện khi máy chủ báo
// attachmentsEnabled (đã cấu hình kho).
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, LifeBuoy, Loader2, Paperclip, X } from "lucide-react";

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
  uploadSupportAttachment,
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

/** Cạnh dài tối đa sau nén — chữ trên màn hình điện thoại vẫn đọc rõ. */
const MAX_SIDE = 1600;
/** Đích dung lượng mỗi ảnh; backend chặn cứng 600 KB. */
const TARGET_BYTES = 400 * 1024;

/**
 * Nén ảnh trên trình duyệt: thu về ≤ MAX_SIDE, xuất JPEG, hạ chất lượng rồi
 * hạ kích thước dần tới khi ≤ TARGET_BYTES. Ảnh gốc chục MB không bao giờ
 * rời máy khách.
 */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    let side = Math.min(MAX_SIDE, Math.max(bitmap.width, bitmap.height));
    const qualities = [0.82, 0.7, 0.58];
    for (let round = 0; round < 3; round++) {
      const scale = side / Math.max(bitmap.width, bitmap.height);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const q of qualities) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
        if (!blob) throw new Error("Không nén được ảnh");
        if (blob.size <= TARGET_BYTES) return blob;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error("Ảnh quá lớn, vui lòng chọn ảnh khác");
  } finally {
    bitmap.close();
  }
}

interface Picked {
  file: File;
  previewUrl: string;
}

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
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [attachmentMax, setAttachmentMax] = useState(3);
  const [picked, setPicked] = useState<Picked[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (initialContent) setContent(initialContent);
    let alive = true;
    fetchMySupportRequests()
      .then((r) => {
        if (!alive) return;
        setHistory(r.requests);
        setAttachmentsEnabled(r.attachmentsEnabled);
        setAttachmentMax(r.attachmentMax);
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

  // Thu hồi URL xem trước khi bỏ ảnh / đóng hộp — tránh rò bộ nhớ.
  useEffect(() => {
    return () => picked.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  }, [picked]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next: Picked[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      if (picked.length + next.length >= attachmentMax) break;
      next.push({ file: f, previewUrl: URL.createObjectURL(f) });
    }
    if (next.length === 0) {
      toast.error(`Chọn tệp ảnh (tối đa ${attachmentMax} ảnh)`);
      return;
    }
    setPicked((p) => [...p, ...next]);
  }

  function removePicked(i: number) {
    setPicked((p) => {
      URL.revokeObjectURL(p[i].previewUrl);
      return p.filter((_, idx) => idx !== i);
    });
  }

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

      // Ảnh tải SAU khi có id yêu cầu — từng ảnh một, nén ngay trước khi gửi.
      let uploaded = 0;
      let failed = 0;
      for (const p of picked) {
        try {
          const blob = await compressImage(p.file);
          const r = await uploadSupportAttachment(res.request.id, blob);
          uploaded = r.attachmentCount;
        } catch {
          failed += 1;
        }
      }
      const created = { ...res.request, attachmentCount: uploaded };

      setHistory((h) => [created, ...(h ?? [])]);
      setContent("");
      setPhone("");
      setPicked([]);
      if (failed > 0) {
        toast.warning(
          `Đã nhận yêu cầu, nhưng ${failed} ảnh không tải lên được — Hubsell vẫn liên hệ với bạn.`
        );
      } else {
        toast.success("Đã nhận yêu cầu — Hubsell sẽ liên hệ với bạn sớm.");
      }
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

          {attachmentsEnabled && (
            <div className="flex flex-wrap items-center gap-2">
              {picked.map((p, i) => (
                <div key={p.previewUrl} className="relative size-16 overflow-hidden rounded-md border">
                  {/* Xem trước từ object URL — next/image không tối ưu được. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePicked(i)}
                    aria-label="Bỏ ảnh này"
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {picked.length < attachmentMax && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-16 items-center gap-1.5 rounded-md border border-dashed px-3 text-xs text-muted-foreground transition-colors hover:border-slate-400 hover:text-slate-900"
                >
                  <ImagePlus className="size-4" />
                  {picked.length === 0
                    ? "Đính kèm ảnh chụp màn hình"
                    : `Thêm ảnh (${picked.length}/${attachmentMax})`}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || content.trim().length < 5}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting && picked.length > 0 ? "Đang gửi ảnh…" : "Gửi"}
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
                    {(r.attachmentCount > 0 || r.attachmentsPurgedAt) && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="size-3" />
                        {r.attachmentCount > 0
                          ? `${r.attachmentCount} ảnh đính kèm`
                          : "Ảnh đính kèm đã xóa sau 7 ngày"}
                      </p>
                    )}
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
