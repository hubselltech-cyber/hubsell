"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { addJournal, getJournal, getServerJournal, subscribeJournal } from "@/lib/pack-video-recorder/journal";
import { INITIAL_RECORDER_STATE, PackRecorder, type RecorderState } from "@/lib/pack-video-recorder/recorder";
import {
  getServerSessionClips,
  getSessionClips,
  hasUnsavedClips,
  onClipStored,
  sessionClipDone,
  sessionClipStarted,
  sessionClipStopping,
  setSessionDeviceName,
  subscribeSession,
} from "@/lib/pack-video-recorder/session";

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
 */
export function usePackRecorder() {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const boxRef = React.useRef<HTMLCanvasElement | null>(null);
  const recorderRef = React.useRef<PackRecorder | null>(null);
  const [state, setState] = React.useState<RecorderState>(INITIAL_RECORDER_STATE);
  const clips = React.useSyncExternalStore(subscribeSession, getSessionClips, getServerSessionClips);
  const journal = React.useSyncExternalStore(subscribeJournal, getJournal, getServerJournal);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const recorder = new PackRecorder({
      onState: setState,
      log: addJournal,
      onClipStart: sessionClipStarted,
      onClipDone: sessionClipDone,
    });
    recorderRef.current = recorder;
    if (videoRef.current) recorder.attach(videoRef.current, boxRef.current);
    void recorder.refreshDevices();
    return () => {
      recorderRef.current = null;
      // Rời màn quay: nhả camera, worker, bộ mã hóa. Clip đang quay được lưu rồi tải lên tiếp ở nền.
      void recorder.dispose();
    };
  }, []);

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

  return { videoRef, boxRef, state, clips, journal, toggleCamera, selectCamera, setAutoCut, primary };
}
