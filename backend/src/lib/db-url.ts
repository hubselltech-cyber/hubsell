// ============================================================
// GIỚI HẠN POOL KẾT NỐI DB — ghép vào DATABASE_URL lúc khởi động (M1, 27/09/2026).
//
// Prisma mặc định mở connection_limit = số CPU × 2 + 1. Trên Render, os.cpus()
// trả số CPU của MÁY CHỦ (không phải 0,5 CPU của gói) → mỗi tiến trình có thể
// mở 17+ kết nối, trong khi Session pooler Supabase (compute Micro) chỉ có
// pool_size 15 về Postgres. Web + worker tách riêng mà không giới hạn thì
// tranh nhau pool giờ cao điểm. Ghép ở đây thay vì sửa tay chuỗi bí mật trên
// Dashboard: đổi số chỉ cần đặt env DB_CONNECTION_LIMIT / DB_POOL_TIMEOUT.
// Chuỗi đã có sẵn tham số thì GIỮ NGUYÊN (người vận hành đặt tay thắng).
//
// CÔNG TẮC KHẨN bộ nhớ database (01/10/2026): Prisma giữ lại các câu lệnh đã
// chuẩn bị cho TỪNG kết nối (statement_cache_size, Prisma mặc định 100), và
// Postgres giữ bộ nhớ cho từng câu ấy tới khi kết nối đóng. 30/09/2026 câu ghi
// sổ cái hàng nghìn tham số làm một kết nối giữ ~350 MB (đo trên DB dev), compute
// Micro 1 GB hết bộ nhớ. Câu ghi đã sửa (services/order-ledger.ts
// LedgerWriteStyle); biến DB_STATEMENT_CACHE_SIZE để hạ con số này mà không
// phải sửa mã khi bộ nhớ database phình lại vì một câu lệnh khác cùng kiểu.
// KHÔNG đặt biến → không ghép gì, Prisma dùng mặc định của nó. Đặt 0 = không giữ
// câu nào (mỗi câu database phân tích + lập kế hoạch lại, tốn thêm CPU).
// ============================================================

export const DEFAULT_DB_CONNECTION_LIMIT = 5;
export const DEFAULT_DB_POOL_TIMEOUT_SEC = 30;

export function withPoolParams(
  url: string | undefined,
  opts: { connectionLimit?: number; poolTimeoutSec?: number; statementCacheSize?: number } = {}
): string | undefined {
  if (!url) return url;
  const limit = normalizePositiveInt(opts.connectionLimit, DEFAULT_DB_CONNECTION_LIMIT);
  const timeout = normalizePositiveInt(opts.poolTimeoutSec, DEFAULT_DB_POOL_TIMEOUT_SEC);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // chuỗi lạ (VD file:) — không đụng
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return url;
  if (!parsed.searchParams.has("connection_limit")) {
    parsed.searchParams.set("connection_limit", String(limit));
  }
  if (!parsed.searchParams.has("pool_timeout")) {
    parsed.searchParams.set("pool_timeout", String(timeout));
  }
  if (opts.statementCacheSize !== undefined && !parsed.searchParams.has("statement_cache_size")) {
    parsed.searchParams.set("statement_cache_size", String(opts.statementCacheSize));
  }
  return parsed.toString();
}

/** Đọc số dương từ env; thiếu/sai → mặc định. */
export function normalizePositiveInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Đọc số nguyên KHÔNG ÂM từ env (0 hợp lệ); thiếu/sai → undefined (không ghép tham số). */
export function normalizeNonNegativeInt(v: unknown): number | undefined {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** DATABASE_URL đã ghép giới hạn pool theo env — nguồn duy nhất cho PrismaClient. */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return withPoolParams(env.DATABASE_URL, {
    connectionLimit: normalizePositiveInt(env.DB_CONNECTION_LIMIT, DEFAULT_DB_CONNECTION_LIMIT),
    poolTimeoutSec: normalizePositiveInt(env.DB_POOL_TIMEOUT, DEFAULT_DB_POOL_TIMEOUT_SEC),
    statementCacheSize: normalizeNonNegativeInt(env.DB_STATEMENT_CACHE_SIZE),
  });
}
