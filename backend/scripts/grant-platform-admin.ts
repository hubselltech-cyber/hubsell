// ============================================================
// GÁN / GỠ QUYỀN QUẢN TRỊ NỀN TẢNG (cờ isPlatformAdmin trên User).
//
// Cờ này mở khu /admin (thống kê người dùng đăng ký, nhật ký webhook toàn
// hệ thống). CHỦ ĐÍCH không có API nào bật được cờ — chỉ chạy script này
// bằng tay, trỏ DATABASE_URL vào DB muốn tác động (local hoặc Supabase).
//
// Cách chạy (trong thư mục backend):
//   npx tsx scripts/grant-platform-admin.ts <email>            # bật cờ
//   npx tsx scripts/grant-platform-admin.ts <email> --revoke   # gỡ cờ
//
// Muốn chạy trên PRODUCTION: đặt tạm DATABASE_URL của Supabase trước lệnh,
// hoặc dùng thẳng SQL trong migration 20260806200000 + UPDATE tay.
// ============================================================
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");

  if (!email || !email.includes("@")) {
    console.error(
      "Cách dùng: npx tsx scripts/grant-platform-admin.ts <email> [--revoke]"
    );
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, isPlatformAdmin: true },
  });
  if (!user) {
    console.error(`Không tìm thấy tài khoản với email: ${email}`);
    process.exit(1);
  }

  const target = !revoke;
  if (user.isPlatformAdmin === target) {
    console.log(
      `Không có gì để làm: ${user.email} (${user.fullName}) đã ${
        target ? "CÓ" : "KHÔNG có"
      } quyền quản trị nền tảng.`
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isPlatformAdmin: target },
  });
  console.log(
    `${target ? "ĐÃ GÁN" : "ĐÃ GỠ"} quyền quản trị nền tảng cho ${user.email} (${user.fullName}).`
  );
  console.log(
    "Lưu ý: người này cần đăng xuất/đăng nhập lại (hoặc F5) để sidebar hiện mục Hệ thống."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
