/** Kiểm tra nhanh DB LOCAL trước khi vá migration fail (P3009):
 *  bảng của migration 20260806090000_ops_alerts_unified đã tồn tại chưa. */
import { prisma } from "../src/prisma";

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ a: string | null; b: string | null }[]>(
    `SELECT to_regclass('public."OpsAlert"')::text a, to_regclass('public."OpsCenterVisit"')::text b`
  );
  console.log(JSON.stringify(rows));
}

main().finally(() => prisma.$disconnect());
