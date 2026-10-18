// ============================================================
// SỬA MỘT LẦN: LÁ TÁCH 15/10 NHẬN LẠI GIÁ VỐN KHÁCH ĐÃ ĐẶT CHO MÃ — Lát 3
// (18/10/2026, docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 8)
//
// Trước 15/10 một mã người bán = một dòng, khách đặt giá vốn cho MÃ và mọi phân
// loại bán dưới mã đó chụp giá ấy. Bản tách 15/10 giữ giá cho một lá (dòng gộp cũ
// đổi khóa tại chỗ), các lá còn lại tạo mới với giá trống → đơn mới chụp giá 0,
// hòa vốn tính thiếu. Đây là Hubsell tự ý bỏ một giá khách đã đặt, không phải
// khách quên nhập → trả lại đúng giá đó cho các lá bị tách. Anh Trung chốt 18/10:
//   · chỉ theo LỊCH SỬ khách đã đặt cho CÙNG MÃ THÔ — không suy từ tên, không bịa;
//   · nhiều nguồn có giá thì phải CÙNG giá, khác giá là bỏ qua nhóm (không đoán);
//   · chỉ SỬA MỘT LẦN cho lá do bản 15/10 tách (tạo 15/10 → ngày deploy lát này);
//     phân loại khách thêm về sau khách tự nhập (đã có cơ chế nhắc giá vốn);
//   · không nối kho hộ; không ghi đè số khách đã nhập; không nhắc thêm gì.
// ============================================================

import { Prisma } from "@prisma/client";
import { backfillOrderLinesByChannelProducts, invalidateOwnerCostCaches } from "../lib/cost-price";
import { prisma } from "../lib/prisma";
import { timestampConst } from "./order-ledger";

/** Cửa sổ "lá do bản 15/10 tách ra": tạo từ ngày deploy bản tách tới ngày deploy lát này. Lá tạo sau đó là của khách. */
export const SPLIT_LEAF_CREATED_FROM = new Date("2026-10-15T00:00:00+07:00");
export const SPLIT_LEAF_CREATED_TO = new Date("2026-10-19T00:00:00+07:00");

/**
 * Giá vốn thừa kế của một nhóm lá cùng mã thô: mọi lá CÓ giá hiệu lực phải cùng một giá → trả giá đó; không lá nào có
 * giá, hoặc có hai giá khác nhau (khách đã cố ý đặt khác) → null. Thuần.
 */
export function inheritedCostOf(siblings: { effectiveCost: number }[]): number | null {
  const costs = new Set(siblings.map((s) => s.effectiveCost).filter((c) => c > 0));
  if (costs.size !== 1) return null;
  return [...costs][0];
}

/**
 * HOÀN TÁC lá nhận giá thừa kế OAN (lượt prod 18/10 13:18 gom chỉ theo mã: 3.489 lá của SẢN PHẨM KHÁC, tên khác, trùng mã người bán
 * nhận giá của sản phẩm nguồn — sai ý anh Trung). Lá "oan" = đang mang dấu thừa kế mà trong cùng (gian, mã thô, SPU) KHÔNG có lá
 * nguồn nào do khách đặt giá. Trả về đúng trạng thái trước lượt sửa: (1) dòng đơn của lá đó tạo từ 15/10 đang mang ĐÚNG giá thừa kế
 * (chỉ lượt vá mới đặt được — trước đó lá không có giá nên dòng chụp 0) → về 0; (2) lá → costPrice NULL, dấu NULL.
 * Idempotent; lá đã được khách sửa tay (dấu NULL) không bị chạm. Chạy TRƯỚC repairSplitLeafCosts ở mỗi lần khởi động.
 */
export async function revertCrossProductInheritance(opts: { channelId?: string } = {}): Promise<{ leaves: number; orderLines: number }> {
  const channelFilter = opts.channelId ? Prisma.sql`AND cp."channelId" = ${opts.channelId}` : Prisma.empty;
  const bad = await prisma.$queryRaw<{ id: string; channelId: string; externalId: string | null; channelSku: string; cost: string }[]>`
    WITH leaf AS (
      SELECT cp."id", cp."channelId", cp."channelSku", cp."externalId", cp."costPrice", cp."costPriceInheritedAt",
             regexp_replace(regexp_replace(cp."channelSku", '\\s\\(.*\\)(\\s#\\S+)?$', ''), '\\s#\\S+$', '') AS base,
             split_part(cp."externalId", '-', 1) AS spu,
             COALESCE(NULLIF(cp."costPrice", 0), p."costPrice", 0) AS cost
      FROM "ChannelProduct" cp
      LEFT JOIN "Product" p ON p."id" = cp."productId"
      WHERE cp."channelSku" ~ '\\s(\\(.*\\)|#\\S+)$' ${channelFilter}
    )
    SELECT i."id", i."channelId", i."externalId", i."channelSku", i."costPrice"::text AS cost
    FROM leaf i
    WHERE i."costPriceInheritedAt" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM leaf s
        WHERE s."channelId" = i."channelId" AND s.base = i.base AND s.spu = i.spu
          AND s."costPriceInheritedAt" IS NULL AND s.cost > 0
      )`;
  if (bad.length === 0) return { leaves: 0, orderLines: 0 };
  let orderLines = 0;
  for (const b of bad) {
    const cost = Number(b.cost);
    const r = await prisma.$executeRaw`
      UPDATE "OrderItem" oi
      SET "costPriceAtSale" = 0
      FROM "Order" o
      WHERE oi."orderId" = o."id"
        AND o."channelId" = ${b.channelId}
        AND o."createdAt" >= ${timestampConst(SPLIT_LEAF_CREATED_FROM)}
        AND oi."costPriceAtSale" = ${cost}
        AND (
          (oi."externalId" IS NOT NULL AND oi."externalId" = ${b.externalId})
          OR (oi."externalId" IS NULL AND oi."channelSku" = ${b.channelSku})
        )`;
    orderLines += r;
  }
  await prisma.channelProduct.updateMany({
    where: { id: { in: bad.map((b) => b.id) } },
    data: { costPrice: null, costPriceInheritedAt: null },
  });
  const owners = await prisma.channel.findMany({ where: { id: { in: [...new Set(bad.map((b) => b.channelId))] } }, select: { userId: true } });
  for (const ownerId of new Set(owners.map((o) => o.userId))) await invalidateOwnerCostCaches(ownerId);
  return { leaves: bad.length, orderLines };
}

export interface SplitRepairResult {
  /** Lá nhận giá thừa kế. */
  leaves: number;
  /** Dòng đơn giá vốn 0 của các lá đó được vá. */
  orderLines: number;
  /** Số gian có lá nhận giá (để xóa đệm). */
  channels: number;
}

/**
 * Chạy MỘT LƯỢT cho toàn nền tảng (idempotent: lá đã có giá không còn là đích; cửa sổ tạo cố định nên lá mới của khách không
 * bao giờ lọt). Nhóm = (gian, mã thô) trên lá ACTIVE có khóa đuôi phân loại; nguồn = lá có giá hiệu lực do khách đặt (giá riêng
 * gian hoặc giá kho qua liên kết); đích = lá giá trống, chưa nối kho, tạo trong cửa sổ tách. Nguồn dùng giá kho thì chép xuống
 * thành giá riêng của gian cho lá đích (không nối kho — tiền lệ keepCostOnDetach).
 */
export async function repairSplitLeafCosts(opts: { channelId?: string } = {}): Promise<SplitRepairResult> {
  const channelFilter = opts.channelId ? Prisma.sql`AND cp."channelId" = ${opts.channelId}` : Prisma.empty;
  const updated = await prisma.$queryRaw<{ id: string; channelId: string; userId: string }[]>`
    WITH leaf AS (
      SELECT cp."id", cp."channelId", cp."productId", cp."createdAt",
             -- (trong template literal TS phải viết \\s để Postgres nhận \s — bẫy 18/10: '\s' thành 's', regexp im lặng không khớp)
             regexp_replace(regexp_replace(cp."channelSku", '\\s\\(.*\\)(\\s#\\S+)?$', ''), '\\s#\\S+$', '') AS base,
             split_part(cp."externalId", '-', 1) AS spu,
             COALESCE(NULLIF(cp."costPrice", 0), p."costPrice", 0) AS cost
      FROM "ChannelProduct" cp
      LEFT JOIN "Product" p ON p."id" = cp."productId"
      WHERE cp.status = 'ACTIVE'
        AND cp."channelSku" ~ '\\s(\\(.*\\)|#\\S+)$'
        AND cp."externalId" IS NOT NULL
        ${channelFilter}
    ),
    src AS (
      -- Nguồn: lá có giá hiệu lực CÙNG SẢN PHẨM SÀN (gian, mã thô, SPU) — không mang giá sang sản phẩm khác dù trùng mã
      -- (prod 18/10 lượt đầu gom chỉ theo mã: 3.489 lá của sản phẩm khác, tên khác nhận giá — sai ý anh Trung, đã hoàn tác).
      -- Nhóm chỉ hợp lệ khi MỌI nguồn cùng một giá.
      SELECT "channelId", base, spu, min(cost) AS cost
      FROM leaf WHERE cost > 0
      GROUP BY "channelId", base, spu
      HAVING count(DISTINCT cost) = 1
    ),
    target AS (
      SELECT l."id", l."channelId", s.cost
      FROM leaf l
      JOIN src s ON s."channelId" = l."channelId" AND s.base = l.base AND s.spu = l.spu
      WHERE l.cost = 0
        AND l."productId" IS NULL
        -- Mốc so bằng hằng UTC (timestampConst): so Date tham số thẳng với cột timestamp(3) lệch theo TimeZone phiên (bẫy Lát 2).
        AND l."createdAt" >= ${timestampConst(SPLIT_LEAF_CREATED_FROM)}
        AND l."createdAt" < ${timestampConst(SPLIT_LEAF_CREATED_TO)}
    )
    UPDATE "ChannelProduct" cp
    SET "costPrice" = t.cost, "costPriceInheritedAt" = now()
    FROM target t, "Channel" c
    WHERE cp."id" = t."id" AND c."id" = cp."channelId"
      AND COALESCE(cp."costPrice", 0) = 0
    RETURNING cp."id", cp."channelId", c."userId"`;
  if (updated.length === 0) return { leaves: 0, orderLines: 0, channels: 0 };

  // Vá dòng đơn giá vốn 0 của đúng các lá vừa nhận giá (đường vá id trước của Lát 1c), theo lô.
  let orderLines = 0;
  const ids = updated.map((u) => u.id);
  for (let i = 0; i < ids.length; i += 200) {
    orderLines += await backfillOrderLinesByChannelProducts(prisma, ids.slice(i, i + 200));
  }
  const owners = [...new Set(updated.map((u) => u.userId))];
  for (const ownerId of owners) await invalidateOwnerCostCaches(ownerId);
  return { leaves: updated.length, orderLines, channels: new Set(updated.map((u) => u.channelId)).size };
}
