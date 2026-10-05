// ============================================================
// LỆNH GỌI SÀN — một cửa cho mọi fetch tới Shopee / Lazada / TikTok (giai đoạn 2
// kiến trúc quy mô, docs/HANG-DOI-BEN.md mục 3.6).
//
// Vì sao: trước 01/10/2026 không lệnh gọi sàn nào có thời hạn chờ — sàn treo là
// luồng việc treo theo. Muốn đặt thời hạn thì phải có căn cứ, mà chưa từng đo
// lệnh gọi sàn mất bao lâu. Nên làm hai nấc:
//   1. (bước nền) ĐO: mọi lệnh gọi đi qua platformFetch, ghi thời gian chờ sàn
//      trả lời; mỗi 15 phút in một dòng tổng hợp cho từng sàn vào log.
//   2. (05/10/2026, bước 6a) BẬT thời hạn chờ mặc định 30 giây, theo số đo
//      02–05/10 (docs/HANG-DOI-BEN.md mục 4.7). PLATFORM_HTTP_TIMEOUT_MS đổi số;
//      đặt 0 là tắt hẳn — hành vi y như gọi fetch thẳng (đường lui).
//
// Thời gian đo là tới lúc sàn trả tiêu đề phản hồi (fetch xong); phần đọc thân
// do nơi gọi làm sau đó nên không nằm trong số đo. Thời hạn chờ (khi bật) thì
// phủ cả phần đọc thân, vì tín hiệu hủy gắn vào cả yêu cầu.
//
// Log chỉ in ĐƯỜNG DẪN, không in query: query của Shopee / Lazada / TikTok chứa
// access_token và chữ ký.
// ============================================================

export type PlatformName =
  | "SHOPEE"
  | "LAZADA"
  | "TIKTOK"
  | "TIKTOK_ADS"
  // Tải tệp vận đơn từ đường dẫn sàn cấp (máy chủ tệp, không phải API) — đo riêng
  // để không lẫn vào phân bố của lệnh gọi API.
  | "LAZADA_FILE"
  | "TIKTOK_FILE";

/** Nhịp in dòng tổng hợp. */
const SUMMARY_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Lệnh chờ lâu hơn mức này được in riêng một dòng ngay lúc đó. MẶC ĐỊNH TỰ CHỌN
 * 10 giây, chỉ ảnh hưởng việc ghi log (để thấy tên API chậm), không đổi hành vi.
 */
const SLOW_LOG_MS = 10_000;
/** Trần số mẫu giữ trong RAM cho một sàn trong một nhịp — quá thì lấy mẫu ngẫu nhiên. */
const MAX_SAMPLES = 5_000;

interface Bucket {
  count: number;
  errors: number;
  timeouts: number;
  maxMs: number;
  samples: number[];
}

const buckets = new Map<PlatformName, Bucket>();
let timer: NodeJS.Timeout | null = null;

function bucketOf(platform: PlatformName): Bucket {
  let b = buckets.get(platform);
  if (!b) {
    b = { count: 0, errors: 0, timeouts: 0, maxMs: 0, samples: [] };
    buckets.set(platform, b);
  }
  return b;
}

function record(platform: PlatformName, ms: number, outcome: "ok" | "error" | "timeout"): void {
  const b = bucketOf(platform);
  b.count += 1;
  if (outcome === "error") b.errors += 1;
  if (outcome === "timeout") b.timeouts += 1;
  if (ms > b.maxMs) b.maxMs = ms;
  if (b.samples.length < MAX_SAMPLES) b.samples.push(ms);
  else if (Math.random() < MAX_SAMPLES / b.count) {
    b.samples[Math.floor(Math.random() * MAX_SAMPLES)] = ms;
  }
}

/** Phân vị của một dãy số đo (ms). Dãy rỗng → null. */
export function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Dòng tổng hợp một sàn — tách ra để test không phụ thuộc đồng hồ. */
export function summaryLine(
  platform: string,
  b: { count: number; errors: number; timeouts: number; maxMs: number; samples: number[] }
): string {
  return (
    `[SanHTTP] ${platform} n=${b.count} p50=${percentile(b.samples, 50)}ms p95=${percentile(b.samples, 95)}ms ` +
    `p99=${percentile(b.samples, 99)}ms max=${b.maxMs}ms loi=${b.errors} qua_han=${b.timeouts}`
  );
}

function flush(): void {
  for (const [platform, b] of buckets) {
    if (b.count > 0) console.log(summaryLine(platform, b));
  }
  buckets.clear();
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(flush, SUMMARY_INTERVAL_MS);
  timer.unref(); // không giữ tiến trình sống
}

/**
 * Thời hạn chờ mặc định. CĂN CỨ: log [SanHTTP] của worker + web 02–05/10/2026 —
 * lệnh hợp lệ chậm nhất 15,0 giây (Shopee get_escrow_detail, HTTP 200), không
 * lệnh thành công nào khác quá 10,1 giây. 30 giây = gấp đôi số đó; hệ số 2 là
 * MẶC ĐỊNH TỰ CHỌN (anh Trung duyệt 05/10), không có tài liệu sàn nào cho số này.
 */
export const DEFAULT_PLATFORM_HTTP_TIMEOUT_MS = 30_000;

/**
 * Thời hạn chờ đang áp dụng (ms), hoặc null khi đã tắt. PLATFORM_HTTP_TIMEOUT_MS:
 * không đặt / đặt sai → mặc định; số nguyên dương → số đó; 0 → tắt.
 */
export function platformTimeoutMs(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.PLATFORM_HTTP_TIMEOUT_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_PLATFORM_HTTP_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_PLATFORM_HTTP_TIMEOUT_MS;
  return n === 0 ? null : n;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "(url lạ)";
  }
}

/**
 * Gọi một API sàn. Trả đúng Response và ném đúng lỗi như fetch; chỉ thêm việc
 * đo thời gian và (khi đã bật) thời hạn chờ.
 */
export async function platformFetch(
  platform: PlatformName,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  ensureTimer();
  const timeoutMs = platformTimeoutMs();
  let signal = init.signal ?? undefined;
  let timeoutSignal: AbortSignal | null = null;
  if (timeoutMs) {
    timeoutSignal = AbortSignal.timeout(timeoutMs);
    signal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }
  const started = Date.now();
  try {
    const res = await fetch(url, signal ? { ...init, signal } : init);
    const ms = Date.now() - started;
    record(platform, ms, "ok");
    if (ms >= SLOW_LOG_MS) console.warn(`[SanHTTP] CHAM ${platform} ${pathOf(url)} ${ms}ms HTTP ${res.status}`);
    return res;
  } catch (err) {
    const ms = Date.now() - started;
    const timedOut = Boolean(timeoutSignal?.aborted);
    record(platform, ms, timedOut ? "timeout" : "error");
    console.warn(
      `[SanHTTP] ${timedOut ? "QUA HAN" : "LOI"} ${platform} ${pathOf(url)} ${ms}ms: ${String((err as Error)?.message ?? err).slice(0, 200)}`
    );
    if (timedOut) {
      throw new Error(`${platform} không trả lời trong ${Math.round(timeoutMs! / 1000)} giây (${pathOf(url)})`, {
        cause: err,
      });
    }
    throw err;
  }
}

/** Cho test: in + xóa số đo ngay, không chờ nhịp. */
export function flushPlatformHttpStats(): void {
  flush();
}
