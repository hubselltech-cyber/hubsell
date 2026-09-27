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
// ============================================================

export const DEFAULT_DB_CONNECTION_LIMIT = 5;
export const DEFAULT_DB_POOL_TIMEOUT_SEC = 30;

export function withPoolParams(
  url: string | undefined,
  opts: { connectionLimit?: number; poolTimeoutSec?: number } = {}
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
  return parsed.toString();
}

/** Đọc số dương từ env; thiếu/sai → mặc định. */
export function normalizePositiveInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** DATABASE_URL đã ghép giới hạn pool theo env — nguồn duy nhất cho PrismaClient. */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return withPoolParams(env.DATABASE_URL, {
    connectionLimit: normalizePositiveInt(env.DB_CONNECTION_LIMIT, DEFAULT_DB_CONNECTION_LIMIT),
    poolTimeoutSec: normalizePositiveInt(env.DB_POOL_TIMEOUT, DEFAULT_DB_POOL_TIMEOUT_SEC),
  });
}
