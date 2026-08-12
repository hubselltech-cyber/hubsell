// Script MỘT LẦN 12/08/2026 — đặt username "hubsell" cho tài khoản điều hành
// nền tảng dev@hubsell.tech, để nhân viên điều hành đăng nhập dạng đẹp
// "hubsell/tênnhânviên" (thay vì username tự sinh từ email kiểu "dev1234").
// Chạy: DATABASE_URL=<chuỗi Supabase từ Render env> npx tsx scripts/prod-hq-username.ts [--apply]
// Không có --apply = chỉ ĐỌC, không sửa gì.
//
// LƯU Ý: KHÔNG đụng tài khoản seed admin@hubsell.vn — anh Trung giữ để test
// dữ liệu thật, chỉ xóa khi thương mại hóa (xem memory hubsell-platform-admin).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TARGET_EMAIL = "dev@hubsell.tech";
const TARGET_USERNAME = "hubsell";

async function main() {
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split(":")[0];
  console.log(`Đang kết nối: ${host ?? "(không rõ host)"} — chế độ ${APPLY ? "APPLY" : "CHỈ ĐỌC"}`);

  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: { id: true, fullName: true, username: true, isPlatformAdmin: true },
  });
  if (!user) {
    console.log(`1) Tài khoản ${TARGET_EMAIL}: CHƯA tồn tại — dừng.`);
    return;
  }
  console.log(
    `1) Tài khoản ${TARGET_EMAIL}: CÓ (${user.fullName}, username=${user.username ?? "(chưa đặt)"}, isPlatformAdmin=${user.isPlatformAdmin})`
  );

  if (user.username === TARGET_USERNAME) {
    console.log(`2) Username đã là "${TARGET_USERNAME}" — không cần làm gì.`);
    return;
  }

  const clash = await prisma.user.findUnique({
    where: { username: TARGET_USERNAME },
    select: { id: true, email: true },
  });
  if (clash && clash.id !== user.id) {
    console.log(
      `2) ❌ Username "${TARGET_USERNAME}" đã thuộc về tài khoản khác (${clash.email ?? clash.id}) — dừng, cần chọn tên khác.`
    );
    return;
  }
  console.log(`2) Username "${TARGET_USERNAME}" còn trống.`);

  if (!APPLY) {
    console.log(`3) CHỈ ĐỌC — chạy lại với --apply để đặt username.`);
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { username: TARGET_USERNAME },
  });
  console.log(
    `3) ✅ Đã đặt username "${TARGET_USERNAME}" — nhân viên điều hành sẽ đăng nhập dạng "${TARGET_USERNAME}/<tênnhânviên>".`
  );
}

main()
  .catch((err) => {
    console.error("LỖI:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
