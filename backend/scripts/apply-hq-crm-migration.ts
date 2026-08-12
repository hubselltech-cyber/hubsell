// Áp migration 20260812210000_hq_crm_audit vào DB đang trỏ bởi DATABASE_URL
// (dev local dùng db push không được thì chạy tay file SQL này — cùng pattern
// manual-migrations 10/08). Idempotent: bảng/enum đã có thì bỏ qua êm.
// Chạy: npx tsx scripts/apply-hq-crm-migration.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split(":")[0];
  console.log(`Đang kết nối: ${host ?? "(không rõ host)"}`);

  const sql = readFileSync(
    join(__dirname, "../prisma/migrations/20260812210000_hq_crm_audit/migration.sql"),
    "utf8"
  );
  // Tách từng câu lệnh theo dấu ';' cuối dòng — file do prisma migrate diff
  // sinh, không có ';' trong chuỗi ký tự nên tách thô là an toàn.
  // Chỉ vứt DÒNG chú thích "--" bên trong từng cụm, KHÔNG vứt cả cụm (mỗi câu
  // lệnh đều mở đầu bằng "-- CreateTable..." — vứt cả cụm là chạy 0 câu nào).
  const statements = sql
    .split(/;\s*\r?\n/)
    .map((s) =>
      s
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .replace(/;\s*$/, "")
        .trim()
    )
    .filter((s) => s.length > 0);

  if (statements.length === 0) {
    throw new Error("Không tách được câu lệnh nào từ file migration — kiểm tra lại file SQL.");
  }

  for (const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`✅ ${stmt.split("\n")[0].slice(0, 70)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists|duplicate/i.test(msg)) {
        console.log(`↷ bỏ qua (đã có): ${stmt.split("\n")[0].slice(0, 60)}`);
      } else {
        throw err;
      }
    }
  }
  console.log("Xong.");
}

main()
  .catch((err) => {
    console.error("LỖI:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
