"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { addJournal, getJournal, getServerJournal, subscribeJournal } from "@/lib/pack-video-recorder/journal";
import { INITIAL_RECORDER_STATE, PackRecorder, type RecorderState } from "@/lib/pack-video-recorder/recorder";
import {
  dismissReturnPrompt,
  getServerSessionClips,
  getSessionClips,
  hasUnsavedClips,
  onClipStored,
  sessionClipDone,
  sessionClipStarted,
  sessionClipStopping,
  sessionRelabelRecording,
  setSessionDeviceName,
  subscribeSession,
  type SessionClip,
} from "@/lib/pack-video-recorder/session";
import type { ClipKind } from "@/lib/pack-video-recorder/types";

import { usePackVideoHours } from "../hours-balance";

/** Camera người dùng chọn lần trước — lần sau bật là dùng lại, khỏi chọn lại mỗi ca. */
const CAMERA_KEY = "hubsell.packVideo.cameraId";

function readSavedCamera(): string | null {
  try {
    return window.localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}

function saveCamera(deviceId: string): void {
  try {
    window.localStorage.setItem(CAMERA_KEY, deviceId);
  } catch {
    // bị chặn localStorage → lần sau chọn lại, không sao
  }
}

/**
 * Nối màn quay với bộ quay (lib/pack-video-recorder): một PackRecorder sống theo màn hình, còn LƯỢT QUAY
 * (danh sách clip + hàng chờ tải lên) và NHẬT KÝ sống ở cấp module nên rời màn rồi quay lại vẫn còn.
 *
 * `initialKind` = chế độ mở sẵn (đóng hàng, hoặc khui hàng hoàn khi vào bằng ?mode=unbox). Địa chỉ đổi lúc màn đang
 * mở thì chế độ đổi theo — trừ khi đang có clip quay dở (bộ quay từ chối).
 */
export function usePackRecorder(initialKind: ClipKind = "PACK") {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const boxRef = React.useRef<HTMLCanvasElement | null>(null);
  const recorderRef = React.useRef<PackRecorder | null>(null);
  const [state, setState] = React.useState<RecorderState>(() => ({ ...INITIAL_RECORDER_STATE, kind: initialKind }));
  const initialKindRef = React.useRef(initialKind);
  const clips = React.useSyncExternalStore(subscribeSession, getSessionClips, getServerSessionClips);
  const journal = React.useSyncExternalStore(subscribeJournal, getJournal, getServerJournal);
  const queryClient = useQueryClient();
  // Số giờ còn lại — bộ quay hỏi qua ref nên không phải dựng lại bộ quay mỗi lần số đổi.
  const remaining = usePackVideoHours().data?.remainingSeconds ?? null;
  const remainingRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    remainingRef.current = remaining;
  }, [remaining]);

  React.useEffect(() => {
    const recorder = new PackRecorder(
      {
        onState: setState,
        log: addJournal,
        onClipStart: sessionClipStarted,
        onClipDone: sessionClipDone,
        onClipRelabel: sessionRelabelRecording,
        // Chưa có số (đang tải / lỗi mạng) thì cho quay — máy chủ vẫn chặn ở bước tải lên.
        canOpenClip: () => remainingRef.current === null || remainingRef.current > 0,
      },
      initialKindRef.current
    );
    recorderRef.current = recorder;
    if (videoRef.current) recorder.attach(videoRef.current, boxRef.current);
    void recorder.refreshDevices();
    return () => {
      recorderRef.current = null;
      // Rời màn quay: nhả camera, worker, bộ mã hóa. Clip đang quay được lưu rồi tải lên tiếp ở nền.
      void recorder.dispose();
    };
  }, []);

  // Địa chỉ đổi chế độ khi màn đang mở (vd. bấm lại nút "Quay khui hàng") → đổi theo nếu không có clip quay dở.
  React.useEffect(() => {
    if (initialKindRef.current === initialKind) return;
    initialKindRef.current = initialKind;
    recorderRef.current?.setKind(initialKind);
  }, [initialKind]);

  // Tên camera đi kèm mỗi video tải lên (cột "Người quay · máy" ở danh sách).
  const cameraLabel = state.camera?.label ?? null;
  React.useEffect(() => {
    if (cameraLabel) setSessionDeviceName(cameraLabel);
  }, [cameraLabel]);

  // Mỗi video lên kho xong → làm mới danh sách video, số trên chip, số giờ đã quay.
  React.useEffect(
    () => onClipStored(() => void queryClient.invalidateQueries({ queryKey: ["pack-videos"] })),
    [queryClient]
  );

  // Tải lại / đóng tab khi đang quay hoặc còn clip chưa lên kho thì trình duyệt hỏi lại.
  const recording = state.phase === "recording";
  React.useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!recording && !hasUnsavedClips()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [recording]);

  const toggleCamera = React.useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const phase = recorder.snapshot.phase;
    if (phase === "off" || phase === "lost") {
      const ok = await recorder.turnOn(readSavedCamera());
      // Camera đã lưu không còn (đổi máy / đổi cổng) → bật camera mặc định.
      if (!ok && readSavedCamera()) await recorder.turnOn(null);
    } else if (phase !== "opening") {
      sessionClipStopping();
      await recorder.turnOff();
    }
  }, []);

  const selectCamera = React.useCallback(async (deviceId: string) => {
    saveCamera(deviceId);
    const recorder = recorderRef.current;
    if (!recorder) return;
    sessionClipStopping();
    await recorder.turnOn(deviceId);
  }, []);

  const setAutoCut = React.useCallback((on: boolean) => recorderRef.current?.setAutoCut(on), []);

  /** Công tắc Đóng hàng | Khui hàng hoàn. Đang quay thì bộ quay từ chối (giao diện cũng đã khóa công tắc). */
  const setKind = React.useCallback((kind: ClipKind) => {
    recorderRef.current?.setKind(kind);
  }, []);

  /** "Chuyển sang khui": đổi loại của CHÍNH clip đang quay rồi chuyển luôn chế độ. */
  const switchCurrentToUnbox = React.useCallback(() => {
    recorderRef.current?.relabelCurrentClip("UNBOX");
  }, []);

  /** "Vẫn là đóng hàng": gạt câu hỏi, không hỏi lại cho cùng tem trong lượt này. */
  const keepAsPack = React.useCallback((clip: SessionClip) => dismissReturnPrompt(clip.localId), []);

  /** Nút lớn: đang quay thì Dừng, chưa quay thì Bắt đầu quay (camera chưa bật thì bật luôn). */
  const primary = React.useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.snapshot.phase === "recording") {
      sessionClipStopping();
      await recorder.stop();
    } else {
      await recorder.startManual();
    }
  }, []);

  return {
    videoRef,
    boxRef,
    state,
    clips,
    journal,
    toggleCamera,
    selectCamera,
    setAutoCut,
    setKind,
    switchCurrentToUnbox,
    keepAsPack,
    primary,
  };
}
