// SEED THANG GÓI + GÁN KHÁCH CŨ (anh Trung chốt cả thang 22/08 — "push luôn
// gói như này", 5 bậc FULL tính năng chỉ khác trần đơn, chỉnh sửa tiếp trực
// tiếp trên /admin/plans):
//   Starter 300 đơn/99k (mặc định, dùng thử 14 ngày; năm TẶNG 1 tháng)
//   Growth 1.000/199k (năm TẶNG 1 tháng) · Pro 3.000/399k · Business
//   10.000/699k (Pro/Business chiết khấu −6%/−11%/năm TẶNG 2 tháng)
//   Enterprise: NHÁP isActive=false — báo giá riêng khi có khách Mall/brand.
//
// NGUYÊN TẮC VÀNG: DB là nguồn chân lý sau lần seed đầu — script CHỈ TẠO GÓI
// CÒN THIẾU, gói đã có (kể cả STARTER) giữ nguyên để không đè lên chỉnh sửa
// tay của anh Trung trên /admin/plans. Việc dọn dẹp: dời thuê bao khỏi gói mã
// cũ (BETA/BASIC) sang STARTER rồi xoá; xoá 2 gói nháp lỗi thời
// STANDARD/ADVANCED (thời còn tách gói theo TÍNH NĂNG) nếu chưa có thuê bao.
//
// HAI BƯỚC TÁCH RỜI (để tạo gói trên production cho anh sửa ngay mà CHƯA kích
// hoạt đếm dùng thử của khách hiện có):
//   npx tsx scripts/backfill-starter-subscriptions.ts                    (xem trước)
//   npx tsx scripts/backfill-starter-subscriptions.ts --apply            (chỉ tạo/dọn GÓI)
//   npx tsx scripts/backfill-starter-subscriptions.ts --apply --assign   (kèm gán chủ shop
//       chưa có thuê bao vào Starter — dùng thử 14 NGÀY ĐẾM TỪ HÔM CHẠY)
// Idempotent — chạy lại bao nhiêu lần cũng an toàn.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ASSIGN = process.argv.includes("--assign");

const TRIAL_DAYS = 14;

// Thang giá chốt 22/08 (căn cứ khảo sát 2 vòng — artifact "Trần đơn gói
// Hubsell"): bước nhảy ×3 kiểu SEA, đơn giá 330→199→133→70đ/đơn.
// Kỳ dài: Starter/Growth tuyến tính riêng 12 tháng = 11 × giá tháng (tặng 1
// tháng); Pro/Business −6%/−11%/12 tháng = 10 × giá tháng (tặng 2 tháng).
// Tất cả sửa được trên /admin/plans; 0 = không bán kỳ đó.
const PLANS = [
  {
    code: "STARTER",
    name: "Starter",
    description:
      "Đầy đủ tính năng Hubsell cho shop dưới 300 đơn/tháng — vượt trần cần nâng gói cao hơn. Mọi tài khoản mới được dùng thử 14 ngày.",
    tier: 1,
    priceMonthly: 99_000,
    priceQuarterly: 297_000,
    priceSemiannual: 594_000,
    priceYearly: 1_089_000,
    maxOrdersPerMonth: 300,
    trialDays: TRIAL_DAYS,
    isActive: true,
    isDefault: true,
    // "all" = full tính năng. Khóa module theo mảng key là việc cưỡng chế GĐ2.
    features: { modules: "all" },
  },
  {
    code: "GROWTH",
    name: "Growth",
    description:
      "Đầy đủ tính năng Hubsell cho shop tới 1.000 đơn/tháng. Mua 12 tháng tặng 1 tháng.",
    tier: 2,
    priceMonthly: 199_000,
    priceQuarterly: 597_000,
    priceSemiannual: 1_194_000,
    priceYearly: 2_189_000,
    maxOrdersPerMonth: 1_000,
    isActive: true,
    features: { modules: "all" },
  },
  {
    code: "PRO",
    name: "Pro",
    description:
      "Đầy đủ tính năng Hubsell cho shop tới 3.000 đơn/tháng. Mua 12 tháng tặng 2 tháng.",
    tier: 3,
    priceMonthly: 399_000,
    priceQuarterly: 1_129_000,
    priceSemiannual: 2_129_000,
    priceYearly: 3_990_000,
    maxOrdersPerMonth: 3_000,
    isActive: true,
    features: { modules: "all" },
  },
  {
    code: "BUSINESS",
    name: "Business",
    description:
      "Đầy đủ tính năng Hubsell cho shop tới 10.000 đơn/tháng. Mua 12 tháng tặng 2 tháng.",
    tier: 4,
    priceMonthly: 699_000,
    priceQuarterly: 1_979_000,
    priceSemiannual: 3_729_000,
    priceYearly: 6_990_000,
    maxOrdersPerMonth: 10_000,
    isActive: true,
    features: { modules: "all" },
  },
  {
    // Nháp khách không thấy — bật "Đang bán" + điền giá khi có khách thỏa thuận.
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Trên 10.000 đơn/tháng — báo giá và SLA riêng. Liên hệ Hubsell.",
    tier: 5,
    isActive: false,
    features: { modules: "all" },
  },
];

// Gói của các bản seed trước cần dọn: BETA/BASIC là tiền thân của STARTER
// (dời thuê bao sang STARTER rồi xoá); STANDARD/ADVANCED là 2 nháp tách theo
// TÍNH NĂNG đã lỗi thời từ khi chốt bán full — xoá nếu chưa có thuê bao.
const LEGACY_TO_STARTER = ["BETA", "BASIC"];
const OBSOLETE_DRAFTS = ["STANDARD", "ADVANCED"];

function trialEnd(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split(":")[0];
  console.log(
    `DB: ${host ?? "(khong ro host)"} — che do: ${APPLY ? "GHI THAT" : "dry-run"}${ASSIGN ? " + GAN KHACH" : ""}`
  );

  // 1. Tao goi con thieu — goi DA CO giu nguyen (khong de len chinh sua tay).
  for (const plan of PLANS) {
    const existing = await prisma.servicePlan.findUnique({ where: { code: plan.code } });
    if (existing) {
      console.log(`Goi ${plan.code} da co — GIU NGUYEN (sua tren /admin/plans).`);
      continue;
    }
    console.log(
      `Se tao goi ${plan.code} (${plan.name})${plan.isActive ? "" : " — NHAP isActive=false"}.`
    );
    if (APPLY) {
      const created = await prisma.servicePlan.create({ data: plan });
      // Toi da MOT goi mac dinh.
      if (plan.isDefault) {
        await prisma.servicePlan.updateMany({
          where: { isDefault: true, id: { not: created.id } },
          data: { isDefault: false },
        });
      }
    }
  }
  const starter = await prisma.servicePlan.findUnique({ where: { code: "STARTER" } });

  // 2. Don goi ma cu tien than cua STARTER: doi thue bao sang STARTER (mo lai
  // dung thu 14 ngay tu hom nay) roi xoa goi cu.
  for (const legacyCode of LEGACY_TO_STARTER) {
    const legacy = await prisma.servicePlan.findUnique({
      where: { code: legacyCode },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!legacy) continue;
    console.log(
      `Goi ${legacyCode} cu con ${legacy._count.subscriptions} thue bao — se doi sang STARTER (dung thu ${TRIAL_DAYS} ngay tu hom nay) roi xoa ${legacyCode}.`
    );
    if (APPLY && starter) {
      await prisma.subscription.updateMany({
        where: { planId: legacy.id },
        data: {
          planId: starter.id,
          isTrial: true,
          currentPeriodStart: new Date(),
          currentPeriodEnd: trialEnd(TRIAL_DAYS),
        },
      });
      await prisma.servicePlan.delete({ where: { id: legacy.id } });
    }
  }

  // 3. Xoa 2 nhap loi thoi (chua tung ban nen binh thuong khong co thue bao).
  for (const code of OBSOLETE_DRAFTS) {
    const draft = await prisma.servicePlan.findUnique({
      where: { code },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!draft) continue;
    if (draft._count.subscriptions > 0) {
      console.log(`⚠ Goi nhap ${code} co ${draft._count.subscriptions} thue bao (la?) — GIU LAI, xu ly tay.`);
      continue;
    }
    console.log(`Se xoa goi nhap loi thoi ${code} (${draft.name}).`);
    if (APPLY) await prisma.servicePlan.delete({ where: { id: draft.id } });
  }

  // 4. Chu shop chua co thue bao — CHI gan khi co --assign (trial dem tu hom chay).
  const owners = await prisma.user.findMany({
    where: { ownerId: null, subscription: null },
    select: { id: true, email: true, fullName: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Chu shop CHUA co thue bao: ${owners.length}`);
  for (const o of owners) console.log(`  - ${o.fullName} (${o.email ?? o.id})`);

  if (!APPLY) {
    console.log("\nDry-run xong — chay lai voi --apply (tao/don goi) hoac --apply --assign (kem gan khach).");
    return;
  }
  if (!starter) throw new Error("Khong co goi STARTER sau buoc tao — kiem tra lai.");
  if (!ASSIGN) {
    if (owners.length > 0) {
      console.log(`\nXong phan GOI. ${owners.length} chu shop tren CHUA duoc gan — chay them --assign khi anh Trung chot thoi diem (dung thu ${TRIAL_DAYS} ngay dem tu ngay chay).`);
    } else {
      console.log("\nXong phan GOI.");
    }
    return;
  }

  let created = 0;
  for (const o of owners) {
    // create tung dong + bat P2002: an toan neu user vua tu dang ky song song.
    try {
      await prisma.subscription.create({
        data: {
          userId: o.id,
          planId: starter.id,
          isTrial: true,
          currentPeriodEnd: trialEnd(TRIAL_DAYS),
        },
      });
      created += 1;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") console.log(`  ↷ bo qua (da co): ${o.email ?? o.id}`);
      else throw err;
    }
  }
  console.log(`Xong: gan ${created}/${owners.length} chu shop vao goi Starter (dung thu ${TRIAL_DAYS} ngay).`);
}

main()
  .catch((err) => {
    console.error("LOI:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
