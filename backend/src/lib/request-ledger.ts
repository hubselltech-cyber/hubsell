import type { NextFunction, Request, Response } from "express";

/**
 * SỔ REQUEST ĐANG CHẠY + RÀO ROUTE NẶNG (03/11/2026 — web Render 512 MB OOM 11 lần
 * trong ngày; lần chết nhanh nhất 32 giây sau khi khởi động mà KHÔNG có dòng log
 * nghiệp vụ nào, tức thủ phạm là một request không in log).
 *
 * Hai việc:
 *   1. Sổ in-flight: middleware ghi {method, đường dẫn, lúc bắt đầu} cho mọi request,
 *      xóa khi xong. memory-watch in sổ này khi RSS vượt ngưỡng → lần chết kế biết
 *      đích danh route. Chỉ là dụng cụ đo, không đổi hành vi.
 *   2. Rào route nặng (heavyRouteGuard): route tải nguyên bảng (sku-products) chỉ cho
 *      tối đa HEAVY_ROUTE_MAX_CONCURRENT request cùng lúc mỗi tiến trình, và từ chối
 *      khi RSS đã sát trần (HEAVY_ROUTE_RSS_MB) — trả 503 kèm câu phổ thông, khách
 *      bấm lại sau. Mục tiêu: MỘT chủ shop rất lớn không kéo sập web của mọi người.
 *      Đây là van an toàn trong tiến trình (không phải khóa nghiệp vụ); sửa gốc =
 *      phân trang / tính ở DB (giai đoạn 3, docs/DONG-BO-GIAI-DOAN-3.md).
 *
 * Số mặc định TỰ CHỌN, có căn cứ đo 03/11: container 512 MB, RSS nền sau vài phút
 * ~330 MB, một phản hồi ~40.000 dòng (đã rút cột) ước ~80–100 MB → từ chối khi RSS
 * > 400 MB; 2 request nặng cùng lúc là trần. Đổi bằng env.
 */

const MB = 1024 * 1024;

interface InFlight {
  id: number;
  method: string;
  path: string;
  startedAt: number;
  /** Nhãn route nặng (heavyRouteGuard) — null = request thường. */
  heavy: string | null;
  /** RSS (byte) lúc vào và đỉnh thấy được trong lúc chạy (memory-watch gọi sampleInFlightRss mỗi tick). */
  rssStart: number;
  rssPeak: number;
}

const inFlight = new Map<number, InFlight>();
let seq = 0;

function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Middleware toàn cục: ghi sổ request đang chạy (đường dẫn không kèm query). */
export function trackInFlight(req: Request, res: Response, next: NextFunction): void {
  const id = ++seq;
  const rss = process.memoryUsage.rss();
  const row: InFlight = {
    id,
    method: req.method,
    path: (req.originalUrl || req.url).split("?")[0],
    startedAt: Date.now(),
    heavy: null,
    rssStart: rss,
    rssPeak: rss,
  };
  inFlight.set(id, row);
  (req as Request & { __inFlightId?: number }).__inFlightId = id;
  res.once("close", () => {
    inFlight.delete(id);
    logFinishedRequest(row, req, res);
  });
  next();
}

/**
 * ĐO REQUEST ĐẨY RSS / CHẠY LÂU (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8.6–8.7).
 *
 * Web OOM 4 lần 25/11; log `[Bộ nhớ]` chỉ chụp "đang chạy" lúc vượt ngưỡng nên không biết request nào làm RSS tăng
 * (máy sau deploy 20:51 lên 413 MB sau 9 phút mà không có `/recommendations`). Cũng chưa biết request nào giữ bể kết
 * nối DB lâu (P2028, 19/11). Dòng `[Đo request]` ghi khi một request XONG mà:
 *   - RSS tăng ≥ REQUEST_LOG_RSS_MB (mặc định 20 MB) tính từ lúc vào tới đỉnh/lúc ra, HOẶC
 *   - chạy ≥ REQUEST_LOG_SLOW_MS (mặc định 5.000 ms).
 * Kèm chủ shop (ownerId) + gian (channelId nếu có ở query/params) + số request thường đang chạy cùng — RSS là của cả
 * tiến trình nên một lượt tăng có thể do request chạy song song; gom nhiều dòng mới kết luận. Chỉ là dụng cụ đo.
 * Số 20 MB / 5 s là MẶC ĐỊNH TỰ CHỌN (một lượt nặng đo dev 8.3 = +22…+123 MB; /api/orders thấy 6–19 s); 0 = tắt điều kiện đó.
 *
 * Quy mô lớn: lúc hệ thống chậm, số request ≥ 5 s tăng theo tải → log không được phình theo. Mỗi tiến trình ghi tối đa
 * REQUEST_LOG_MAX_PER_MIN dòng/phút (mặc định 60, tự chọn); phần vượt KHÔNG im lặng: hết phút in một dòng tổng "bỏ qua N
 * dòng" kèm dòng có RSS tăng nhiều nhất trong số bị bỏ. Sổ là RAM theo từng tiến trình — đúng vì RSS cũng là của từng
 * tiến trình; chạy nhiều instance thì mỗi máy tự ghi (Render gắn mã máy đầu dòng). Không phải khóa / tiền.
 */
function envNonNeg(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** memory-watch gọi mỗi tick: cập nhật đỉnh RSS cho mọi request đang chạy + in dòng tổng của phút đã qua nếu có. */
export function sampleInFlightRss(rss: number = process.memoryUsage.rss(), now: number = Date.now()): void {
  for (const r of inFlight.values()) if (rss > r.rssPeak) r.rssPeak = rss;
  rollLogWindow(now);
}

/** Trần dòng `[Đo request]` mỗi phút — đếm theo cửa sổ phút, phần vượt gom thành một dòng tổng. */
const logWindow = { start: 0, written: 0, dropped: 0, worstGrowMb: -1, worstLine: "" };

function rollLogWindow(now: number): void {
  if (now - logWindow.start < 60_000) return;
  if (logWindow.dropped > 0) {
    console.log(
      `[Đo request] bỏ qua ${logWindow.dropped} dòng trong phút trước (trần ${envNonNeg("REQUEST_LOG_MAX_PER_MIN", 60)}/phút)` +
        ` — RSS tăng nhiều nhất trong số bỏ: ${logWindow.worstLine.replace("[Đo request] ", "")}`
    );
  }
  logWindow.start = now;
  logWindow.written = 0;
  logWindow.dropped = 0;
  logWindow.worstGrowMb = -1;
  logWindow.worstLine = "";
}

/** true = được in; false = đã đếm vào phần bỏ qua. Xuất ra để test. */
export function admitLogLine(line: string, growMb: number, now: number = Date.now()): boolean {
  rollLogWindow(now);
  const max = envNonNeg("REQUEST_LOG_MAX_PER_MIN", 60);
  if (max === 0 || logWindow.written < max) {
    logWindow.written++;
    return true;
  }
  logWindow.dropped++;
  if (growMb > logWindow.worstGrowMb) {
    logWindow.worstGrowMb = growMb;
    logWindow.worstLine = line;
  }
  return false;
}

export interface FinishedRequestInfo {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  rssStartMb: number;
  rssPeakMb: number;
  rssEndMb: number;
  ownerId?: string;
  channelId?: string;
  concurrent: number;
  heavy: string | null;
}

/** null = không cần ghi. Tách riêng để test. */
export function formatFinishedRequest(
  info: FinishedRequestInfo,
  thresholds: { rssMb: number; slowMs: number }
): string | null {
  if (LONG_LIVED_PATHS.has(info.path)) return null;
  const grew = Math.max(info.rssPeakMb, info.rssEndMb) - info.rssStartMb;
  const hitRss = thresholds.rssMb > 0 && grew >= thresholds.rssMb;
  const hitSlow = thresholds.slowMs > 0 && info.durationMs >= thresholds.slowMs;
  if (!hitRss && !hitSlow) return null;
  const why = [hitRss ? "RSS" : null, hitSlow ? "LÂU" : null].filter(Boolean).join("+");
  return (
    `[Đo request] ${why} ${info.method} ${info.path}${info.heavy ? ` [${info.heavy}]` : ""} ${info.status} ` +
    `${(info.durationMs / 1000).toFixed(1)}s RSS ${info.rssStartMb}→${info.rssPeakMb}→${info.rssEndMb} MB (+${grew}) ` +
    `chủ shop ${info.ownerId ?? "-"} gian ${info.channelId ?? "-"} cùng chạy ${info.concurrent}`
  );
}

function pickChannelId(req: Request): string | undefined {
  const q = (req.query ?? {}) as Record<string, unknown>;
  const p = (req.params ?? {}) as Record<string, unknown>;
  for (const v of [q.channelId, p.channelId, q.channel, p.channel]) {
    if (typeof v === "string" && v && v !== "all") return v.slice(0, 40);
  }
  return undefined;
}

function logFinishedRequest(row: InFlight, req: Request, res: Response): void {
  try {
    const end = process.memoryUsage.rss();
    const line = formatFinishedRequest(
      {
        method: row.method,
        path: row.path,
        status: res.statusCode,
        durationMs: Date.now() - row.startedAt,
        rssStartMb: Math.round(row.rssStart / MB),
        rssPeakMb: Math.round(Math.max(row.rssPeak, end) / MB),
        rssEndMb: Math.round(end / MB),
        ownerId: (req as Request & { ownerId?: string }).ownerId,
        channelId: pickChannelId(req),
        concurrent: realInFlightCount(),
        heavy: row.heavy,
      },
      { rssMb: envNonNeg("REQUEST_LOG_RSS_MB", 20), slowMs: envNonNeg("REQUEST_LOG_SLOW_MS", 5000) }
    );
    if (line && admitLogLine(line, Math.round((Math.max(row.rssPeak, end) - row.rssStart) / MB))) console.log(line);
  } catch {
    // dụng cụ đo không được làm hỏng request
  }
}

/** Số request đang chạy. */
export function inFlightCount(): number {
  return inFlight.size;
}

/** Luồng SSE chuông thông báo: mở hàng giờ, không nặng — đừng để che request thật (đính chính 03/11/2026). */
const LONG_LIVED_PATHS = new Set(["/api/notifications/stream"]);

/** Số request thường đang chạy (bỏ luồng SSE). */
function realInFlightCount(): number {
  let n = 0;
  for (const r of inFlight.values()) if (!LONG_LIVED_PATHS.has(r.path)) n++;
  return n;
}

/**
 * Dòng mô tả sổ in-flight: BỎ luồng SSE (chỉ đếm), route nặng trước rồi lâu nhất trước, tối đa `limit`
 * mục — memory-watch in khi RSS cao. Bản đầu xếp cũ nhất trước nên SSE chiếm hết 8 chỗ, che mất route thật.
 */
export function describeInFlight(limit = 8): string {
  const all = [...inFlight.values()];
  const real = all.filter((r) => !LONG_LIVED_PATHS.has(r.path));
  const streams = all.length - real.length;
  const suffix = streams > 0 ? ` (+${streams} luồng chuông)` : "";
  if (real.length === 0) return `không có request thường nào đang chạy${suffix}`;
  const now = Date.now();
  const items = real
    .sort((a, b) => Number(b.heavy !== null) - Number(a.heavy !== null) || a.startedAt - b.startedAt)
    .slice(0, limit);
  const rest = real.length - items.length;
  return (
    items
      .map((r) => `${r.method} ${r.path}${r.heavy ? ` [${r.heavy}]` : ""} ${Math.round((now - r.startedAt) / 1000)}s`)
      .join(" | ") + (rest > 0 ? ` | +${rest} nữa` : "") + suffix
  );
}

function heavyInFlight(label: string): number {
  let n = 0;
  for (const r of inFlight.values()) if (r.heavy === label) n++;
  return n;
}

/** Mã lỗi để giao diện phân biệt "máy chủ đang bận" với lỗi khác. */
export const SERVER_BUSY_CODE = "SERVER_BUSY";

/**
 * Rào cho route nặng. Dùng: `router.get("/x", heavyRouteGuard("x"), handler)`.
 * Từ chối (503, Retry-After 30) khi route này đã có đủ request đang chạy hoặc RSS
 * tiến trình đã sát trần; nếu không, đánh dấu request là nặng rồi cho qua.
 */
export function heavyRouteGuard(label: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (admitHeavyRequest(label, req, res)) next();
  };
}

/**
 * Cùng luật với heavyRouteGuard nhưng gọi TRONG handler, khi đã biết lượt này có nặng thật không.
 * true = cho qua (đã đánh dấu nặng); false = đã trả 503, handler phải dừng.
 *
 * Vì sao (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8): RSS không trả lại sau một đỉnh — máy boot 173 MB, lên 461 MB lúc
 * trang Quảng cáo chạy, heap về 78 MB mà RSS kẹt ~470 MB → rào chặn 51/51 lượt Giá vốn, kể cả gian 31 dòng. Lượt nhỏ
 * không đẩy được máy tới OOM nên không được phép bị chặn theo trạng thái chung của tiến trình; chỉ lượt lớn mới xét.
 */
export function admitHeavyRequest(label: string, req: Request, res: Response): boolean {
  const maxConcurrent = numEnv("HEAVY_ROUTE_MAX_CONCURRENT", 2);
  const rssLimitMb = numEnv("HEAVY_ROUTE_RSS_MB", 400);
  const running = heavyInFlight(label);
  const rssMb = Math.round(process.memoryUsage().rss / MB);
  if (running >= maxConcurrent || rssMb > rssLimitMb) {
    console.warn(
      `[Rào] ${label}: từ chối (${running} đang chạy, RSS ${rssMb} MB, trần ${rssLimitMb} MB) — ${describeInFlight(5)}`
    );
    res.setHeader("Retry-After", "30");
    res.status(503).json({
      error: "Máy chủ đang bận tải một danh sách lớn. Vui lòng thử lại sau 30 giây.",
      code: SERVER_BUSY_CODE,
    });
    return false;
  }
  const id = (req as Request & { __inFlightId?: number }).__inFlightId;
  const row = id === undefined ? undefined : inFlight.get(id);
  if (row) row.heavy = label;
  return true;
}
