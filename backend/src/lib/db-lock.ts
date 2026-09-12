// ============================================================
// KHÓA THEO GIAN Ở TẦNG DB (Postgres advisory lock) — 12/09/2026
//
// Vì sao: mutex Map trong RAM chỉ đúng khi backend chạy MỘT tiến trình. Lên
// nhiều instance (web + worker, hoặc 2 worker), hai tiến trình cùng refresh
// token một gian → Shopee/Lazada ROTATE refresh_token → bên thua giữ token
// chết → gian bị đánh dấu rớt kết nối, seller phải ủy quyền lại vì lỗi của
// mình. Đây là kiểu gián đoạn KHÔNG được phép ở quy mô thương mại.
//
// Cách làm: pg_advisory_xact_lock(hashtext(key)) trong một interactive
// transaction — khóa sống đúng bằng transaction, tự nhả khi commit/rollback
// hay khi kết nối chết (không bao giờ kẹt khóa mồ côi). Dùng khóa CẤP
// TRANSACTION (xact) chứ không cấp session để chạy được cả qua pooler chế độ
// transaction của Supabase (mỗi transaction ghim vào một kết nối).
//
// Bên chờ khóa đứng ở câu SELECT cho tới khi bên cầm xong; vào được rồi PHẢI
// đọc lại dữ liệu (double-check) vì bên trước có thể đã làm hộ. Callback nhận
// `tx` — mọi đọc/ghi liên quan tới khóa phải đi qua tx để ở trong cùng
// transaction.
// ============================================================

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/** Chờ lấy kết nối từ pool tối đa (ms). */
const LOCK_MAX_WAIT_MS = 15_000;
/**
 * Transaction sống tối đa (ms) — trong đó có một call HTTP tới sàn (refresh
 * token ~1-3s, rate-limit retry tới ~10s). Quá ngưỡng Prisma rollback + nhả khóa.
 */
const LOCK_TIMEOUT_MS = 45_000;

/**
 * Chạy `fn` dưới khóa advisory theo `key` (vd "shopee-token:<channelId>").
 * Nhiều tiến trình gọi cùng key → xếp hàng tuần tự; khác key → song song.
 */
export async function withDbLock<T>(
  key: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      return fn(tx);
    },
    { maxWait: LOCK_MAX_WAIT_MS, timeout: LOCK_TIMEOUT_MS }
  );
}
