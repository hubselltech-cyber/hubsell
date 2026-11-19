// ============================================================
// Đường quay: camera → canvas in ngày giờ → VideoEncoder H.264 (WebCodecs) → mediabunny ghép MP4.
//
// VÌ SAO không dùng trình ghi sẵn của Chrome (MediaRecorder): đo 16/11/2026 nó ra MP4 PHÂN MẢNH
// (`ftyp moov moof mdat…`), không có số khung, khung khóa chỉ ở giây 0 và 3,5 — nhiều trình phát không
// tua được. Đường này ra MP4 thường (không phân mảnh), khung khóa đúng mỗi giây, 0 khung rớt.
//
// MỘT bộ mã hóa chạy xuyên suốt, nhiều clip nối đuôi nhau. Cắt clip = ép khung kế tiếp thành khung khóa
// rồi chuyển các gói H.264 từ khung khóa đó sang tệp MP4 mới → không dừng, không cấu hình lại, không mất
// khung nào giữa hai clip. Đo với tem thật: 13–25 mili giây từ lúc quyết định cắt tới khung đầu clip mới
// (trên điện thoại Note8 là 147–230 mili giây).
//
// Lát M1 (18/11/2026): clip GHI THẲNG XUỐNG Ổ trong lúc quay (StreamTarget → kho clip chờ gửi), `moov` ở CUỐI
// tệp (`fastStart: false`) → RAM không phình theo độ dài clip (đo M0: phẳng với 3 bàn × 30 phút).
//   ⛔ KHÔNG dùng `fastStart: "reserve"`: độn 4,75 MB vào MỖI clip (đo M0, mục 18.7).
//   ⛔ KHÔNG khai `frameRate` cho rãnh video: mediabunny bắt mốc giờ về lưới 1/30 giây → hai khung trùng giờ.
// ============================================================

import type * as Mediabunny from "mediabunny";

import { KEY_FRAME_INTERVAL_US, MAX_ENCODE_QUEUE, WRITE_CHUNK_BYTES } from "./config";
import { startPump, type FramePump, type PumpMode } from "./frame-pump";
import { codeLinesDue, stampCodeLines, type PipFrame, type StampCanvas } from "./stamp-canvas";
import type { ClipOutcome, ClipSinkLike, RecorderLog } from "./types";

/** Số byte đầu của khung đầu tiên ghi vào sổ cứu clip (để tìm lại chỗ bắt đầu dữ liệu khung hình trong tệp dở). */
const RECOVERY_FIRST_BYTES = 32;

type Mb = typeof Mediabunny;

/** Bộ đọc mã nhận khung GỐC của camera (chưa in ngày giờ). */
export interface FrameTap {
  readonly active: boolean;
  /** Trả Promise (xong khi đã chụp được ảnh từ khung) nếu nhận, null nếu chưa tới lượt. */
  offer(source: VideoFrame | HTMLVideoElement): Promise<void> | null;
}

interface Clip {
  code: string;
  manual: boolean;
  /** Các dòng mã in lên khung hình của clip này (dưới ngày giờ), từ sau giây đầu. Clip quay tay không có tem → rỗng. */
  labelLines: string[];
  decidedAtMs: number;
  framesFed: number;
  chunks: number;
  boundaryTsUs: number | null;
  t0Us: number;
  lastTsUs: number;
  firstFrameAt: Date | null;
  keyNotHonoured: boolean;
  output: Mediabunny.Output | null;
  source: Mediabunny.EncodedVideoPacketSource | null;
  /** Chỗ ghi tệp của clip trong kho clip chờ gửi. */
  sink: ClipSinkLike | null;
  chain: Promise<void>;
  error: string | null;
  finishing: boolean;
  resolve: (outcome: ClipOutcome) => void;
  done: Promise<ClipOutcome>;
}

export interface ClipHandle {
  code: string;
  /** Xong khi tệp MP4 của clip đã ghép xong (hoặc clip hỏng). */
  done: Promise<ClipOutcome>;
  /** Mili giây từ lúc quyết định tới khung đầu của clip (null nếu chưa có khung). */
  msToFirstFrame(): number | null;
}

/** Chọn chuỗi codec H.264: thử High → Main → Baseline ở mức vừa đủ cho khổ hình. */
function codecCandidates(width: number, height: number, fps: number): string[] {
  const pixels = width * height;
  let level = "33";
  if (pixels <= 1280 * 720 && fps <= 30) level = "1f";
  else if (pixels <= 1920 * 1088 && fps <= 30) level = "28";
  else if (pixels <= 2560 * 1440 && fps <= 30) level = "32";
  return [`avc1.6400${level}`, `avc1.4d40${level}`, `avc1.42e0${level}`];
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function webCodecsMissing(): string | null {
  if (typeof VideoEncoder !== "function") return "Trình duyệt này không quay được (thiếu VideoEncoder). Hãy dùng Chrome hoặc Edge bản mới.";
  if (typeof VideoFrame !== "function") return "Trình duyệt này không quay được (thiếu VideoFrame). Hãy dùng Chrome hoặc Edge bản mới.";
  return null;
}

export class ClipPipeline {
  private mb: Mb | null = null;
  private encoder: VideoEncoder | null = null;
  private pump: FramePump | null = null;
  private decoderConfig: VideoDecoderConfig | null = null;
  private error: string | null = null;
  private closed = false;

  private readonly frameDurUs: number;
  private baseUs: number | null = null;
  private lastTsUs = -1;
  private lastKeyTsUs = -Infinity;

  /** Clip đã quyết định bắt đầu, chờ khung kế tiếp. */
  private pendingBegin: Clip | null = null;
  /** Clip đang nhận khung. */
  private feedClip: Clip | null = null;
  /** Clip đang nhận gói đã mã hóa. */
  private writeClip: Clip | null = null;
  /** Các clip đã có khung đầu, chờ gói khóa tương ứng đi ra. */
  private boundaries: Clip[] = [];
  private readonly clips: Clip[] = [];
  /** Báo cho ClipHandle biết mất bao lâu từ lúc quyết định tới khung đầu của clip. */
  private readonly firstFrameHook = new WeakMap<Clip, (ms: number) => void>();

  constructor(
    private readonly opts: {
      track: MediaStreamTrack;
      video: HTMLVideoElement;
      width: number;
      height: number;
      fps: number;
      bitrate: number;
      pumpMode: PumpMode;
      stamp: StampCanvas;
      /**
       * Ô cận cảnh cho khung hình đang vẽ (null = không ghép). Chỉ là NGUỒN HÌNH: không quyết định mở / cắt / dừng
       * clip (anh Trung 19/11/2026) — mọi quyết định đó vẫn đi qua beginClip / endClip như trước.
       */
      pip?: () => PipFrame | null;
      tap: FrameTap | null;
      log: RecorderLog;
      /** Xin chỗ ghi cho một clip (kho clip chờ gửi — ghi thẳng xuống ổ). */
      openSink: () => Promise<ClipSinkLike>;
      /** Bỏ các mảnh đã ghi của một clip hỏng. */
      discardFile: (fileKey: string) => Promise<void>;
    }
  ) {
    this.frameDurUs = Math.round(1_000_000 / opts.fps);
  }

  get broken(): string | null {
    return this.error;
  }

  async open(): Promise<void> {
    const missing = webCodecsMissing();
    if (missing) throw new Error(missing);
    const { width, height, fps, bitrate } = this.opts;
    if (width % 2 || height % 2) throw new Error(`Camera trả khổ hình lẻ ${width}×${height}, không mã hóa H.264 được`);

    let config: VideoEncoderConfig | null = null;
    for (const codec of codecCandidates(width, height, fps)) {
      const candidate: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        latencyMode: "realtime",
        hardwareAcceleration: "no-preference",
        avc: { format: "avc" }, // gói dạng AVCC + description (avcC) — đúng thứ MP4 cần
      };
      try {
        if ((await VideoEncoder.isConfigSupported(candidate)).supported) {
          config = candidate;
          break;
        }
      } catch {
        // thử cấu hình kế tiếp
      }
    }
    if (!config) throw new Error(`Máy này không mã hóa được H.264 ở ${width}×${height}`);

    // Nạp động: thư viện chỉ cần lúc thật sự quay, không vào gói của các trang khác.
    this.mb = await import("mediabunny");
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.onChunk(chunk, meta),
      error: (err) => this.onEncoderError(err),
    });
    this.encoder.configure(config);
    this.opts.stamp.resize(width, height);
    this.pump = startPump({
      mode: this.opts.pumpMode,
      track: this.opts.track,
      video: this.opts.video,
      onFrame: (source, tsUs) => this.onFrame(source, tsUs),
      log: this.opts.log,
    });
  }

  /** Bắt đầu một clip. Đang có clip thì đây là một lần CẮT: clip cũ tự kết thúc tại khung khóa đầu của clip mới. */
  beginClip(code: string, manual: boolean): ClipHandle {
    let resolve!: (outcome: ClipOutcome) => void;
    const done = new Promise<ClipOutcome>((r) => (resolve = r));
    const clip: Clip = {
      code,
      manual,
      labelLines: manual ? [] : stampCodeLines(code, null),
      decidedAtMs: performance.now(),
      framesFed: 0,
      chunks: 0,
      boundaryTsUs: null,
      t0Us: 0,
      lastTsUs: 0,
      firstFrameAt: null,
      keyNotHonoured: false,
      output: null,
      source: null,
      sink: null,
      chain: Promise.resolve(),
      error: null,
      finishing: false,
      resolve,
      done,
    };
    let firstFrameMs: number | null = null;
    const handle: ClipHandle = { code, done, msToFirstFrame: () => firstFrameMs };
    if (this.closed || this.error) {
      clip.finishing = true;
      resolve({ ok: false, code, error: this.error ?? "Đường quay đã đóng" });
      return handle;
    }
    if (this.pendingBegin) this.cancelPending("Bị thay bằng clip khác trước khi có khung hình");
    this.pendingBegin = clip;
    this.clips.push(clip);
    this.firstFrameHook.set(clip, (ms) => (firstFrameMs = ms));
    return handle;
  }

  /**
   * Máy chủ vừa khớp ra đơn của tem `code` → in thêm dòng "Mã đơn hàng" từ khung hình kế tiếp. Chỉ áp cho clip
   * CÒN ĐANG QUAY (hoặc đang chờ khung đầu) của đúng tem đó — câu trả lời về trễ sau khi đã đổi tem thì bỏ.
   */
  setOrderCode(code: string, orderCode: string): void {
    for (const clip of [this.feedClip, this.pendingBegin]) {
      if (clip && !clip.manual && clip.code === code) clip.labelLines = stampCodeLines(code, orderCode);
    }
  }

  /** Kết thúc clip đang quay (không mở clip mới). Bộ mã hóa vẫn mở, sẵn sàng cho clip sau. */
  async endClip(): Promise<ClipOutcome | null> {
    if (this.pendingBegin) this.cancelPending("Đã dừng trước khi có khung hình");
    const clip = this.feedClip;
    this.feedClip = null;
    if (!clip) return null;
    try {
      if (this.encoder?.state === "configured") await this.encoder.flush();
    } catch (err) {
      clip.error ??= `Bộ mã hóa không xả được: ${errText(err)}`;
    }
    // Sau flush mọi gói của clip đã ra hết. Nếu trong lúc chờ đã có clip khác mở thì clip này đã được đóng
    // ở ranh giới; còn không thì đóng ở đây.
    if (this.writeClip === clip) {
      this.writeClip = null;
      this.finishClip(clip);
    } else if (!clip.source && !clip.finishing) {
      this.boundaries = this.boundaries.filter((b) => b !== clip);
      clip.finishing = true;
      clip.resolve({ ok: false, code: clip.code, error: this.error ?? "Clip không có khung hình nào" });
    }
    return clip.done;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.endClip().catch(() => null);
    this.closed = true;
    await this.pump?.stop().catch(() => {});
    try {
      if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
    } catch {
      // đã đóng
    }
    await Promise.all(this.clips.map((c) => c.done));
  }

  private cancelPending(reason: string): void {
    const clip = this.pendingBegin;
    this.pendingBegin = null;
    if (!clip) return;
    clip.finishing = true;
    clip.resolve({ ok: false, code: clip.code, error: reason });
  }

  private async onFrame(source: VideoFrame | HTMLVideoElement, tsUs: number): Promise<void> {
    // Bộ đọc mã nhận khung gốc. Phải chờ nó chụp xong rồi mới đi tiếp vì khung sẽ bị đóng sau hàm này.
    const tap = this.opts.tap;
    if (tap?.active) {
      const snap = tap.offer(source);
      if (snap) await snap;
    }
    if (this.closed || this.error) return;
    const pending = this.pendingBegin;
    if (!this.feedClip && !pending) return; // đang nghỉ giữa hai clip: không vẽ, không mã hóa
    const encoder = this.encoder;
    if (!encoder || encoder.state !== "configured") return;
    if (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) return; // máy đuối: bỏ khung này, không để dồn

    if (this.baseUs === null) this.baseUs = tsUs;
    let ts = Math.round(tsUs - this.baseUs);
    if (ts <= this.lastTsUs) ts = this.lastTsUs + 1;
    this.lastTsUs = ts;

    let keyFrame = false;
    if (pending) {
      // Khung này là khung ĐẦU của clip mới → ép khung khóa và đánh dấu ranh giới.
      this.pendingBegin = null;
      keyFrame = true;
      pending.boundaryTsUs = ts;
      pending.firstFrameAt = new Date();
      this.firstFrameHook.get(pending)?.(performance.now() - pending.decidedAtMs);
      this.boundaries.push(pending);
      this.feedClip = pending;
    } else if (ts - this.lastKeyTsUs >= KEY_FRAME_INTERVAL_US - this.frameDurUs / 2) {
      keyFrame = true;
    }
    if (keyFrame) this.lastKeyTsUs = ts;

    // Chữ đi theo CLIP đang nhận khung hình. Hai dòng mã hiện TRỄ CODE_LINES_DELAY_MS so với khung đầu của clip (tính
    // theo mốc giờ của khung hình, nên trong tệp đúng từng khung) — giây đầu của clip mới chỉ có ngày giờ.
    const feed = this.feedClip;
    const lines =
      feed && feed.boundaryTsUs !== null && codeLinesDue((ts - feed.boundaryTsUs) / 1000) ? feed.labelLines : undefined;
    this.opts.stamp.draw(source, undefined, lines, this.opts.pip?.() ?? null);
    const frame = new VideoFrame(this.opts.stamp.canvas, { timestamp: ts, duration: this.frameDurUs, alpha: "discard" });
    try {
      encoder.encode(frame, { keyFrame });
      if (this.feedClip) this.feedClip.framesFed++;
    } finally {
      frame.close();
    }
  }

  private onChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    const mb = this.mb;
    if (!mb) return;
    if (meta?.decoderConfig) this.decoderConfig = meta.decoderConfig;

    // Tới ranh giới: gói này là khung khóa đầu tiên của clip mới → đóng clip cũ, mở tệp mới.
    while (this.boundaries.length && chunk.timestamp >= (this.boundaries[0].boundaryTsUs ?? Infinity)) {
      const next = this.boundaries[0];
      if (chunk.type !== "key") {
        if (!next.keyNotHonoured) {
          next.keyNotHonoured = true;
          this.opts.log("warn", `Bộ mã hóa chưa trả khung khóa đúng chỗ cắt (clip ${next.code}) — chờ khung khóa kế tiếp`);
        }
        break;
      }
      this.boundaries.shift();
      if (this.writeClip) this.finishClip(this.writeClip);
      this.openWriter(next, chunk.timestamp);
      this.writeClip = next;
    }

    const clip = this.writeClip;
    if (!clip || !clip.source) return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    // Dời mốc thời gian để mỗi clip bắt đầu từ 0.
    const packet = new mb.EncodedPacket(
      data,
      chunk.type,
      (chunk.timestamp - clip.t0Us) / 1e6,
      (chunk.duration ?? this.frameDurUs) / 1e6
    );
    clip.chunks++;
    clip.lastTsUs = chunk.timestamp;
    // Gói đầu của mỗi tệp phải kèm decoderConfig (có avcC) — dùng lại cái bộ mã hóa đưa lúc đầu.
    const first = clip.chunks === 1;
    const packetMeta = first && this.decoderConfig ? { decoderConfig: this.decoderConfig } : undefined;
    const source = clip.source;
    // Sổ cứu clip (M1b): báo từng khung ĐÚNG thứ tự ghép, ngay trước khi ghép — trang sập giữa chừng thì ghép lại được.
    const tsUs = chunk.timestamp - clip.t0Us;
    const durUs = chunk.duration ?? this.frameDurUs;
    const isKey = chunk.type === "key";
    const config = this.decoderConfig;
    clip.chain = clip.chain.then(async () => {
      if (clip.error) return;
      try {
        const sink = clip.sink;
        if (first && config && sink?.recoveryBegin) {
          const description = config.description;
          sink.recoveryBegin({
            code: clip.code,
            manual: clip.manual,
            startedAtIso: (clip.firstFrameAt ?? new Date()).toISOString(),
            width: this.opts.width,
            height: this.opts.height,
            codec: config.codec,
            description: description
              ? ArrayBuffer.isView(description)
                ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice()
                : new Uint8Array(description as ArrayBuffer).slice()
              : null,
            firstBytes: data.slice(0, RECOVERY_FIRST_BYTES),
          });
        }
        sink?.recoverySample?.(data.byteLength, tsUs, durUs, isKey);
        await source.add(packet, packetMeta);
      } catch (err) {
        clip.error = `Ghép tệp MP4 lỗi: ${errText(err)}`;
      }
    });
  }

  private openWriter(clip: Clip, t0Us: number): void {
    const mb = this.mb;
    if (!mb) return;
    clip.t0Us = t0Us;
    const source = new mb.EncodedVideoPacketSource("avc");
    clip.source = source;
    // Các gói đầu của clip xếp hàng sau chuỗi này (onChunk nối vào clip.chain) nên không gói nào tới trước khi tệp mở.
    clip.chain = (async () => {
      const sink = await this.opts.openSink();
      clip.sink = sink;
      clip.output = new mb.Output({
        // fastStart false: ghi dần xuống ổ, `moov` viết ở CUỐI tệp lúc kết thúc (chỉ thêm ≈ 6 KB; tua vẫn được).
        format: new mb.Mp4OutputFormat({ fastStart: false }),
        target: new mb.StreamTarget(sink.stream() as WritableStream<Mediabunny.StreamTargetChunk>, {
          chunked: true,
          chunkSize: WRITE_CHUNK_BYTES,
        }),
      });
      clip.output.addVideoTrack(source); // ⛔ không khai frameRate (xem đầu tệp)
      await clip.output.start();
    })().catch((err: unknown) => {
      clip.error = `Không mở được tệp MP4: ${errText(err)}`;
    });
  }

  private finishClip(clip: Clip): void {
    if (clip.finishing) return;
    clip.finishing = true;
    const { width, height } = this.opts;
    clip.chain
      .then(async (): Promise<ClipOutcome> => {
        const output = clip.output;
        if (clip.error) throw new Error(clip.error);
        if (!output || !clip.chunks) {
          await output?.cancel().catch(() => {});
          throw new Error("Clip không có khung hình nào");
        }
        await output.finalize();
        const file = clip.sink?.finish();
        clip.sink = null; // từ đây tệp thuộc về hàng chờ gửi
        if (!file || !file.sizeBytes) throw new Error("Ghép xong nhưng không có dữ liệu tệp");
        const mediaSeconds = (clip.lastTsUs - clip.t0Us + this.frameDurUs) / 1e6;
        return {
          ok: true,
          clip: {
            code: clip.code,
            manual: clip.manual,
            startedAt: clip.firstFrameAt ?? new Date(),
            durationSec: mediaSeconds,
            width,
            height,
            frames: clip.chunks,
            file,
          },
        };
      })
      .then(
        (outcome) => clip.resolve(outcome),
        (err: unknown) => {
          // Clip hỏng: dọn các mảnh đã ghi xuống ổ để không thành rác.
          const sink = clip.sink;
          clip.sink = null;
          if (sink) void this.opts.discardFile(sink.finish().fileKey).catch(() => {});
          clip.resolve({ ok: false, code: clip.code, error: errText(err) });
        }
      );
  }

  private onEncoderError(err: unknown): void {
    this.error = `Bộ mã hóa lỗi: ${errText(err)}`;
    this.opts.log("error", this.error);
    // Cứu phần đã quay được.
    if (this.pendingBegin) this.cancelPending(this.error);
    for (const clip of this.boundaries) {
      clip.finishing = true;
      clip.resolve({ ok: false, code: clip.code, error: this.error });
    }
    this.boundaries = [];
    this.feedClip = null;
    if (this.writeClip) {
      const clip = this.writeClip;
      this.writeClip = null;
      this.finishClip(clip);
    }
  }
}
