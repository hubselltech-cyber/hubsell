// ============================================================
// ĐIỀN 3 CỘT "TRÊN GIỎ" SHOPEE CHO ĐƠN CŨ TỪ SNAPSHOT ESCROW ĐÃ LƯU (lát 4, 29/10/2026)
//
// Order.shopeeOriginalPrice / shopeeSellerDiscount / shopeeBundleDiscount được
// mapper ghi cho đơn đồng bộ SAU deploy; đơn cũ đã có Order.expectedIncome (JSON
// nguyên văn order_income của get_escrow_detail, ghi mỗi lần ước tính) → chép ba
// trường sang cột, không gọi sàn. Chạy ở bảo trì khởi động của worker sổ cái:
// theo từng NGÀY tạo đơn (đi chỉ mục createdAt), nghỉ giữa các ngày có dòng để
// không dồn IO (sự cố Disk IO 28/10). Idempotent: chỉ dòng còn NULL.
// Ba cột này KHÔNG nằm trong WHEN của trigger sổ cái → UPDATE không đánh bẩn sổ.
// Đơn hủy bỏ qua (escrow đơn hủy rỗng/sai — bảng đọc từ OrderItem.originalPrice).
// ============================================================

import { prisma } from "../lib/prisma";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY_MS = 86_400_000;

export async function backfillShopeeEscrowColumns(
  opts: { daysBack?: number; pauseMs?: number; log?: (msg: string) => void } = {}
): Promise<{ days: number; updated: number }> {
  const daysBack = Math.max(1, Math.min(400, opts.daysBack ?? 150));
  const pauseMs = opts.pauseMs ?? 800;
  const log = opts.log ?? ((m) => console.log(m));
  let updated = 0;
  let daysTouched = 0;
  const now = Date.now();
  for (let d = 0; d < daysBack; d++) {
    const to = new Date(now - d * DAY_MS);
    const from = new Date(to.getTime() - DAY_MS);
    const n = await prisma.$executeRaw`
      UPDATE "Order"
      SET "shopeeOriginalPrice" = ("expectedIncome"->>'order_original_price')::numeric,
          "shopeeSellerDiscount" = NULLIF("expectedIncome"->>'order_seller_discount', '')::numeric,
          "shopeeBundleDiscount" = CASE
            WHEN "expectedIncome" ? 'order_selling_price' AND "expectedIncome" ? 'order_discounted_price'
            THEN ("expectedIncome"->>'order_selling_price')::numeric - ("expectedIncome"->>'order_discounted_price')::numeric
          END
      WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
        AND "shopeeOriginalPrice" IS NULL
        AND "expectedIncome" ? 'order_original_price'
        AND "shippingStatus" <> 'CANCELLED'
    `;
    if (n > 0) {
      updated += n;
      daysTouched++;
      await sleep(pauseMs);
    }
  }
  if (updated > 0) {
    log(`[Ledger] Điền cột giá gốc/giảm giá SP/combo Shopee từ snapshot escrow: ${updated} đơn, ${daysTouched} ngày có dòng`);
  }
  return { days: daysTouched, updated };
}
