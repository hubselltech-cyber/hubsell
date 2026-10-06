// ============================================================
// XÓA CỨNG TÀI KHOẢN ĐÃ TỰ XÓA QUÁ 30 NGÀY (06/10/2026)
//
// Người dùng bấm "Xóa tài khoản" trong app → dòng User bị ẩn danh ngay và đặt
// deletedAt (services/account-deletion.ts). Script này xóa hẳn dòng User (và
// mọi bảng cascade theo userId: gian hàng, đơn, sản phẩm, nhân viên…) khi đã
// qua 30 ngày — đúng lời hứa ở hubsell.vn/xoa-tai-khoan. Chạy tay định kỳ.
//
// Chạy: npx tsx scripts/purge-deleted-accounts.ts            (xem trước)
//       npx tsx scripts/purge-deleted-accounts.ts --apply    (xóa thật)
// Production: đặt DATABASE_URL (session pooler) như lúc chạy seed.
// Lỗi ràng buộc ở một user (bảng chưa cascade) KHÔNG dừng cả lượt — in ra để
// xử lý tay, các user khác vẫn xóa tiếp.
// ============================================================
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const RETENTION_DAYS = 30;

async function main() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({
    where: { deletedAt: { not: null, lte: cutoff } },
    select: { id: true, ownerId: true, deletedAt: true, _count: { select: { channels: true, staff: true } } },
    orderBy: { deletedAt: "asc" },
  });
  console.log(
    `Tài khoản tự xóa trước ${cutoff.toISOString().slice(0, 10)}: ${users.length}` +
      (APPLY ? " — XÓA THẬT" : " — xem trước, thêm --apply để xóa")
  );
  let ok = 0;
  let failed = 0;
  for (const u of users) {
    const kind = u.ownerId ? "nhân viên" : `chủ shop (${u._count.channels} gian, ${u._count.staff} NV)`;
    console.log(`- ${u.id} · ${kind} · xóa mềm ${u.deletedAt!.toISOString().slice(0, 10)}`);
    if (!APPLY) continue;
    try {
      await prisma.user.delete({ where: { id: u.id } });
      ok++;
    } catch (err) {
      failed++;
      console.error(`  ✗ không xóa được: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  }
  if (APPLY) console.log(`Xong: ${ok} xóa, ${failed} lỗi.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
