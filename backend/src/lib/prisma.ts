import { PrismaClient } from "@prisma/client";

// Một instance PrismaClient dùng chung cho toàn app.
// Tránh tạo nhiều kết nối database khi code tự reload lúc dev.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
