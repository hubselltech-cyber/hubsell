// ============================================================
// TỰ ĐIỀN MÃ VẠCH QUẢN LÝ cho sản phẩm kho CŨ — từng bước nhỏ (05/11/2026 đêm,
// docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.6; anh Trung chọn "Máy tự điền chậm").
//
// Đường DUY NHẤT điền mã cho sản phẩm cũ (script chạy tay scripts/backfill-product-barcode.ts đã bỏ 06/11).
// Migration 20261105220000_product_barcode chỉ cho sản phẩm MỚI tự có mã (DEFAULT của cột);
// sản phẩm có từ trước để NULL. Hàm ở đây làm MỘT BƯỚC: duyệt một lô theo khóa chính
// (`id > con trỏ`, không OFFSET), điền mã cho dòng còn NULL bằng một câu UPDATE, rồi ghi con trỏ
// vào bảng maintenance_jobs. Worker (workers/product-barcode-backfill.ts) gọi lặp lại có nghỉ.
//
// Vì sao đi MỘT LƯỢT theo khóa chính là đủ: sản phẩm tạo sau migration luôn có mã (DEFAULT ở
// DB, kể cả do bản mã cũ tạo), nên dòng NULL chỉ nằm trong tập có sẵn lúc bắt đầu — đi hết
// khóa chính một lần là hết NULL. Xong thì đánh dấu doneAt, các lần sau không đụng bảng Product.
//
// An toàn khi chạy lại / chạy trùng: UPDATE chỉ đụng dòng `barcode IS NULL` (khóa dòng trước khi
// ghi), con trỏ ghi SAU khi điền — chết giữa chừng thì lượt sau duyệt lại đúng lô đó, không ghi gì.
// UPDATE không đụng "costPrice" nên trigger sổ cái trên "Product" không chạy.
// ============================================================
import { prisma } from "../lib/prisma";

export const PRODUCT_BARCODE_BACKFILL_KEY = "product-barcode-backfill";

export interface BarcodeBackfillStep {
  /** Số dòng đã duyệt trong bước này (0 = hết bảng). */
  scanned: number;
  /** Số dòng vừa được điền mã. */
  filled: number;
  /** true = việc đã xong hẳn (đã đánh dấu doneAt). */
  done: boolean;
  /** Tổng số dòng đã điền từ đầu việc. */
  totalFilled: number;
}

/**
 * Làm một bước. `key` chỉ đổi trong test (mỗi test một việc riêng, không đụng tiến độ thật).
 */
export async function runBarcodeBackfillStep(opts: { batch: number; key?: string }): Promise<BarcodeBackfillStep> {
  const key = opts.key ?? PRODUCT_BARCODE_BACKFILL_KEY;
  const batch = Math.max(1, Math.min(2000, Math.floor(opts.batch)));
  const job = await prisma.maintenanceJob.upsert({ where: { key }, update: {}, create: { key } });
  if (job.doneAt) return { scanned: 0, filled: 0, done: true, totalFilled: job.processed };

  const rows = await prisma.product.findMany({
    where: { id: { gt: job.cursor ?? "" } },
    orderBy: { id: "asc" },
    take: batch,
    select: { id: true, barcode: true },
  });
  if (rows.length === 0) {
    await prisma.maintenanceJob.update({ where: { key }, data: { doneAt: new Date(), updatedAt: new Date() } });
    return { scanned: 0, filled: 0, done: true, totalFilled: job.processed };
  }

  const ids = rows.filter((r) => r.barcode === null).map((r) => r.id);
  let filled = 0;
  if (ids.length > 0) {
    // Sinh mã theo thứ tự id (≈ thứ tự tạo) để các phân loại tạo cùng lúc nhận mã liền nhau.
    filled = await prisma.$executeRaw`
      UPDATE "Product" AS p SET "barcode" = public.product_new_barcode()
      FROM (SELECT "id" FROM "Product" WHERE "id" = ANY(${ids}) AND "barcode" IS NULL ORDER BY "id" FOR UPDATE) AS t
      WHERE p."id" = t."id"`;
  }
  const updated = await prisma.maintenanceJob.update({
    where: { key },
    data: { cursor: rows[rows.length - 1].id, processed: { increment: filled }, updatedAt: new Date() },
    select: { processed: true },
  });
  return { scanned: rows.length, filled, done: false, totalFilled: updated.processed };
}
