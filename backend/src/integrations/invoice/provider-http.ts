// ============================================================
// LỆNH GỌI NHÀ CUNG CẤP HÓA ĐƠN — một cửa có ĐO thời gian và có THỜI HẠN CHỜ
// (giai đoạn 2 bước 5, lát 4 + lát 6a — docs/HANG-DOI-BEN.md mục 4.6).
//
// ĐO (lát 4): mỗi 15 phút in một dòng tổng hợp cho từng cặp NCC + loại lệnh, cùng
// cách làm với lệnh gọi sàn (lib/platform-http.ts).
//
// THỜI HẠN CHỜ (lát 6a): trước 03/10/2026 lệnh gọi NCC không đặt thời hạn, NCC
// nhận kết nối rồi im lặng thì lệnh treo tới mức mặc định 300 giây của thư viện
// (đo 02/10) và vòng tự phát hành của MỌI shop đứng lại chừng đó. Nay mỗi lệnh có
// thời hạn INVOICE_HTTP_TIMEOUT_MS, tính cho CẢ lượt trao đổi (gửi, chờ tiêu đề,
// đọc thân). Quá hạn → ném ProviderTimeoutError; nơi gọi lệnh PHÁT HÀNH coi đó là
// "chưa rõ kết quả" (lát 5), không phải "chưa lập".
//
// Ngoài thời hạn chờ, hành vi y như gọi fetch thẳng: trả đúng Response, ném đúng lỗi.
//
// Tách riêng theo LOẠI LỆNH (phát hành, hỏi trạng thái, lấy token...) vì phát hành
// phải ký số nên chậm hơn hẳn lệnh đọc — gộp chung thì số đo không dùng được.
//
// Thời gian đo là tới lúc NCC trả tiêu đề phản hồi; phần đọc thân do nơi gọi làm
// sau đó (readProviderBody) nên không nằm trong số đo, nhưng vẫn nằm trong thời hạn chờ. Log chỉ in tên NCC + loại lệnh, không in địa
// chỉ hay thân lệnh (thân mang dữ liệu người mua, tiêu đề mang token).
// ============================================================

import { percentile } from "../../lib/platform-http";

/** Nhịp in dòng tổng hợp. */
const SUMMARY_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Lệnh chờ lâu hơn mức này được in riêng một dòng ngay lúc đó. MẶC ĐỊNH TỰ CHỌN
 * 10 giây (bằng cửa gọi sàn), chỉ ảnh hưởng việc ghi log, không đổi hành vi.
 */
const SLOW_LOG_MS = 10_000;
/** Trần số mẫu giữ trong RAM cho một khóa trong một nhịp — quá thì lấy mẫu ngẫu nhiên. */
const MAX_SAMPLES = 5_000;
/**
 * Thời hạn chờ mặc định cho một lệnh gọi NCC. MẶC ĐỊNH TỰ CHỌN 60 giây (anh Trung
 * nhận 02/10/2026): sandbox MISA phát hành mất 0,35–0,6 giây, prod chưa có số đo
 * nào vì chưa shop nào phát hành. Có dòng [NccHTTP] thật thì chỉnh theo số đo.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Thời hạn chờ đang áp dụng (mili giây). Đọc INVOICE_HTTP_TIMEOUT_MS mỗi lần gọi;
 * "0" = TẮT thời hạn (đường lui); để trống hoặc giá trị lạ = mặc định.
 */
export function providerHttpTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INVOICE_HTTP_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_TIMEOUT_MS;
}

/** Lệnh gọi NCC vượt thời hạn chờ. NCC CÓ THỂ đã nhận và xử lý lệnh. */
export class ProviderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`quá thời hạn chờ ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} giây` : `${timeoutMs} ms`}`);
    this.name = "ProviderTimeoutError";
  }
}

export function isProviderTimeout(err: unknown): err is ProviderTimeoutError {
  return err instanceof ProviderTimeoutError;
}

/** Lỗi do tín hiệu hết giờ của AbortSignal.timeout (lúc fetch hoặc lúc đọc thân). */
function isAbortTimeout(err: unknown): boolean {
  const e = err as { name?: string; cause?: { name?: string } } | null;
  return e?.name === "TimeoutError" || e?.cause?.name === "TimeoutError";
}

interface Bucket {
  count: number;
  errors: number;
  maxMs: number;
  samples: number[];
}

const buckets = new Map<string, Bucket>();
let timer: NodeJS.Timeout | null = null;

function record(key: string, ms: number, failed: boolean): void {
  let b = buckets.get(key);
  if (!b) {
    b = { count: 0, errors: 0, maxMs: 0, samples: [] };
    buckets.set(key, b);
  }
  b.count += 1;
  if (failed) b.errors += 1;
  if (ms > b.maxMs) b.maxMs = ms;
  if (b.samples.length < MAX_SAMPLES) b.samples.push(ms);
  else if (Math.random() < MAX_SAMPLES / b.count) {
    b.samples[Math.floor(Math.random() * MAX_SAMPLES)] = ms;
  }
}

/** Dòng tổng hợp một cặp NCC + loại lệnh — tách ra để test không phụ thuộc đồng hồ. */
export function providerSummaryLine(
  key: string,
  b: { count: number; errors: number; maxMs: number; samples: number[] }
): string {
  return (
    `[NccHTTP] ${key} n=${b.count} p50=${percentile(b.samples, 50)}ms p95=${percentile(b.samples, 95)}ms ` +
    `p99=${percentile(b.samples, 99)}ms max=${b.maxMs}ms loi=${b.errors}`
  );
}

function flush(): void {
  for (const [key, b] of buckets) {
    if (b.count > 0) console.log(providerSummaryLine(key, b));
  }
  buckets.clear();
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(flush, SUMMARY_INTERVAL_MS);
  timer.unref(); // không giữ tiến trình sống
}

/**
 * Gọi một API của nhà cung cấp hóa đơn. Trả đúng Response và ném đúng lỗi như
 * fetch; thêm việc đo thời gian và thời hạn chờ (quá hạn → ProviderTimeoutError).
 * Thân câu trả lời đọc bằng readProviderBody để lỗi quá hạn lúc đọc cũng ra cùng một kiểu.
 *
 * @param provider  Mã NCC như ở sổ đăng ký ("MISA"...).
 * @param operation Loại lệnh, chữ thường không dấu ("publishing", "status", "token"...).
 */
export async function providerFetch(
  provider: string,
  operation: string,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  ensureTimer();
  const key = `${provider} ${operation}`;
  const started = Date.now();
  const timeoutMs = providerHttpTimeoutMs();
  // Tín hiệu hết giờ gắn vào cả lượt trao đổi: quá hạn lúc đang đọc thân cũng bị cắt.
  const signal =
    timeoutMs > 0
      ? init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs)
      : init.signal;
  try {
    const res = await fetch(url, signal ? { ...init, signal } : init);
    const ms = Date.now() - started;
    record(key, ms, false);
    if (ms >= SLOW_LOG_MS) console.warn(`[NccHTTP] CHAM ${key} ${ms}ms HTTP ${res.status}`);
    // NCC báo quá tải (hạn mức gọi API). MISA 02/10/2026: hạn mức đang tắt, sẽ bật
    // lại và công bố số theo từng API — dòng này là chỗ thấy số thật đầu tiên.
    if (res.status === 429) {
      // Response giả trong test có thể không mang headers — không để dòng log làm hỏng lệnh.
      const retryAfter = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
      console.warn(`[NccHTTP] QUA TAI ${key} HTTP 429${retryAfter ? ` Retry-After=${retryAfter}` : ""}`);
    }
    return res;
  } catch (err) {
    const ms = Date.now() - started;
    record(key, ms, true);
    if (timeoutMs > 0 && isAbortTimeout(err)) {
      console.warn(`[NccHTTP] QUA HAN ${key} ${ms}ms (thời hạn chờ ${timeoutMs}ms)`);
      throw new ProviderTimeoutError(timeoutMs);
    }
    console.warn(`[NccHTTP] LOI ${key} ${ms}ms: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    throw err;
  }
}

/**
 * Đọc thân câu trả lời của một lệnh đã gọi qua providerFetch. Quá thời hạn chờ lúc
 * đang đọc → ProviderTimeoutError; đứt kết nối giữa chừng → ném lại đúng lỗi đó.
 */
export async function readProviderBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    const timeoutMs = providerHttpTimeoutMs();
    if (timeoutMs > 0 && isAbortTimeout(err)) throw new ProviderTimeoutError(timeoutMs);
    throw err;
  }
}

/** Cho test: in + xóa số đo ngay, không chờ nhịp. */
export function flushProviderHttpStats(): void {
  flush();
}
