// ============================================================
// ĐIỀN GIÁ VỐN KHO ĐANG TRỐNG TỪ GIÁ GIAN — dữ liệu CŨ, chạy tay một lần (lát A, 27/11/2026,
// docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 15.6).
//
// Sản phẩm kho đã nối đang giá vốn 0 mà các SKU sàn đã nối có giá riêng CHUNG MỘT MỨC → giá kho nhận mức đó
// (lib/cost-price liftShopCostToEmptyWarehouseIn — cùng luật với lúc khách nhập giá ở trang Cấu hình Giá vốn).
// Các gian lệch giá nhau thì bỏ qua. Giá riêng của gian không đổi. Chạy lại không sao: chỉ đụng sản phẩm còn giá 0.
//
// Đo prod 27/11: 24.583 sản phẩm / 21 chủ shop sẽ được điền; 88 SKU sàn cùng sản phẩm đang trống giá sẽ theo giá
// kho mới (không cái nào đang bán, 0 dòng đơn trong 30 ngày). Mỗi sản phẩm đổi giá kích trigger sổ cái
// order_ledger_on_product_cost (đơn kiểu cũ không có dòng hàng) → đi theo lô nhỏ, có nghỉ.
//
// Cách chạy (trong thư mục backend):
//   npx tsx scripts/lift-warehouse-cost.ts          # CHỈ ĐẾM theo chủ shop, không ghi gì
//   npx tsx scripts/lift-warehouse-cost.ts run      # ghi theo lô
// Biến môi trường: LIFT_BATCH (mặc định 500 sản phẩm / lô), LIFT_PAUSE_MS (mặc định 3000).
// ============================================================
import { prisma } from "../src/lib/prisma";
import { backfillOrderLinesByProducts, invalidateOwnerCostCaches, liftShopCostToEmptyWarehouseIn } from "../src/lib/cost-price";

const BATCH = Math.max(1, Math.min(2000, Number(process.env.LIFT_BATCH) || 500));
const PAUSE_MS = Math.max(0, Number(process.env.LIFT_PAUSE_MS) || 3000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const run = process.argv[2] === "run";
  // Ứng viên: sản phẩm kho giá 0 có ít nhất một SKU sàn đã nối mang giá riêng. Lọc "chung một mức" do câu UPDATE lo.
  const candidates = await prisma.$queryRaw<{ id: string; userId: string }[]>`
    SELECT p."id", p."userId"
    FROM "Product" AS p
    WHERE p."costPrice" = 0
      AND EXISTS (SELECT 1 FROM "ChannelProduct" AS cp WHERE cp."productId" = p."id" AND cp."costPrice" > 0)
    ORDER BY p."userId", p."id"`;
  const byOwner = new Map<string, string[]>();
  for (const c of candidates) {
    const ids = byOwner.get(c.userId);
    if (ids) ids.push(c.id);
    else byOwner.set(c.userId, [c.id]);
  }
  console.log(`[lift-cost] ${candidates.length} sản phẩm kho ứng viên / ${byOwner.size} chủ shop — ${run ? `GHI, lô ${BATCH}, nghỉ ${PAUSE_MS} ms` : "CHỈ ĐẾM"}`);

  let lifted = 0;
  let backfilled = 0;
  for (const [ownerId, ids] of byOwner) {
    if (!run) {
      console.log(`[lift-cost] chủ shop ${ownerId}: ${ids.length} ứng viên`);
      continue;
    }
    let ownerLifted = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const filled = await liftShopCostToEmptyWarehouseIn(prisma, { productIds: ids.slice(i, i + BATCH) }, ownerId);
      ownerLifted += filled.length;
      // SKU sàn khác cùng sản phẩm đang trống giá nay theo giá kho → vá dòng đơn còn 0 của chúng.
      if (filled.length > 0) backfilled += await backfillOrderLinesByProducts(prisma, filled, ownerId);
      if (PAUSE_MS > 0) await sleep(PAUSE_MS);
    }
    if (ownerLifted > 0) await invalidateOwnerCostCaches(ownerId);
    lifted += ownerLifted;
    console.log(`[lift-cost] chủ shop ${ownerId}: điền ${ownerLifted}/${ids.length} sản phẩm`);
  }
  if (run) console.log(`[lift-cost] xong: điền ${lifted} sản phẩm kho, vá ${backfilled} dòng đơn cũ còn 0`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
