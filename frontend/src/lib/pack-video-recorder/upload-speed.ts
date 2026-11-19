// ============================================================
// ĐO TỐC ĐỘ TẢI LÊN THẬT + CÂU BÁO TÌNH TRẠNG HÀNG CHỜ (rủi ro N4, N5 — mục 18.4). Hàm thuần.
//
// Không đo bằng "bài thử tốc độ" riêng (tốn mạng của shop, lại không phải đường tới kho): lấy luôn số byte kho
// đã nhận của chính các video đang gửi. So với TỐC ĐỘ QUAY (byte tệp sinh ra mỗi giây quay) để biết hàng chờ
// đang ngắn lại hay dài ra.
//
// Cảnh báo, KHÔNG khóa cứng (anh Trung): mạng chậm / mất mạng chỉ hiện dải báo, vẫn quay bình thường. Chỉ một
// ca chặn MỞ video mới: ổ đĩa đã ghi hỏng thật (hết chỗ thì quay cũng không giữ được).
// ============================================================

/** Cửa sổ trượt để tính tốc độ tải — 20 giây: đủ dài để không nhảy theo từng gói, đủ ngắn để theo kịp mạng đổi. Số tự chọn. */
const WINDOW_MS = 20_000;
/** Phải có ít nhất chừng này thời gian đang gửi trong cửa sổ mới dám nói tốc độ. Số tự chọn. */
const MIN_SPAN_MS = 3_000;

export class UploadSpeedMeter {
  private samples: { atMs: number; bytes: number }[] = [];

  /** Ghi nhận kho vừa nhận thêm `bytes` byte lúc `nowMs`. */
  add(bytes: number, nowMs: number): void {
    if (!(bytes > 0)) return;
    this.samples.push({ atMs: nowMs, bytes });
    this.trim(nowMs);
  }

  /** Byte / giây trong cửa sổ gần nhất; null = chưa đủ số liệu. */
  bytesPerSecond(nowMs: number): number | null {
    this.trim(nowMs);
    if (this.samples.length < 2) return null;
    const span = nowMs - this.samples[0].atMs;
    if (span < MIN_SPAN_MS) return null;
    // Mẫu đầu chỉ đánh dấu mốc bắt đầu cửa sổ — byte của nó được gửi TRƯỚC mốc đó.
    const sum = this.samples.slice(1).reduce((s, x) => s + x.bytes, 0);
    return (sum * 1000) / span;
  }

  reset(): void {
    this.samples = [];
  }

  private trim(nowMs: number): void {
    const cutoff = nowMs - WINDOW_MS;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].atMs < cutoff) drop++;
    if (drop) this.samples = this.samples.slice(drop);
  }
}

/** Tốc độ quay (byte tệp / giây quay) — trung bình trượt qua các clip vừa xong. */
export class RecordRateMeter {
  private rate: number | null = null;

  addClip(sizeBytes: number, durationSec: number): void {
    if (!(sizeBytes > 0) || !(durationSec >= 1)) return;
    const r = sizeBytes / durationSec;
    this.rate = this.rate === null ? r : this.rate * 0.7 + r * 0.3;
  }

  bytesPerSecond(): number | null {
    return this.rate;
  }
}

export type DiskState =
  /** Ghi xuống ổ bình thường. */
  | "ok"
  /** Lần ghi thử gần nhất hỏng, hoặc trình duyệt báo còn rất ít chỗ — cảnh báo sớm. */
  | "low"
  /** Một lần ghi video THẬT đã hỏng: video đó đang nằm tạm trong bộ nhớ, không mở video mới. */
  | "full"
  /** Trình duyệt không cho dùng ổ (chế độ ẩn danh, bản cũ…) → video chờ gửi nằm trong bộ nhớ như trước đây. */
  | "memory";

export interface QueueSnapshot {
  online: boolean;
  /** Số video đã quay xong nhưng chưa lên kho (đang chờ + đang gửi). */
  waiting: number;
  /** Tổng cỡ các video đó. */
  backlogBytes: number;
  /** Số lần gửi hỏng LIÊN TIẾP (0 = đang gửi trơn). */
  failures: number;
  /** Lý do của lần hỏng gần nhất. */
  lastError: string | null;
  /** Mốc sẽ tự thử lại (Date.now()), null = không chờ theo đồng hồ. */
  nextRetryAtMs: number | null;
  uploadBytesPerSec: number | null;
  recordBytesPerSec: number | null;
  disk: DiskState;
}

export type QueueNoticeKind = "disk-full" | "offline" | "retrying" | "slow" | "disk-low" | "memory";

export interface QueueNotice {
  kind: QueueNoticeKind;
  tone: "rose" | "amber" | "slate";
  text: string;
  /** Có nên hiện nút "Thử ngay" không. */
  canRetryNow: boolean;
}

/** Từ ngần này clip chờ trở lên mới nói "mạng chậm" — một clip vừa quay xong đang gửi là chuyện thường. Số tự chọn. */
export const SLOW_NOTICE_MIN_WAITING = 2;
/** Hỏng liên tiếp từ ngần này lần mới hiện dải "chưa gửi được" — một lần chập rồi tự qua thì khỏi làm phiền. Số tự chọn. */
export const RETRY_NOTICE_MIN_FAILURES = 2;

function clipCount(n: number): string {
  return `${n.toLocaleString("vi-VN")} video`;
}

/** "≈ 3 phút" / "≈ 1 giờ 20 phút" — làm tròn LÊN để không hứa sớm hơn thực tế. */
export function roughDuration(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `≈ ${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `≈ ${h} giờ ${m} phút` : `≈ ${h} giờ`;
}

/**
 * Câu báo DUY NHẤT cho tình trạng hàng chờ (nặng nhất thắng); null = mọi thứ bình thường, không hiện gì.
 * `nowMs` chỉ dùng để tính "thử lại sau N giây".
 */
export function queueNotice(s: QueueSnapshot, nowMs: number): QueueNotice | null {
  if (s.disk === "full") {
    return {
      kind: "disk-full",
      tone: "rose",
      text:
        s.waiting > 0
          ? `Ổ đĩa máy này đã đầy — chưa mở được video mới. ${clipCount(s.waiting)} đang chờ gửi vẫn được giữ; gửi xong tới đâu ổ trống tới đó. Đừng đóng trang này.`
          : "Ổ đĩa máy này đã đầy — chưa mở được video mới. Dọn bớt ổ đĩa rồi bấm Thử ngay.",
      canRetryNow: true,
    };
  }
  if (!s.online) {
    return {
      kind: "offline",
      tone: "amber",
      text:
        s.waiting > 0
          ? `Mất mạng — ${clipCount(s.waiting)} đang chờ gửi. Cứ quay tiếp, có mạng lại là tự gửi.`
          : "Mất mạng — cứ quay tiếp, video được giữ trên máy này và tự gửi khi có mạng lại.",
      canRetryNow: false,
    };
  }
  if (s.waiting > 0 && s.failures >= RETRY_NOTICE_MIN_FAILURES) {
    const wait = s.nextRetryAtMs !== null ? Math.max(0, Math.ceil((s.nextRetryAtMs - nowMs) / 1000)) : 0;
    const why = s.lastError ? ` (${s.lastError})` : "";
    return {
      kind: "retrying",
      tone: "amber",
      text: `Chưa gửi được video lên hệ thống${why} — ${clipCount(s.waiting)} đang chờ, ${
        wait > 0 ? `tự thử lại sau ${wait} giây` : "đang thử lại"
      }. Cứ quay tiếp.`,
      canRetryNow: wait > 0,
    };
  }
  if (
    s.waiting >= SLOW_NOTICE_MIN_WAITING &&
    s.uploadBytesPerSec !== null &&
    s.recordBytesPerSec !== null &&
    s.uploadBytesPerSec < s.recordBytesPerSec
  ) {
    const eta = s.uploadBytesPerSec > 0 ? ` (${roughDuration(s.backlogBytes / s.uploadBytesPerSec)})` : "";
    return {
      kind: "slow",
      tone: "amber",
      text: `Mạng tải lên chậm hơn tốc độ quay — đang chờ ${clipCount(s.waiting)}${eta}. Cứ quay tiếp, video vẫn được giữ.`,
      canRetryNow: false,
    };
  }
  if (s.disk === "low") {
    return {
      kind: "disk-low",
      tone: "amber",
      text: "Ổ đĩa máy này sắp đầy — video chờ gửi có thể không còn chỗ giữ. Dọn bớt ổ đĩa, và đừng để mất mạng lâu.",
      canRetryNow: false,
    };
  }
  if (s.disk === "memory" && s.waiting > 0) {
    return {
      kind: "memory",
      tone: "slate",
      text: `Trình duyệt này không cho giữ video chờ gửi trên ổ đĩa — ${clipCount(s.waiting)} đang nằm trong bộ nhớ. Đừng đóng hay tải lại trang tới khi gửi xong.`,
      canRetryNow: false,
    };
  }
  return null;
}

/**
 * Gộp nhiều lần gọi thành tối đa MỘT lần mỗi `intervalMs`: lần đầu chạy ngay, các lần trong khoảng nghỉ gộp
 * thành một lần chạy ở cuối khoảng. Dùng để không làm mới số liệu máy chủ sau MỖI video (rủi ro N9).
 */
export function createThrottle(
  fn: () => void,
  intervalMs: number,
  clock: { now(): number; setTimer(run: () => void, ms: number): unknown; clearTimer(handle: unknown): void } = {
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
): { call(): void; cancel(): void } {
  let lastRun = -Infinity;
  let timer: unknown = null;
  const run = () => {
    timer = null;
    lastRun = clock.now();
    fn();
  };
  return {
    call() {
      if (timer !== null) return; // đã có một lần chạy đang hẹn
      const wait = lastRun + intervalMs - clock.now();
      if (wait <= 0) run();
      else timer = clock.setTimer(run, wait);
    },
    cancel() {
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
    },
  };
}
