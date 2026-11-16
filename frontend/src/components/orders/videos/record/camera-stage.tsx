"use client";

import * as React from "react";
import { AlertTriangle, Camera, CameraOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { RecorderState } from "@/lib/pack-video-recorder/recorder";
import type { SessionClip } from "@/lib/pack-video-recorder/session";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { ChannelBadge, shopNameOf } from "../video-bits";
import { formatElapsed, useElapsedSeconds } from "./record-bits";

/**
 * NHÃN TRẠNG THÁI TO trên khung hình (anh Trung 16/11: "Trạng thái đang quay… cần dễ nhìn hơn").
 * Bốn trạng thái, bốn màu khác hẳn nhau để liếc là biết: chưa bật camera · sẵn sàng · đang quay · mất camera.
 */
function StatusPill({ state }: { state: RecorderState }) {
  const elapsed = useElapsedSeconds(state.current?.startedAtMs ?? null);
  const base = "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-base font-semibold shadow-sm";
  switch (state.phase) {
    case "recording":
      return (
        <span className={cn(base, "border-rose-200 bg-rose-50 text-rose-700")} role="status">
          <span className="size-2.5 animate-pulse rounded-full bg-rose-600 motion-reduce:animate-none" aria-hidden />
          Đang quay <span className="tabular-nums">{formatElapsed(elapsed)}</span>
        </span>
      );
    case "ready":
      return (
        <span className={cn(base, "border-emerald-200 bg-emerald-50 text-emerald-700")} role="status">
          {state.autoCut && state.scanAvailable ? "Sẵn sàng · giơ tem" : "Sẵn sàng"}
        </span>
      );
    case "lost":
      return (
        <span className={cn(base, "border-amber-200 bg-amber-50 text-amber-800")} role="status">
          <AlertTriangle className="size-4" aria-hidden />
          Mất camera
        </span>
      );
    case "opening":
      return (
        <span className={cn(base, "border-slate-200 bg-slate-100 text-slate-700")} role="status">
          Đang bật camera…
        </span>
      );
    default:
      return (
        <span className={cn(base, "border-slate-200 bg-slate-100 text-slate-700")} role="status">
          Chưa bật camera
        </span>
      );
  }
}

/** Dòng phụ dưới mã tem: đơn khớp được, "Chưa khớp đơn", hoặc "Quay tay". */
function TemSubline({ clip }: { clip: SessionClip }) {
  if (clip.manual) return <p className={TEXT_SUB}>Quay tay · không gắn với tem nào</p>;
  if (clip.order === undefined) return <p className={TEXT_SUB}>Đang tìm đơn của tem này…</p>;
  if (clip.order === null) return <p className="text-xs font-medium text-amber-700">Chưa khớp đơn</p>;
  const { order } = clip;
  const first = order.items[0];
  const more = order.items.length - 1;
  const shop = shopNameOf(order.channelPlatform, order.shopName);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <ChannelBadge platform={order.channelPlatform} />
      <span className={cn(TEXT_SUB, "font-mono")}>{order.orderCode}</span>
      {shop && <span className={TEXT_SUB}>· {shop}</span>}
      {first && (
        <span className={cn(TEXT_SUB, "min-w-0 max-w-full truncate")} title={first.name}>
          · {first.name} ×{first.quantity}
          {more > 0 ? ` (+${more} món)` : ""}
        </span>
      )}
    </div>
  );
}

/**
 * NỬA TRÁI của màn quay: khung xem trước camera + nhãn trạng thái + dải báo sự cố + ô "Đang quay cho tem".
 * Thẻ <video> và lớp phủ vẽ khung bao mã do bộ quay (PackRecorder) điều khiển qua hai ref.
 */
export function CameraStage({
  state,
  currentClip,
  videoRef,
  boxRef,
  onTurnOn,
}: {
  state: RecorderState;
  /** Clip đang quay của lượt (để hiện đơn khớp với tem). */
  currentClip: SessionClip | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  boxRef: React.RefObject<HTMLCanvasElement | null>;
  onTurnOn: () => void;
}) {
  // "Tem này đã quay rồi" nháy 3 giây rồi tự tắt (âm boop-boop đã báo bằng tai).
  const repeatAt = state.repeat?.atMs ?? null;
  const [showRepeat, setShowRepeat] = React.useState(false);
  React.useEffect(() => {
    if (repeatAt === null) return;
    setShowRepeat(true);
    const timer = setTimeout(() => setShowRepeat(false), 3000);
    return () => clearTimeout(timer);
  }, [repeatAt]);

  const cameraOn = state.phase === "ready" || state.phase === "recording";

  return (
    <div className="min-w-0 space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-xl border bg-black">
        <video ref={videoRef} className="size-full object-contain" autoPlay muted playsInline />
        <canvas ref={boxRef} className="pointer-events-none absolute inset-0 size-full object-contain" aria-hidden />
        {!cameraOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300">
            {state.phase === "lost" ? <CameraOff className="size-10" aria-hidden /> : <Camera className="size-10" aria-hidden />}
            {state.phase === "off" && (
              // Nền khung hình luôn đen (cả giao diện sáng lẫn tối) → nút dùng màu cố định cho đủ tương phản.
              <Button
                variant="outline"
                onClick={onTurnOn}
                className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                Bật camera
              </Button>
            )}
          </div>
        )}
        <div className="absolute right-3 top-3">
          <StatusPill state={state} />
        </div>
      </div>

      {state.problem && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {state.problem}
        </p>
      )}
      {showRepeat && state.repeat && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Tem <span className="font-mono">{state.repeat.code}</span> đã quay rồi — không quay lại.
        </p>
      )}

      <Card>
        <CardContent className="space-y-1 py-4">
          <p className={TEXT_SUB}>{state.current ? "Đang quay cho tem" : "Chưa quay"}</p>
          {state.current ? (
            <>
              <p className="break-all font-mono text-2xl font-semibold leading-tight">
                {state.current.manual ? "Quay tay" : state.current.code}
              </p>
              {currentClip && <TemSubline clip={currentClip} />}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {cameraOn
                ? state.autoCut && state.scanAvailable
                  ? "Giơ tem thẳng vào camera để bắt đầu, hoặc bấm Bắt đầu quay."
                  : "Bấm Bắt đầu quay để quay."
                : "Bật camera để bắt đầu."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
