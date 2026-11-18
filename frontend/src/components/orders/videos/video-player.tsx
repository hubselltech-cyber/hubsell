"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Play, RotateCw } from "lucide-react";

import { ApiError, fetchPackVideoUrl, type PackVideoRow } from "@/lib/api";
import { PACK_VIDEO_STATUS_META, formatClipDuration, isPackVideoPlayable } from "@/lib/pack-video";
import { cn } from "@/lib/utils";

/** Xin lại đường dẫn sớm hơn hạn ngần này để không chết giữa lúc tua. */
const EXPIRY_MARGIN_MS = 15_000;

type PlayerState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; url: string; expiresAt: number; resumeAt: number }
  | { phase: "error"; message: string };

/**
 * TRÌNH PHÁT MỘT VIDEO ĐÓNG / KHUI HÀNG.
 *
 * - Không tải gì cho tới khi người dùng bấm phát: đường dẫn xem là đường dẫn ký sẵn hạn
 *   ngắn, xin từ máy chủ đúng lúc bấm.
 * - Đang xem mà đường dẫn hết hạn (thẻ video báo lỗi sau mốc hạn) → tự xin đường dẫn mới
 *   và phát tiếp từ đúng giây đang xem. Lỗi khác → hiện câu báo + nút Thử lại.
 * - Khung giữ đúng tỷ lệ tệp (3:4 hoặc 9:16) ngay từ lúc chưa tải nên trang không nhảy.
 */
export function VideoPlayer({
  video,
  autoPlay = false,
  className,
}: {
  video: Pick<PackVideoRow, "id" | "status" | "width" | "height" | "durationSec">;
  /** true = xin đường dẫn và phát ngay khi hiện (hộp xem nhanh). */
  autoPlay?: boolean;
  className?: string;
}) {
  const [state, setState] = React.useState<PlayerState>({ phase: "idle" });
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const playable = isPackVideoPlayable(video.status);
  const ratio = video.width > 0 && video.height > 0 ? `${video.width} / ${video.height}` : "3 / 4";

  const load = React.useCallback(
    async (resumeAt: number) => {
      setState({ phase: "loading" });
      try {
        const res = await fetchPackVideoUrl(video.id, false);
        const expiresAt = new Date(res.expiresAt).getTime();
        setState({
          phase: "ready",
          url: res.url,
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 60_000,
          resumeAt,
        });
      } catch (err) {
        setState({
          phase: "error",
          message: err instanceof ApiError ? err.message : "Không lấy được đường dẫn xem video",
        });
      }
    },
    [video.id]
  );

  // Đổi sang video khác (hộp xem nhanh dùng lại component) → về trạng thái chờ.
  React.useEffect(() => {
    setState({ phase: "idle" });
  }, [video.id]);

  React.useEffect(() => {
    if (autoPlay && playable) void load(0);
  }, [autoPlay, playable, load]);

  function handleLoadedMetadata() {
    const el = videoRef.current;
    if (!el || state.phase !== "ready") return;
    if (state.resumeAt > 0) el.currentTime = state.resumeAt;
    // Trình duyệt có thể chặn tự phát có tiếng — người dùng bấm nút phát của thẻ video là được.
    void el.play().catch(() => undefined);
  }

  function handleError() {
    if (state.phase !== "ready") return;
    const at = videoRef.current?.currentTime ?? 0;
    if (Date.now() >= state.expiresAt - EXPIRY_MARGIN_MS) {
      void load(at);
      return;
    }
    setState({ phase: "error", message: "Không phát được video. Kiểm tra mạng rồi thử lại." });
  }

  const statusMeta = PACK_VIDEO_STATUS_META[video.status];

  return (
    <div
      // bg-black (không phải slate-900): thang slate bị lật trong giao diện tối, nền trình phát phải đen ở cả hai.
      className={cn("relative w-full overflow-hidden rounded-xl bg-black", className)}
      style={{ aspectRatio: ratio }}
    >
      {state.phase === "ready" ? (
        <video
          ref={videoRef}
          key={state.url}
          src={state.url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onError={handleError}
          className="absolute inset-0 size-full bg-black object-contain"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-white">
          {!playable ? (
            <>
              <AlertTriangle className="size-6 opacity-80" />
              <p className="text-sm">{statusMeta?.label ?? "Video chưa xem được"}</p>
              {video.status === "PENDING" && (
                <p className="text-xs opacity-70">Video còn nằm trên điện thoại, chưa tải lên xong.</p>
              )}
            </>
          ) : state.phase === "loading" ? (
            <Loader2 className="size-7 animate-spin opacity-80 motion-reduce:animate-none" />
          ) : state.phase === "error" ? (
            <>
              <AlertTriangle className="size-6 opacity-80" />
              <p className="text-sm">{state.message}</p>
              <button
                type="button"
                onClick={() => void load(0)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-white/25"
              >
                <RotateCw className="size-4" />
                Thử lại
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label="Phát video"
                onClick={() => void load(0)}
                className="flex h-12 w-[4.25rem] items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg transition-colors hover:bg-emerald-600"
              >
                <Play className="size-6 translate-x-0.5 fill-current" />
              </button>
              <p className="text-xs tabular-nums opacity-70">{formatClipDuration(video.durationSec)}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
