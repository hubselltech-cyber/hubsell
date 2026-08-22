// Tạo gói BETA 0đ (isDefault) nếu chưa có + gán mọi CHỦ SHOP chưa có thuê bao
// vào gói đó (GĐ1 thương mại hóa 22/08). Idempotent: chạy lại không tạo trùng.
// Dry-run mặc định — thêm --apply mới ghi thật.
//   npx tsx scripts/backfill-beta-subscriptions.ts          (xem trước)
//   npx tsx scripts/backfill-beta-subscriptions.ts --apply  (ghi thật)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split(":")[0];
  console.log(`DB: ${host ?? "(không rõ host)"} — chế độ: ${APPLY ? "GHI THẬT" : "dry-run"}`);

  let beta = await prisma.servicePlan.findUnique({ where: { code: "BETA" } });
  if (!beta) {
    console.log("Chưa có gói BETA → sẽ tạo: Beta 0đ, isActive + isDefault, không giới hạn.");
    if (APPLY) {
      beta = await prisma.servicePlan.create({
        data: {
          code: "BETA",
          name: "Beta",
          description:
            "Gói dùng thử miễn phí giai đoạn beta — đầy đủ tính năng, không giới hạn thời gian.",
          tier: 0,
          priceMonthly: 0,
          priceYearly: 0,
          isActive: true,
          isDefault: true,
        },
      });
    }
  } else {
    console.log(`Gói BETA đã có (id ${beta.id}, isDefault=${beta.isDefault}).`);
  }

  const owners = await prisma.user.findMany({
    where: { ownerId: null, subscription: null },
    select: { id: true, email: true, fullName: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Chủ shop CHƯA có thuê bao: ${owners.length}`);
  for (const o of owners) console.log(`  - ${o.fullName} (${o.email ?? o.id})`);

  if (!APPLY) {
    console.log("\nDry-run xong — chạy lại với --apply để ghi.");
    return;
  }
  if (!beta) throw new Error("Không có gói BETA sau bước tạo — kiểm tra lại.");

  let created = 0;
  for (const o of owners) {
    // create từng dòng + bắt P2002: an toàn nếu user vừa tự đăng ký song song.
    try {
      await prisma.subscription.create({
        data: { userId: o.id, planId: beta.id, currentPeriodEnd: null },
      });
      created += 1;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") console.log(`  ↷ bỏ qua (đã có): ${o.email ?? o.id}`);
      else throw err;
    }
  }
  console.log(`Xong: gán ${created}/${owners.length} chủ shop vào gói Beta.`);
}

main()
  .catch((err) => {
    console.error("LỖI:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
