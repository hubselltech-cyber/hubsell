"use client";

import * as React from "react";
import { Camera, Focus, Move, Package, PackageOpen, Play, Scissors, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { PIP_DEFAULT, PIP_LIMITS, type PipSettings } from "@/lib/pack-video-recorder/pip-layout";
import type { RecorderState } from "@/lib/pack-video-recorder/recorder";
import type { ClipKind } from "@/lib/pack-video-recorder/types";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { KIND_ACCENT } from "./record-bits";
import { useOutOfHours } from "./record-hours";

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
    <Card className={cn("[--card-spacing:--spacing(4)]", unbox && "border-violet-300")}>
      <CardContent className="space-y-2">
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

export interface CloseupControls {
  /** Đang ở chế độ "Chỉnh vị trí" ô cận cảnh trên khung xem trước. */
  adjusting: boolean;
  onEnabled: (on: boolean) => void;
  onSelect: (deviceId: string) => void;
  onAdjusting: (on: boolean) => void;
  onPip: (next: PipSettings) => void;
}

/**
 * CAMERA CẬN CẢNH — TÙY CHỌN, mặc định tắt (anh Trung 19/11/2026: "tùy chọn 2 camera cho người có nhu cầu, còn bình
 * thường là mình vẫn sẽ dùng 1 camera"). Tắt thì chỉ là MỘT hàng có công tắc. Bật thì: chọn webcam thứ hai → hình
 * của nó được ghép vào một góc video; nút "Chỉnh vị trí" để kéo ô / đổi cỡ / phóng to MỘT lần, máy nhớ.
 * Camera cận KHÔNG đọc tem, KHÔNG cắt clip — giơ tem vẫn là giơ cho camera chính.
 */
function CloseupSection({ state, controls }: { state: RecorderState; controls: CloseupControls }) {
  const { closeup, pip } = state;
  const recording = state.phase === "recording";
  const mainOn = state.phase === "ready" || recording;
  // Camera chính không được chọn lại làm camera cận.
  const choices = state.devices.filter((d) => d.deviceId !== state.camera?.deviceId);
  const known = !!closeup.deviceId && choices.some((d) => d.deviceId === closeup.deviceId);
  const zoomText = pip.zoom.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Focus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Camera cận cảnh
          <span className="rounded bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600">Tùy chọn</span>
        </span>
        <Switch
          checked={closeup.enabled}
          disabled={recording}
          onCheckedChange={controls.onEnabled}
          aria-label={closeup.enabled ? "Tắt camera cận cảnh" : "Bật camera cận cảnh"}
          title={recording ? "Dừng clip đang quay rồi mới đổi" : undefined}
        />
      </div>
      {!closeup.enabled ? (
        <p className={TEXT_SUB}>Thêm webcam thứ hai soi tem, ghép vào một góc video.</p>
      ) : (
        <>
          {choices.length === 0 ? (
            <p className={TEXT_SUB}>
              {mainOn
                ? "Chưa thấy webcam thứ hai — cắm thêm một webcam vào cổng USB khác trên máy (không qua ổ chia)."
                : "Bật camera toàn cảnh trước, rồi chọn webcam thứ hai ở đây."}
            </p>
          ) : (
            <NativeSelect
              aria-label="Chọn camera cận cảnh"
              value={known ? (closeup.deviceId ?? "") : ""}
              disabled={recording || closeup.phase === "opening"}
              onChange={(event) => {
                if (event.target.value) controls.onSelect(event.target.value);
              }}
            >
              {!known && <option value="">Chọn camera cận cảnh…</option>}
              {choices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
          )}
          {closeup.problem ? (
            <p role="alert" className="text-sm font-medium text-rose-700">
              {closeup.problem}
            </p>
          ) : closeup.phase === "on" ? (
            <p className={TEXT_SUB}>
              <span className="block truncate" title={`${closeup.label} · ${closeup.width}×${closeup.height}`}>
                {closeup.label} · {closeup.width}×{closeup.height}
              </span>
              Giơ tem cho camera toàn cảnh để bắt đầu quay, rồi đặt tem dưới camera cận cảnh.
            </p>
          ) : closeup.phase === "opening" ? (
            <p className={TEXT_SUB}>Đang bật camera cận cảnh…</p>
          ) : (
            choices.length > 0 && (
              <p className={TEXT_SUB}>
                {mainOn ? "Chọn webcam soi tem ở ô trên." : "Camera cận cảnh bật cùng lúc với camera toàn cảnh."}
              </p>
            )
          )}
          {controls.adjusting ? (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-medium text-emerald-800">
                Kéo ô trên khung hình để dời, kéo góc để đổi cỡ.
              </p>
              <label className="flex items-center gap-3 text-sm text-emerald-800">
                <span className="shrink-0">Phóng to</span>
                <input
                  type="range"
                  min={PIP_LIMITS.minZoom}
                  max={PIP_LIMITS.maxZoom}
                  step={0.1}
                  value={pip.zoom}
                  onChange={(event) => controls.onPip({ ...pip, zoom: Number(event.target.value) })}
                  className="h-2 min-w-0 flex-1 cursor-pointer accent-emerald-600"
                  aria-label="Phóng to hình cận cảnh"
                />
                <span className="w-9 shrink-0 text-right tabular-nums">{zoomText}×</span>
              </label>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => controls.onPip(PIP_DEFAULT)}>
                  Về mặc định
                </Button>
                <Button size="sm" onClick={() => controls.onAdjusting(false)}>
                  Xong
                </Button>
              </div>
            </div>
          ) : (
            closeup.phase === "on" && (
              <Button
                variant="outline"
                size="sm"
                disabled={recording}
                title={recording ? "Dừng clip đang quay rồi mới chỉnh vị trí" : undefined}
                onClick={() => controls.onAdjusting(true)}
              >
                <Move className="size-4" aria-hidden />
                Chỉnh vị trí
              </Button>
            )
          )}
        </>
      )}
    </div>
  );
}

/**
 * Ô CAMERA TOÀN CẢNH (anh Trung 21/11/2026 đổi tên từ "Camera" cho rõ cặp với "Camera cận cảnh"): bật / tắt một chạm,
 * tên camera + khổ hình, chọn camera khi máy có nhiều cái; dưới cùng là tùy chọn cận cảnh.
 * flex-1: ô này giãn cho đáy bằng đáy khung hình bên trái.
 */
function CameraCard({
  state,
  closeup,
  onToggle,
  onSelect,
}: {
  state: RecorderState;
  closeup: CloseupControls;
  onToggle: () => void;
  onSelect: (deviceId: string) => void;
}) {
  const on = state.phase === "ready" || state.phase === "recording";
  const opening = state.phase === "opening";
  return (
    <Card className="flex-1 [--card-spacing:--spacing(4)]">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-base font-semibold">
            <Camera className="size-5 text-muted-foreground" aria-hidden />
            Camera toàn cảnh
          </span>
          <span className="flex items-center gap-2">
            <OnOffLabel on={on} onText="Đang bật" offText={opening ? "Đang bật…" : "Đang tắt"} />
            <Switch
              checked={on || opening}
              disabled={opening}
              onCheckedChange={onToggle}
              aria-label={on ? "Tắt camera toàn cảnh" : "Bật camera toàn cảnh"}
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
            aria-label="Chọn camera toàn cảnh"
            value={state.camera?.deviceId ?? ""}
            disabled={opening}
            onChange={(event) => {
              if (event.target.value) onSelect(event.target.value);
            }}
          >
            {!state.camera && <option value="">Chọn camera toàn cảnh…</option>}
            {state.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        )}
        <CloseupSection state={state} controls={closeup} />
      </CardContent>
    </Card>
  );
}

/**
 * Ô TỰ CẮT THEO TEM: công tắc + một dòng nói cách dùng (dài thì cắt "…", rê chuột xem đủ). Ô thấp cố định 66px,
 * nằm sát trên nút lớn ở đáy cột.
 */
function AutoCutCard({ state, onChange }: { state: RecorderState; onChange: (on: boolean) => void }) {
  const on = state.autoCut && state.scanAvailable;
  const hint = state.scanAvailable
    ? "Giơ tem vào camera là quay, tem khác là cắt clip."
    : "Máy này không đọc được mã tem — chỉ quay bằng nút Bắt đầu quay.";
  return (
    <Card className="h-[66px] shrink-0 justify-center py-0 [--card-spacing:--spacing(4)]">
      <CardContent>
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
        <p className={cn(TEXT_SUB, "truncate")} title={hint}>
          {hint}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * CỘT ĐIỀU KHIỂN bên phải (bố cục anh Trung duyệt 16/11): Chế độ quay · Camera · Tự cắt theo tem · MỘT nút lớn đổi vai
 * Bắt đầu quay ↔ Dừng (không bao giờ có hai nút cạnh nhau để bấm nhầm).
 *
 * 21/11/2026 anh Trung "cải thiện lại giao diện cho gọn": ô Lượt quay này dời sang cạnh ô "Đang quay cho tem" dưới
 * khung hình (session-card.tsx), số giờ còn lại dời lên hàng đầu màn quay (record-hours.tsx) → cột này kết thúc ở
 * nút lớn, không còn rơi khỏi màn.
 *
 * THẲNG HÀNG (anh Trung 21/11: "các khối cho hàng lối thẳng nhau"): cột này cao bằng cột trái — đỉnh thẳng đỉnh khung
 * hình, đáy nút lớn thẳng đáy hàng [ô tem | ô Lượt quay này]. Ô Camera toàn cảnh giãn (flex-1) để lấp phần giữa; cụm
 * [Tự cắt theo tem · nút lớn] luôn nằm sát đáy. Khi cột này tự nhiên cao hơn cột trái (đang mở tùy chọn cận cảnh)
 * thì hàng ô bên trái giãn theo — đáy hai cột vẫn bằng nhau. Đây là bản anh nhìn và duyệt ("Như thế này ok").
 */
export function ControlPanel({
  state,
  diskFull,
  closeup,
  onKind,
  onToggleCamera,
  onSelectCamera,
  onAutoCut,
  onPrimary,
}: {
  state: RecorderState;
  /** Tùy chọn camera cận cảnh (webcam thứ hai soi tem). */
  closeup: CloseupControls;
  /** Ổ đĩa đã ghi hỏng thật → không mở video mới (dải báo phía trên nói lý do). */
  diskFull: boolean;
  onKind: (kind: ClipKind) => void;
  onToggleCamera: () => void;
  onSelectCamera: (deviceId: string) => void;
  onAutoCut: (on: boolean) => void;
  onPrimary: () => void;
}) {
  const recording = state.phase === "recording";
  const outOfHours = useOutOfHours();
  // Hết giờ / ổ đĩa đầy: chỉ khóa nút khi CHƯA quay — đang quay thì nút là "Dừng", luôn bấm được.
  const blocked = state.phase === "opening" || state.phase === "lost" || (!recording && (outOfHours || diskFull));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Cụm trên giãn (ô Camera toàn cảnh lấp phần giữa); ô Tự cắt + nút lớn nằm sát đáy, bằng đáy cột trái. */}
      <div className="flex flex-1 flex-col gap-3">
        <ModeCard state={state} onChange={onKind} />
        <CameraCard state={state} closeup={closeup} onToggle={onToggleCamera} onSelect={onSelectCamera} />
      </div>
      <AutoCutCard state={state} onChange={onAutoCut} />
      <button
        type="button"
        onClick={onPrimary}
        disabled={blocked}
        className={cn(
          "flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-xl text-lg font-semibold text-white transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
          recording ? "bg-rose-600 hover:bg-rose-700" : KIND_ACCENT[state.kind].startButton
        )}
      >
        {recording ? <Square className="size-5 fill-current" aria-hidden /> : <Play className="size-5 fill-current" aria-hidden />}
        {recording ? "Dừng" : state.kind === "UNBOX" ? "Bắt đầu quay khui" : "Bắt đầu quay"}
      </button>
    </div>
  );
}
