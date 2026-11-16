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

import { VideoPlayer } from "./video-player";

/** Hộp XEM NHANH một video ngay từ bảng; việc chuẩn bị bằng chứng làm ở trang hồ sơ của đơn. */
export function QuickViewDialog({
  video,
  onClose,
}: {
  video: PackVideoRow | null;
  onClose: () => void;
}) {
  // Khung dọc: bề ngang tối đa tính từ chiều cao màn để trình phát không tràn khỏi hộp.
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
            <div className="mx-auto w-full" style={{ maxWidth: `calc((100dvh - 14rem) * ${ratio})` }}>
              <VideoPlayer video={video} autoPlay />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
