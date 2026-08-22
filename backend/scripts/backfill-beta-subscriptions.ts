// GÓI MẶC ĐỊNH + DÙNG THỬ (anh Trung chốt 22/08: KHÔNG có Beta miễn phí vĩnh
// viễn — mọi khách mới dùng thử 14 ngày, hết thử là gói Cơ bản 99k/tháng dưới
// 300 đơn full tính năng):
//   1. Upsert gói BASIC "Cơ bản" (99k/tháng, 990k/năm ≈ tặng 2 tháng — sửa
//      được trên /admin/plans), trần 300 đơn/tháng, trialDays 14, isDefault.
//   2. Nếu còn gói BETA đời đầu: dời mọi thuê bao sang BASIC (mở lại kỳ dùng
//      thử 14 ngày kể từ hôm chạy) rồi xoá BETA.
//   3. Gán mọi chủ shop CHƯA có thuê bao vào BASIC — dùng thử 14 ngày.
// Idempotent. Dry-run mặc định — thêm --apply mới ghi thật.
//   npx tsx scripts/backfill-beta-subscriptions.ts          (xem trước)
//   npx tsx scripts/backfill-beta-subscriptions.ts --apply  (ghi thật)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const BASIC = {
  code: "BASIC",
  name: "Cơ bản",
  description:
    "Đầy đủ tính năng Hubsell cho shop dưới 300 đơn/tháng. Mọi tài khoản mới được dùng thử 14 ngày.",
  tier: 1,
  priceMonthly: 99_000,
  priceYearly: 990_000,
  maxOrdersPerMonth: 300,
  trialDays: 14,
  isActive: true,
  isDefault: true,
};

function trialEnd(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split(":")[0];
  console.log(`DB: ${host ?? "(khong ro host)"} — che do: ${APPLY ? "GHI THAT" : "dry-run"}`);

  let basic = await prisma.servicePlan.findUnique({ where: { code: BASIC.code } });
  console.log(basic ? `Goi BASIC da co (id ${basic.id}) — se upsert thong so.` : "Se tao goi BASIC.");
  if (APPLY) {
    basic = await prisma.servicePlan.upsert({
      where: { code: BASIC.code },
      create: BASIC,
      update: BASIC,
    });
    // Toi da MOT goi mac dinh.
    await prisma.servicePlan.updateMany({
      where: { isDefault: true, id: { not: basic.id } },
      data: { isDefault: false },
    });
  }

  // Chuyen doi tu goi BETA doi dau (chi ton tai o DB da chay backfill ban cu).
  const beta = await prisma.servicePlan.findUnique({
    where: { code: "BETA" },
    include: { _count: { select: { subscriptions: true } } },
  });
  if (beta) {
    console.log(`Goi BETA cu con ${beta._count.subscriptions} thue bao — se doi sang BASIC (dung thu ${BASIC.trialDays} ngay tu hom nay) roi xoa BETA.`);
    if (APPLY && basic) {
      await prisma.subscription.updateMany({
        where: { planId: beta.id },
        data: {
          planId: basic.id,
          isTrial: true,
          currentPeriodStart: new Date(),
          currentPeriodEnd: trialEnd(BASIC.trialDays),
        },
      });
      await prisma.servicePlan.delete({ where: { id: beta.id } });
    }
  }

  const owners = await prisma.user.findMany({
    where: { ownerId: null, subscription: null },
    select: { id: true, email: true, fullName: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Chu shop CHUA co thue bao: ${owners.length}`);
  for (const o of owners) console.log(`  - ${o.fullName} (${o.email ?? o.id})`);

  if (!APPLY) {
    console.log("\nDry-run xong — chay lai voi --apply de ghi.");
    return;
  }
  if (!basic) throw new Error("Khong co goi BASIC sau buoc tao — kiem tra lai.");

  let created = 0;
  for (const o of owners) {
    // create tung dong + bat P2002: an toan neu user vua tu dang ky song song.
    try {
      await prisma.subscription.create({
        data: {
          userId: o.id,
          planId: basic.id,
          isTrial: true,
          currentPeriodEnd: trialEnd(BASIC.trialDays),
        },
      });
      created += 1;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") console.log(`  ↷ bo qua (da co): ${o.email ?? o.id}`);
      else throw err;
    }
  }
  console.log(`Xong: gan ${created}/${owners.length} chu shop vao goi Co ban (dung thu ${BASIC.trialDays} ngay).`);
}

main()
  .catch((err) => {
    console.error("LOI:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
