// GÓI MẶC ĐỊNH + DÙNG THỬ (anh Trung chốt 22/08, tên gói chốt lại 22/08:
// "Starter" — KHÔNG có gói miễn phí vĩnh viễn; mọi khách mới dùng thử 14 ngày,
// hết thử là Starter 99k/tháng dưới 300 đơn FULL tính năng, vượt trần 300 đơn
// bắt buộc nâng gói cao hơn):
//   1. Upsert gói STARTER "Starter" (99k/tháng; kỳ 3/6/12 tháng giá TUYẾN TÍNH
//      — anh Trung chốt 22/08: ưu đãi kỳ dài chỉ dành cho bậc từ 3.000 đơn trở
//      lên, 2 bậc thấp không chiết khấu; sửa được trên /admin/plans), trần 300
//      đơn/tháng, trialDays 14, isDefault.
//   2. Nếu còn gói mã cũ (BETA đời đầu / BASIC "Beta" bản seed trước): dời mọi
//      thuê bao sang STARTER (mở lại kỳ dùng thử 14 ngày kể từ hôm chạy) rồi
//      xoá gói cũ.
//   3. Gán mọi chủ shop CHƯA có thuê bao vào STARTER — dùng thử 14 ngày.
// Idempotent. Dry-run mặc định — thêm --apply mới ghi thật.
//   npx tsx scripts/backfill-starter-subscriptions.ts          (xem trước)
//   npx tsx scripts/backfill-starter-subscriptions.ts --apply  (ghi thật)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// Thang gói anh Trung chốt 22/08: Starter (<300 đơn, FULL tính năng, 99k) là
// cửa vào — vượt trần 300 đơn bắt buộc nâng gói; TRÊN 300 đơn tách 2 gói
// Cơ bản / Nâng cao (khác nhau về TÍNH NĂNG — giá/trần/danh sách tính năng
// chưa chốt, seed dạng NHÁP isActive=false để anh điền dần trên /admin/plans,
// khách không nhìn thấy gói nháp).
const STARTER = {
  code: "STARTER",
  name: "Starter",
  description:
    "Đầy đủ tính năng Hubsell cho shop dưới 300 đơn/tháng — vượt trần cần nâng gói cao hơn. Mọi tài khoản mới được dùng thử 14 ngày.",
  tier: 1,
  // Kỳ dài giá TUYẾN TÍNH (= tháng × số tháng, KHÔNG chiết khấu — bán kỳ dài
  // chỉ để khách/kế toán đỡ thao tác chuyển khoản hàng tháng khi chưa có cổng
  // thanh toán). Sửa được trên /admin/plans; 0 = không bán kỳ đó.
  priceMonthly: 99_000,
  priceQuarterly: 297_000,
  priceSemiannual: 594_000,
  priceYearly: 1_188_000,
  maxOrdersPerMonth: 300,
  trialDays: 14,
  isActive: true,
  isDefault: true,
  // "all" = full tính năng. Khóa module theo mảng key là việc cưỡng chế GĐ2.
  features: { modules: "all" },
};

/**
 * 2 gói cho khách trên 300 đơn (NHÁP — giá anh Trung điền sau trên /admin/plans).
 * Tính năng anh Trung chốt 22/08: Cơ bản CHỈ Tổng quan + Tài chính + Kho;
 * Nâng cao full. Key module khớp khu vực app, FE dịch nhãn.
 */
const DRAFT_UPPER_PLANS = [
  {
    code: "STANDARD",
    name: "Cơ bản",
    description: "Trên 300 đơn/tháng — gồm Tổng quan, Tài chính, Kho. NHÁP: chưa chốt giá.",
    tier: 2,
    features: { modules: ["dashboard", "finance", "warehouse"] },
  },
  {
    code: "ADVANCED",
    name: "Nâng cao",
    description: "Trên 300 đơn/tháng — đầy đủ toàn bộ tính năng Hubsell. NHÁP: chưa chốt giá.",
    tier: 3,
    features: { modules: "all" },
  },
];

function trialEnd(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split(":")[0];
  console.log(`DB: ${host ?? "(khong ro host)"} — che do: ${APPLY ? "GHI THAT" : "dry-run"}`);

  let starter = await prisma.servicePlan.findUnique({ where: { code: STARTER.code } });
  console.log(
    starter ? `Goi STARTER da co (id ${starter.id}) — se upsert thong so.` : "Se tao goi STARTER."
  );
  if (APPLY) {
    starter = await prisma.servicePlan.upsert({
      where: { code: STARTER.code },
      create: STARTER,
      update: STARTER,
    });
    // Toi da MOT goi mac dinh.
    await prisma.servicePlan.updateMany({
      where: { isDefault: true, id: { not: starter.id } },
      data: { isDefault: false },
    });
  }

  // Goi nhap tren 300 don: CHI TAO KHI CHUA CO — khong upsert de khoi de len
  // gia/tinh nang anh Trung da tu dien tren /admin/plans.
  for (const draft of DRAFT_UPPER_PLANS) {
    const existing = await prisma.servicePlan.findUnique({ where: { code: draft.code } });
    if (existing) {
      console.log(`Goi ${draft.code} da co — giu nguyen.`);
      continue;
    }
    console.log(`Se tao goi NHAP ${draft.code} (${draft.name}) — isActive=false.`);
    if (APPLY) await prisma.servicePlan.create({ data: draft });
  }

  // Chuyen doi tu goi ma cu (chi ton tai o DB da chay backfill ban truoc):
  // BETA doi dau, hoac BASIC ten "Beta" cua ban seed truoc khi chot ten Starter.
  for (const legacyCode of ["BETA", "BASIC"]) {
    const legacy = await prisma.servicePlan.findUnique({
      where: { code: legacyCode },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!legacy) continue;
    console.log(`Goi ${legacyCode} cu con ${legacy._count.subscriptions} thue bao — se doi sang STARTER (dung thu ${STARTER.trialDays} ngay tu hom nay) roi xoa ${legacyCode}.`);
    if (APPLY && starter) {
      await prisma.subscription.updateMany({
        where: { planId: legacy.id },
        data: {
          planId: starter.id,
          isTrial: true,
          currentPeriodStart: new Date(),
          currentPeriodEnd: trialEnd(STARTER.trialDays),
        },
      });
      await prisma.servicePlan.delete({ where: { id: legacy.id } });
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
  if (!starter) throw new Error("Khong co goi STARTER sau buoc tao — kiem tra lai.");

  let created = 0;
  for (const o of owners) {
    // create tung dong + bat P2002: an toan neu user vua tu dang ky song song.
    try {
      await prisma.subscription.create({
        data: {
          userId: o.id,
          planId: starter.id,
          isTrial: true,
          currentPeriodEnd: trialEnd(STARTER.trialDays),
        },
      });
      created += 1;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") console.log(`  ↷ bo qua (da co): ${o.email ?? o.id}`);
      else throw err;
    }
  }
  console.log(`Xong: gan ${created}/${owners.length} chu shop vao goi Starter (dung thu ${STARTER.trialDays} ngay).`);
}

main()
  .catch((err) => {
    console.error("LOI:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
