// ============================================================
// HÀNG ĐỢI BỀN — phần cấu hình THUẦN (không mở kết nối), có test riêng.
// Thiết kế: docs/HANG-DOI-BEN.md. Module chạy thật: lib/queue.ts.
//
// Tên hàng đợi ở đây phải khớp các hàng đợi đã tạo trong migration
// 20261001200000_queue_foundation — ứng dụng chạy pg-boss với migrate:false và
// KHÔNG tạo hàng đợi lúc chạy, nên thêm hàng đợi = thêm migration + thêm tên ở đây.
// ============================================================

import type { HubsellRole } from "../workers";

/** Schema của pg-boss trong database (tách khỏi "public" của Prisma). */
export const QUEUE_SCHEMA = "pgboss";

export const QUEUES = {
  /** Sự kiện đơn từ sàn — khóa sàn:mã shop:mã đơn, gộp theo khóa. */
  evtOrder: "evt.order",
  /** Sự kiện ủy quyền / thu hồi ủy quyền gian. */
  evtAuth: "evt.auth",
  /** Việc sự kiện sàn hỏng sau khi hết lượt thử. */
  evtDead: "evt.dead",
  /** Đẩy hết tồn đang chờ của một gian — khóa mã gian, gộp theo khóa. */
  stockChannel: "stock.channel",
  /** Đọc lại tồn Shopee sau khi đẩy (việc hẹn giờ). */
  stockVerify: "stock.verify",
  /** Việc đẩy tồn hỏng sau khi hết lượt thử. */
  stockDead: "stock.dead",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: readonly QueueName[] = Object.values(QUEUES);

/** Hàng đợi lỗi — có việc nằm trong đây là có việc cần người xem. */
export const DEAD_QUEUES: readonly QueueName[] = [QUEUES.evtDead, QUEUES.stockDead];

/**
 * Số kết nối pg-boss tự mở ở tiến trình worker. MẶC ĐỊNH TỰ CHỌN 2: đo trên
 * Supabase 01/10/2026 hai kết nối xử lý 4.000 việc/giây, và trần chế độ phiên
 * của bộ gộp là 30 cho mọi tiến trình (web 5 + worker 3 đã dùng; lúc deploy bản
 * cũ và mới cùng sống). Đổi bằng QUEUE_POOL_MAX.
 */
export const DEFAULT_WORKER_POOL_MAX = 2;
/**
 * Tiến trình web chỉ GỬI việc, và gửi qua kết nối sẵn có của Prisma (xem
 * enqueue ở lib/queue.ts). Pool riêng của pg-boss ở web chỉ để thư viện đọc
 * danh sách hàng đợi; 1 kết nối, tự trả khi nghỉ (đo 01/10: nghỉ 12 giây còn 0).
 */
export const WEB_POOL_MAX = 1;

/**
 * Số việc evt.order chạy cùng lúc ở MỘT tiến trình worker. MẶC ĐỊNH TỰ CHỌN 4
 * (anh Trung nhận làm mặc định 01/10/2026): trước giai đoạn 2 Shopee chạy 1
 * luồng, TikTok 3 làn, và worker có 3 kết nối database. Đổi bằng
 * QUEUE_EVT_ORDER_CONCURRENCY.
 */
export const DEFAULT_EVT_ORDER_CONCURRENCY = 4;

export function evtOrderConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.QUEUE_EVT_ORDER_CONCURRENCY);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : DEFAULT_EVT_ORDER_CONCURRENCY;
}

/**
 * Tổng số lượt chạy của một việc evt.order trước khi sang hàng đợi lỗi: 1 lượt
 * đầu + retryLimit 2 khai ở migration queue_foundation. Chỉ dùng cho câu chữ
 * cảnh báo; số lượt thật do cấu hình hàng đợi trong database quyết định.
 */
export const EVT_ORDER_MAX_ATTEMPTS = 3;

/** Tham số trong chuỗi kết nối chỉ Prisma hiểu — thư viện `pg` nhận vào sẽ hiểu sai hoặc cảnh báo. */
const PRISMA_ONLY_PARAMS = [
  "schema",
  "connection_limit",
  "pool_timeout",
  "statement_cache_size",
  "pgbouncer",
  "sslmode",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface QueueConnection {
  connectionString: string;
  /** undefined = không TLS (database trên máy mình). */
  ssl: { rejectUnauthorized: false } | undefined;
}

/**
 * Chuỗi kết nối cho pool riêng của pg-boss. QUEUE_DATABASE_URL đặt thì dùng
 * (để sau này trỏ pg-boss sang cổng 6543 — chế độ giao dịch của bộ gộp — mà
 * không sửa mã), không thì dùng DATABASE_URL.
 *
 * TLS: database không nằm trên máy mình thì mã hóa đường truyền nhưng KHÔNG
 * kiểm chuỗi chứng chỉ — đúng hành vi Prisma đang chạy với sslmode=require
 * (chứng chỉ của bộ gộp Supabase do CA riêng của họ ký). sslmode=disable trong
 * chuỗi thì tắt TLS.
 */
export function resolveQueueConnection(env: NodeJS.ProcessEnv = process.env): QueueConnection | null {
  const raw = (env.QUEUE_DATABASE_URL ?? "").trim() || (env.DATABASE_URL ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return null;
  const sslmode = url.searchParams.get("sslmode");
  for (const key of PRISMA_ONLY_PARAMS) url.searchParams.delete(key);
  const useTls = sslmode ? sslmode !== "disable" : !LOCAL_HOSTS.has(url.hostname);
  return {
    connectionString: url.toString(),
    ssl: useTls ? { rejectUnauthorized: false } : undefined,
  };
}

export interface QueueRoleOptions {
  /** Số kết nối tối đa của pool riêng pg-boss. */
  max: number;
  /** Chạy phần giám sát của pg-boss (trả việc quá hạn giữ, dọn việc cũ, đếm hàng đợi). */
  supervise: boolean;
  /** Tiến trình này có nhận việc để xử lý không. */
  consumes: boolean;
}

/**
 * Cấu hình theo vai tiến trình: worker / all giám sát + xử lý việc; web chỉ gửi.
 * Chỉ MỘT nơi cần giám sát; nhiều worker cùng giám sát vẫn an toàn (pg-boss tự
 * nhường nhau bằng khóa trong database).
 */
export function queueOptionsForRole(
  role: HubsellRole,
  env: NodeJS.ProcessEnv = process.env
): QueueRoleOptions {
  if (role === "web") return { max: WEB_POOL_MAX, supervise: false, consumes: false };
  const n = Number(env.QUEUE_POOL_MAX);
  const max = Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_WORKER_POOL_MAX;
  return { max, supervise: true, consumes: true };
}
