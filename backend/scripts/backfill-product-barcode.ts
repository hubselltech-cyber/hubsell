// ============================================================
// ĐIỀN MÃ VẠCH QUẢN LÝ cho sản phẩm kho CŨ (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.2)
//
// Migration 20261105220000_product_barcode chỉ thêm cột + DEFAULT (sản phẩm MỚI tự có mã);
// sản phẩm có từ trước để NULL để migration không phải viết lại cả bảng dưới khóa. Script
// này điền nốt, theo lô:
//   · duyệt theo khóa chính `id > con trỏ` (không OFFSET, không quét lại phần đã điền),
//   · mỗi lô một câu UPDATE … WHERE barcode IS NULL (chạy lại bao nhiêu lần cũng an toàn),
//   · nghỉ giữa các lô để không dồn Disk IO.
// UPDATE không đụng "costPrice" nên trigger sổ cái trên "Product" không chạy.
//
//   npx tsx scripts/backfill-product-barcode.ts status
//   npx tsx scripts/backfill-product-barcode.ts run [--batch 1000] [--pause 300] [--max 0]
//
// In chữ KHÔNG DẤU để đọc được trên Render Shell.
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function status() {
  const [missing, total] = await Promise.all([
    prisma.product.count({ where: { barcode: null } }),
    prisma.product.count(),
  ]);
  console.log(`San pham kho: ${total} · chua co ma vach: ${missing}`);
}

async function run() {
  const batch = Math.max(1, Math.min(5000, numArg("batch", 1000)));
  const pauseMs = numArg("pause", 300);
  const max = numArg("max", 0);
  let cursor = "";
  let filled = 0;
  let scanned = 0;
  for (;;) {
    const rows = await prisma.product.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: batch,
      select: { id: true, barcode: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;
    const ids = rows.filter((r) => r.barcode === null).map((r) => r.id);
    if (ids.length > 0) {
      // Thứ tự sinh mã theo id (≈ thứ tự tạo) để các phân loại tạo cùng lúc nhận mã liền nhau.
      const n = await prisma.$executeRaw`
        UPDATE "Product" AS p SET "barcode" = public.product_new_barcode()
        FROM (SELECT "id" FROM "Product" WHERE "id" = ANY(${ids}) AND "barcode" IS NULL ORDER BY "id" FOR UPDATE) AS t
        WHERE p."id" = t."id"`;
      filled += n;
    }
    console.log(`  da duyet ${scanned}, da dien ${filled}`);
    if (max > 0 && filled >= max) break;
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  }
  console.log(`Xong: dien ${filled} ma vach.`);
  await status();
}

const cmd = process.argv[2];
(cmd === "run" ? run() : status())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
