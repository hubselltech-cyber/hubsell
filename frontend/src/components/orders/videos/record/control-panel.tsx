"use client";

import * as React from "react";
import { Camera, Clock, Package, PackageOpen, Play, RotateCcw, Scissors, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { formatHoursBalance } from "@/lib/pack-video";
import type { RecorderState } from "@/lib/pack-video-recorder/recorder";
import { retrySessionClip, type SessionClip } from "@/lib/pack-video-recorder/session";
import type { ClipKind } from "@/lib/pack-video-recorder/types";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { remainingLabel, usePackVideoHours } from "../hours-balance";
import { KIND_ACCENT, formatElapsed, shortCode, useElapsedSeconds } from "./record-bits";

function OnOffLabel({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium",
        on ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
      )}
    >
      {on ? onText : offText}
    </span>
  );
}

/**
 * Ô CHẾ ĐỘ QUAY: Đóng hàng | Khui hàng hoàn — đứng ĐẦU cột điều khiển vì nó quyết định video thuộc loại nào.
 * Anh Trung 16/11/2026: "Chưa có đường quay video khui hàng, và phải làm sao để khi quay video khui hàng không bị
 * trùng mã đơn hàng với video đóng hàng." Kiện hoàn về vẫn dán tem cũ, nên thứ phân biệt hai video là chế độ này.
 * Đang quay thì KHÓA công tắc (không biết clip dở thuộc loại nào); muốn đổi loại của clip đang quay thì dùng câu
 * hỏi "Chuyển sang quay khui hàng?" dưới khung hình.
 */
function ModeCard({ state, onChange }: { state: RecorderState; onChange: (kind: ClipKind) => void }) {
  const recording = state.phase === "recording";
  const unbox = state.kind === "UNBOX";
  return (
    <Card className={cn(unbox && "border-violet-300")}>
      <CardContent className="space-y-2 py-4">
        <div
          aria-disabled={recording}
          title={recording ? "Dừng clip đang quay rồi mới đổi chế độ" : undefined}
          className={cn(recording && "pointer-events-none opacity-60")}
        >
          <Segmented<ClipKind>
            ariaLabel="Chế độ quay"
            className="flex w-full [&>button]:flex-1 [&>button]:justify-center"
            value={state.kind}
            onChange={onChange}
            items={[
              { key: "PACK", label: "Đóng hàng", icon: <Package className="size-4" aria-hidden /> },
              { key: "UNBOX", label: "Khui hàng hoàn", icon: <PackageOpen className="size-4" aria-hidden /> },
            ]}
          />
        </div>
        {recording ? (
          <p className={TEXT_SUB}>Dừng clip đang quay rồi mới đổi chế độ.</p>
        ) : unbox ? (
          <p className={cn("text-sm font-medium", KIND_ACCENT.UNBOX.text)}>Quay đủ 6 mặt kiện trước khi mở.</p>
        ) : (
          <p className={TEXT_SUB}>Quay lúc đóng gói kiện gửi đi.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Ô CAMERA: bật / tắt một chạm, tên camera + khổ hình, chọn camera khi máy có nhiều cái. */
function CameraCard({
  state,
  onToggle,
  onSelect,
}: {
  state: RecorderState;
  onToggle: () => void;
  onSelect: (deviceId: string) => void;
}) {
  const on = state.phase === "ready" || state.phase === "recording";
  const opening = state.phase === "opening";
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-base font-semibold">
            <Camera className="size-5 text-muted-foreground" aria-hidden />
            Camera
          </span>
          <span className="flex items-center gap-2">
            <OnOffLabel on={on} onText="Đang bật" offText={opening ? "Đang bật…" : "Đang tắt"} />
            <Switch
              checked={on || opening}
              disabled={opening}
              onCheckedChange={onToggle}
              aria-label={on ? "Tắt camera" : "Bật camera"}
            />
          </span>
        </div>
        <p
          className={cn(TEXT_SUB, "truncate")}
          title={state.camera ? `${state.camera.label} · ${state.camera.width}×${state.camera.height}` : undefined}
        >
          {state.camera
            ? `${state.camera.label} · ${state.camera.width}×${state.camera.height}`
            : "Bật camera để xem hình và bắt đầu quay."}
        </p>
        {/* Máy bàn đóng hàng thường có 1–4 camera → ô chọn gốc của trình duyệt là đủ. */}
        {state.devices.length > 1 && (
          <NativeSelect
            aria-label="Chọn camera"
            value={state.camera?.deviceId ?? ""}
            disabled={opening}
            onChange={(event) => {
              if (event.target.value) onSelect(event.target.value);
            }}
          >
            {!state.camera && <option value="">Chọn camera…</option>}
            {state.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </CardContent>
    </Card>
  );
}

/** Ô TỰ CẮT THEO TEM: công tắc + một dòng nói cách dùng. */
function AutoCutCard({ state, onChange }: { state: RecorderState; onChange: (on: boolean) => void }) {
  const on = state.autoCut && state.scanAvailable;
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-base font-semibold">
            <Scissors className="size-5 text-muted-foreground" aria-hidden />
            Tự cắt theo tem
          </span>
          <span className="flex items-center gap-2">
            <OnOffLabel on={on} onText="Đang bật" offText="Đang tắt" />
            <Switch
              checked={on}
              disabled={!state.scanAvailable}
              onCheckedChange={onChange}
              aria-label={on ? "Tắt tự cắt theo tem" : "Bật tự cắt theo tem"}
            />
          </span>
        </div>
        <p className={TEXT_SUB}>
          {state.scanAvailable
            ? "Giơ tem vào camera là quay, tem khác là cắt clip."
            : "Máy này không đọc được mã tem — chỉ quay bằng nút Bắt đầu quay."}
        </p>
      </CardContent>
    </Card>
  );
}

const STATUS_TEXT: Record<SessionClip["status"], string> = {
  recording: "đang quay",
  saving: "đang lưu",
  queued: "chờ tải lên",
  uploading: "đang tải lên",
  stored: "đã lưu",
  failed: "lỗi",
};

function ClipLine({ clip }: { clip: SessionClip }) {
  const elapsed = useElapsedSeconds(clip.status === "recording" ? clip.startedAtMs : null);
  const duration = clip.status === "recording" ? elapsed : (clip.durationSec ?? 0);
  const label = clip.manual ? "Quay tay" : shortCode(clip.code);
  return (
    <li className="flex items-center justify-between gap-2 border-t py-1.5 text-sm">
      <span className="flex min-w-0 items-center gap-1.5">
        {clip.kind === "UNBOX" && (
          <span className={cn("shrink-0 rounded px-1.5 py-px text-[11px] font-medium", KIND_ACCENT.UNBOX.chip)}>Khui</span>
        )}
        <span className={cn("min-w-0 truncate", !clip.manual && "font-mono")} title={clip.code}>
          {label}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 tabular-nums">
        <span className="text-muted-foreground">{formatElapsed(duration)}</span>
        {clip.status === "failed" ? (
          <>
            <span className="font-medium text-rose-600" title={clip.error ?? undefined}>
              lỗi
            </span>
            {clip.sizeBytes !== null && (
              <Button variant="outline" size="xs" onClick={() => retrySessionClip(clip.localId)}>
                <RotateCcw className="size-3" />
                Thử lại
              </Button>
            )}
          </>
        ) : (
          <span
            className={cn(
              "font-medium",
              clip.status === "stored" && "text-emerald-600",
              clip.status === "recording" && "text-rose-600",
              (clip.status === "uploading" || clip.status === "queued" || clip.status === "saving") && "text-amber-600"
            )}
            title={clip.error ?? undefined}
          >
            {clip.status === "uploading"
              ? `đang tải lên ${Math.round(clip.progress * 100)} %`
              : STATUS_TEXT[clip.status]}
          </span>
        )}
      </span>
    </li>
  );
}

/** Ô LƯỢT QUAY NÀY: số video TO + tổng thời gian + các clip gần nhất kèm trạng thái tải lên. */
function SessionCard({ clips }: { clips: SessionClip[] }) {
  const recording = clips.find((c) => c.status === "recording") ?? null;
  const live = useElapsedSeconds(recording?.startedAtMs ?? null);
  const total = clips.reduce((sum, c) => sum + (c.durationSec ?? 0), 0) + live;
  const waiting = clips.filter((c) => c.status === "queued" || c.status === "uploading" || c.status === "saving").length;
  const failed = clips.filter((c) => c.status === "failed").length;
  const unboxCount = clips.filter((c) => c.kind === "UNBOX").length;
  return (
    <Card>
      <CardContent className="py-4">
        <p className={TEXT_SUB}>Lượt quay này</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold leading-none tabular-nums">
            {clips.length.toLocaleString("vi-VN")} <span className="text-xl">video</span>
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">{formatHoursBalance(total)}</p>
        </div>
        {unboxCount > 0 && (
          <p className={cn("mt-1 text-xs font-medium", KIND_ACCENT.UNBOX.text)}>
            trong đó {unboxCount.toLocaleString("vi-VN")} video khui
          </p>
        )}
        {(waiting > 0 || failed > 0) && (
          <p className="mt-1 text-xs">
            {waiting > 0 && <span className="text-amber-600">{waiting} clip chưa tải lên xong</span>}
            {waiting > 0 && failed > 0 && " · "}
            {failed > 0 && <span className="text-rose-600">{failed} clip lỗi</span>}
          </p>
        )}
        {clips.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Chưa quay video nào trong lượt này.</p>
        ) : (
          <ul className="mt-3 max-h-56 overflow-y-auto pr-1">
            {clips.slice(0, 30).map((clip) => (
              <ClipLine key={clip.localId} clip={clip} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Dòng nhỏ số giờ quay còn lại — cùng nguồn với trang Video đóng hàng. */
function HoursLine() {
  const hours = usePackVideoHours().data;
  if (!hours) return null;
  return (
    <p className="flex items-center gap-1.5 px-1 text-sm text-muted-foreground">
      <Clock className="size-4" aria-hidden />
      <span className="font-medium text-foreground">{remainingLabel(hours)}</span>
      {hours.purchasedSeconds > 0 && <span>/ {formatHoursBalance(hours.purchasedSeconds)}</span>}
    </p>
  );
}

/**
 * CỘT ĐIỀU KHIỂN bên phải (bố cục anh Trung duyệt 16/11): Chế độ quay · Camera · Tự cắt theo tem · MỘT nút lớn đổi vai
 * Bắt đầu quay ↔ Dừng (không bao giờ có hai nút cạnh nhau để bấm nhầm) · Lượt quay này · giờ còn lại.
 */
export function ControlPanel({
  state,
  clips,
  onKind,
  onToggleCamera,
  onSelectCamera,
  onAutoCut,
  onPrimary,
}: {
  state: RecorderState;
  clips: SessionClip[];
  onKind: (kind: ClipKind) => void;
  onToggleCamera: () => void;
  onSelectCamera: (deviceId: string) => void;
  onAutoCut: (on: boolean) => void;
  onPrimary: () => void;
}) {
  const recording = state.phase === "recording";
  const blocked = state.phase === "opening" || state.phase === "lost";
  return (
    <div className="min-w-0 space-y-3">
      <ModeCard state={state} onChange={onKind} />
      <CameraCard state={state} onToggle={onToggleCamera} onSelect={onSelectCamera} />
      <AutoCutCard state={state} onChange={onAutoCut} />
      <button
        type="button"
        onClick={onPrimary}
        disabled={blocked}
        className={cn(
          "flex h-14 w-full items-center justify-center gap-2 rounded-xl text-lg font-semibold text-white transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
          recording ? "bg-rose-600 hover:bg-rose-700" : KIND_ACCENT[state.kind].startButton
        )}
      >
        {recording ? <Square className="size-5 fill-current" aria-hidden /> : <Play className="size-5 fill-current" aria-hidden />}
        {recording ? "Dừng" : state.kind === "UNBOX" ? "Bắt đầu quay khui" : "Bắt đầu quay"}
      </button>
      <SessionCard clips={clips} />
      <HoursLine />
    </div>
  );
}
