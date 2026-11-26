"use client";

// HỦY GHI NHẬN một khoản thu gói do HQ bấm "Xác nhận đã nhận tiền" (26/11/2026) —
// mở từ nút ↶ trên dòng Sổ quỹ. Ca điển hình: khách tự chuyển qua payOS, máy đã ghi,
// HQ thấy tiền về lại ghi tay thêm một lần → hai dòng thu cho một lần chuyển khoản.
// Một lần ghi nhận sinh nhiều thứ nên hộp này XEM TRƯỚC đủ những gì sẽ được gỡ
// (backend services/void-package-payment.ts): hạn gói của khách, tờ nháp hóa đơn trên
// meinvoice.vn, hoa hồng giới thiệu. Máy không dựng lại chắc chắn được thì nói rõ lý
// do và không cho bấm.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  previewVoidLedgerPayment,
  voidLedgerPayment,
  type PlatformLedgerEntry,
  type VoidPaymentSummary,
} from "@/lib/api";
import { formatMoney } from "./shared";

function vnDate(iso: string | null): string {
  if (!iso) return "vô thời hạn";
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Câu về tờ hóa đơn của dòng này trên meinvoice.vn. */
function draftLine(state: VoidPaymentSummary["invoiceDraft"]): string {
  switch (state) {
    case "DRAFT":
      return "Tờ nháp chờ ký trên meinvoice.vn sẽ bị xóa — anh không còn ký nhầm thành hóa đơn thừa.";
    case "UNKNOWN":
      return "Chưa hỏi được meinvoice.vn lúc này. Khi bấm, máy xóa tờ nháp trước; xóa không được thì dừng, không gỡ gì.";
    default:
      return "Không có tờ nháp nào của dòng này trên meinvoice.vn.";
  }
}

export function VoidPaymentDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: PlatformLedgerEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<VoidPaymentSummary | null>(null);
  /** Lý do máy không hủy được khoản này (đã có hóa đơn, không dựng lại được hạn gói…). */
  const [blocked, setBlocked] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    previewVoidLedgerPayment(entry.id)
      .then(({ preview }) => setPreview(preview))
      .catch((err) => setBlocked(err instanceof ApiError ? err.message : "Không xem trước được, thử lại sau"));
  }, [entry.id]);

  async function handleVoid() {
    setSubmitting(true);
    try {
      const { done } = await voidLedgerPayment(entry.id);
      const lost = done.commission && !done.commission.recoverable;
      toast.success(
        `Đã hủy ghi nhận ${formatMoney(done.amount)} — hạn gói của khách về ${vnDate(done.periodEndAfter)}`
      );
      if (lost) {
        toast.warning(
          `Chưa thu hồi được hoa hồng ${formatMoney(done.commission!.amount)} của ${done.commission!.referrerLabel} (ví không còn đủ)`
        );
      }
      onClose();
      onDone();
    } catch (err) {
      // Lỗi lúc bấm (MISA không xóa được tờ nháp, tờ vừa được ký…) — bày ngay trong hộp.
      setBlocked(err instanceof ApiError ? err.message : "Không hủy được, thử lại sau");
      setPreview(null);
    } finally {
      setSubmitting(false);
    }
  }

  const periodChanged = preview !== null && preview.periodEndBefore !== preview.periodEndAfter;

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="size-5" />
            Hủy ghi nhận khoản thu này?
          </DialogTitle>
          <DialogDescription>
            Dùng khi anh đã bấm xác nhận nhầm hoặc trùng với khoản máy tự ghi. Khoản do payOS /
            App Store ghi là tiền thật — không hủy ở đây.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted px-3 py-2 text-sm">
          <p className="font-medium">
            {formatMoney(entry.amount)} · {entry.note ?? "Thu phí gói"}
          </p>
          <p className="text-xs text-muted-foreground">
            {entry.customer ? `${entry.customer.fullName} · ${entry.customer.email ?? "—"}` : "—"} · ghi bởi{" "}
            {entry.createdByName}
          </p>
        </div>

        {preview === null && blocked === null && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang kiểm hạn gói và tờ nháp hóa đơn…
          </p>
        )}

        {blocked !== null && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">Máy không tự hủy được khoản này</p>
            <p className="mt-1">{blocked}</p>
          </div>
        )}

        {preview !== null && (
          <ul className="space-y-2 text-sm">
            <li>
              <span className="font-medium">Sổ quỹ:</span> xóa dòng thu {formatMoney(preview.amount)} và chứng từ
              thanh toán của nó.
            </li>
            <li>
              <span className="font-medium">Hạn gói của khách:</span>{" "}
              {periodChanged ? (
                <>
                  {vnDate(preview.periodEndBefore)} → <b>{vnDate(preview.periodEndAfter)}</b>
                </>
              ) : (
                <>giữ nguyên {vnDate(preview.periodEndAfter)}</>
              )}
              {preview.shiftedPayments > 0 &&
                ` (dời kỳ của ${preview.shiftedPayments} khoản thanh toán ghi sau cho khớp)`}
              .
            </li>
            <li>
              <span className="font-medium">Hóa đơn:</span> {draftLine(preview.invoiceDraft)}
            </li>
            <li>
              <span className="font-medium">Hoa hồng giới thiệu:</span>{" "}
              {preview.commission === null
                ? "khoản này không sinh hoa hồng."
                : preview.commission.recoverable
                  ? `thu hồi ${formatMoney(preview.commission.amount)} khỏi ví của ${preview.commission.referrerLabel}.`
                  : `ví của ${preview.commission.referrerLabel} không còn đủ ${formatMoney(preview.commission.amount)} — máy KHÔNG trừ, anh xử lý riêng.`}
            </li>
            <li className="text-xs text-muted-foreground">
              Không gỡ được: thư &ldquo;gói đã kích hoạt&rdquo; đã gửi khách. Toàn bộ khoản bị gỡ được chép vào
              Nhật ký thao tác.
            </li>
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {preview !== null ? "Giữ lại" : "Đóng"}
          </Button>
          {preview !== null && (
            <Button variant="destructive" onClick={handleVoid} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Hủy ghi nhận
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
