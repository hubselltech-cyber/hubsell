// ============================================================
// LỆNH GỌI NHÀ CUNG CẤP HÓA ĐƠN — một cửa có ĐO thời gian (giai đoạn 2 bước 5,
// lát 4 — docs/HANG-DOI-BEN.md mục 4.6).
//
// Vì sao: thiết kế bước 5 cần một thời hạn chờ cho lệnh gọi NCC (lệnh treo hiện
// kéo dài tới mức mặc định 300 giây của thư viện), mà muốn đặt số thì phải có số
// đo. Cùng cách làm với lệnh gọi sàn (lib/platform-http.ts): lát này CHỈ ĐO, mỗi
// 15 phút in một dòng tổng hợp cho từng cặp NCC + loại lệnh; thời hạn chờ thêm ở
// lát sau. Hành vi y như gọi fetch thẳng: trả đúng Response, ném đúng lỗi.
//
// Tách riêng theo LOẠI LỆNH (phát hành, hỏi trạng thái, lấy token...) vì phát hành
// phải ký số nên chậm hơn hẳn lệnh đọc — gộp chung thì số đo không dùng được.
//
// Thời gian đo là tới lúc NCC trả tiêu đề phản hồi; phần đọc thân do nơi gọi làm
// sau đó nên không nằm trong số đo. Log chỉ in tên NCC + loại lệnh, không in địa
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
 * fetch; chỉ thêm việc đo thời gian.
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
  try {
    const res = await fetch(url, init);
    const ms = Date.now() - started;
    record(key, ms, false);
    if (ms >= SLOW_LOG_MS) console.warn(`[NccHTTP] CHAM ${key} ${ms}ms HTTP ${res.status}`);
    return res;
  } catch (err) {
    const ms = Date.now() - started;
    record(key, ms, true);
    console.warn(`[NccHTTP] LOI ${key} ${ms}ms: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    throw err;
  }
}

/** Cho test: in + xóa số đo ngay, không chờ nhịp. */
export function flushProviderHttpStats(): void {
  flush();
}
