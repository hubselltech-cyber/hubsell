// ============================================================
// ĐỌC ĐƠN LỆCH PHÍ VẬN CHUYỂN (Order.shippingFeeDiff > 0) cho các màn Đối soát phí
// ship (kho) và Kiểm toán phí (tài chính) — một nguồn số, một bộ lọc, một cách phân
// loại nguyên nhân. Thiết kế: docs/DOI-SOAT-PHI-SHIP-NGUYEN-NHAN-KHAO-SAT-31-10.md.
//
// Nguyên nhân là cột TÍNH LÚC ĐỌC (lib/shipping-diff-reason.ts) nên mọi phép lọc /
// gom theo nguyên nhân làm ở tầng ứng dụng, trên tập đơn lệch của MỘT chủ shop.
// ============================================================

import { ChannelName, Prisma, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { ChannelScope } from "../lib/channel-filter";
import type { DateRangeFilter } from "../lib/date-range";
import { loadSkuImages } from "../lib/sku-images";
import {
  classifyShippingDiff,
  isClaimableReason,
  shippingDiffReasonMatcher,
  type ShippingDiffReason,
} from "../lib/shipping-diff-reason";
import {
  shipGuaranteeGap,
  splitShippingDiff,
  type ShipDiffParts,
  type ShipGuaranteeGap,
  type TiktokShipPartCols,
} from "../lib/shipping-diff-parts";
import {
  createShipDiffProductFold,
  shipDiffAvgPerOrder,
  shipDiffOrderRate,
  sortShipDiffProducts,
  type ShipDiffLine,
  type ShipDiffProductGroup,
  type ShipDiffProductSort,
  type ShipDiffReasonTotal,
} from "../lib/shipping-diff-products";
import { ledgerScopeSql } from "./order-ledger";

/** Bộ lọc DB chung: đơn bị trừ thêm phí ship của phạm vi gian, theo NGÀY ĐẶT. */
export function shipDiffWhere(
  scope: ChannelScope,
  range: DateRangeFilter | undefined
): Prisma.OrderWhereInput {
  return { channel: scope, shippingFeeDiff: { gt: 0 }, createdAt: range };
}

/**
 * Đơn hủy sau khi gửi / khách trả hàng ĐÃ TRẢ phí Bảo đảm phí vận chuyển mà vẫn lệch — cùng luật với
 * `shipGuaranteeGap` (lib/shipping-diff-parts.ts) nhưng viết thành bộ lọc DB để thẻ "Truy thu phí ship"
 * đếm bằng MỘT câu aggregate, không kéo cả tập đơn lệch về phân loại. Hai bên được so khớp ở
 * shipping-diff-db.test.ts; sửa luật phân loại hủy / hoàn của TikTok thì sửa cả chỗ này.
 */
export function shipGuaranteeGapWhere(
  scope: ChannelScope,
  range: DateRangeFilter | undefined
): Prisma.OrderWhereInput {
  return {
    ...shipDiffWhere(scope, range),
    isSettled: true,
    tiktokSettlement: { is: { estimated: false, feeShipGuarantee: { lt: 0 } } },
    OR: [
      { shippingStatus: ShippingStatus.CANCELLED },
      { returnStatus: { not: ReturnStatus.NONE } },
      { tiktokSettlement: { is: { shipReturn: { lt: 0 } } } },
    ],
  };
}

/**
 * Cột nhẹ để PHÂN LOẠI NGUYÊN NHÂN + TÁCH TIỀN: Order + vài cột ship có dấu của bản kê TikTok /
 * sao kê Lazada (không gọi sàn).
 */
export const SHIP_REASON_SELECT = {
  id: true,
  shippingStatus: true,
  returnStatus: true,
  deliveredAt: true,
  isSettled: true,
  shippingFeeDiff: true,
  shippingDisputeStatus: true,
  channel: { select: { channelName: true } },
  tiktokSettlement: {
    select: {
      estimated: true,
      shipActual: true,
      shipCustomerPaid: true,
      shipPlatformDiscount: true,
      shipSubsidy: true,
      shipSellerDiscount: true,
      shipReturn: true,
      shipOther: true,
      shipReimbursement: true,
      feeShipGuarantee: true,
    },
  },
  lazadaSettlement: {
    select: {
      shipFeeReturn: true,
      feeShipSeller: true,
      shipFeeAdjustment: true,
      shipDiscountSeller: true,
    },
  },
} satisfies Prisma.OrderSelect;

type ShipReasonRow = Prisma.OrderGetPayload<{ select: typeof SHIP_REASON_SELECT }>;

/** Cột ship có dấu của bản kê TikTok thành số; null = đơn không có bản kê TikTok. */
function tiktokShipCols(t: ShipReasonRow["tiktokSettlement"]): TiktokShipPartCols | null {
  if (!t) return null;
  return {
    estimated: t.estimated,
    shipActual: Number(t.shipActual),
    shipCustomerPaid: Number(t.shipCustomerPaid),
    shipPlatformDiscount: Number(t.shipPlatformDiscount),
    shipSubsidy: Number(t.shipSubsidy),
    shipSellerDiscount: Number(t.shipSellerDiscount),
    shipReturn: Number(t.shipReturn),
    shipOther: Number(t.shipOther),
    shipReimbursement: Number(t.shipReimbursement),
    feeShipGuarantee: Number(t.feeShipGuarantee),
  };
}

type ShipReasonInput = Pick<
  ShipReasonRow,
  "shippingStatus" | "returnStatus" | "deliveredAt" | "isSettled" | "channel" | "tiktokSettlement" | "lazadaSettlement"
>;

/** Cờ "đã trả phí Bảo đảm phí vận chuyển mà vẫn lệch" của một đơn lệch đã biết nguyên nhân. */
export function shipGuaranteeGapOf(o: ShipReasonInput, reason: ShippingDiffReason): ShipGuaranteeGap | null {
  return shipGuaranteeGap(reason, tiktokShipCols(o.tiktokSettlement));
}

/** Tiền lệch của một đơn tách theo chiều đi / chiều về / phụ phí / sàn bù; null = chưa tách được. */
export function shipPartsOf(o: Pick<ShipReasonRow, "shippingFeeDiff" | "tiktokSettlement">): ShipDiffParts | null {
  return splitShippingDiff(Number(o.shippingFeeDiff), tiktokShipCols(o.tiktokSettlement));
}

export function shipReasonOf(o: ShipReasonInput): ShippingDiffReason {
  const l = o.lazadaSettlement;
  return classifyShippingDiff({
    channelName: o.channel.channelName,
    shippingStatus: o.shippingStatus,
    returnStatus: o.returnStatus,
    isSettled: o.isSettled,
    everDelivered: o.deliveredAt !== null,
    tiktok: tiktokShipCols(o.tiktokSettlement),
    lazada: l
      ? {
          shipFeeReturn: Number(l.shipFeeReturn),
          feeShipSeller: Number(l.feeShipSeller),
          shipFeeAdjustment: Number(l.shipFeeAdjustment),
          shipDiscountSeller: Number(l.shipDiscountSeller),
        }
      : null,
  });
}

// ------------------------------------------------------------
// Lệch ship THEO SẢN PHẨM (Kiểm toán phí › Truy thu phí ship › Theo sản phẩm)
// ------------------------------------------------------------

/** Bước 1 — đầu đơn: cột phân loại + gian + ngày đặt (không kéo dòng hàng). */
const BY_PRODUCT_ORDER_SELECT = {
  ...SHIP_REASON_SELECT,
  channelId: true,
  createdAt: true,
  channel: { select: { channelName: true, shopName: true } },
} satisfies Prisma.OrderSelect;

/** Bước 2 — dòng hàng đọc theo lô mã đơn (chỉ mục OrderItem.orderId), gom dần rồi bỏ. */
const BY_PRODUCT_ITEM_BATCH = 1000;

export interface ShipDiffProductRow {
  key: string;
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  itemId: string | null;
  sku: string | null;
  productName: string;
  imageUrl: string | null;
  unattributed: boolean;
  amount: number;
  orders: number;
  avgPerOrder: number;
  /** Tổng đơn của sản phẩm trong kỳ (mẫu số tỷ lệ); null = chưa đếm được. */
  totalOrders: number | null;
  /** % đơn của sản phẩm bị lệch; null = chưa đếm được. */
  rate: number | null;
  topReason: ShippingDiffReason;
  reasons: ShipDiffReasonTotal[];
}

export interface ShipDiffByProductResult {
  summary: {
    /** Tổng tiền ship shop chịu thêm + số đơn, theo bộ lọc nguyên nhân (= Σ amount mọi dòng). */
    totalAmount: number;
    orders: number;
    productCount: number;
    /** Theo nguyên nhân của mọi đơn trong phạm vi + kỳ, KHÔNG theo bộ lọc nguyên nhân. */
    reasons: (ShipDiffReasonTotal & { claimable: boolean })[];
  };
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  items: ShipDiffProductRow[];
}

/**
 * Đếm đơn KHÔNG hủy của từng sản phẩm trong kỳ ở sổ dòng hàng — chỉ cho các dòng của
 * TRANG đang xem (≤ 100 sản phẩm), đi chỉ mục (channelId, itemId) / (channelId, channelSku).
 * Sổ có thể trễ vài phút so với đơn mới: chấp nhận được với một tỷ lệ.
 */
async function loadNonCancelledOrderCounts(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  groups: ShipDiffProductGroup[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const channelIds = [...new Set(groups.map((g) => g.channelId))];
  const itemIds = [...new Set(groups.map((g) => g.itemId).filter((x): x is string => !!x))];
  const skus = [...new Set(groups.filter((g) => !g.itemId && g.sku !== null).map((g) => g.sku as string))];
  if (channelIds.length === 0) return out;

  const base = Prisma.sql`${ledgerScopeSql(scope, range, { alias: "l" })}
      AND l."channelId" IN (${Prisma.join(channelIds)})
      AND l."shippingStatus" <> ${ShippingStatus.CANCELLED}::"ShippingStatus"`;
  const [byItem, bySku] = await Promise.all([
    itemIds.length
      ? prisma.$queryRaw<{ channelId: string; id: string; n: bigint }[]>(Prisma.sql`
          SELECT l."channelId", l."itemId" AS id, count(DISTINCT l."orderId") AS n
          FROM "order_line_ledger" l
          WHERE ${base} AND l."itemId" IN (${Prisma.join(itemIds)})
          GROUP BY 1, 2`)
      : [],
    skus.length
      ? prisma.$queryRaw<{ channelId: string; id: string; n: bigint }[]>(Prisma.sql`
          SELECT l."channelId", l."channelSku" AS id, count(DISTINCT l."orderId") AS n
          FROM "order_line_ledger" l
          WHERE ${base} AND l."itemId" IS NULL AND l."channelSku" IN (${Prisma.join(skus)})
          GROUP BY 1, 2`)
      : [],
  ]);
  const itemCount = new Map(byItem.map((r) => [`${r.channelId}\u0000${r.id}`, Number(r.n)]));
  const skuCount = new Map(bySku.map((r) => [`${r.channelId}\u0000${r.id}`, Number(r.n)]));
  for (const g of groups) {
    const n = g.itemId
      ? itemCount.get(`${g.channelId}\u0000${g.itemId}`)
      : g.sku !== null
        ? skuCount.get(`${g.channelId}\u0000${g.sku}`)
        : undefined;
    if (n !== undefined) out.set(g.key, n);
  }
  return out;
}

export async function loadShipDiffByProduct(params: {
  scope: ChannelScope;
  range: DateRangeFilter | undefined;
  /** CLAIMABLE | POLICY | mã ShippingDiffReason | "" = tất cả. */
  reasonKey: string;
  sort: ShipDiffProductSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}): Promise<ShipDiffByProductResult> {
  const { scope, range, page, pageSize } = params;
  const where = shipDiffWhere(scope, range);
  const fold = createShipDiffProductFold(shippingDiffReasonMatcher(params.reasonKey));
  const channels = new Map<string, { channelName: ChannelName; shopName: string }>();

  // Bước 1: MỘT lượt đọc đầu đơn lệch của phạm vi — cùng dạng câu với danh sách đơn lệch (đi chỉ mục
  // gian, không ORDER BY … LIMIT để planner khỏi chọn nhầm đường quét khóa chính của cả bảng đơn).
  const heads = await prisma.order.findMany({ where, select: BY_PRODUCT_ORDER_SELECT });

  // Bước 2: dòng hàng theo lô; phần nặng (tên sản phẩm × số dòng) không bao giờ nằm trọn trong bộ nhớ.
  for (let i = 0; i < heads.length; i += BY_PRODUCT_ITEM_BATCH) {
    const batch = heads.slice(i, i + BY_PRODUCT_ITEM_BATCH);
    const items = await prisma.orderItem.findMany({
      where: { orderId: { in: batch.map((o) => o.id) } },
      select: { orderId: true, externalId: true, channelSku: true, productName: true, quantity: true, price: true },
    });
    const linesOf = new Map<string, ShipDiffLine[]>();
    for (const it of items) {
      const line = {
        externalId: it.externalId,
        channelSku: it.channelSku,
        productName: it.productName,
        quantity: it.quantity,
        price: Number(it.price),
      };
      const list = linesOf.get(it.orderId);
      if (list) list.push(line);
      else linesOf.set(it.orderId, [line]);
    }
    for (const o of batch) {
      if (!channels.has(o.channelId)) channels.set(o.channelId, o.channel);
      fold.add({
        channelId: o.channelId,
        createdAt: o.createdAt,
        diff: Number(o.shippingFeeDiff),
        reason: shipReasonOf(o),
        cancelled: o.shippingStatus === ShippingStatus.CANCELLED,
        lines: linesOf.get(o.id) ?? [],
      });
    }
  }

  const folded = fold.result();
  const sorted = sortShipDiffProducts(folded.groups, params.sort, params.dir);
  const pageGroups = sorted.slice((page - 1) * pageSize, page * pageSize);

  const [counts, images] = await Promise.all([
    loadNonCancelledOrderCounts(scope, range, pageGroups),
    loadSkuImages(
      scope,
      pageGroups.map((g) => g.sku).filter((s): s is string => !!s)
    ),
  ]);

  return {
    summary: {
      totalAmount: folded.totalAmount,
      orders: folded.orders,
      productCount: sorted.length,
      reasons: folded.reasonTotals.map((r) => ({ ...r, claimable: isClaimableReason(r.reason) })),
    },
    page,
    pageSize,
    pageCount: Math.ceil(sorted.length / pageSize),
    total: sorted.length,
    items: pageGroups.map((g) => {
      const ch = channels.get(g.channelId)!;
      const rate = shipDiffOrderRate(g, counts.get(g.key));
      return {
        key: g.key,
        channelId: g.channelId,
        channelName: ch.channelName,
        shopName: ch.shopName,
        itemId: g.itemId,
        sku: g.sku,
        productName: g.productName,
        imageUrl: g.sku ? (images.get(g.sku) ?? null) : null,
        unattributed: g.unattributed,
        amount: g.amount,
        orders: g.orders,
        avgPerOrder: shipDiffAvgPerOrder(g),
        totalOrders: rate?.totalOrders ?? null,
        rate: rate?.rate ?? null,
        topReason: g.reasons[0].reason,
        reasons: g.reasons,
      };
    }),
  };
}
