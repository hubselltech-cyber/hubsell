// ============================================================
// DANH SÁCH ĐƠN — bộ lọc dùng chung + lấy trang "đơn thường" theo TỪNG GIAN (25/11/2026)
//
// Vì sao có tệp này (docs/DONG-BO-GIAI-DOAN-3.md mục 8.9–8.10):
//   Câu cũ của GET /api/orders lọc gian qua quan hệ `channel: { userId }` rồi
//   `ORDER BY createdAt DESC LIMIT 20`. Postgres không biết shop có bao nhiêu đơn
//   (ước 3.133 dòng cho MỌI shop) nên chọn đi lùi chỉ mục "Order_createdAt_idx" của
//   CẢ BẢNG (mọi shop) và lọc dần cho tới khi đủ 20 dòng. Shop càng ít đơn mới thì
//   càng phải lội qua đơn của shop khác; shop nhỏ gần như quét hết bảng.
//   Đo prod 25/11/2026 (pg_stat_statements từ 12/10): 2.339 lượt, 232 MB đọc đĩa /
//   lượt, TB 14,2 giây, lâu nhất 110 giây — góp phần làm cạn Disk IO của Supabase.
//
// Cách mới: với MỖI gian trong phạm vi, lấy (skip + take) đơn mới nhất qua chỉ mục
//   "Order_channelId_createdAt_idx" (LATERAL), rồi trộn và cắt trang ngay trong
//   database. Kế hoạch chạy không phụ thuộc thống kê; số dòng chạm = số gian ×
//   (skip + take). Đo prod cùng lúc đĩa đang bị bóp: shop 4 gian 62 ms / 129 trang đệm.
//
// Bộ lọc viết HAI lần (mảnh `where` Prisma cho các câu đếm + mảnh SQL cho câu trên),
// cả hai dựng từ CÙNG một OrderListFilters. Test db so id hai đường trên mọi tổ hợp
// lọc (order-list-db.test.ts) — sửa một bên phải sửa bên kia.
// ============================================================

import { Carrier, Prisma, ReturnStatus, ShippingStatus } from "@prisma/client";
import type { ChannelScope } from "../lib/channel-filter";
import { prisma } from "../lib/prisma";
import { EXPRESS_KEYWORDS, expressShippingWhere, notExpressShippingWhere } from "./shipping";

/** Trạng thái còn nằm trong tay shop — đơn hỏa tốc ở các trạng thái này được ghim đầu bảng. */
export const PINNED_STATUSES = [ShippingStatus.PENDING, ShippingStatus.PROCESSED];

export interface OrderListFilters {
  shippingStatus: ShippingStatus | null;
  /** Chỉ đơn khách đang xin hủy chờ shop quyết. */
  cancelRequested: boolean;
  /** "EXPRESS" = nhóm hỏa tốc mọi sàn (so tên hãng nguyên văn). */
  carrier: "EXPRESS" | Carrier | null;
  /** Bộ lọc con của tab Đã xử lý: chưa in / đã in chưa gói / đã đóng gói. */
  printed: "yes" | "no" | "packed" | null;
  orderType: "single" | "multi" | null;
  returnStatus: ReturnStatus | null;
  search: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Đọc bộ lọc của màn Đơn hàng từ query; giá trị lạ thì coi như không lọc. */
export function parseOrderListFilters(query: Record<string, unknown>): OrderListFilters {
  const shippingStatus = str(query.shippingStatus);
  const carrier = str(query.carrier);
  const printed = str(query.printed);
  const orderType = str(query.orderType);
  const returnStatus = str(query.returnStatus);
  return {
    shippingStatus: (Object.values(ShippingStatus) as string[]).includes(shippingStatus)
      ? (shippingStatus as ShippingStatus)
      : null,
    cancelRequested: query.cancelRequested === "1" || query.cancelRequested === "true",
    carrier:
      carrier === "EXPRESS"
        ? "EXPRESS"
        : (Object.values(Carrier) as string[]).includes(carrier)
          ? (carrier as Carrier)
          : null,
    printed: printed === "yes" || printed === "no" || printed === "packed" ? printed : null,
    orderType: orderType === "single" || orderType === "multi" ? orderType : null,
    returnStatus: (Object.values(ReturnStatus) as string[]).includes(returnStatus)
      ? (returnStatus as ReturnStatus)
      : null,
    search: str(query.search).trim(),
  };
}

/** Số điện thoại trong ô tìm: bỏ dấu cách / chấm / gạch để "0901 234 567" khớp "0901234567". */
function phoneNeedle(search: string): string {
  return search.replace(/[\s.-]/g, "");
}

/**
 * Mảnh `where` Prisma của màn Đơn hàng — dùng cho danh sách, các câu đếm tab và
 * GET /stats để mọi nơi cùng phạm vi.
 */
export function orderListWhere(scope: ChannelScope, f: OrderListFilters): Prisma.OrderWhereInput {
  return {
    channel: scope,
    ...(f.shippingStatus ? { shippingStatus: f.shippingStatus } : {}),
    ...(f.cancelRequested ? { cancelRequestedAt: { not: null } } : {}),
    // "EXPRESS" = nhóm HỎA TỐC mọi sàn (anh Trung 08/09): lọc theo tên hãng
    // nguyên văn qua expressShippingWhere — cùng luật với badge ⚡ và ghim đầu bảng.
    ...(f.carrier === "EXPRESS" ? expressShippingWhere() : f.carrier ? { carrier: f.carrier } : {}),
    // 01/11/2026 thêm nấc "packed" (Đã đóng gói — quét sau in): "yes" nay là
    // ĐÃ IN NHƯNG CHƯA ĐÓNG GÓI để ba chip con nối nhau thành dây chuyền
    // Chưa in → Đã in → Đã đóng gói; seller không dùng bước quét thì
    // packingDoneAt luôn null, chip "Đã in" vẫn như trước.
    ...(f.printed === "yes"
      ? { labelPrintedAt: { not: null }, packingDoneAt: null }
      : f.printed === "no"
        ? { labelPrintedAt: null }
        : f.printed === "packed"
          ? { packingDoneAt: { not: null } }
          : {}),
    // Đơn cũ chưa ghi chi tiết dòng hàng có itemCount = 0, cố ý KHÔNG rơi vào
    // nhóm nào — không biết đơn gồm mấy mặt hàng thì đừng đoán bừa cho kho.
    ...(f.orderType === "single" ? { itemCount: 1 } : f.orderType === "multi" ? { itemCount: { gt: 1 } } : {}),
    ...(f.returnStatus ? { returnStatus: f.returnStatus } : {}),
    // Ô tìm kiếm đa năng: gõ gì cũng ra — mã đơn, tên khách, số điện thoại
    // hoặc mã vận đơn (chiều đi lẫn chiều hoàn — kho gõ vài số cuối trên tem hoàn cũng ra, 04/10).
    ...(f.search
      ? {
          OR: [
            { orderCode: { contains: f.search, mode: "insensitive" as const } },
            { customerName: { contains: f.search, mode: "insensitive" as const } },
            { customerPhone: { contains: phoneNeedle(f.search) } },
            { trackingCode: { contains: f.search, mode: "insensitive" as const } },
            { returnTrackingCode: { contains: f.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

/**
 * Mẫu LIKE "có chứa" giống hệt cách Prisma dịch `contains`: bọc %…% và KHÔNG thoát % _ \
 * (kiểm bằng test db 25/11/2026: gõ "100%" thì Prisma khớp mọi chuỗi có "100"). Giữ y như vậy để
 * danh sách và các câu đếm tab — vẫn đi đường Prisma — không lệch nhau.
 */
function containsPattern(needle: string): string {
  return `%${needle}%`;
}

/** Tên hãng có chứa một từ khóa hỏa tốc — bản SQL của expressShippingWhere(). */
function expressSql(o: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${Prisma.join(
    EXPRESS_KEYWORDS.map((k) => Prisma.sql`${o}."shippingCarrierName" ILIKE ${containsPattern(k)}`),
    " OR "
  )})`;
}

/** Phần bù tường minh (tên hãng NULL vẫn tính là không hỏa tốc) — bản SQL của notExpressShippingWhere(). */
function notExpressSql(o: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${o}."shippingCarrierName" IS NULL OR (${Prisma.join(
    EXPRESS_KEYWORDS.map((k) => Prisma.sql`NOT ${o}."shippingCarrierName" ILIKE ${containsPattern(k)}`),
    " AND "
  )}))`;
}

/** Bản SQL của orderListWhere() — KHÔNG gồm phạm vi gian (câu gọi tự nối theo "channelId"). */
export function orderListFilterSql(f: OrderListFilters, alias = "o"): Prisma.Sql {
  const o = Prisma.raw(alias);
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.shippingStatus) conds.push(Prisma.sql`${o}."shippingStatus" = ${f.shippingStatus}::"ShippingStatus"`);
  if (f.cancelRequested) conds.push(Prisma.sql`${o}."cancelRequestedAt" IS NOT NULL`);
  if (f.carrier === "EXPRESS") conds.push(expressSql(o));
  else if (f.carrier) conds.push(Prisma.sql`${o}."carrier" = ${f.carrier}::"Carrier"`);
  if (f.printed === "yes") conds.push(Prisma.sql`${o}."labelPrintedAt" IS NOT NULL AND ${o}."packingDoneAt" IS NULL`);
  else if (f.printed === "no") conds.push(Prisma.sql`${o}."labelPrintedAt" IS NULL`);
  else if (f.printed === "packed") conds.push(Prisma.sql`${o}."packingDoneAt" IS NOT NULL`);
  if (f.orderType === "single") conds.push(Prisma.sql`${o}."itemCount" = 1`);
  else if (f.orderType === "multi") conds.push(Prisma.sql`${o}."itemCount" > 1`);
  if (f.returnStatus) conds.push(Prisma.sql`${o}."returnStatus" = ${f.returnStatus}::"ReturnStatus"`);
  if (f.search) {
    const p = containsPattern(f.search);
    conds.push(Prisma.sql`(
      ${o}."orderCode" ILIKE ${p}
      OR ${o}."customerName" ILIKE ${p}
      OR ${o}."customerPhone" LIKE ${containsPattern(phoneNeedle(f.search))}
      OR ${o}."trackingCode" ILIKE ${p}
      OR ${o}."returnTrackingCode" ILIKE ${p}
    )`);
  }
  return Prisma.join(conds, " AND ");
}

/**
 * Đơn GHIM đầu bảng: khách đang xin hủy (mọi tab) hoặc hỏa tốc còn trong tay shop.
 * Trả mảnh `where` Prisma đã gộp bộ lọc chung.
 */
export function pinnedOrderWhere(where: Prisma.OrderWhereInput): Prisma.OrderWhereInput {
  return {
    AND: [
      where,
      {
        OR: [
          { cancelRequestedAt: { not: null } },
          { AND: [{ shippingStatus: { in: PINNED_STATUSES } }, expressShippingWhere()] },
        ],
      },
    ],
  };
}

/** Phần bù của nhóm ghim: không xin hủy VÀ (đã bàn giao trở đi hoặc không hỏa tốc, kể cả chưa có tên hãng). */
export function restOrderWhere(where: Prisma.OrderWhereInput): Prisma.OrderWhereInput {
  return {
    AND: [
      where,
      { cancelRequestedAt: null },
      { OR: [{ shippingStatus: { notIn: PINNED_STATUSES } }, notExpressShippingWhere()] },
    ],
  };
}

/** Bản SQL của điều kiện riêng nhóm "đơn thường" trong restOrderWhere(). */
function restOrderSql(alias = "o"): Prisma.Sql {
  const o = Prisma.raw(alias);
  return Prisma.sql`${o}."cancelRequestedAt" IS NULL AND (
    ${o}."shippingStatus" NOT IN (${Prisma.join(PINNED_STATUSES.map((s) => Prisma.sql`${s}::"ShippingStatus"`))})
    OR ${notExpressSql(o)}
  )`;
}

/** Các gian trong tầm nhìn — bản SQL của ChannelScope (chủ shop, gian được phân công, lọc theo sàn). */
function scopeChannelsSql(scope: ChannelScope): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`c."userId" = ${scope.userId}`];
  if (typeof scope.id === "string") conds.push(Prisma.sql`c."id" = ${scope.id}`);
  else if (scope.id) conds.push(Prisma.sql`c."id" = ANY(${scope.id.in}::text[])`);
  if (scope.channelName) conds.push(Prisma.sql`c."channelName" = ${scope.channelName}::"ChannelName"`);
  return Prisma.sql`SELECT c."id" FROM "Channel" c WHERE ${Prisma.join(conds, " AND ")}`;
}

/**
 * Id của một trang "đơn thường" (không ghim), mới nhất trước, đã bỏ `skip` dòng đầu.
 *
 * Mỗi gian tự lấy (skip + take) đơn mới nhất qua "Order_channelId_createdAt_idx" rồi database trộn
 * và cắt trang — tiến trình web chỉ nhận đúng `take` id. Thứ tự: ngày sàn giảm dần, trùng giây thì
 * theo id giảm dần (bản cũ không có luật trùng giây nên hai trang liền nhau có thể lặp / sót đơn).
 *
 * Trang sâu vẫn tốn theo skip (số gian × (skip + take) dòng chỉ mục), nhưng luôn nằm trong đơn của
 * chính shop, không bao giờ lan sang đơn shop khác.
 */
export async function restOrderIdsPage(
  scope: ChannelScope,
  f: OrderListFilters,
  skip: number,
  take: number
): Promise<string[]> {
  const s = Math.max(0, Math.floor(skip));
  const t = Math.max(0, Math.floor(take));
  if (t === 0) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT t."id"
    FROM (${scopeChannelsSql(scope)}) ch
    CROSS JOIN LATERAL (
      SELECT o."id", o."createdAt"
      FROM "Order" o
      WHERE o."channelId" = ch."id"
        AND ${orderListFilterSql(f, "o")}
        AND ${restOrderSql("o")}
      ORDER BY o."createdAt" DESC, o."id" DESC
      LIMIT ${s + t}::int
    ) t
    ORDER BY t."createdAt" DESC, t."id" DESC
    OFFSET ${s}::int
    LIMIT ${t}::int
  `);
  return rows.map((r) => r.id);
}
