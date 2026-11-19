"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PACK_VIDEOS_PATH } from "@/lib/pack-video";

import { CameraStage } from "./camera-stage";
import { ControlPanel } from "./control-panel";
import { JournalPanel } from "./journal-panel";
import { QueueNotice } from "./queue-notice";
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
 *
 * HAI CHẾ ĐỘ QUAY (anh Trung 16/11/2026: "Chưa có đường quay video khui hàng, và phải làm sao để khi quay video khui
 * hàng không bị trùng mã đơn hàng với video đóng hàng"): Đóng hàng | Khui hàng hoàn, chọn ở đầu cột điều khiển.
 * `?mode=unbox` mở sẵn chế độ khui — nút "Quay khui hàng" của trang Đối soát đơn hoàn dẫn vào bằng địa chỉ này.
 * (useSearchParams: videos-page.tsx bọc màn này trong <Suspense> theo đúng yêu cầu của Next khi build.)
 */
export function RecordScreen() {
  const mode = useSearchParams().get("mode");
  const recorder = usePackRecorder(mode === "unbox" ? "UNBOX" : "PACK");
  const currentClip = recorder.clips.find((c) => c.status === "recording") ?? null;
  // "Chỉnh vị trí" ô cận cảnh: chỉ có nghĩa khi camera cận đang chạy và KHÔNG có clip đang quay (bộ quay cũng từ
  // chối đổi bố cục giữa clip) → clip vừa mở hay camera cận vừa mất thì tự thoát chế độ chỉnh.
  const [adjustWanted, setAdjustWanted] = React.useState(false);
  const adjusting = adjustWanted && recorder.state.closeup.phase === "on" && recorder.state.phase !== "recording";

  return (
    <div className="space-y-5">
      <Link href={PACK_VIDEOS_PATH} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="size-4" />
        Về danh sách video
      </Link>

      {/* Tình trạng hàng chờ gửi (mất mạng, mạng chậm, ổ đĩa đầy) — tự mất khi hết; vẫn quay bình thường. */}
      <QueueNotice queue={recorder.queue} onRetryNow={recorder.retryQueueNow} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(19rem,1fr)]">
        <CameraStage
          state={recorder.state}
          currentClip={currentClip}
          videoRef={recorder.videoRef}
          boxRef={recorder.boxRef}
          closeupVideoRef={recorder.closeupVideoRef}
          adjustingPip={adjusting}
          onPip={recorder.setPip}
          onTurnOn={() => void recorder.toggleCamera()}
          onSwitchToUnbox={recorder.switchCurrentToUnbox}
          onKeepPack={recorder.keepAsPack}
        />
        <ControlPanel
          state={recorder.state}
          clips={recorder.clips}
          diskFull={recorder.queue.disk === "full"}
          closeup={{
            adjusting,
            onEnabled: recorder.setCloseupEnabled,
            onSelect: recorder.selectCloseup,
            onAdjusting: setAdjustWanted,
            onPip: recorder.setPip,
          }}
          onKind={recorder.setKind}
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
