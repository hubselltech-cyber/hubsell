// ============================================================
// BỘ QUAY VIDEO ĐÓNG HÀNG BẰNG WEBCAM — điều phối camera, đường quay, bộ đọc mã, máy trạng thái tự cắt.
// Lib thuần (không React): màn quay nối vào bằng các hàm báo sự kiện.
//
// Chép từ trang thử `tools/thu-webcam` sau khi cả năm cửa đã qua với webcam và tem thật (16/11/2026,
// docs/VIDEO-DONG-HANG-THIET-KE.md mục 13). Ba rào bắt buộc rút từ sự cố thật trong lúc thử:
//   1. mở camera có thử lại (webcam vừa nối lại USB thì Chrome chưa đọc được ngay);
//   2. mất camera giữa chừng → báo động + LƯU NGAY clip đang quay, không để mất cả clip;
//   3. camera có lại → tự mở lại và quay về chờ tem (KHÔNG tự quay tiếp clip quay tay).
// ============================================================

import { cameraErrorText, listCameras, openCameraStream, type CameraDevice } from "./camera";
import { ClipPipeline, webCodecsMissing } from "./clip-pipeline";
import { CAMERA_RECOVER_DEBOUNCE_MS, RECORD_BITRATE, RECORD_FPS } from "./config";
import { resolvePumpMode } from "./frame-pump";
import { Scanner } from "./scanner";
import { playAlarm, playBoop, playDone, playTing, unlockAudio } from "./sound";
import { StampCanvas } from "./stamp-canvas";
import { TemCutter } from "./tem-cutter";
import { manualClipCode } from "./tracking-code";
import { CLIP_KIND_LABEL, type ClipKind, type ClipOutcome, type RecorderLog, type ScannedCode } from "./types";

export type RecorderPhase = "off" | "opening" | "ready" | "recording" | "lost";

export interface RecorderState {
  phase: RecorderPhase;
  camera: { deviceId: string; label: string; width: number; height: number } | null;
  devices: CameraDevice[];
  /** Tự mở / cắt clip theo tem. Tắt thì chỉ quay bằng nút. */
  autoCut: boolean;
  /** false = bộ đọc mã không khởi động được trên máy này → chỉ quay tay. */
  scanAvailable: boolean;
  /** Chế độ quay: đóng hàng hay khui hàng hoàn. Clip mở ra mang loại này. */
  kind: ClipKind;
  current: { code: string; manual: boolean; startedAtMs: number; kind: ClipKind } | null;
  /** Câu báo khi mất camera / không bật được camera. */
  problem: string | null;
  /** Tem vừa bị từ chối vì đã quay rồi (để màn hình nháy thông báo). */
  repeat: { code: string; atMs: number } | null;
}

export interface RecorderEvents {
  onState(state: RecorderState): void;
  log: RecorderLog;
  onClipStart(info: { code: string; manual: boolean; startedAtMs: number; kind: ClipKind }): void;
  onClipDone(outcome: ClipOutcome): void;
  /** Clip ĐANG QUAY vừa được đổi loại (rào "đơn này đang hoàn về"). */
  onClipRelabel?(kind: ClipKind): void;
}

/** Trạng thái lúc chưa bật gì — cũng là trạng thái màn hình vẽ ở lượt đầu. */
export const INITIAL_RECORDER_STATE: RecorderState = {
  phase: "off",
  camera: null,
  devices: [],
  autoCut: true,
  scanAvailable: true,
  kind: "PACK",
  current: null,
  problem: null,
  repeat: null,
};

const LOST_TEXT = "Mất camera — kiểm tra dây USB, nên cắm thẳng vào máy. Cắm lại là camera tự bật.";

export class PackRecorder {
  private video: HTMLVideoElement | null = null;
  private boxCanvas: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private pipeline: ClipPipeline | null = null;
  private scanner: Scanner | null = null;
  private stamp: StampCanvas | null = null;
  private readonly cutter = new TemCutter();
  private lost: { atMs: number; label: string } | null = null;
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private busy = false;

  private state: RecorderState = INITIAL_RECORDER_STATE;

  /** `initialKind`: chế độ lúc mở màn quay (vd. vào từ nút "Quay khui hàng" của trang Đối soát đơn hoàn). */
  constructor(
    private readonly events: RecorderEvents,
    initialKind: ClipKind = "PACK"
  ) {
    this.state = { ...INITIAL_RECORDER_STATE, kind: initialKind };
    this.cutter.setMode(initialKind);
    if (typeof navigator !== "undefined") {
      navigator.mediaDevices?.addEventListener?.("devicechange", this.onDeviceChange);
    }
  }

  get snapshot(): RecorderState {
    return this.state;
  }

  /** Gắn thẻ <video> xem trước và lớp phủ vẽ khung bao mã. Gọi một lần khi màn hình dựng xong. */
  attach(video: HTMLVideoElement, boxCanvas: HTMLCanvasElement | null): void {
    this.video = video;
    this.boxCanvas = boxCanvas;
  }

  private patch(next: Partial<RecorderState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    this.events.onState(this.state);
  }

  async refreshDevices(): Promise<void> {
    this.patch({ devices: await listCameras() });
  }

  /** Bật camera + đường quay + bộ đọc mã. Xong thì ở trạng thái "sẵn sàng". */
  async turnOn(deviceId: string | null = null): Promise<boolean> {
    if (this.busy || this.disposed) return false;
    const video = this.video;
    if (!video) return false;
    const missing = webCodecsMissing();
    const pumpMode = resolvePumpMode();
    if (missing || !pumpMode) {
      const text = missing ?? "Trình duyệt này không lấy được từng khung hình. Hãy dùng Chrome hoặc Edge bản mới.";
      this.events.log("error", text);
      this.patch({ phase: "off", problem: text });
      return false;
    }
    this.busy = true;
    unlockAudio();
    await this.teardown();
    this.patch({ phase: "opening", problem: null });
    try {
      const stream = await openCameraStream(deviceId, this.events.log);
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("Camera không trả luồng hình nào");
      this.stream = stream;
      this.track = track;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const settings = track.getSettings();
      const width = settings.width ?? video.videoWidth;
      const height = settings.height ?? video.videoHeight;
      const label = track.label || "Camera";
      track.addEventListener("ended", () => void this.onTrackEnded(track));

      this.stamp ??= new StampCanvas();
      this.scanner = new Scanner(this.boxCanvas, this.events.log);
      const scanAvailable = await this.scanner.init();
      this.pipeline = new ClipPipeline({
        track,
        video,
        width,
        height,
        fps: RECORD_FPS,
        bitrate: RECORD_BITRATE,
        pumpMode,
        stamp: this.stamp,
        tap: this.scanner,
        log: this.events.log,
      });
      await this.pipeline.open();
      this.cutter.reset();
      // Camera đã lên (tự mở lại hay người dùng tự bật) → hết trạng thái "mất camera"; không xóa thì lần mất sau bị bỏ qua.
      this.lost = null;
      this.patch({
        phase: "ready",
        camera: { deviceId: settings.deviceId ?? deviceId ?? "", label, width, height },
        scanAvailable,
        current: null,
        problem: null,
      });
      this.applyScan();
      this.events.log("info", `Đã bật camera ${label} (${width}×${height})`);
      void this.refreshDevices(); // sau khi được cấp quyền mới đọc được tên camera
      return true;
    } catch (err) {
      await this.teardown();
      const text = cameraErrorText(err);
      this.events.log("error", text);
      this.patch({ phase: "off", camera: null, current: null, problem: text });
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Tắt camera. Đang quay thì lưu clip trước. */
  async turnOff(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.lost = null;
      if (this.recoverTimer) clearTimeout(this.recoverTimer);
      const had = this.state.camera;
      await this.teardown();
      this.patch({ phase: "off", camera: null, current: null, problem: null });
      if (had) this.events.log("info", "Đã tắt camera");
    } finally {
      this.busy = false;
    }
  }

  /**
   * Đổi chế độ quay (đóng hàng ↔ khui hàng hoàn). CHỈ đổi được khi không có clip đang quay — đang quay mà đổi
   * thì không biết clip dở thuộc loại nào. Trả false nếu bị từ chối.
   */
  setKind(kind: ClipKind): boolean {
    if (this.state.kind === kind) return true;
    if (this.state.current) return false;
    this.cutter.setMode(kind);
    this.patch({ kind, repeat: null });
    this.events.log("info", `Đổi sang chế độ ${CLIP_KIND_LABEL[kind]}`);
    return true;
  }

  /**
   * Ngoại lệ duy nhất của luật trên: đổi loại của CHÍNH clip đang quay rồi chuyển luôn chế độ. Dùng cho rào
   * "Đơn này đang hoàn về. Chuyển sang quay khui hàng?" — loại video chỉ được dùng lúc tải lên, nên đổi trước khi
   * clip kết thúc là an toàn, không phải quay lại.
   */
  relabelCurrentClip(kind: ClipKind): boolean {
    const current = this.state.current;
    if (!current || current.kind === kind) return false;
    this.cutter.relabelCurrent(kind);
    this.patch({ kind, current: { ...current, kind }, repeat: null });
    this.events.log(
      "info",
      kind === "UNBOX"
        ? `Chuyển clip đang quay ${current.code} sang KHUI theo cảnh báo đơn đang hoàn`
        : `Chuyển clip đang quay ${current.code} sang ĐÓNG HÀNG`
    );
    this.events.onClipRelabel?.(kind);
    return true;
  }

  setAutoCut(on: boolean): void {
    if (this.state.autoCut === on) return;
    this.patch({ autoCut: on });
    this.applyScan();
    this.events.log("info", on ? "Bật tự cắt theo tem" : "Tắt tự cắt theo tem — chỉ quay bằng nút");
  }

  /** Bộ đọc mã chỉ chạy khi camera đang bật VÀ tự cắt đang bật (tắt thì khỏi tốn máy). */
  private applyScan(): void {
    const scanner = this.scanner;
    if (!scanner) return;
    const want = this.state.autoCut && this.state.scanAvailable && (this.state.phase === "ready" || this.state.phase === "recording");
    if (want && !scanner.active) scanner.start((codes) => this.onRead(codes));
    else if (!want && scanner.active) scanner.stop();
  }

  private onRead(codes: ScannedCode[]): void {
    if (!this.state.autoCut || !this.pipeline) return;
    const decision = this.cutter.feed(codes);
    if (!decision) return;
    const unbox = this.state.kind === "UNBOX";
    if (decision.type === "repeat") {
      playBoop();
      this.events.log("warn", `Tem ${decision.code} đã quay ${unbox ? "khui " : ""}rồi — không quay lại`);
      this.patch({ repeat: { code: decision.code, atMs: Date.now() } });
      return;
    }
    const previous = this.state.current;
    if (previous) {
      this.events.log(
        "info",
        `Đọc được tem ${decision.code} — cắt clip ${previous.code}, ${unbox ? "mở clip KHUI mới" : "quay tiếp clip mới"}`
      );
    } else {
      this.events.log("info", unbox ? `Mở clip KHUI cho tem ${decision.code}` : `Đọc được tem ${decision.code} — bắt đầu quay`);
    }
    this.beginClip(decision.code, false);
  }

  /** Nút "Bắt đầu quay": mở một clip không cần tem. Camera chưa bật thì bật trước. */
  async startManual(): Promise<boolean> {
    unlockAudio();
    if (this.state.phase === "recording") return false;
    if (this.state.phase !== "ready") {
      const on = await this.turnOn(this.state.camera?.deviceId ?? null);
      if (!on) return false;
    }
    const code = manualClipCode(this.state.kind);
    this.events.log(
      "info",
      this.state.kind === "UNBOX" ? "Bắt đầu quay tay KHUI hàng (không cần tem)" : "Bắt đầu quay tay (không cần tem)"
    );
    this.beginClip(code, true);
    return true;
  }

  private beginClip(code: string, manual: boolean): void {
    const pipeline = this.pipeline;
    if (!pipeline) return;
    const startedAtMs = Date.now();
    const kind = this.state.kind;
    const handle = pipeline.beginClip(code, manual);
    this.cutter.started(code);
    playTing();
    this.patch({ phase: "recording", current: { code, manual, startedAtMs, kind }, repeat: null });
    this.events.onClipStart({ code, manual, startedAtMs, kind });
    void handle.done.then((outcome) => {
      if (!outcome.ok) this.cutter.failed(code);
      if (!this.disposed) this.events.onClipDone(outcome);
    });
  }

  /** Nút "Dừng": lưu clip đang quay, về trạng thái sẵn sàng (bộ đọc mã vẫn chạy). */
  async stop(): Promise<void> {
    const current = this.state.current;
    if (!current || !this.pipeline) return;
    playDone();
    this.cutter.stopped();
    this.events.log("info", `Dừng — đang lưu clip ${current.kind === "UNBOX" ? "KHUI " : ""}${current.code}`);
    this.patch({ phase: this.track?.readyState === "live" ? "ready" : this.state.phase, current: null });
    await this.pipeline.endClip().catch(() => null);
  }

  private async onTrackEnded(track: MediaStreamTrack): Promise<void> {
    if (this.disposed || track !== this.track || this.lost) return;
    const label = this.state.camera?.label ?? track.label;
    const clip = this.state.current?.code ?? null;
    this.lost = { atMs: Date.now(), label };
    playAlarm();
    this.events.log(
      "error",
      clip ? `Mất camera — clip ${clip} được lưu tới lúc mất hình. Kiểm tra dây USB.` : "Mất camera — kiểm tra dây USB."
    );
    this.cutter.stopped();
    this.patch({ phase: "lost", current: null, problem: LOST_TEXT });
    await this.teardown(); // đóng đường quay → clip đang quay được ghép và trả ra qua onClipDone
    this.patch({ phase: "lost", camera: null });
    this.scheduleRecover();
  }

  private readonly onDeviceChange = (): void => {
    void this.refreshDevices();
    this.scheduleRecover();
  };

  private scheduleRecover(): void {
    if (!this.lost || this.disposed) return;
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.recoverTimer = setTimeout(() => void this.tryRecover(), CAMERA_RECOVER_DEBOUNCE_MS);
  }

  private async tryRecover(): Promise<void> {
    const lost = this.lost;
    if (!lost || this.disposed || this.track) return;
    if (this.busy) {
      // Đang có một lượt bật camera khác chạy (người dùng vừa bấm) — chờ nó xong rồi xem lại.
      this.recoverTimer = setTimeout(() => void this.tryRecover(), 1000);
      return;
    }
    const back = (await listCameras()).find((d) => d.label === lost.label);
    if (!back) return; // chưa cắm lại — lần đổi thiết bị sau sẽ thử tiếp
    const ok = await this.turnOn(back.deviceId);
    if (!ok) {
      // turnOn đã ghi lỗi và về "off"; vẫn coi là đang mất camera để thử lại.
      this.lost = lost;
      this.patch({ phase: "lost", problem: LOST_TEXT });
      this.recoverTimer = setTimeout(() => void this.tryRecover(), 3000);
      return;
    }
    const seconds = Math.round((Date.now() - lost.atMs) / 100) / 10;
    this.events.log("info", `Camera đã có lại sau ${seconds} giây — sẵn sàng quay`);
    playTing();
  }

  /** Đóng đường quay (clip đang quay được lưu), bộ đọc mã và camera. */
  private async teardown(): Promise<void> {
    const { pipeline, scanner, stream } = this;
    this.pipeline = null;
    this.scanner = null;
    this.stream = null;
    this.track = null;
    scanner?.stop();
    await pipeline?.close().catch(() => {});
    scanner?.dispose();
    for (const t of stream?.getTracks() ?? []) t.stop();
    if (this.video) this.video.srcObject = null;
  }

  /** Gọi khi rời màn quay: dọn camera, worker, bộ mã hóa. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    if (typeof navigator !== "undefined") {
      navigator.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
    }
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.lost = null;
    await this.teardown();
    this.disposed = true;
  }
}
