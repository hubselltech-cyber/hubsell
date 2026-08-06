// Script MỘT LẦN 06/08/2026 — kiểm tra & nâng cấp Supabase PRODUCTION cho khu
// Quản trị nền tảng: thêm cột isPlatformAdmin + gán cờ cho dev@hubsell.tech.
// Chạy: DATABASE_URL=<chuỗi Supabase> npx tsx scripts/prod-platform-admin-check.ts [--apply]
// Không có --apply = chỉ ĐỌC (kiểm tra cột + tài khoản), không sửa gì.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split(":")[0];
  console.log(`Đang kết nối: ${host ?? "(không rõ host)"} — chế độ ${APPLY ? "APPLY" : "CHỈ ĐỌC"}`);

  const col: unknown[] = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'User' AND column_name = 'isPlatformAdmin'`
  );
  console.log(`1) Cột isPlatformAdmin: ${col.length ? "ĐÃ có" : "CHƯA có"}`);

  if (!col.length && APPLY) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false`
    );
    console.log("   → Đã thêm cột isPlatformAdmin (default false).");
  }

  const users: { email: string; fullName: string; isPlatformAdmin?: boolean }[] =
    await prisma.$queryRawUnsafe(
      col.length || APPLY
        ? `SELECT email, "fullName", "isPlatformAdmin" FROM "User" WHERE email = 'dev@hubsell.tech'`
        : `SELECT email, "fullName" FROM "User" WHERE email = 'dev@hubsell.tech'`
    );
  console.log(
    `2) Tài khoản dev@hubsell.tech: ${users.length ? `CÓ (${users[0].fullName}${users[0].isPlatformAdmin !== undefined ? `, isPlatformAdmin=${users[0].isPlatformAdmin}` : ""})` : "CHƯA đăng ký"}`
  );

  if (users.length && APPLY && users[0].isPlatformAdmin !== true) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "isPlatformAdmin" = true WHERE email = 'dev@hubsell.tech'`
    );
    console.log(`   → Đã gán cờ quản trị nền tảng (${n} dòng).`);
  }
}

main()
  .catch((err) => {
    console.error("LỖI:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
