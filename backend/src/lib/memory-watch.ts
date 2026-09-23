import v8 from "v8";

/**
 * CANH BỘ NHỚ TIẾN TRÌNH (22/09/2026 — sự cố Render sập 5 lần trong 4 ngày vì
 * "Reached heap limit … JavaScript heap out of memory", exit 134, trong khi biểu
 * đồ RAM container chỉ 40–55% của 512 MB: V8 tự đặt heap limit theo RAM máy/4,
 * thấp hơn nhiều RAM gói, còn log ứng dụng không có dòng nào nói trước khi chết).
 *
 * Hai việc, đều rẻ:
 *   1. In heap limit + RSS lúc khởi động — đối chiếu cờ --max-old-space-size
 *      trong `npm start` (backend/package.json) có ăn không.
 *   2. Lấy mẫu mỗi vài giây; heap vượt NGƯỠNG CẢNH BÁO thì ghi một dòng (kèm
 *      RSS) và chỉ ghi lại khi đã hạ xuống dưới mức nghỉ rồi vượt lần nữa —
 *      không spam log. Có dòng này trong log là biết đỉnh RAM xảy ra lúc nào,
 *      dò ngược theo mốc thời gian ra việc nào đang chạy.
 *
 * Ngưỡng là MẶC ĐỊNH TỰ CHỌN (không phải số của Render/Node): 70% để thấy sớm,
 * 85% là sát chết (V8 bắt đầu GC dồn dập từ ~90%). Đổi bằng env
 * MEMORY_WATCH_WARN_PCT / MEMORY_WATCH_CRIT_PCT; MEMORY_WATCH_SECONDS=0 tắt.
 */

const MB = 1024 * 1024;

export function heapLimitMb(): number {
  return Math.round(v8.getHeapStatistics().heap_size_limit / MB);
}

function pctEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : fallback;
}

export function describeMemory(): string {
  const m = process.memoryUsage();
  return (
    `heap ${Math.round(m.heapUsed / MB)}/${heapLimitMb()} MB, ` +
    `RSS ${Math.round(m.rss / MB)} MB, ngoài heap ${Math.round(m.external / MB)} MB`
  );
}

export function startMemoryWatch(): void {
  const seconds = process.env.MEMORY_WATCH_SECONDS === undefined ? 5 : Number(process.env.MEMORY_WATCH_SECONDS);
  console.log(`[Bộ nhớ] Khởi động: ${describeMemory()}`);
  if (!Number.isFinite(seconds) || seconds <= 0) return;

  const warnPct = pctEnv("MEMORY_WATCH_WARN_PCT", 70);
  const critPct = pctEnv("MEMORY_WATCH_CRIT_PCT", 85);
  const restPct = Math.max(10, warnPct - 10); // hạ xuống dưới mức này mới "lên đạn" lại
  const limit = v8.getHeapStatistics().heap_size_limit;
  let armedWarn = true;
  let armedCrit = true;

  const tick = () => {
    const pct = (process.memoryUsage().heapUsed / limit) * 100;
    if (pct >= critPct && armedCrit) {
      armedCrit = false;
      console.error(`[Bộ nhớ] ⚠️ SÁT TRẦN HEAP ${Math.round(pct)}% — ${describeMemory()}`);
    } else if (pct >= warnPct && armedWarn) {
      armedWarn = false;
      console.warn(`[Bộ nhớ] Heap cao ${Math.round(pct)}% — ${describeMemory()}`);
    }
    if (pct < restPct) {
      armedWarn = true;
      armedCrit = true;
    }
  };
  setInterval(tick, seconds * 1000).unref();
  // Mốc nền mỗi 30 phút để biết mức "bình thường" của từng bản deploy.
  setInterval(() => console.log(`[Bộ nhớ] Mốc nền: ${describeMemory()}`), 30 * 60 * 1000).unref();
}
