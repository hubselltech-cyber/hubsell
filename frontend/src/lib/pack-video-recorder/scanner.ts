// ============================================================
// Bộ đọc mã phía luồng chính: cứ 200 ms lấy MỘT khung hình đủ độ phân giải, gửi sang Worker đọc
// Code 128 + QR, rồi báo kết quả cho máy trạng thái tự cắt. Khung bao mã chỉ vẽ lên lớp phủ của ô xem
// trước — KHÔNG bao giờ vẽ vào hình được quay.
//
// Số đo 16/11/2026 (tem Shopee SPX thật, 1280×720): chỉ đọc được mã QR, không lần nào đọc được mã vạch;
// đọc được khi tem được giơ thẳng vào camera. Anh Trung: "Phải dơ thẳng vào cam mới nhận. Như vậy cũng OK rồi."
// ============================================================

import { SCAN_INTERVAL_MS } from "./config";
import type { FrameTap } from "./clip-pipeline";
import type { ScanReply, ScanRequest } from "./scan.worker";
import type { RecorderLog, ScannedCode } from "./types";

const WORKER_INIT_TIMEOUT_MS = 15_000;
const HUNG_READ_MS = 5_000;
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class Scanner implements FrameTap {
  private worker: Worker | null = null;
  private mainDetect: ((bitmap: ImageBitmap) => Promise<ScannedCode[]>) | null = null;
  private ready = false;
  private running = false;
  private busy = false;
  private busySince = 0;
  private lastAttemptAt = -Infinity;
  private seq = 0;
  private readonly pending = new Map<number, { width: number; height: number }>();
  private clearBoxesTimer: ReturnType<typeof setTimeout> | null = null;
  private onRead: ((codes: ScannedCode[]) => void) | null = null;
  private errorsLogged = 0;

  constructor(
    private readonly boxCanvas: HTMLCanvasElement | null,
    private readonly log: RecorderLog
  ) {}

  get active(): boolean {
    return this.running;
  }

  /** Khởi động một lần. Thử Worker trước; Worker hỏng thì đọc trên luồng chính và ghi rõ vào nhật ký. */
  async init(): Promise<boolean> {
    if (this.ready) return true;
    if (typeof createImageBitmap !== "function") {
      this.log("error", "Trình duyệt này không đọc được mã tem (thiếu createImageBitmap)");
      return false;
    }
    if (typeof Worker === "function") {
      try {
        await this.startWorker();
        this.ready = true;
        return true;
      } catch (err) {
        this.log("warn", `Bộ đọc mã không chạy nền được (${errText(err)}) — chuyển sang chạy trực tiếp, hình có thể giật`);
        this.worker?.terminate();
        this.worker = null;
      }
    }
    try {
      const core = await import("./scan-core");
      const { detect } = await core.createDetector();
      this.mainDetect = async (bitmap) => core.plainCodes(await detect(bitmap));
      this.ready = true;
      return true;
    } catch (err) {
      this.log("error", `Không khởi động được bộ đọc mã tem: ${errText(err)}`);
      return false;
    }
  }

  private startWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
      const timeout = setTimeout(() => reject(new Error("không trả lời sau 15 giây")), WORKER_INIT_TIMEOUT_MS);
      worker.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error(event.message || "lỗi khi nạp"));
      };
      worker.onmessage = (event: MessageEvent<ScanReply>) => {
        const msg = event.data;
        if (msg.type === "ready") {
          clearTimeout(timeout);
          worker.onerror = (e) => this.log("error", `Bộ đọc mã lỗi: ${e.message}`);
          resolve();
        } else if (msg.type === "init-error") {
          clearTimeout(timeout);
          reject(new Error(msg.error));
        } else if (msg.type === "result") {
          this.onResult(msg.id, msg.codes, msg.error);
        }
      };
      this.worker = worker;
      const init: ScanRequest = { type: "init" };
      worker.postMessage(init);
    });
  }

  /** Bắt đầu nhận khung do đường quay đưa sang (offer). */
  start(onRead: (codes: ScannedCode[]) => void): boolean {
    if (!this.ready) return false;
    this.onRead = onRead;
    this.running = true;
    this.lastAttemptAt = -Infinity;
    return true;
  }

  stop(): void {
    this.running = false;
    this.onRead = null;
    this.clearBoxes();
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.mainDetect = null;
    this.pending.clear();
    this.busy = false;
    this.ready = false;
  }

  /** Người gọi phải chờ Promise trả về rồi mới được đóng VideoFrame. */
  offer(source: VideoFrame | HTMLVideoElement): Promise<void> | null {
    if (!this.running) return null;
    const now = performance.now();
    if (now - this.lastAttemptAt < SCAN_INTERVAL_MS - 4) return null;
    if (this.busy && now - this.busySince > HUNG_READ_MS) {
      // Lần đọc trước treo — gỡ kẹt để không đứng hẳn.
      this.busy = false;
      this.pending.clear();
      this.log("warn", "Một lần đọc mã tem treo quá 5 giây — bỏ qua và đọc tiếp");
    }
    this.lastAttemptAt = now;
    if (this.busy) return null; // lần đọc trước chưa xong: bỏ lượt này, không xếp hàng
    this.busy = true;
    this.busySince = now;
    const id = ++this.seq;
    return createImageBitmap(source)
      .then((bitmap) => {
        this.pending.set(id, { width: bitmap.width, height: bitmap.height });
        if (this.worker) {
          const request: ScanRequest = { type: "detect", id, bitmap };
          this.worker.postMessage(request, [bitmap]);
        } else if (this.mainDetect) {
          const detect = this.mainDetect;
          detect(bitmap)
            .then(
              (codes) => this.onResult(id, codes),
              (err: unknown) => this.onResult(id, [], errText(err))
            )
            .finally(() => bitmap.close());
        } else {
          bitmap.close();
          this.busy = false;
        }
      })
      .catch(() => {
        this.busy = false;
      });
  }

  private onResult(id: number, codes: ScannedCode[], error?: string): void {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    this.busy = false;
    if (!pending) return;
    if (error && this.errorsLogged < 3) {
      this.errorsLogged++;
      this.log("error", `Lỗi khi đọc mã tem: ${error}`);
    }
    if (!this.running) return;
    this.drawBoxes(codes, pending.width, pending.height);
    try {
      this.onRead?.(codes);
    } catch (err) {
      this.log("error", `Lỗi khi xử lý mã vừa đọc: ${errText(err)}`);
    }
  }

  private clearBoxes(): void {
    if (this.clearBoxesTimer) clearTimeout(this.clearBoxesTimer);
    this.clearBoxesTimer = null;
    const canvas = this.boxCanvas;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Khung bao chỉ vẽ lên lớp phủ của ô xem trước, tự xóa sau 0,7 giây. */
  private drawBoxes(codes: ScannedCode[], width: number, height: number): void {
    const canvas = this.boxCanvas;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.clearBoxesTimer) clearTimeout(this.clearBoxesTimer);
    if (!codes.length) return;
    ctx.lineWidth = Math.max(3, Math.round(height / 240));
    ctx.strokeStyle = "#22c55e";
    for (const code of codes) {
      if (code.corners?.length === 4) {
        ctx.beginPath();
        ctx.moveTo(code.corners[0].x, code.corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(code.corners[i].x, code.corners[i].y);
        ctx.closePath();
        ctx.stroke();
      } else if (code.box) {
        ctx.strokeRect(code.box.x, code.box.y, code.box.w, code.box.h);
      }
    }
    this.clearBoxesTimer = setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), 700);
  }
}
