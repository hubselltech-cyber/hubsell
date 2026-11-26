// ============================================================
// VIDEO ĐÓNG HÀNG — đọc sổ cho trang web /orders/videos
// (danh sách · số trên chip · hồ sơ một đơn · đường dẫn xem / tải · cờ "đơn có video" ·
//  danh sách đơn hoàn · thống kê)
//
// HAI LUẬT không ngoại lệ:
//  1. Mọi câu truy vấn mang `ownerId` lấy từ PHIÊN ĐĂNG NHẬP (PackVideoScope) — không hàm nào nhận
//     chủ shop từ tham số của người gọi API (rào S1).
//  2. Chỉ ĐỌC bảng Order, đúng số dòng của trang đang xem; không gọi sàn, không ghi gì vào Order.
// Nhân viên bị giới hạn gian (allowedChannelIds) chỉ thấy video của gian mình và không thấy video
// chưa khớp đơn — bản thí điểm nhân viên chưa vào được, luật này cài sẵn cho lúc mở.
//
// Thống kê cộng thẳng từ `pack_videos` (bảng gộp theo ngày để lát sau). "Giờ quay" chỉ tính video
// đã STORED: video quay xong mà chưa lên kho thì chưa tính.
// ============================================================

import { Prisma, ReturnStatus } from "@prisma/client";
import { PACK_VIDEO_GET_EXPIRES_SEC, PACK_VIDEO_PAGE_DEFAULT, PACK_VIDEO_PAGE_MAX } from "../../config/pack-video";
import { CANCELLED_AFTER_SHIP } from "../../integrations/cancelled-after-ship";
import { getR2Storage } from "../../integrations/r2/client";
import type { DateRangeFilter } from "../../lib/date-range";
import { complaintDueOf, complaintDueView, type ComplaintDueView } from "../../lib/return-complaint-due";
import { complaintDueSoonSql, complaintDueSql, utcTs } from "../../lib/return-complaint-due-sql";
import { loadVariantNames } from "../../lib/order-line-names";
import { keyBelongsToOwner, packVideoDownloadName } from "../../lib/pack-video-key";
import { escapeLikePrefix, type PackVideoKind, type PackVideoStatus } from "../../lib/pack-video-rules";
import { prisma } from "../../lib/prisma";
import { TEM_ITEM_SELECT, matchOrderForTem } from "./order-match";
import { PackVideoError, type PackVideoDeps } from "./upload";

export interface PackVideoScope {
  ownerId: string;
  /** null = thấy mọi gian (chủ shop); mảng = chỉ các gian này (nhân viên). */
  allowedChannelIds: string[] | null;
}

export const PACK_VIDEO_CHIPS = ["all", "returns", "unmatched", "pending", "expiring"] as const;

/**
 * Chip "Sắp tự xóa": video đã có hạn giữ rơi vào trong vòng 3 ngày tới (kể cả đã tới hạn mà worker chạy bóng
 * chưa xóa). 3 ngày là SỐ TỰ CHỌN — đủ để khách kịp tải về nếu cần, theo luật xóa W5 (thiết kế mục 19.4).
 */
export const PACK_VIDEO_EXPIRING_DAYS = 3;
export type PackVideoChip = (typeof PACK_VIDEO_CHIPS)[number];

export interface PackVideoFilters {
  kind?: PackVideoKind;
  range?: DateRangeFilter;
  channelIds?: string[];
  recordedById?: string;
  q?: string;
}

export interface OrderLineView {
  name: string;
  variantName: string | null;
  quantity: number;
  imageUrl: string | null;
}

export interface PackVideoRow {
  id: string;
  kind: PackVideoKind;
  status: PackVideoStatus;
  trackingCode: string;
  orderId: string | null;
  orderCode: string | null;
  channelId: string | null;
  channelPlatform: string | null;
  shopName: string | null;
  recordedAt: string;
  durationSec: number;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  recordedById: string;
  recordedByName: string | null;
  deviceName: string | null;
  durationFlag: boolean;
  /** Hạn giữ "YYYY-MM-DD" (luật W5) — null = chưa có hạn (đang chờ trạng thái đơn hoặc đang giữ). */
  deleteAfter: string | null;
  /** Lý do đang giữ (RETURN_OPEN / RETURN_DAMAGED / UNBOX_UNMATCHED / PARCEL_RETURNING) — null = không giữ. */
  holdReason: string | null;
  order: {
    shippingStatus: string;
    returnStatus: string;
    hasReturn: boolean;
    items: OrderLineView[];
  } | null;
}

/** Cột đọc từ sổ cho một dòng danh sách. */
interface RawVideo {
  id: string;
  kind: string;
  status: string;
  trackingCode: string;
  orderId: string | null;
  orderCode: string | null;
  channelId: string | null;
  recordedAt: Date;
  durationSec: number;
  sizeBytes: bigint;
  width: number | null;
  height: number | null;
  recordedById: string;
  deviceName: string | null;
  durationFlag: boolean;
  deleteAfter: Date | null;
  holdReason: string | null;
}

const VIDEO_COLUMNS = Prisma.sql`
  v."id", v."kind", v."status", v."trackingCode", v."orderId", v."orderCode", v."channelId",
  v."recordedAt", v."durationSec", v."sizeBytes", v."width", v."height", v."recordedById",
  v."deviceName", v."durationFlag", v."deleteAfter", v."holdReason"`;

/** Hạn giữ rơi vào N ngày tới (theo ngày lịch giờ VN). */
const EXPIRING = Prisma.sql`(v."deleteAfter" IS NOT NULL AND v."status" = 'STORED'
  AND v."deleteAfter" <= ((now() AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date + ${PACK_VIDEO_EXPIRING_DAYS}::int)`;

/** Video còn "sống" với người xem: đã lưu hoặc đang chờ tải. */
const LIVE = Prisma.sql`v."status" IN ('STORED', 'PENDING')`;

const and = (parts: Prisma.Sql[]) => Prisma.join(parts, " AND ");

/** Điều kiện phạm vi: chủ shop + giới hạn gian của nhân viên. */
function scopeConds(scope: PackVideoScope): Prisma.Sql[] {
  const c = [Prisma.sql`v."ownerId" = ${scope.ownerId}`];
  if (scope.allowedChannelIds) {
    c.push(
      scope.allowedChannelIds.length
        ? Prisma.sql`v."channelId" IN (${Prisma.join(scope.allowedChannelIds)})`
        : Prisma.sql`FALSE`
    );
  }
  return c;
}

/**
 * Ô tìm: TIỀN TỐ mã vận đơn; không ra video nào thì coi chuỗi là MÃ ĐƠN (đúng tuyệt đối) — tra
 * Order trước rồi lấy video theo orderId, nên sổ video không cần chỉ mục riêng cho mã đơn.
 */
async function searchCond(scope: PackVideoScope, q: string): Promise<Prisma.Sql> {
  const prefix = Prisma.sql`v."trackingCode" LIKE ${`${escapeLikePrefix(q)}%`}`;
  const hit = await prisma.$queryRaw<{ one: number }[]>(Prisma.sql`
    SELECT 1 AS one FROM "pack_videos" v WHERE ${and([...scopeConds(scope), prefix])} LIMIT 1`);
  if (hit.length > 0) return prefix;
  const orders = await prisma.order.findMany({
    where: { channel: { userId: scope.ownerId }, orderCode: q },
    select: { id: true },
    take: 20,
  });
  if (orders.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`v."orderId" IN (${Prisma.join(orders.map((o) => o.id))})`;
}

async function filterConds(scope: PackVideoScope, f: PackVideoFilters): Promise<Prisma.Sql[]> {
  const c = [...scopeConds(scope), LIVE];
  if (f.kind) c.push(Prisma.sql`v."kind" = ${f.kind}`);
  if (f.range) {
    c.push(Prisma.sql`v."recordedAt" >= ${f.range.gte}::timestamptz`);
    c.push(Prisma.sql`v."recordedAt" <= ${f.range.lte}::timestamptz`);
  }
  if (f.channelIds?.length) c.push(Prisma.sql`v."channelId" IN (${Prisma.join(f.channelIds)})`);
  if (f.recordedById) c.push(Prisma.sql`v."recordedById" = ${f.recordedById}`);
  const q = f.q?.trim().slice(0, 64);
  if (q) c.push(await searchCond(scope, q));
  return c;
}

/** Đơn của video này có phát sinh hoàn (cùng định nghĩa với trang Đối soát đơn hoàn). */
const HAS_RETURN = Prisma.sql`EXISTS (
  SELECT 1 FROM "Order" o WHERE o."id" = v."orderId" AND o."returnStatus" <> 'NONE')`;

function chipCond(chip: PackVideoChip): Prisma.Sql | null {
  if (chip === "returns") return HAS_RETURN;
  if (chip === "unmatched") return Prisma.sql`v."orderId" IS NULL`;
  if (chip === "pending") return Prisma.sql`v."status" = 'PENDING'`;
  if (chip === "expiring") return EXPIRING;
  return null;
}

function encodeCursor(row: { recordedAt: Date; id: string }): string {
  return Buffer.from(`${row.recordedAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime())) return null;
  return { at, id };
}

export function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return PACK_VIDEO_PAGE_DEFAULT;
  return Math.min(n, PACK_VIDEO_PAGE_MAX);
}

/** Ghép thông tin đơn / gian / người quay cho MỘT TRANG video (≤ 100 dòng). */
async function hydrate(scope: PackVideoScope, raws: RawVideo[]): Promise<PackVideoRow[]> {
  if (raws.length === 0) return [];
  const orderIds = [...new Set(raws.map((r) => r.orderId).filter((x): x is string => !!x))];
  const channelIds = [...new Set(raws.map((r) => r.channelId).filter((x): x is string => !!x))];
  const userIds = [...new Set(raws.map((r) => r.recordedById))];

  const orders = orderIds.length
    ? await prisma.order.findMany({
        // Đọc theo khóa chính; kèm chủ shop làm chốt chặn thứ hai.
        where: { id: { in: orderIds }, channel: { userId: scope.ownerId } },
        select: {
          id: true,
          channelId: true,
          shippingStatus: true,
          returnStatus: true,
          items: {
            select: {
              productName: true,
              quantity: true,
              imageUrl: true,
              channelSku: true,
              externalId: true,
              variantName: true,
              product: { select: { imageUrl: true, variantName: true } },
            },
          },
        },
      })
    : [];
  const channels = channelIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: channelIds }, userId: scope.ownerId },
        select: { id: true, channelName: true, shopName: true },
      })
    : [];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, OR: [{ id: scope.ownerId }, { ownerId: scope.ownerId }] },
    select: { id: true, fullName: true, staffUsername: true },
  });
  const variantOf = await loadVariantNames(
    orders.flatMap((o) =>
      o.items.map((i) => ({
        channelId: o.channelId,
        externalId: i.externalId,
        channelSku: i.channelSku,
        productVariantName: i.product?.variantName ?? null,
        variantName: i.variantName,
      }))
    )
  );

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const userById = new Map(users.map((u) => [u.id, u]));

  return raws.map((r) => {
    const o = r.orderId ? orderById.get(r.orderId) : undefined;
    const ch = r.channelId ? channelById.get(r.channelId) : undefined;
    const u = userById.get(r.recordedById);
    return {
      id: r.id,
      kind: r.kind as PackVideoKind,
      status: r.status as PackVideoStatus,
      trackingCode: r.trackingCode,
      orderId: r.orderId,
      orderCode: r.orderCode,
      channelId: r.channelId,
      channelPlatform: ch?.channelName ?? null,
      shopName: ch?.shopName ?? null,
      recordedAt: r.recordedAt.toISOString(),
      durationSec: r.durationSec,
      sizeBytes: Number(r.sizeBytes),
      width: r.width,
      height: r.height,
      recordedById: r.recordedById,
      recordedByName: u ? u.fullName || u.staffUsername || null : null,
      deviceName: r.deviceName,
      durationFlag: r.durationFlag,
      deleteAfter: r.deleteAfter ? r.deleteAfter.toISOString().slice(0, 10) : null,
      holdReason: r.holdReason,
      order: o
        ? {
            shippingStatus: o.shippingStatus,
            returnStatus: o.returnStatus,
            hasReturn: o.returnStatus !== ReturnStatus.NONE,
            items: o.items.map((i) => ({
              name: i.productName,
              variantName:
                variantOf({
                  channelId: o.channelId,
                  externalId: i.externalId,
                  channelSku: i.channelSku,
                  productVariantName: i.product?.variantName ?? null,
                  variantName: i.variantName,
                }) || null,
              quantity: i.quantity,
              imageUrl: i.imageUrl ?? i.product?.imageUrl ?? null,
            })),
          }
        : null,
    };
  });
}

/** Danh sách video, mới nhất trước, phân trang bằng con trỏ (recordedAt, id). */
export async function listVideos(
  scope: PackVideoScope,
  filters: PackVideoFilters,
  page: { chip?: PackVideoChip; cursor?: string; limit?: number }
): Promise<{ items: PackVideoRow[]; nextCursor: string | null }> {
  const limit = clampLimit(page.limit);
  const conds = await filterConds(scope, filters);
  const chip = chipCond(page.chip ?? "all");
  if (chip) conds.push(chip);
  const after = decodeCursor(page.cursor);
  if (after) {
    conds.push(Prisma.sql`(v."recordedAt", v."id") < (${after.at}::timestamptz, ${after.id})`);
  }
  const raws = await prisma.$queryRaw<RawVideo[]>(Prisma.sql`
    SELECT ${VIDEO_COLUMNS}
    FROM "pack_videos" v
    WHERE ${and(conds)}
    ORDER BY v."recordedAt" DESC, v."id" DESC
    LIMIT ${limit + 1}`);
  const pageRows = raws.slice(0, limit);
  return {
    items: await hydrate(scope, pageRows),
    nextCursor: raws.length > limit ? encodeCursor(pageRows[pageRows.length - 1]) : null,
  };
}

/** Một dòng của tab Lịch sử xóa: mã vận đơn + lý do (luật đã xóa) + ngày xóa. */
export interface DeletedVideoRow {
  id: string;
  trackingCode: string;
  kind: PackVideoKind;
  /** L1–L7 (lib/pack-video-retention.ts) hoặc ACCOUNT; web đổi ra câu tiếng Việt. */
  deleteRule: string | null;
  deletedAt: string | null;
}

/**
 * LỊCH SỬ XÓA (anh Trung 25/11/2026: "thêm 1 tab lịch sử xóa kèm lý do — chỉ cần 2 cột là mã vận đơn và cột lý do,
 * thêm thanh tìm kiếm mã vận đơn… khách mà hỏi còn dễ trả lời"). Video hệ thống ĐÃ tự xóa, quay mới nhất trước
 * (đi theo chỉ mục pack_videos_owner_recorded_idx — không sắp theo ngày xóa để khỏi sắp trong bộ nhớ). Ô tìm =
 * mã vận đơn BẮT ĐẦU bằng chuỗi gõ (chỉ mục pack_videos_owner_tracking_idx). Lượt tải dở bị dọn (LOST) không
 * phải video nên không nằm ở đây.
 */
export async function listDeletedVideos(
  scope: PackVideoScope,
  page: { q?: string; cursor?: string; limit?: number }
): Promise<{ items: DeletedVideoRow[]; nextCursor: string | null }> {
  const limit = clampLimit(page.limit);
  const conds = [...scopeConds(scope), Prisma.sql`v."status" = 'DELETED'`];
  const q = page.q?.trim().slice(0, 64);
  if (q) {
    const prefix = `${escapeLikePrefix(q)}%`;
    // Mã vận đơn lưu nguyên như trên tem (thường chữ HOA) — nhận cả khi khách gõ chữ thường.
    conds.push(Prisma.sql`(v."trackingCode" LIKE ${prefix} OR v."trackingCode" LIKE ${prefix.toUpperCase()})`);
  }
  const after = decodeCursor(page.cursor);
  if (after) conds.push(Prisma.sql`(v."recordedAt", v."id") < (${after.at}::timestamptz, ${after.id})`);
  const rows = await prisma.$queryRaw<
    { id: string; trackingCode: string; kind: string; deleteRule: string | null; deletedAt: Date | null; recordedAt: Date }[]
  >(Prisma.sql`
    SELECT v."id", v."trackingCode", v."kind", v."deleteRule", v."deletedAt", v."recordedAt"
    FROM "pack_videos" v
    WHERE ${and(conds)}
    ORDER BY v."recordedAt" DESC, v."id" DESC
    LIMIT ${limit + 1}`);
  const pageRows = rows.slice(0, limit);
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      trackingCode: r.trackingCode,
      kind: r.kind === "UNBOX" ? "UNBOX" : "PACK",
      deleteRule: r.deleteRule,
      deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    })),
    nextCursor: rows.length > limit ? encodeCursor(pageRows[pageRows.length - 1]) : null,
  };
}

/** Số trên bốn chip — cùng bộ lọc với danh sách, KHÔNG áp chip. */
export async function summarizeVideos(
  scope: PackVideoScope,
  filters: PackVideoFilters
): Promise<Record<PackVideoChip, number>> {
  const conds = await filterConds(scope, filters);
  const rows = await prisma.$queryRaw<Record<PackVideoChip, number>[]>(
    Prisma.sql`
    SELECT count(*)::int AS "all",
           count(*) FILTER (WHERE ${HAS_RETURN})::int AS "returns",
           count(*) FILTER (WHERE v."orderId" IS NULL)::int AS "unmatched",
           count(*) FILTER (WHERE v."status" = 'PENDING')::int AS "pending",
           count(*) FILTER (WHERE ${EXPIRING})::int AS "expiring"
    FROM "pack_videos" v
    WHERE ${and(conds)}`
  );
  return rows[0] ?? { all: 0, returns: 0, unmatched: 0, pending: 0, expiring: 0 };
}

export interface OrderDossier {
  order: {
    id: string;
    orderCode: string;
    trackingCode: string | null;
    channelPlatform: string;
    shopName: string;
    shippingStatus: string;
    returnStatus: string;
    returnRequestedAt: string | null;
    returnedAt: string | null;
    deliveredAt: string | null;
    items: OrderLineView[];
  };
  videos: PackVideoRow[];
}

/** Hồ sơ video của MỘT đơn. Đơn không thuộc chủ shop (hoặc ngoài gian được phân) → 404. */
export async function videosByOrder(scope: PackVideoScope, orderId: string): Promise<OrderDossier> {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      channel: {
        userId: scope.ownerId,
        ...(scope.allowedChannelIds ? { id: { in: scope.allowedChannelIds } } : {}),
      },
    },
    select: {
      id: true,
      orderCode: true,
      trackingCode: true,
      shippingStatus: true,
      returnStatus: true,
      returnRequestedAt: true,
      returnedAt: true,
      deliveredAt: true,
      channel: { select: { channelName: true, shopName: true } },
    },
  });
  if (!order) throw new PackVideoError(404, "NOT_FOUND", "Không tìm thấy đơn hàng");

  const raws = await prisma.$queryRaw<RawVideo[]>(Prisma.sql`
    SELECT ${VIDEO_COLUMNS}
    FROM "pack_videos" v
    WHERE ${and([...scopeConds(scope), LIVE, Prisma.sql`v."orderId" = ${order.id}`])}
    ORDER BY v."recordedAt" ASC, v."id" ASC
    LIMIT 50`);
  const videos = await hydrate(scope, raws);
  // Dòng hàng của đơn: lấy từ video đầu tiên nếu có (đã ghép sẵn), không thì đọc riêng.
  const items = videos[0]?.order?.items ?? (await orderItems(scope, order.id));
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    order: {
      id: order.id,
      orderCode: order.orderCode,
      trackingCode: order.trackingCode,
      channelPlatform: order.channel.channelName,
      shopName: order.channel.shopName,
      shippingStatus: order.shippingStatus,
      returnStatus: order.returnStatus,
      returnRequestedAt: iso(order.returnRequestedAt),
      returnedAt: iso(order.returnedAt),
      deliveredAt: iso(order.deliveredAt),
      items,
    },
    videos,
  };
}

type OrderItemRow = Prisma.OrderItemGetPayload<{ select: typeof TEM_ITEM_SELECT }>;

/** Món hàng đã đọc sẵn → dòng hiển thị (tên phân loại đi cùng một nguồn với danh sách đơn). */
async function toLineViews(channelId: string, items: OrderItemRow[]): Promise<OrderLineView[]> {
  const lines = items.map((i) => ({
    channelId,
    externalId: i.externalId,
    channelSku: i.channelSku,
    productVariantName: i.product?.variantName ?? null,
    variantName: i.variantName,
  }));
  const variantOf = await loadVariantNames(lines);
  return items.map((i, idx) => ({
    name: i.productName,
    variantName: variantOf(lines[idx]) || null,
    quantity: i.quantity,
    imageUrl: i.imageUrl ?? i.product?.imageUrl ?? null,
  }));
}

async function orderItems(scope: PackVideoScope, orderId: string): Promise<OrderLineView[]> {
  const o = await prisma.order.findFirst({
    where: { id: orderId, channel: { userId: scope.ownerId } },
    select: { channelId: true, items: { select: TEM_ITEM_SELECT } },
  });
  return o ? toLineViews(o.channelId, o.items) : [];
}

export interface TemMatch {
  orderId: string;
  orderCode: string;
  channelPlatform: string;
  shopName: string | null;
  items: OrderLineView[];
  /** Đơn có hoàn — ĐÚNG định nghĩa của tab Đơn hoàn và trang Đối soát đơn hoàn: returnStatus ≠ NONE. */
  hasReturn: boolean;
  returnStatus: string;
  /** Đơn đã có video ĐÓNG / video KHUI nằm trên kho chưa (chỉ tính STORED). */
  hasPackVideo: boolean;
  hasUnboxVideo: boolean;
}

/**
 * Màn QUAY hỏi trước: mã trên tem này khớp đơn nào? — để người đóng hàng thấy ngay tên gian + món hàng
 * trong lúc đang quay (quay nhầm tem thì biết liền). CHỈ ĐỌC, dùng đúng luật khớp của bước tải lên
 * (order-match.ts: khớp tuyệt đối, hơn một đơn thì coi như không khớp) nên hai nơi không bao giờ lệch nhau.
 * Nhân viên bị giới hạn gian không thấy đơn của gian khác.
 *
 * `kind` = chế độ đang quay. Với UNBOX (khui hàng hoàn) luật khớp thử thêm mã vận đơn chiều hoàn.
 * Trả kèm ba dấu hiệu để màn quay CHỐNG CHỌN NHẦM CHẾ ĐỘ (anh Trung 16/11/2026: "phải làm sao để khi quay
 * video khui hàng không bị trùng mã đơn hàng với video đóng hàng" — kiện hoàn về vẫn dán đúng tem cũ nên
 * camera đọc ra cùng một mã): đơn có hoàn không, đã có video đóng / video khui trên kho chưa.
 * M2.5 (26/11/2026): MỘT câu mang về đơn + gian + tình trạng hoàn + món hàng (order-match.ts matchOrderForTem), rồi
 * hai lượt đọc song song: pack_videos theo chỉ mục orderId, tên phân loại của món hàng. Trước đó là 5 câu nối nhau.
 */
export async function matchTem(
  scope: PackVideoScope,
  trackingCode: string,
  kind: PackVideoKind = "PACK"
): Promise<{ order: TemMatch | null }> {
  const order = await matchOrderForTem(scope.ownerId, trackingCode, kind);
  if (!order) return { order: null };
  if (scope.allowedChannelIds && !scope.allowedChannelIds.includes(order.channelId)) return { order: null };
  const [kinds, items] = await Promise.all([
    prisma.packVideo.findMany({
      where: { orderId: order.id, ownerId: scope.ownerId, status: "STORED" },
      select: { kind: true },
      distinct: ["kind"],
    }),
    toLineViews(order.channelId, order.items),
  ]);
  return {
    order: {
      orderId: order.id,
      orderCode: order.orderCode,
      channelPlatform: order.channel.channelName,
      shopName: order.channel.shopName,
      items,
      hasReturn: order.returnStatus !== ReturnStatus.NONE,
      returnStatus: order.returnStatus,
      hasPackVideo: kinds.some((k) => k.kind === "PACK"),
      hasUnboxVideo: kinds.some((k) => k.kind === "UNBOX"),
    },
  };
}

/** Đường dẫn xem (phát trong trình duyệt) hoặc tải về — hạn ngắn, chỉ cho video đã lên kho. */
export async function videoUrl(
  scope: PackVideoScope,
  id: string,
  download: boolean,
  deps: PackVideoDeps = {}
): Promise<{ url: string; expiresAt: string }> {
  const row = await prisma.packVideo.findFirst({
    where: {
      ownerId: scope.ownerId,
      id,
      ...(scope.allowedChannelIds ? { channelId: { in: scope.allowedChannelIds } } : {}),
    },
    select: { ownerId: true, objectKey: true, status: true, trackingCode: true, kind: true },
  });
  if (!row) throw new PackVideoError(404, "NOT_FOUND", "Không tìm thấy video");
  if (row.status !== "STORED") {
    throw new PackVideoError(409, "NOT_STORED", "Video này chưa tải lên xong hoặc đã bị xóa");
  }
  if (!keyBelongsToOwner(row.objectKey, row.ownerId)) {
    throw new PackVideoError(500, "KEY_MISMATCH", "Đường dẫn tệp không khớp chủ shop");
  }
  const storage = deps.storage ?? getR2Storage();
  const now = (deps.now ?? (() => new Date()))();
  const url = await storage.presignGet(
    row.objectKey,
    download ? packVideoDownloadName(row.trackingCode, row.kind as PackVideoKind) : undefined
  );
  return { url, expiresAt: new Date(now.getTime() + PACK_VIDEO_GET_EXPIRES_SEC * 1000).toISOString() };
}

/** Trong các đơn này, đơn nào đã có video trên kho — cho nút "Xem video" ở dòng đơn. */
export async function ordersWithVideo(scope: PackVideoScope, orderIds: string[]): Promise<string[]> {
  if (orderIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ orderId: string }[]>(Prisma.sql`
    SELECT DISTINCT v."orderId"
    FROM "pack_videos" v
    WHERE ${and([
      ...scopeConds(scope),
      Prisma.sql`v."status" = 'STORED'`,
      Prisma.sql`v."orderId" IN (${Prisma.join(orderIds)})`,
    ])}`);
  return rows.map((r) => r.orderId);
}

// ───────── Đơn hoàn ─────────

export const RETURN_CARDS = ["all", "has_pack", "damaged_no_unbox", "due_soon", "no_video"] as const;
export type ReturnCard = (typeof RETURN_CARDS)[number];
export const RETURN_SORTS = ["requested", "due"] as const;
export type ReturnSort = (typeof RETURN_SORTS)[number];

export interface ReturnOrderRow {
  orderId: string;
  orderCode: string;
  trackingCode: string | null;
  channelPlatform: string;
  shopName: string;
  /** FAILED_DELIVERY = kiện giao thất bại quay đầu; BUYER_RETURN = khách trả hàng. */
  returnType: "FAILED_DELIVERY" | "BUYER_RETURN";
  returnStatus: string;
  returnRequestedAt: string | null;
  packVideo: { id: string; durationSec: number } | null;
  unboxVideo: { id: string; durationSec: number } | null;
  /** Hạn khiếu nại (docs/HAN-KHIEU-NAI-DON-HOAN.md): hạn sàn trả trước, thiếu thì theo luật. */
  complaintDue: ComplaintDueView;
}

/**
 * Danh sách ĐƠN có hoàn (một dòng = một đơn, kể cả đơn không có video) + số trên thẻ lọc.
 * Đi từ Order với đúng định nghĩa "đơn hoàn" của trang Đối soát đơn hoàn (returnStatus ≠ NONE),
 * nối sổ video qua chỉ mục orderId. Con trỏ ở đây là VỊ TRÍ (offset) bọc kín: đơn hoàn của một shop
 * tính bằng nghìn và cột sắp xếp có giá trị trống, giống cách trang Đối soát đang phân trang.
 * Việc nhận / nhập kho / báo hỏng KHÔNG làm ở đây.
 */
export async function listReturnOrders(
  scope: PackVideoScope,
  page: { card?: ReturnCard; sort?: ReturnSort; q?: string; cursor?: string; limit?: number; now?: Date }
): Promise<{ cards: Record<ReturnCard, number>; items: ReturnOrderRow[]; nextCursor: string | null }> {
  const limit = clampLimit(page.limit);
  const offset = Math.max(0, Number.parseInt(page.cursor ?? "0", 10) || 0);
  const card = page.card ?? "all";
  const now = page.now ?? new Date();
  // Thẻ "Sắp hết hạn" mặc định sắp theo hạn — gần hết hạn nhất lên đầu.
  const sort: ReturnSort = page.sort ?? (card === "due_soon" ? "due" : "requested");
  const due = complaintDueSql("o", "c");
  // Tham số Date phải ép về timestamp UTC (utcTs) — cột thời gian của Order không có múi giờ.
  const nowTs = utcTs(now);

  const base = [Prisma.sql`c."userId" = ${scope.ownerId}`, Prisma.sql`o."returnStatus" <> 'NONE'`];
  if (scope.allowedChannelIds) {
    base.push(
      scope.allowedChannelIds.length
        ? Prisma.sql`c."id" IN (${Prisma.join(scope.allowedChannelIds)})`
        : Prisma.sql`FALSE`
    );
  }
  const hasVideo = (kind: PackVideoKind) => Prisma.sql`EXISTS (
    SELECT 1 FROM "pack_videos" v
    WHERE v."orderId" = o."id" AND v."ownerId" = ${scope.ownerId} AND v."status" = 'STORED' AND v."kind" = ${kind})`;
  const pack = hasVideo("PACK");
  const unbox = hasVideo("UNBOX");
  // "Hỏng" = kho báo hỏng / mất, CHƯA chốt khiếu nại (DAMAGED) — ca cần video khui nhất.
  const cardConds: Record<ReturnCard, Prisma.Sql | null> = {
    all: null,
    has_pack: pack,
    damaged_no_unbox: Prisma.sql`o."returnStatus" = 'DAMAGED' AND NOT ${unbox}`,
    due_soon: complaintDueSoonSql(now, "o", "c"),
    no_video: Prisma.sql`NOT ${pack} AND NOT ${unbox}`,
  };

  const counts = await prisma.$queryRaw<Record<ReturnCard, number>[]>(Prisma.sql`
    SELECT count(*)::int AS "all",
           count(*) FILTER (WHERE ${cardConds.has_pack})::int AS "has_pack",
           count(*) FILTER (WHERE ${cardConds.damaged_no_unbox})::int AS "damaged_no_unbox",
           count(*) FILTER (WHERE ${cardConds.due_soon})::int AS "due_soon",
           count(*) FILTER (WHERE ${cardConds.no_video})::int AS "no_video"
    FROM "Order" o JOIN "Channel" c ON c."id" = o."channelId"
    WHERE ${and(base)}`);

  const where = cardConds[card] ? [...base, cardConds[card] as Prisma.Sql] : [...base];
  // Ô tìm (25/11/2026): mã đơn / mã vận đơn / mã vận đơn chiều hoàn, chứa chuỗi. Chỉ lọc DANH SÁCH —
  // số trên thẻ giữ nguyên để thẻ không nhảy theo từng ký tự gõ.
  const q = (page.q ?? "").trim().slice(0, 64);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push(
      Prisma.sql`(o."orderCode" ILIKE ${like} OR o."trackingCode" ILIKE ${like} OR o."returnTrackingCode" ILIKE ${like})`
    );
  }
  const rows = await prisma.$queryRaw<
    {
      id: string;
      orderCode: string;
      trackingCode: string | null;
      channelName: string;
      shopName: string;
      returnStatus: string;
      returnRequestedAt: Date | null;
      platformReturnStatus: string | null;
      returnedAt: Date | null;
      returnDeliveredAt: Date | null;
      returnTrackingCode: string | null;
      returnComplaintDueAt: Date | null;
      returnComplaintDueProvisional: boolean;
    }[]
  >(Prisma.sql`
    SELECT o."id", o."orderCode", o."trackingCode", c."channelName"::text AS "channelName", c."shopName",
           o."returnStatus"::text AS "returnStatus", o."returnRequestedAt", o."platformReturnStatus",
           o."returnedAt", o."returnDeliveredAt", o."returnTrackingCode",
           o."returnComplaintDueAt", o."returnComplaintDueProvisional"
    FROM "Order" o JOIN "Channel" c ON c."id" = o."channelId"
    WHERE ${and(where)}
    ORDER BY ${
      sort === "due"
        ? // Còn hạn (gần hết nhất trước) → đã quá hạn (VỪA quá hạn trước — đơn quá hạn lâu chìm xuống) → không có hạn.
          Prisma.sql`(${due} <= ${nowTs}) ASC NULLS LAST,
            (CASE WHEN ${due} > ${nowTs} THEN ${due} END) ASC NULLS LAST,
            ${due} DESC NULLS LAST, o."returnRequestedAt" DESC NULLS LAST, o."id" DESC`
        : Prisma.sql`o."returnRequestedAt" DESC NULLS LAST, o."id" DESC`
    }
    LIMIT ${limit + 1} OFFSET ${offset}`);
  const pageRows = rows.slice(0, limit);

  // Video mới nhất của từng loại cho các đơn của TRANG này.
  const latest = new Map<string, { id: string; durationSec: number }>();
  if (pageRows.length > 0) {
    const vids = await prisma.$queryRaw<{ id: string; orderId: string; kind: string; durationSec: number }[]>(
      Prisma.sql`
      SELECT v."id", v."orderId", v."kind", v."durationSec"
      FROM "pack_videos" v
      WHERE v."ownerId" = ${scope.ownerId} AND v."status" = 'STORED'
        AND v."orderId" IN (${Prisma.join(pageRows.map((r) => r.id))})
      ORDER BY v."recordedAt" ASC`
    );
    for (const v of vids) latest.set(`${v.orderId}|${v.kind}`, { id: v.id, durationSec: v.durationSec });
  }

  return {
    cards: counts[0] ?? { all: 0, has_pack: 0, damaged_no_unbox: 0, due_soon: 0, no_video: 0 },
    items: pageRows.map((r) => ({
      orderId: r.id,
      orderCode: r.orderCode,
      trackingCode: r.trackingCode,
      channelPlatform: r.channelName,
      shopName: r.shopName,
      returnType:
        (r.platformReturnStatus ?? "").toUpperCase() === CANCELLED_AFTER_SHIP ? "FAILED_DELIVERY" : "BUYER_RETURN",
      returnStatus: r.returnStatus,
      returnRequestedAt: r.returnRequestedAt ? r.returnRequestedAt.toISOString() : null,
      packVideo: latest.get(`${r.id}|PACK`) ?? null,
      unboxVideo: latest.get(`${r.id}|UNBOX`) ?? null,
      complaintDue: complaintDueView(
        complaintDueOf({
          platform: r.channelName,
          returnStatus: r.returnStatus as ReturnStatus,
          returnedAt: r.returnedAt,
          returnDeliveredAt: r.returnDeliveredAt,
          platformReturnStatus: r.platformReturnStatus,
          returnTrackingCode: r.returnTrackingCode,
          returnComplaintDueAt: r.returnComplaintDueAt,
          returnComplaintDueProvisional: r.returnComplaintDueProvisional,
        })
      ),
    })),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}

// ───────── Thống kê ─────────

export interface PackVideoStats {
  totalVideos: number;
  totalSeconds: number;
  avgSeconds: number;
  byDay: { day: string; videos: number; seconds: number }[];
  byRecorder: {
    recordedById: string;
    name: string | null;
    videos: number;
    seconds: number;
    avgSeconds: number;
    maxSeconds: number;
  }[];
  byChannel: { channelId: string | null; shopName: string | null; videos: number; seconds: number }[];
  longest: PackVideoRow[];
}

/** Thống kê thời gian quay trong khoảng ngày (theo giờ quay, múi giờ VN). Chỉ video đã STORED. */
export async function videoStats(scope: PackVideoScope, range: DateRangeFilter | undefined): Promise<PackVideoStats> {
  const conds = [...scopeConds(scope), Prisma.sql`v."status" = 'STORED'`];
  if (range) {
    conds.push(Prisma.sql`v."recordedAt" >= ${range.gte}::timestamptz`);
    conds.push(Prisma.sql`v."recordedAt" <= ${range.lte}::timestamptz`);
  }
  const where = and(conds);

  // Chạy LẦN LƯỢT: hồ kết nối chỉ có 5, một lượt mở tab không được chiếm hết.
  const byDay = await prisma.$queryRaw<{ day: string; videos: number; seconds: number }[]>(Prisma.sql`
    SELECT to_char(v."recordedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS "day",
           count(*)::int AS "videos", coalesce(sum(v."durationSec"), 0)::int AS "seconds"
    FROM "pack_videos" v WHERE ${where}
    GROUP BY 1 ORDER BY 1`);
  const byRecorder = await prisma.$queryRaw<
    { recordedById: string; videos: number; seconds: number; maxSeconds: number }[]
  >(Prisma.sql`
    SELECT v."recordedById", count(*)::int AS "videos", coalesce(sum(v."durationSec"), 0)::int AS "seconds",
           coalesce(max(v."durationSec"), 0)::int AS "maxSeconds"
    FROM "pack_videos" v WHERE ${where}
    GROUP BY 1 ORDER BY 3 DESC`);
  const byChannel = await prisma.$queryRaw<{ channelId: string | null; videos: number; seconds: number }[]>(
    Prisma.sql`
    SELECT v."channelId", count(*)::int AS "videos", coalesce(sum(v."durationSec"), 0)::int AS "seconds"
    FROM "pack_videos" v WHERE ${where}
    GROUP BY 1 ORDER BY 3 DESC`
  );
  const longestRaw = await prisma.$queryRaw<RawVideo[]>(Prisma.sql`
    SELECT ${VIDEO_COLUMNS}
    FROM "pack_videos" v WHERE ${where}
    ORDER BY v."durationSec" DESC, v."recordedAt" DESC
    LIMIT 20`);

  const users = byRecorder.length
    ? await prisma.user.findMany({
        where: {
          id: { in: byRecorder.map((r) => r.recordedById) },
          OR: [{ id: scope.ownerId }, { ownerId: scope.ownerId }],
        },
        select: { id: true, fullName: true, staffUsername: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const chIds = byChannel.map((c) => c.channelId).filter((x): x is string => !!x);
  const channels = chIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: chIds }, userId: scope.ownerId },
        select: { id: true, shopName: true },
      })
    : [];
  const shopById = new Map(channels.map((c) => [c.id, c.shopName]));

  const totalVideos = byDay.reduce((s, d) => s + d.videos, 0);
  const totalSeconds = byDay.reduce((s, d) => s + d.seconds, 0);
  return {
    totalVideos,
    totalSeconds,
    avgSeconds: totalVideos ? Math.round(totalSeconds / totalVideos) : 0,
    byDay,
    byRecorder: byRecorder.map((r) => {
      const u = userById.get(r.recordedById);
      return {
        recordedById: r.recordedById,
        name: u ? u.fullName || u.staffUsername || null : null,
        videos: r.videos,
        seconds: r.seconds,
        avgSeconds: r.videos ? Math.round(r.seconds / r.videos) : 0,
        maxSeconds: r.maxSeconds,
      };
    }),
    byChannel: byChannel.map((c) => ({
      channelId: c.channelId,
      shopName: c.channelId ? (shopById.get(c.channelId) ?? null) : null,
      videos: c.videos,
      seconds: c.seconds,
    })),
    longest: await hydrate(scope, longestRaw),
  };
}
