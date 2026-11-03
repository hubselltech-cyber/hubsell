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
  inFlight.set(id, {
    id,
    method: req.method,
    path: (req.originalUrl || req.url).split("?")[0],
    startedAt: Date.now(),
    heavy: null,
  });
  (req as Request & { __inFlightId?: number }).__inFlightId = id;
  res.once("close", () => inFlight.delete(id));
  next();
}

/** Số request đang chạy. */
export function inFlightCount(): number {
  return inFlight.size;
}

/** Luồng SSE chuông thông báo: mở hàng giờ, không nặng — đừng để che request thật (đính chính 03/11/2026). */
const LONG_LIVED_PATHS = new Set(["/api/notifications/stream"]);

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
  const maxConcurrent = numEnv("HEAVY_ROUTE_MAX_CONCURRENT", 2);
  const rssLimitMb = numEnv("HEAVY_ROUTE_RSS_MB", 400);
  return (req: Request, res: Response, next: NextFunction): void => {
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
      return;
    }
    const id = (req as Request & { __inFlightId?: number }).__inFlightId;
    const row = id === undefined ? undefined : inFlight.get(id);
    if (row) row.heavy = label;
    next();
  };
}
