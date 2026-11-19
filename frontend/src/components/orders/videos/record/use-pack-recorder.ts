"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { addJournal, getJournal, getServerJournal, subscribeJournal } from "@/lib/pack-video-recorder/journal";
import { PIP_DEFAULT, clampPip, type PipSettings } from "@/lib/pack-video-recorder/pip-layout";
import { INITIAL_RECORDER_STATE, PackRecorder, type RecorderState } from "@/lib/pack-video-recorder/recorder";
import {
  discardClipFile,
  diskBlocker,
  dismissReturnPrompt,
  getServerQueueSnapshot,
  getServerSessionClips,
  getQueueSnapshot,
  getSessionClips,
  hasUnsavedClips,
  onClipStored,
  openClipSink,
  resumeUploadQueue,
  retryQueueNow,
  sessionClipDone,
  sessionDropLeadIn,
  sessionClipStarted,
  sessionClipStopping,
  sessionRelabelRecording,
  setSessionDeviceName,
  subscribeQueue,
  subscribeSession,
  type SessionClip,
} from "@/lib/pack-video-recorder/session";
import type { ClipKind } from "@/lib/pack-video-recorder/types";
import { createThrottle } from "@/lib/pack-video-recorder/upload-speed";

import { usePackVideoHours } from "../hours-balance";

/**
 * Làm mới số liệu máy chủ (số giờ còn lại, danh sách video) tối đa MỘT lần mỗi 30 giây thay vì sau mỗi video
 * (rủi ro N9, mục 18.4: người đóng hàng không nhìn danh sách; lúc gửi dồn sau mất mạng thì mỗi video một lượt
 * gọi là thừa). 30 giây là số tự chọn; lớp chặn hết giờ thật vẫn ở máy chủ nên trễ 30 giây không sai tiền.
 */
const REFRESH_EVERY_MS = 30_000;

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
 * CAMERA CẬN CẢNH (tùy chọn, anh Trung 19/11/2026): bật / tắt, camera đã chọn, chỗ đặt ô ghép — nhớ theo MÁY, cùng
 * chỗ với camera chính. Không lưu máy chủ: vị trí tùy góc đặt camera của từng bàn, và mã camera chỉ có nghĩa trên
 * đúng trình duyệt này.
 */
const CLOSEUP_KEY = "hubsell.packVideo.closeup";

interface SavedCloseup {
  enabled: boolean;
  deviceId: string | null;
  pip: PipSettings;
}

function readSavedCloseup(): SavedCloseup {
  const fallback: SavedCloseup = { enabled: false, deviceId: null, pip: PIP_DEFAULT };
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(CLOSEUP_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SavedCloseup> | null;
    return {
      enabled: parsed?.enabled === true,
      deviceId: typeof parsed?.deviceId === "string" && parsed.deviceId ? parsed.deviceId : null,
      pip: clampPip(parsed?.pip),
    };
  } catch {
    return fallback;
  }
}

function saveCloseup(value: SavedCloseup): void {
  try {
    window.localStorage.setItem(CLOSEUP_KEY, JSON.stringify(value));
  } catch {
    // bị chặn localStorage → lần sau cài lại, không sao
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
  const closeupVideoElRef = React.useRef<HTMLVideoElement | null>(null);
  const [state, setState] = React.useState<RecorderState>(() => {
    // Cài đặt camera cận cảnh đã nhớ có ngay từ lượt vẽ đầu (màn này chỉ dựng phía trình duyệt).
    const saved = readSavedCloseup();
    return {
      ...INITIAL_RECORDER_STATE,
      kind: initialKind,
      closeup: { ...INITIAL_RECORDER_STATE.closeup, enabled: saved.enabled, deviceId: saved.deviceId },
      pip: saved.pip,
    };
  });
  const initialKindRef = React.useRef(initialKind);
  const clips = React.useSyncExternalStore(subscribeSession, getSessionClips, getServerSessionClips);
  const journal = React.useSyncExternalStore(subscribeJournal, getJournal, getServerJournal);
  const queue = React.useSyncExternalStore(subscribeQueue, getQueueSnapshot, getServerQueueSnapshot);
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
        onLeadInDropped: sessionDropLeadIn,
        onClipRelabel: sessionRelabelRecording,
        // Chưa có số giờ (đang tải / lỗi mạng) thì cho quay — máy chủ vẫn chặn ở bước tải lên.
        clipBlocker: () =>
          remainingRef.current !== null && remainingRef.current <= 0
            ? "Hết giờ quay — không mở được video mới. Mua thêm giờ để quay tiếp."
            : diskBlocker(),
        openSink: openClipSink,
        discardFile: discardClipFile,
      },
      initialKindRef.current
    );
    recorderRef.current = recorder;
    recorder.configureCloseup(readSavedCloseup());
    if (videoRef.current) recorder.attach(videoRef.current, boxRef.current);
    if (closeupVideoElRef.current) recorder.attachCloseupPreview(closeupVideoElRef.current);
    void recorder.refreshDevices();
    return () => {
      recorderRef.current = null;
      // Rời màn quay: nhả camera, worker, bộ mã hóa. Clip đang quay được lưu rồi tải lên tiếp ở nền.
      void recorder.dispose();
    };
  }, []);

  // IN MÃ ĐƠN HÀNG LÊN VIDEO (anh Trung 18/11): sổ clip hỏi máy chủ "tem này của đơn nào"; có câu trả lời lúc clip
  // còn đang quay thì báo bộ quay in thêm dòng mã đơn hàng (mã vận đơn đã được in từ khung đầu). Gọi lặp vô hại.
  React.useEffect(() => {
    const live = clips.find((c) => c.status === "recording");
    const orderCode = live?.order?.orderCode;
    if (live && orderCode) recorderRef.current?.setOrderCode(live.code, orderCode);
  }, [clips]);

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

  // Video quay từ lượt trước mà chưa lên kho (trang tải lại, máy mở lại) → gửi tiếp ngay khi màn quay mở.
  React.useEffect(() => {
    void resumeUploadQueue();
  }, []);

  // Video lên kho → làm mới danh sách video, số trên chip, số giờ đã quay — GỘP, tối đa một lần / 30 giây.
  React.useEffect(() => {
    const refresh = createThrottle(() => void queryClient.invalidateQueries({ queryKey: ["pack-videos"] }), REFRESH_EVERY_MS);
    const off = onClipStored(refresh.call);
    return () => {
      off();
      refresh.cancel();
    };
  }, [queryClient]);

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

  // CAMERA CẬN CẢNH: nhớ cài đặt theo máy mỗi khi đổi (bật / tắt, camera, chỗ đặt ô).
  const closeupEnabled = state.closeup.enabled;
  const closeupDeviceId = state.closeup.deviceId;
  const pip = state.pip;
  React.useEffect(() => {
    saveCloseup({ enabled: closeupEnabled, deviceId: closeupDeviceId, pip });
  }, [closeupEnabled, closeupDeviceId, pip]);

  /** Thẻ <video> của ô cận cảnh trên khung xem trước vừa được dựng / gỡ. */
  const closeupVideoRef = React.useCallback((video: HTMLVideoElement | null) => {
    closeupVideoElRef.current = video;
    recorderRef.current?.attachCloseupPreview(video);
  }, []);
  const setCloseupEnabled = React.useCallback((on: boolean) => {
    recorderRef.current?.setCloseupEnabled(on);
  }, []);
  const selectCloseup = React.useCallback((deviceId: string) => {
    recorderRef.current?.selectCloseup(deviceId);
  }, []);
  const setPip = React.useCallback((next: PipSettings) => {
    recorderRef.current?.setPip(next);
  }, []);

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
    queue,
    retryQueueNow,
    toggleCamera,
    selectCamera,
    setAutoCut,
    closeupVideoRef,
    setCloseupEnabled,
    selectCloseup,
    setPip,
    setKind,
    switchCurrentToUnbox,
    keepAsPack,
    primary,
  };
}
