"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PackVideoRow } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { formatClipDuration } from "@/lib/pack-video";

import { DeleteVideoButton } from "./video-delete";
import { VideoPlayer } from "./video-player";

/**
 * Hộp XEM NHANH một video ngay từ bảng; việc chuẩn bị bằng chứng làm ở trang hồ sơ của đơn.
 * Chủ shop có nút "Xóa video" ngay dưới trình phát (26/11/2026) — xóa xong hộp tự đóng, bảng tự tải lại.
 */
export function QuickViewDialog({
  video,
  onClose,
}: {
  video: PackVideoRow | null;
  onClose: () => void;
}) {
  // Khung dọc: bề ngang tối đa tính từ chiều cao màn để trình phát + hàng nút Xóa không tràn khỏi hộp.
  const ratio = video && video.width > 0 && video.height > 0 ? video.width / video.height : 0.75;
  return (
    <Dialog
      open={video !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {video && (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono">{video.trackingCode}</DialogTitle>
              <DialogDescription>
                Quay {formatDateTime(video.recordedAt)} · {formatClipDuration(video.durationSec)}
                {video.recordedByName ? ` · ${video.recordedByName}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="mx-auto w-full" style={{ maxWidth: `calc((100dvh - 17rem) * ${ratio})` }}>
              <VideoPlayer video={video} autoPlay />
            </div>
            <div className="flex justify-end empty:hidden">
              <DeleteVideoButton video={video} onDeleted={onClose} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
