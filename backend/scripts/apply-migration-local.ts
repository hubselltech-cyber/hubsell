// Áp MỘT thư mục migration vào DB đang trỏ bởi DATABASE_URL — dùng cho DEV
// LOCAL khi không chạy được `prisma db push` (production KHÔNG cần: Render tự
// `prisma migrate deploy` khi deploy). Idempotent: đối tượng đã có thì bỏ qua êm.
// Chạy: npx tsx scripts/apply-migration-local.ts <tên_thư_mục_migration>
//   vd: npx tsx scripts/apply-migration-local.ts 20260812230000_platform_ledger
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Tách file SQL thành câu lệnh; mỗi khối DO $$…END $$; là MỘT câu. */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  const re = /DO \$\$[\s\S]*?END \$\$;/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push(...sql.slice(last, m.index).split(/;\s*\r?\n/));
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  out.push(...sql.slice(last).split(/;\s*\r?\n/));
  return out;
}

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Cách dùng: npx tsx scripts/apply-migration-local.ts <tên_thư_mục_migration>");
    process.exit(1);
  }
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split(":")[0];
  console.log(`Đang kết nối: ${host ?? "(không rõ host)"} — áp migration ${folder}`);

  const sql = readFileSync(
    join(__dirname, `../prisma/migrations/${folder}/migration.sql`),
    "utf8"
  );
  // Tách theo ';' cuối dòng; chỉ vứt DÒNG chú thích "--" trong từng cụm,
  // KHÔNG vứt cả cụm (mỗi câu lệnh đều mở đầu bằng "-- CreateTable...").
  // 24/09: khối `DO $$ … END $$;` (FK viết idempotent) có ';' bên trong —
  // splitSql giữ nguyên cả khối làm MỘT câu lệnh.
  const statements = splitSql(sql)
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
