"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TourPlayer } from "@/components/tour/guide-tour-player";
import type { GuideTour } from "@/lib/guide-tours";

/**
 * HỘP THOẠI HƯỚNG DẪN ĐỘNG — mở TourPlayer ngay tại chỗ (vd nút "Hướng dẫn
 * kết nối" trên đầu khối sàn ở trang Kênh bán) thay vì bắt người dùng rời
 * sang /guide. Player chỉ mount khi mở → đóng là dừng hẳn animation + giọng.
 */
export function TourDialog({
  open,
  onOpenChange,
  tour,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tour: GuideTour | null;
  title: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ??
              "Hướng dẫn tự chạy như video — bấm nút loa để nghe thuyết minh, bấm chấm tròn để nhảy bước."}
          </DialogDescription>
        </DialogHeader>
        {open && tour && (
          <TourPlayer
            steps={tour.steps}
            voiceDir={tour.voiceDir}
            alt={`Hướng dẫn: ${title}`}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
