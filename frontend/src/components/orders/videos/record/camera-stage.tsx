"use client";

import * as React from "react";
import { AlertTriangle, Camera, CameraOff, PackageOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CODE_LINES_DELAY_MS } from "@/lib/pack-video-recorder/config";
import type { RecorderState } from "@/lib/pack-video-recorder/recorder";
import type { SessionClip } from "@/lib/pack-video-recorder/session";
import { formatStamp, stampCodeLines } from "@/lib/pack-video-recorder/stamp-canvas";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import type { PipSettings } from "@/lib/pack-video-recorder/pip-layout";

import { ChannelBadge, shopNameOf } from "../video-bits";
import { CloseupOverlay } from "./closeup-overlay";
import { KIND_ACCENT, formatElapsed, useElapsedSeconds } from "./record-bits";

/**
 * NHÃN TRẠNG THÁI TO trên khung hình (anh Trung 16/11: "Trạng thái đang quay… cần dễ nhìn hơn").
 * Bốn trạng thái, bốn màu khác hẳn nhau để liếc là biết: chưa bật camera · sẵn sàng · đang quay · mất camera.
 * Ở chế độ khui hàng hoàn nhãn "sẵn sàng" và "đang quay" đổi sang màu tím + câu chữ riêng (xem KIND_ACCENT).
 */
/**
 * NGÀY GIỜ TRÊN KHUNG XEM TRƯỚC — cùng chữ, cùng chỗ (góc trái trên) với ngày giờ in vào tệp video.
 *
 * Anh Trung 16/11/2026: "Cả video khui hàng và đóng hàng đang bị thiếu hiển thị thời gian ngày giờ rồi em".
 * Tệp quay ra VẪN có ngày giờ (đã cắt khung hình ra soi), nhưng khung xem trước là hình thô của camera nên
 * người đóng hàng không thấy → tưởng thiếu. Bài học cũ trên điện thoại (14/11): xem trước phải hiện đúng như tệp.
 * Dùng chung hàm định dạng với bộ in vào tệp (formatStamp) để hai chỗ không bao giờ lệch chữ.
 */
/**
 * 18/11/2026 — thêm các DÒNG MÃ của clip đang quay ("Mã vận đơn: …", "Mã đơn hàng: …") ngay dưới ngày giờ, đúng
 * chữ và đúng thứ tự in vào tệp (stampCodeLines). Anh Trung thử bản in mã: "quay xong thì đã in mã vận đơn ra
 * rồi còn màn xem trực tiếp lúc quay thì chưa hiện ra".
 */
/**
 * 20/11/2026 — hai dòng mã hiện TRỄ 1 giây so với lúc clip mở (CODE_LINES_DELAY_MS, anh Trung: "để 1 giây trễ"), đúng
 * như trong tệp. `showAtMs` = mốc được hiện của clip đang quay; đổi clip là ẩn ngay, không nháy mã mới trước mốc.
 */
function LiveStamp({ lines, showAtMs }: { lines: readonly string[]; showAtMs: number | null }) {
  const [text, setText] = React.useState(() => formatStamp(new Date()));
  React.useEffect(() => {
    const timer = setInterval(() => setText(formatStamp(new Date())), 250);
    return () => clearInterval(timer);
  }, []);
  // Ghi lại MỐC đã tới (không phải cờ bật / tắt): clip mới có mốc khác → tự ẩn ngay trong lượt vẽ đó.
  const [dueFor, setDueFor] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (showAtMs === null) return;
    const timer = setTimeout(() => setDueFor(showAtMs), Math.max(0, showAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [showAtMs]);
  const shown = showAtMs !== null && dueFor === showAtMs ? lines : [];
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1">
      <span
        className="rounded bg-black/60 px-2 py-0.5 font-mono text-sm font-semibold tabular-nums text-white"
        title="Ngày giờ này được in vào video"
        suppressHydrationWarning
      >
        {text}
      </span>
      {shown.map((line) => (
        <span
          key={line}
          className="max-w-full truncate rounded bg-black/60 px-2 py-0.5 font-mono text-base font-semibold text-white"
          title="Dòng này được in vào video"
        >
          {line}
        </span>
      ))}
    </div>
  );
}

function StatusPill({ state }: { state: RecorderState }) {
  const elapsed = useElapsedSeconds(state.current?.startedAtMs ?? null);
  const base = "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-base font-semibold shadow-sm";
  switch (state.phase) {
    case "recording": {
      // Loại của CHÍNH clip đang quay (có thể vừa được đổi theo cảnh báo đơn đang hoàn).
      const kind = state.current?.kind ?? state.kind;
      return (
        <span className={cn(base, KIND_ACCENT[kind].recordingPill)} role="status">
          <span className="size-2.5 animate-pulse rounded-full bg-rose-600 motion-reduce:animate-none" aria-hidden />
          {kind === "UNBOX" ? "Đang quay khui hàng" : "Đang quay"}{" "}
          <span className="tabular-nums">{formatElapsed(elapsed)}</span>
        </span>
      );
    }
    case "ready": {
      const scanning = state.autoCut && state.scanAvailable;
      return (
        <span className={cn(base, KIND_ACCENT[state.kind].readyPill)} role="status">
          {state.kind === "UNBOX"
            ? scanning
              ? "Sẵn sàng · giơ tem kiện hoàn"
              : "Sẵn sàng khui hàng"
            : scanning
              ? "Sẵn sàng · giơ tem"
              : "Sẵn sàng"}
        </span>
      );
    }
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
  const unbox = clip.kind === "UNBOX";
  if (clip.manual) {
    return <p className={TEXT_SUB}>{unbox ? "Khui · quay tay, chưa khớp đơn" : "Quay tay · không gắn với tem nào"}</p>;
  }
  if (clip.order === undefined) return <p className={TEXT_SUB}>Đang tìm đơn của tem này…</p>;
  if (clip.order === null) {
    return <p className="text-xs font-medium text-amber-700">{unbox ? "Khui · chưa khớp đơn" : "Chưa khớp đơn"}</p>;
  }
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
 * NỬA TRÁI của màn quay: khung xem trước camera + nhãn trạng thái + dải báo sự cố + hàng [ô "Đang quay cho tem" |
 * ô "Lượt quay này"].
 * Thẻ <video> và lớp phủ vẽ khung bao mã do bộ quay (PackRecorder) điều khiển qua hai ref.
 *
 * RÀO CHỐNG CHỌN NHẦM CHẾ ĐỘ nằm ngay dưới khung hình (cảnh báo, không khóa cứng):
 *   · đang quay ĐÓNG HÀNG mà tem thuộc đơn có hoàn → hỏi "Chuyển sang quay khui hàng?" (hai nút);
 *   · đang quay KHUI mà đơn chưa có yêu cầu hoàn → một dòng nhắc, vẫn quay bình thường.
 */
export function CameraStage({
  state,
  currentClip,
  videoRef,
  boxRef,
  closeupVideoRef,
  adjustingPip,
  session,
  onPip,
  onTurnOn,
  canSwitchToUnbox,
  onSwitchToUnbox,
  onKeepPack,
}: {
  /** Ô "Lượt quay này" (bộ đếm tải lên / đã quay) — đứng cạnh ô "Đang quay cho tem" dưới khung hình. */
  session: React.ReactNode;
  /** Thẻ <video> của ô cận cảnh (camera thứ hai, tùy chọn) — bộ quay gắn luồng hình vào. */
  closeupVideoRef: (video: HTMLVideoElement | null) => void;
  /** Đang ở chế độ "Chỉnh vị trí" ô cận cảnh. */
  adjustingPip: boolean;
  onPip: (next: PipSettings) => void;
  state: RecorderState;
  /** Clip đang quay của lượt (để hiện đơn khớp với tem). */
  currentClip: SessionClip | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  boxRef: React.RefObject<HTMLCanvasElement | null>;
  onTurnOn: () => void;
  /** "Chuyển sang khui": đổi loại của clip đang quay rồi chuyển chế độ. */
  /** Người này có quyền quay khui không (nhân viên thiếu quyền Đối soát đơn hoàn → không hỏi "Chuyển sang khui"). */
  canSwitchToUnbox: boolean;
  onSwitchToUnbox: () => void;
  /** "Vẫn là đóng hàng": gạt câu hỏi, không hỏi lại cho cùng tem trong lượt. */
  onKeepPack: (clip: SessionClip) => void;
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
  // Màu viền khung theo loại của clip đang quay; lúc nghỉ thì theo chế độ đang chọn.
  const kind = state.current?.kind ?? state.kind;
  const unbox = kind === "UNBOX";
  const noReturnHint =
    !!currentClip && currentClip.kind === "UNBOX" && !!currentClip.order && !currentClip.order.hasReturn;
  // Các dòng mã đang được in vào video của clip này (clip quay tay không có tem → không in mã).
  const current = state.current;
  const matchedOrderCode =
    current && currentClip && currentClip.code === current.code ? (currentClip.order?.orderCode ?? null) : null;
  const stampLines = current && !current.manual ? stampCodeLines(current.code, matchedOrderCode) : [];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={cn("relative aspect-video shrink-0 overflow-hidden rounded-xl bg-black", KIND_ACCENT[kind].frame)}>
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
        {/* Ô cận cảnh nằm DƯỚI ngày giờ + dòng mã, đúng thứ tự vẽ trong tệp video. */}
        {cameraOn && <CloseupOverlay state={state} adjusting={adjustingPip} videoRef={closeupVideoRef} onPip={onPip} />}
        {cameraOn && (
          <LiveStamp
            lines={stampLines}
            showAtMs={current && !current.manual ? current.startedAtMs + CODE_LINES_DELAY_MS : null}
          />
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
      {currentClip?.returnPrompt && canSwitchToUnbox && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
        >
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-amber-800">
            <PackageOpen className="size-5 shrink-0" aria-hidden />
            Đơn này đang hoàn về. Chuyển sang quay khui hàng?
          </p>
          <span className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={onSwitchToUnbox}>
              Chuyển sang khui
            </Button>
            <Button size="sm" variant="outline" onClick={() => onKeepPack(currentClip)}>
              Vẫn là đóng hàng
            </Button>
          </span>
        </div>
      )}
      {noReturnHint && (
        <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
          Đơn này chưa có yêu cầu hoàn — vẫn quay khui bình thường.
        </p>
      )}
      {showRepeat && state.repeat && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Tem <span className="font-mono">{state.repeat.code}</span> đã quay {state.kind === "UNBOX" ? "khui " : ""}rồi —
          không quay lại.
        </p>
      )}

      {/*
        HÀNG DƯỚI khung hình: ô tem đang quay (NGẮN — anh Trung 21/11: "phần này có mỗi mã vận đơn, cho ngắn lại để
        nhường chỗ cho tab bên cạnh nhiều thông tin hơn") + ô Lượt quay này (rộng gấp đôi, bộ
        đếm trên + danh sách clip dưới). Đáy hàng này thẳng đáy nút lớn ở cột phải (control-panel.tsx); flex-1: cột phải
        mà cao hơn thì hàng này giãn theo cho bằng đáy.
      */}
      <div className="grid flex-1 gap-3 sm:grid-cols-[minmax(11rem,1fr)_minmax(0,2fr)]">
        <Card className="[--card-spacing:--spacing(4)]">
          <CardContent className="@container space-y-1">
            <p className={cn(TEXT_SUB, state.current && unbox && cn("font-semibold", KIND_ACCENT.UNBOX.text))}>
              {state.current ? (unbox ? "Đang quay KHUI cho tem" : "Đang quay cho tem") : "Chưa quay"}
            </p>
            {state.current ? (
              <>
                <p className="break-all font-mono text-xl font-semibold leading-tight @xs:text-2xl">
                  {state.current.manual ? (unbox ? "Khui · quay tay" : "Quay tay") : state.current.code}
                </p>
                {currentClip && <TemSubline clip={currentClip} />}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {cameraOn
                  ? state.autoCut && state.scanAvailable
                    ? unbox
                      ? "Giơ tem của kiện hoàn thẳng vào camera để bắt đầu, hoặc bấm Bắt đầu quay khui."
                      : "Giơ tem thẳng vào camera để bắt đầu, hoặc bấm Bắt đầu quay."
                    : unbox
                      ? "Bấm Bắt đầu quay khui để quay."
                      : "Bấm Bắt đầu quay để quay."
                  : "Bật camera để bắt đầu."}
              </p>
            )}
          </CardContent>
        </Card>
        {session}
      </div>
    </div>
  );
}
