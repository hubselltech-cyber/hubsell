// ============================================================
// ĐƯỜNG ĐỐI SOÁT CHO TEST DB — đọc đơn gốc theo trang, dựng dòng computePnlRow.
//
// Đây là "đường cũ" của các báo cáo tài chính trước 30/09/2026 (kéo đơn lên
// RAM rồi cộng bằng JS). Từ 30/09 mọi báo cáo đọc SỔ CÁI ĐƠN; đường cũ được
// giữ sau 9 công tắc env tới 14/10/2026 thì gỡ khỏi mã chạy thật (lát 3.0 của
// giai đoạn 3, docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md). Phần còn lại ở đây CHỈ để
// các test *-ledger-db.test.ts so "sổ = đơn gốc" trên DB dev — không import từ
// mã chạy thật.
// ============================================================

import { ChannelName, Prisma, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { MARGIN_MAX_ORDERS, marginWindowRange, type AdsInsightChannel, type MarginRow } from "../../lib/ads-margin";
import type { ChannelScope } from "../../lib/channel-filter";
import type { DateRangeFilter } from "../../lib/date-range";
import type { SkuAgg } from "../../lib/finance-views";
import { TIKTOK_BREAKEVEN_MAX_ORDERS, tiktokMarginWindowRange, type BreakevenPnlRow } from "../../lib/tiktok-breakeven";
import { computePnlRow, PNL_INCLUDE, type PnlOrder, type PnlRow } from "../../lib/pnl-formula";
import {
  encodePnlCursor,
  matchesPnlFilter,
  pnlSummaryTotalsFromRows,
  type LedgerPnlFilter,
  type PnlListCursor,
  type PnlSummaryTotals,
} from "../../lib/realized-pnl-totals";
import {
  aggregateDeclaration,
  declarationBasis,
  type DeclarationChannelRow,
  type DeclarationInput,
} from "../../services/tax-declaration";

/** Lọc thêm trên tập đơn (ngoài gian + kỳ). */
export interface PnlOrderFilter {
  shippingStatus?: ShippingStatus;
  where?: Prisma.OrderWhereInput;
}

/**
 * Tập đơn của một phạm vi, đọc THEO TRANG (mới nhất trước, cursor theo id), mỗi
 * trang đưa qua `onPage`. `max` là phanh an toàn — chạm thì `truncated` = true
 * và số của nơi gọi chỉ là cận dưới (test bỏ qua phép so đó).
 */
export async function forEachPnlOrderPage(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  opts: { pageSize?: number; max?: number } & PnlOrderFilter,
  onPage: (page: PnlOrder[]) => void | Promise<void>
): Promise<{ count: number; truncated: boolean }> {
  const pageSize = opts.pageSize ?? 1000;
  const max = opts.max ?? 20_000;
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.order.findMany({
      where: {
        ...opts.where,
        channel: scope,
        createdAt: range,
        ...(opts.shippingStatus ? { shippingStatus: opts.shippingStatus } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: PNL_INCLUDE,
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    count += page.length;
    await onPage(page);
    if (page.length < pageSize) return { count, truncated: false };
    if (count >= max) return { count, truncated: true };
    cursor = page[page.length - 1].id;
  }
}

/** Toàn bộ dòng Lãi/Lỗ của kỳ (mới nhất trước). `lean` bỏ bản kê Lazada/TikTok của từng dòng. */
export async function fetchPnlRows(
  scope: ChannelScope,
  range?: DateRangeFilter,
  opts: { lean?: boolean; max?: number } & PnlOrderFilter = {}
): Promise<{ rows: PnlRow[]; truncated: boolean }> {
  const rows: PnlRow[] = [];
  const { truncated } = await forEachPnlOrderPage(scope, range, opts, (page) => {
    for (const o of page) {
      const r = computePnlRow(o);
      rows.push(opts.lean ? { ...r, lazada: null, tiktok: null } : r);
    }
  });
  return { rows, truncated };
}

/** Đơn CHƯA quyết toán đang giao / đã giao — tập đơn của bảng Phân bổ dòng tiền và câu "tiền đang ở đâu". */
export const OPEN_CASH_WHERE: Prisma.OrderWhereInput = {
  isSettled: false,
  shippingStatus: { in: [ShippingStatus.SHIPPING, ShippingStatus.DELIVERED] },
};

/** Gom MỘT đơn vào bảng theo SKU — luật phân bổ phí của Lãi/Lỗ theo SKU trước khi chuyển sang sổ dòng hàng. */
export function addOrderToSkuAgg(bySku: Map<string, SkuAgg>, order: PnlOrder) {
  // Sàn khấu trừ của đơn = Giá trị đơn − Doanh thu thực tế (SSOT).
  const r = computePnlRow(order);
  const orderFee = r.revenueGross - r.platformRevenue;
  const orderLineRevenue = order.items.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  for (const item of order.items) {
    const sku = item.product?.skuCode ?? item.channelSku;
    const lineRevenue = Number(item.price) * item.quantity;
    const lineCogs = Number(item.costPriceAtSale) * item.quantity;
    const share = orderLineRevenue > 0 ? lineRevenue / orderLineRevenue : 0;
    const row = bySku.get(sku) ?? {
      sku,
      productName: item.productName,
      imageUrl: item.product?.imageUrl ?? null,
      quantitySold: 0,
      revenue: 0,
      cogs: 0,
      allocatedFee: 0,
    };
    row.quantitySold += item.quantity;
    row.revenue += lineRevenue;
    row.cogs += lineCogs;
    row.allocatedFee += orderFee * share;
    if (!row.imageUrl && item.product?.imageUrl) row.imageUrl = item.product.imageUrl;
    bySku.set(sku, row);
  }
}

/** Lãi/Lỗ theo SKU từ đơn Đã giao (đường cũ). */
export async function skuAggFromOrders(
  scope: ChannelScope,
  range: DateRangeFilter | undefined
): Promise<{ bySku: Map<string, SkuAgg>; truncated: boolean }> {
  const bySku = new Map<string, SkuAgg>();
  const { truncated } = await forEachPnlOrderPage(scope, range, { shippingStatus: ShippingStatus.DELIVERED }, (page) =>
    page.forEach((o) => addOrderToSkuAgg(bySku, o))
  );
  return { bySku, truncated };
}

/**
 * Bảng Lãi/Lỗ thực hiện theo đường cũ: kéo cả kỳ lên RAM, lọc + cắt trang bằng
 * JS (cùng hình dạng trả về với loadRealizedPnl ở routes/finance.ts).
 */
export async function realizedPnlFromOrders(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  filter: LedgerPnlFilter,
  opts: { page: number; pageSize: number; cursor?: PnlListCursor | null; rowsOnly?: boolean }
): Promise<{ rows: PnlRow[]; nextCursor: string | null; totals: PnlSummaryTotals | null; truncated: boolean }> {
  const { rows: all, truncated } = await fetchPnlRows(scope, range, { shippingStatus: filter.shippingStatus });
  const filtered = all.filter((r) => matchesPnlFilter(r, filter));
  let start = (opts.page - 1) * opts.pageSize;
  if (opts.cursor) {
    const c = opts.cursor;
    const at = filtered.findIndex((r) => r.id === c.orderId);
    start = at >= 0 ? at + 1 : filtered.findIndex((r) => r.createdAt.getTime() < c.createdAt.getTime());
    if (start < 0) start = filtered.length;
  }
  const rows = filtered.slice(start, start + opts.pageSize);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      last && start + opts.pageSize < filtered.length
        ? encodePnlCursor({ createdAt: last.createdAt, orderId: last.id })
        : null,
    totals: opts.rowsOnly ? null : pnlSummaryTotalsFromRows(filtered),
    truncated,
  };
}

/**
 * Bảng kê khai theo sàn theo đường cũ: đọc đơn theo trang, áp cùng cơ sở cắt kỳ
 * (declarationBasis) rồi gom bằng aggregateDeclaration.
 */
export async function declarationRowsFromOrders(
  scope: ChannelScope,
  range: DateRangeFilter
): Promise<{ rows: DeclarationChannelRow[]; truncated: boolean; missingDeliveredAt: number }> {
  const inputs: DeclarationInput[] = [];
  let missingDeliveredAt = 0;
  const byDelivered = declarationBasis() === "delivered";
  const { truncated } = await forEachPnlOrderPage(
    scope,
    byDelivered ? undefined : range,
    byDelivered
      ? {
          shippingStatus: ShippingStatus.DELIVERED,
          where: { OR: [{ deliveredAt: range }, { deliveredAt: null, createdAt: range }] },
        }
      : {},
    (page) => {
      for (const o of page) {
        if (byDelivered && o.deliveredAt === null) missingDeliveredAt += 1;
        const r = computePnlRow(o);
        inputs.push({
          channelName: r.channelName,
          shippingStatus: r.shippingStatus,
          isSettled: r.isSettled,
          revenueGross: r.revenueGross,
          sellerVoucher: r.sellerVoucher,
          refundedAmount: r.refundedAmount,
          platformTax: r.platformTax,
        });
      }
    }
  );
  return { rows: aggregateDeclaration(inputs), truncated, missingDeliveredAt };
}

/** Dòng gọn biên lãi Shopee/Lazada của một gian dựng từ đơn gốc (đường cũ của loadMarginRows). */
export async function marginRowsFromOrders(
  channel: AdsInsightChannel,
  range: DateRangeFilter = marginWindowRange()
): Promise<MarginRow[]> {
  const scope = { userId: channel.userId, id: channel.id, channelName: channel.channelName };
  return (await fetchPnlRows(scope, range, { max: MARGIN_MAX_ORDERS })).rows;
}

/** Dòng gọn hòa vốn TikTok của một gian dựng từ đơn gốc (đường cũ của loadBreakevenRows). */
export async function breakevenRowsFromOrders(
  channel: { id: string; userId: string },
  range: DateRangeFilter = tiktokMarginWindowRange()
): Promise<BreakevenPnlRow[]> {
  const scope = { userId: channel.userId, id: channel.id, channelName: ChannelName.TIKTOK };
  const rows: BreakevenPnlRow[] = [];
  await forEachPnlOrderPage(scope, range, { max: TIKTOK_BREAKEVEN_MAX_ORDERS }, (page) => {
    for (const o of page) {
      const r = computePnlRow(o);
      rows.push({
        createdAt: r.createdAt,
        shippingStatus: r.shippingStatus,
        // Chỉ bản kê THẬT mới là "đã đối soát"; số ước tính của sàn (estimated) thì chưa.
        isSettled: r.isSettled && r.tiktok != null && (r.tiktok as { estimated?: boolean }).estimated !== true,
        items: r.items.map((it) => ({ sku: it.sku, price: it.price, quantity: it.quantity })),
        actualRevenue: r.actualRevenue,
        profit: r.profit,
        missingCostPrice: r.missingCostPrice,
        tiktok: r.tiktok ? { feeGmvMax: Number((r.tiktok as Record<string, unknown>).feeGmvMax) || 0 } : null,
      });
    }
  });
  return rows;
}
