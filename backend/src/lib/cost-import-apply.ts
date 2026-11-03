import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  backfillOrderLinesByChannelProducts,
  backfillOrderLinesByProducts,
  invalidateOwnerCostCaches,
} from "./cost-price";

type Db = Prisma.TransactionClient;
export type CostImportPlan = { productCost: Map<string, number>; shopCost: Map<string, number> };

/**
 * GHI GIÁ CỦA CẢ FILE EXCEL TRONG MỘT CÂU MỖI BẢNG (03/11/2026). Trọn gói trong giao dịch của nơi gọi. Chỉ ghi
 * dòng thuộc chủ shop; trả về id đã ghi để lượt vá đơn không chạm dòng của người khác.
 */
export async function writeCostImportPlan(
  db: Db,
  plan: CostImportPlan,
  ownerId: string
): Promise<{ productIds: string[]; channelProductIds: string[] }> {
  let productIds: string[] = [];
  let channelProductIds: string[] = [];
  if (plan.productCost.size > 0) {
    const ids = [...plan.productCost.keys()];
    const costs = ids.map((id) => plan.productCost.get(id)!);
    const rows = await db.$queryRaw<{ id: string }[]>`
      UPDATE "Product" AS p
      SET "costPrice" = v.cost
      FROM unnest(${ids}::text[], ${costs}::numeric[]) AS v(id, cost)
      WHERE p."id" = v.id AND p."userId" = ${ownerId}
      RETURNING p."id"`;
    productIds = rows.map((r) => r.id);
  }
  if (plan.shopCost.size > 0) {
    const ids = [...plan.shopCost.keys()];
    const costs = ids.map((id) => plan.shopCost.get(id)!);
    const rows = await db.$queryRaw<{ id: string }[]>`
      UPDATE "ChannelProduct" AS cp
      SET "costPrice" = v.cost, "costPriceInheritedAt" = NULL
      FROM unnest(${ids}::text[], ${costs}::numeric[]) AS v(id, cost), "Channel" AS c
      WHERE cp."id" = v.id AND c."id" = cp."channelId" AND c."userId" = ${ownerId}
      RETURNING cp."id"`;
    channelProductIds = rows.map((r) => r.id);
  }
  return { productIds, channelProductIds };
}

/**
 * Vá đơn cũ cho các id vừa ghi, mỗi loại MỘT câu: hai câu vá đọc giá ngay từ bảng nên không cần gọi theo từng mức
 * giá. Giá kho trước, giá riêng của gian sau (vá theo kho bỏ qua dòng có giá riêng, lượt gian vá đúng giá gian).
 */
export async function backfillCostImport(
  db: Parameters<typeof backfillOrderLinesByProducts>[0],
  written: { productIds: string[]; channelProductIds: string[] },
  ownerId: string
): Promise<number> {
  const byProduct = await backfillOrderLinesByProducts(db, written.productIds, ownerId);
  const byChannel = await backfillOrderLinesByChannelProducts(db, written.channelProductIds);
  return byProduct + byChannel;
}

/**
 * Lưu giá rồi vá đơn cũ. Giá của khách lưu trọn gói trước: hoặc cập nhật hết, hoặc không đổi gì. Vá đơn chạy sau
 * khi đã lưu, vá lỗi cũng không làm mất giá vừa nhập; lượt kéo danh mục của gian sẽ vá lại.
 */
export async function saveCostPlan(
  plan: CostImportPlan,
  ownerId: string
): Promise<{ updated: number; backfilled: number }> {
  const written = await prisma.$transaction((tx) => writeCostImportPlan(tx, plan, ownerId), {
    timeout: 30_000,
    maxWait: 10_000,
  });
  let backfilled = 0;
  try {
    backfilled = await backfillCostImport(prisma, written, ownerId);
  } catch (e) {
    console.error(`[cost-save] chủ shop ${ownerId}: đã lưu giá, vá đơn cũ lỗi: ${(e as Error).message}`);
  }
  await invalidateOwnerCostCaches(ownerId);
  return { updated: written.productIds.length + written.channelProductIds.length, backfilled };
}
