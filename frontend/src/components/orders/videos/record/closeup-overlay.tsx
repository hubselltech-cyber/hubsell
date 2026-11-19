"use client";

import * as React from "react";

import { movePip, pictureArea, resizePip, type PipCorner, type PipSettings } from "@/lib/pack-video-recorder/pip-layout";
import type { RecorderState } from "@/lib/pack-video-recorder/recorder";
import { cn } from "@/lib/utils";

/**
 * Ô CẬN CẢNH TRÊN KHUNG XEM TRƯỚC (anh Trung 19/11/2026 — docs/VIDEO-DONG-HANG-THIET-KE.md mục 22).
 *
 * Hiện ĐÚNG như ô được ghép vào tệp video: cùng chỗ, cùng cỡ, cùng vùng hình (pip-layout.ts là nguồn tính chung;
 * `object-cover` + `scale(zoom)` ở đây tương đương vùng cắt của bộ ghép hình). Chỉ hiện khi tệp cũng có ô: camera
 * cận đang chạy, hoặc vừa mất giữa chừng (ô xám có chữ báo).
 *
 * Chế độ "Chỉnh vị trí": kéo ô để dời, kéo một trong bốn góc để đổi cỡ; phím mũi tên dời 1 %, giữ Shift + mũi tên
 * đổi cỡ. Ngoài chế độ này ô không nhận chuột (không che thao tác trên khung hình).
 */

const CORNERS: { corner: PipCorner; className: string }[] = [
  // Nút kéo nằm TRONG góc ô: ô sát mép khung hình thì nút vẫn hiện trọn, không bị khung cắt mất.
  { corner: "nw", className: "left-0 top-0 cursor-nwse-resize" },
  { corner: "ne", className: "right-0 top-0 cursor-nesw-resize" },
  { corner: "sw", className: "bottom-0 left-0 cursor-nesw-resize" },
  { corner: "se", className: "bottom-0 right-0 cursor-nwse-resize" },
];

const pct = (v: number) => `${v * 100}%`;

export function CloseupOverlay({
  state,
  adjusting,
  videoRef,
  onPip,
}: {
  state: RecorderState;
  adjusting: boolean;
  /** Bộ quay gắn luồng hình camera cận vào thẻ <video> này. */
  videoRef: (video: HTMLVideoElement | null) => void;
  onPip: (next: PipSettings) => void;
}) {
  const areaRef = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ mode: "move" | PipCorner; startX: number; startY: number; start: PipSettings } | null>(null);
  const { closeup, pip } = state;
  if (closeup.phase !== "on" && closeup.phase !== "lost") return null;
  const area = pictureArea(state.camera);

  const begin = (mode: "move" | PipCorner, event: React.PointerEvent<HTMLElement>) => {
    if (!adjusting) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, startX: event.clientX, startY: event.clientY, start: pip };
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const rect = areaRef.current?.getBoundingClientRect();
    if (!d || !rect || rect.width <= 0 || rect.height <= 0) return;
    const dx = (event.clientX - d.startX) / rect.width;
    const dy = (event.clientY - d.startY) / rect.height;
    onPip(d.mode === "move" ? movePip(d.start, dx, dy) : resizePip(d.start, d.mode, dx, dy));
  };
  const end = () => {
    drag.current = null;
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!adjusting) return;
    const step = 0.01;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    onPip(event.shiftKey ? resizePip(pip, "se", d[0], d[1]) : movePip(pip, d[0], d[1]));
  };

  return (
    <div
      ref={areaRef}
      className="pointer-events-none absolute"
      style={{ left: pct(area.left), top: pct(area.top), width: pct(area.width), height: pct(area.height) }}
    >
      <div
        role={adjusting ? "group" : undefined}
        aria-label={adjusting ? "Ô cận cảnh — kéo để dời, kéo góc để đổi cỡ" : undefined}
        tabIndex={adjusting ? 0 : undefined}
        onPointerDown={(event) => begin("move", event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        className={cn(
          "absolute touch-none select-none border-2 border-white bg-slate-800 outline-none",
          adjusting && "pointer-events-auto cursor-move ring-2 ring-emerald-400 ring-offset-0 focus-visible:ring-4"
        )}
        style={{ left: pct(pip.x), top: pct(pip.y), width: pct(pip.w), height: pct(pip.h) }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <video
            ref={videoRef}
            className="size-full object-cover"
            style={{ transform: `scale(${pip.zoom})` }}
            autoPlay
            muted
            playsInline
          />
          {closeup.phase === "lost" && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-800 px-1 text-center font-mono text-xs font-semibold text-white">
              Mất camera cận cảnh
            </div>
          )}
        </div>
        {adjusting &&
          CORNERS.map(({ corner, className }) => (
            <span
              key={corner}
              aria-hidden
              onPointerDown={(event) => begin(corner, event)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className={cn("absolute size-3.5 rounded-full border-2 border-white bg-emerald-500 shadow", className)}
            />
          ))}
      </div>
    </div>
  );
}
