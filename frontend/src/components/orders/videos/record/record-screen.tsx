"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PACK_VIDEOS_PATH } from "@/lib/pack-video";

import { CameraStage } from "./camera-stage";
import { ControlPanel } from "./control-panel";
import { JournalPanel } from "./journal-panel";
import { usePackRecorder } from "./use-pack-recorder";

/**
 * MÀN QUAY VIDEO ĐÓNG HÀNG BẰNG WEBCAM (/orders/videos/record) — docs/VIDEO-DONG-HANG-THIET-KE.md mục 13.
 *
 * Bố cục anh Trung duyệt bằng phác thảo 16/11/2026 ("Được, dựng đi"): trái là khung camera to có nhãn
 * trạng thái và ô "Đang quay cho tem"; phải là cột điều khiển (Camera · Tự cắt theo tem · một nút lớn
 * Bắt đầu quay ↔ Dừng · Lượt quay này); dưới cùng là Nhật ký (anh dặn thêm: "giữ lại cả nhật ký… khá cần").
 * Không có thứ gì của người thử (độ phân giải, bitrate, năm cửa) — các số đó cố định ở lib/pack-video-recorder/config.ts.
 *
 * Tệp này chỉ được nạp phía trình duyệt (videos-page.tsx nạp động, không dựng phía máy chủ).
 */
export function RecordScreen() {
  const recorder = usePackRecorder();
  const currentClip = recorder.clips.find((c) => c.status === "recording") ?? null;

  return (
    <div className="space-y-5">
      <Link href={PACK_VIDEOS_PATH} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="size-4" />
        Về danh sách video
      </Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(19rem,1fr)]">
        <CameraStage
          state={recorder.state}
          currentClip={currentClip}
          videoRef={recorder.videoRef}
          boxRef={recorder.boxRef}
          onTurnOn={() => void recorder.toggleCamera()}
        />
        <ControlPanel
          state={recorder.state}
          clips={recorder.clips}
          onToggleCamera={() => void recorder.toggleCamera()}
          onSelectCamera={(deviceId) => void recorder.selectCamera(deviceId)}
          onAutoCut={recorder.setAutoCut}
          onPrimary={() => void recorder.primary()}
        />
      </div>

      <JournalPanel entries={recorder.journal} />
    </div>
  );
}
