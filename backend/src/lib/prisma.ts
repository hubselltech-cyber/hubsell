import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./db-url";

// Một instance PrismaClient dùng chung cho toàn app.
// Tránh tạo nhiều kết nối database khi code tự reload lúc dev.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Giới hạn pool kết nối ghép vào DATABASE_URL lúc khởi động (lib/db-url.ts):
// mặc định connection_limit=5, pool_timeout=30 — chỉnh bằng DB_CONNECTION_LIMIT /
// DB_POOL_TIMEOUT, không phải sửa chuỗi bí mật trên Dashboard.
const databaseUrl = resolveDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
