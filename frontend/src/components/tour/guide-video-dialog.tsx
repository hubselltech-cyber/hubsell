"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** Video hướng dẫn anh Trung tự quay (YouTube) — dùng chung cho trang tính năng + /guide. */
export const TIKTOK_ADS_VIDEO_ID = "jaGQEWVCPbs";

/** Khung YouTube 16:9 (nocookie, không gợi ý video kênh khác ở cuối). */
export function YoutubeEmbed({ videoId, title, autoplay = false }: { videoId: string; title: string; autoplay?: boolean }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border bg-black">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0${autoplay ? "&autoplay=1" : ""}`}
        title={title}
        className="size-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}

/**
 * Link "Video hướng dẫn" trên hàng tab trang tính năng: bấm là MỞ VIDEO NGAY trên trang
 * (hộp nổi + nút X), khách không phải rời trang sang /guide (anh Trung 17/10).
 * Đóng hộp = gỡ iframe nên video dừng hẳn.
 */
export function GuideVideoLink({ videoId, title, hint }: { videoId: string; title: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
        title={hint}
      >
        <CircleHelp className="size-3.5" />
        Video hướng dẫn
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-4xl">
          <DialogTitle className="pr-8">{title}</DialogTitle>
          {open && <YoutubeEmbed videoId={videoId} title={title} autoplay />}
        </DialogContent>
      </Dialog>
    </>
  );
}
