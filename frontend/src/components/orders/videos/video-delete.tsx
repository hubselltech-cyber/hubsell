"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage, deletePackVideo, type PackVideoRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { PACK_VIDEO_KIND_LABEL, formatClipDuration, isPackVideoPlayable } from "@/lib/pack-video";
import { usePackVideoCaps } from "@/lib/use-feature";

/**
 * NÚT "XÓA VIDEO" + hộp hỏi lại (26/11/2026) — chủ shop tự xóa TỪNG video đã lưu, không phải chờ luật tự xóa.
 *
 * Nằm cạnh trình phát (hộp xem nhanh, trang hồ sơ đơn) chứ không nằm trên dòng bảng: người xóa nhìn thấy đúng
 * video mình sắp xóa, và bảng không thêm nút dễ bấm nhầm. Chỉ chủ shop thấy nút (máy chủ cũng chặn nhân viên).
 * Xóa là hết — hộp nói rõ không khôi phục được và giờ đã quay không cộng lại; đơn đang có hoàn thì cảnh báo thêm
 * (cảnh báo, không khóa: chủ shop vẫn xóa được).
 */
export function DeleteVideoButton({
  video,
  onDeleted,
}: {
  video: PackVideoRow;
  /** Gọi sau khi máy chủ báo đã xóa (đóng hộp xem nhanh…). Danh sách tự tải lại. */
  onDeleted?: () => void;
}) {
  const { manage } = usePackVideoCaps();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (!manage || !isPackVideoPlayable(video.status)) return null;

  // Video khui hàng, đơn có hoàn, hoặc hệ thống đang giữ làm bằng chứng → nhắc tải về trước.
  const evidence = video.kind === "UNBOX" || video.order?.hasReturn === true || video.holdReason !== null;

  async function handleConfirm() {
    setBusy(true);
    try {
      await deletePackVideo(video.id);
      toast.success(`Đã xóa video ${video.trackingCode}`);
      setOpen(false);
      // Mọi ô đệm của trang video (danh sách, số chip, hồ sơ đơn, lịch sử xóa, thống kê) đọc lại.
      void qc.invalidateQueries({ queryKey: ["pack-videos"] });
      onDeleted?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Chưa xóa được video, thử lại sau."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-rose-700 hover:bg-rose-50 hover:text-rose-700"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
        Xóa video
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !busy) setOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa video này?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{video.trackingCode}</span> · {PACK_VIDEO_KIND_LABEL[video.kind]} · quay{" "}
              {formatDateTime(video.recordedAt)} · {formatClipDuration(video.durationSec)}
            </DialogDescription>
          </DialogHeader>

          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Xóa rồi không khôi phục được.</li>
            <li>Giờ đã quay của video này không được cộng lại.</li>
            <li>Mã vận đơn vẫn nằm ở tab Lịch sử xóa để tra lại.</li>
          </ul>

          {evidence && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                {video.kind === "UNBOX" ? "Đây là video khui hàng hoàn." : "Đơn này có hoàn."} Video là bằng chứng khi
                khiếu nại với sàn, nên tải về máy trước khi xóa.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirm()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="size-4" />}
              Xóa video
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
