// Script DEV LOCAL: mint JWT cho tài khoản admin local để test UI không cần gõ
// mật khẩu (nạp vào localStorage hubsell_token — xem memory
// hubsell-local-test-chrome). Chỉ có nghĩa với DB local + JWT_SECRET trong
// .env; không phải lỗ hổng — ai có hai thứ đó vốn đã toàn quyền.
// Chạy: npx tsx scripts/dev-mint-jwt.ts
import "dotenv/config";
import { signToken } from "../src/middleware/auth";
import { prisma } from "../src/lib/prisma";

async function main() {
  const user =
    (await prisma.user.findUnique({ where: { email: "admin@hubsell.vn" } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" } }));
  if (!user) throw new Error("Không có user ADMIN nào trong DB local");
  const token = signToken(user.id);
  console.log(
    JSON.stringify({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    })
  );
}

main().finally(() => prisma.$disconnect());
