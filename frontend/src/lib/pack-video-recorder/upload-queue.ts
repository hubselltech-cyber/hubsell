// ============================================================
// MÁY TRẠNG THÁI CỦA HÀNG CHỜ TẢI LÊN (rủi ro N2 + N3, mục 18.4). Thuần: mọi thứ chạm trình duyệt / mạng được
// truyền vào, nên test được bằng đồng hồ giả.
//
// Luật:
//   · gửi TUẦN TỰ, mỗi tab một lượt PUT một lúc (không tranh băng thông với chính mình, không dồn sóng);
//   · hỏng vì mạng / máy chủ / kho → KHÔNG bỏ cuộc: clip xuống cuối hàng, cả hàng nghỉ một khoảng tăng dần có
//     lệch ngẫu nhiên (upload-backoff.ts) rồi thử tiếp. Một clip lên được là bộ đếm hỏng về 0;
//   · đang MẤT MẠNG thì đứng chờ, không đốt lượt thử; CÓ MẠNG LẠI là chạy ngay, không chờ hết khoảng nghỉ;
//   · chỉ dừng hẳn một clip với lỗi thử lại cũng vô ích (hết quyền, tệp hỏng, hết giờ quay) — clip đó sang
//     "lỗi", tệp VẪN GIỮ, người dùng bấm "Thử lại" được; các clip khác đi tiếp.
// ============================================================

import { retryDelayMs } from "./upload-backoff";

export type UploadVerdict =
  /** Thử lại được (mạng, máy chủ 5xx / 429, kho chưa nhận…). */
  | { kind: "retry"; text: string; retryAfterMs?: number | null }
  /** Thử lại cũng vô ích → dừng clip này, chờ người dùng. */
  | { kind: "fatal"; text: string };

export interface UploadQueueDeps {
  /** Gửi trọn một clip (xin vé → PUT → chốt). Ném lỗi nếu chưa xong. */
  upload(localId: string): Promise<void>;
  classify(err: unknown): UploadVerdict;
  isOnline(): boolean;
  now(): number;
  random(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onJob(localId: string, event: UploadJobEvent): void;
  /** Trạng thái chung của hàng chờ vừa đổi (để vẽ dải báo). */
  onQueue(state: UploadQueueState): void;
}

export type UploadJobEvent =
  | { type: "uploading"; attempt: number }
  | { type: "stored" }
  | { type: "retry"; attempt: number; text: string; waitMs: number }
  | { type: "failed"; text: string };

export interface UploadQueueState {
  /** Số clip còn trong hàng (kể cả clip đang gửi). */
  pending: number;
  /** Số lần hỏng LIÊN TIẾP của cả hàng. */
  failures: number;
  lastError: string | null;
  /** Mốc tự thử lại; null = không chờ theo đồng hồ. */
  nextRetryAtMs: number | null;
  /** Đang đứng chờ vì mất mạng. */
  waitingOnline: boolean;
}

export class UploadQueue {
  private readonly queue: string[] = [];
  private readonly attempts = new Map<string, number>();
  private running = false;
  private active: string | null = null;
  private failures = 0;
  private lastError: string | null = null;
  private nextRetryAtMs: number | null = null;
  private waitingOnline = false;
  /** Đánh thức lượt nghỉ / lượt chờ mạng đang diễn ra. */
  private wake: (() => void) | null = null;

  constructor(private readonly deps: UploadQueueDeps) {}

  get state(): UploadQueueState {
    return {
      pending: this.queue.length + (this.active ? 1 : 0),
      failures: this.failures,
      lastError: this.lastError,
      nextRetryAtMs: this.nextRetryAtMs,
      waitingOnline: this.waitingOnline,
    };
  }

  has(localId: string): boolean {
    return this.active === localId || this.queue.includes(localId);
  }

  /** Thêm một clip vào cuối hàng (bỏ qua nếu đã có). */
  enqueue(localId: string): void {
    if (this.has(localId)) return;
    this.queue.push(localId);
    this.emit();
    void this.run();
  }

  /** Có mạng lại / người dùng bấm "Thử ngay": bỏ khoảng nghỉ đang chờ, chạy tiếp ngay. */
  kick(): void {
    this.wake?.();
  }

  private emit(): void {
    this.deps.onQueue(this.state);
  }

  /** Chờ tới khi `kick()` được gọi, hoặc hết `ms` (ms = null thì chỉ chờ kick). */
  private pause(ms: number | null): Promise<void> {
    return new Promise((resolve) => {
      let timer: unknown = null;
      const done = () => {
        if (timer !== null) this.deps.clearTimer(timer);
        this.wake = null;
        resolve();
      };
      this.wake = done;
      if (ms !== null) timer = this.deps.setTimer(done, ms);
    });
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        if (!this.deps.isOnline()) {
          // Mất mạng: không thử, không đếm hỏng. Sự kiện "có mạng lại" gọi kick().
          this.waitingOnline = true;
          this.nextRetryAtMs = null;
          this.emit();
          await this.pause(null);
          this.waitingOnline = false;
          continue;
        }
        const localId = this.queue.shift() as string;
        this.active = localId;
        const attempt = (this.attempts.get(localId) ?? 0) + 1;
        this.attempts.set(localId, attempt);
        this.deps.onJob(localId, { type: "uploading", attempt });
        this.emit();
        try {
          await this.deps.upload(localId);
          this.active = null;
          this.attempts.delete(localId);
          this.failures = 0;
          this.lastError = null;
          this.deps.onJob(localId, { type: "stored" });
          this.emit();
        } catch (err) {
          this.active = null;
          const verdict = this.deps.classify(err);
          if (verdict.kind === "fatal") {
            this.attempts.delete(localId);
            this.deps.onJob(localId, { type: "failed", text: verdict.text });
            this.emit();
            continue;
          }
          this.failures++;
          this.lastError = verdict.text;
          this.queue.push(localId); // xuống cuối hàng: một clip trục trặc không chặn các clip sau
          const waitMs = retryDelayMs(this.failures, this.deps.random(), verdict.retryAfterMs ?? null);
          this.deps.onJob(localId, { type: "retry", attempt, text: verdict.text, waitMs });
          if (!this.deps.isOnline()) continue; // vừa rớt mạng → vòng trên sẽ đứng chờ mạng, khỏi nghỉ theo đồng hồ
          this.nextRetryAtMs = this.deps.now() + waitMs;
          this.emit();
          await this.pause(waitMs);
          this.nextRetryAtMs = null;
        }
      }
    } finally {
      this.running = false;
      this.nextRetryAtMs = null;
      this.waitingOnline = false;
      this.emit();
    }
  }
}
