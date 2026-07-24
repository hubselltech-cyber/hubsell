// ============================================================
// TIKTOK SHOP — TẦNG NGHIỆP VỤ (có truy cập DB)
//
// client.ts là các hàm API THUẦN (không biết DB). File này ghép chúng với Prisma:
//   1) getValidAccessToken() — tự refresh access_token khi sắp hết hạn.
//   2) syncTiktokOrders()    — kéo đơn thật → upsert Order + OrderItem.
//   3) syncTiktokSettlements()— kéo đối soát thật → cập nhật số quyết toán/đơn.
// ============================================================

import type { Channel, Prisma } from "@prisma/client";
import { ChannelName, InventoryLogType, ShippingStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { PLATFORM_FEE_RATE } from "../../mockMarketplace";
import { expireToDate } from "./config";
import {
  fetchOrders,
  fetchSettlements,
  fetchStatementTransactions,
  getOrderDetail,
  refreshAccessToken,
  type TikTokOrder,
} from "./client";

// Làm mới token khi còn dưới 5 phút là hết hạn — chừa biên an toàn cho các call
// nối tiếp trong cùng một lượt đồng bộ, tránh token hết hạn giữa chừng.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Chặn phân trang chạy vô tận (đề phòng next_page_token luôn có do lỗi phía sàn).
const MAX_PAGES = 50;
const PAGE_SIZE = 50;

export interface AccessContext {
  accessToken: string;
  shopCipher: string;
}

/**
 * Trả về access_token còn hạn cho một gian TikTok, TỰ ĐỘNG refresh nếu sắp/đã
 * hết hạn rồi lưu token mới xuống DB. Gọi hàm này NGAY TRƯỚC mọi lượt gọi API.
 *
 * Ném lỗi rõ ràng khi gian chưa uỷ quyền hoặc refresh_token đã hết hạn (buộc
 * chủ shop uỷ quyền lại) — để lỗi không lặng lẽ biến thành chữ ký/401 khó truy.
 */
export async function getValidAccessToken(channel: Channel): Promise<AccessContext> {
  if (channel.channelName !== ChannelName.TIKTOK) {
    throw new Error("Gian hàng này không phải TikTok Shop");
  }
  if (!channel.apiToken || !channel.refreshToken || !channel.shopCipher) {
    throw new Error("Gian hàng chưa uỷ quyền TikTok (thiếu token/shop_cipher)");
  }

  const now = Date.now();
  const accessExp = channel.accessTokenExpireAt?.getTime() ?? 0;

  // Còn hạn dư dả → dùng luôn token hiện có.
  if (accessExp - now > REFRESH_BUFFER_MS) {
    return { accessToken: channel.apiToken, shopCipher: channel.shopCipher };
  }

  // Sắp/đã hết hạn → phải refresh. Nếu refresh_token cũng hết hạn thì bó tay.
  const refreshExp = channel.refreshTokenExpireAt?.getTime() ?? 0;
  if (refreshExp && refreshExp < now) {
    throw new Error(
      "Phiên uỷ quyền TikTok đã hết hạn (refresh_token). Vui lòng kết nối lại gian hàng."
    );
  }

  const t = await refreshAccessToken(channel.refreshToken);
  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      apiToken: t.access_token,
      refreshToken: t.refresh_token,
      accessTokenExpireAt: expireToDate(t.access_token_expire_in),
      refreshTokenExpireAt: expireToDate(t.refresh_token_expire_in),
    },
  });

  return { accessToken: t.access_token, shopCipher: channel.shopCipher };
}

// ---------- Ánh xạ trạng thái đơn TikTok → vòng đời của Hubsell ----------

function mapShippingStatus(tiktokStatus?: string): ShippingStatus {
  switch (tiktokStatus) {
    case "UNPAID":
    case "ON_HOLD":
    case "AWAITING_SHIPMENT":
      return ShippingStatus.PENDING;
    case "PARTIALLY_SHIPPING":
    case "AWAITING_COLLECTION":
      return ShippingStatus.PROCESSED;
    case "IN_TRANSIT":
      return ShippingStatus.SHIPPING;
    case "DELIVERED":
    case "COMPLETED":
      return ShippingStatus.DELIVERED;
    case "CANCELLED":
      return ShippingStatus.CANCELLED;
    default:
      return ShippingStatus.PENDING;
  }
}

/** Gộp line_items theo SKU người bán, cộng dồn số lượng (202309 tách theo đơn vị). */
function aggregateLineItems(order: TikTokOrder) {
  const agg = new Map<
    string,
    { channelSku: string; productName: string; price: number; quantity: number }
  >();
  for (const li of order.line_items ?? []) {
    const sku = li.seller_sku || li.sku_id || li.id;
    const qty = li.quantity ?? 1;
    const existing = agg.get(sku);
    if (existing) {
      existing.quantity += qty;
    } else {
      agg.set(sku, {
        channelSku: sku,
        productName: li.product_name ?? sku,
        price: Number(li.sale_price ?? 0) || 0,
        quantity: qty,
      });
    }
  }
  return [...agg.values()];
}

export interface SyncOrdersOptions {
  /** Chỉ lấy đơn tạo từ mốc này (Unix seconds). Mặc định 90 ngày gần nhất. */
  createTimeGe?: number;
  createTimeLt?: number;
  maxPages?: number;
}

export interface SyncOrdersResult {
  fetched: number; // số đơn TikTok trả về
  created: number; // số Order tạo mới
  updated: number; // số Order cập nhật trạng thái
  itemsCreated: number; // số OrderItem tạo mới
  pages: number;
}

/**
 * Kéo đơn hàng thật từ TikTok Shop và upsert vào DB (idempotent theo
 * (channelId, orderCode)). CỐ Ý KHÔNG trừ tồn kho ở đây: đồng bộ lịch sử chạy
 * lặp nhiều lần, trừ kho theo lô sẽ làm tồn kho sai và không idempotent — việc
 * trừ kho thuộc luồng webhook "đơn mới" riêng.
 */
export async function syncTiktokOrders(
  channel: Channel,
  opts: SyncOrdersOptions = {}
): Promise<SyncOrdersResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);

  const nowSec = Math.floor(Date.now() / 1000);
  const createTimeGe = opts.createTimeGe ?? nowSec - 90 * 24 * 60 * 60;
  const createTimeLt = opts.createTimeLt ?? nowSec;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  // % phí tạm tính (GĐ1) khi đơn chưa được đối soát — số thật thay sau ở settlement.
  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.TIKTOK];

  const result: SyncOrdersResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    itemsCreated: 0,
    pages: 0,
  };

  let pageToken: string | undefined;
  do {
    const data = await fetchOrders({
      accessToken,
      shopCipher,
      createTimeGe,
      createTimeLt,
      pageSize: PAGE_SIZE,
      pageToken,
    });
    result.pages++;

    for (const o of data.orders ?? []) {
      result.fetched++;
      // Đồng bộ lô CỐ Ý không trừ kho (chỉ upsert), nên mỗi đơn một transaction nhẹ.
      const outcome = await prisma.$transaction((tx) =>
        upsertOrderTx(tx, channel, o, feeRate)
      );
      if (outcome.created) {
        result.created++;
        result.itemsCreated += outcome.itemsCreated;
      } else {
        result.updated++;
      }
    }

    pageToken = data.next_page_token || undefined;
  } while (pageToken && result.pages < maxPages);

  return result;
}

/**
 * Tạo mới hoặc cập nhật MỘT đơn TikTok TRONG một transaction cho trước. Tạo mới
 * thì kèm OrderItem + snapshot giá vốn; đã tồn tại thì chỉ cập nhật các trường
 * biến động (trạng thái, tổng tiền, vận đơn) — KHÔNG đụng OrderItem để giữ
 * nguyên snapshot giá vốn ban đầu.
 *
 * Nhận `tx` từ bên ngoài để webhook có thể GỘP upsert + trừ kho vào cùng một
 * transaction (đảm bảo nguyên tử); luồng đồng bộ lô thì tự bọc `$transaction`.
 */
async function upsertOrderTx(
  tx: Prisma.TransactionClient,
  channel: Channel,
  order: TikTokOrder,
  feeRate: number
): Promise<{ orderId: string; created: boolean; itemsCreated: number }> {
  const orderCode = order.id;
  const totalAmount = Number(order.payment?.total_amount ?? 0) || 0;
  const shippingStatus = mapShippingStatus(order.order_status);
  const paymentStatus = order.order_status === "UNPAID" ? "UNPAID" : "PAID";
  const customerName = order.recipient_address?.name?.trim() || "Khách TikTok";
  const customerPhone = order.recipient_address?.phone_number?.trim() || null;
  const trackingCode = order.tracking_number?.trim() || null;

  const existing = await tx.order.findUnique({
    where: { channelId_orderCode: { channelId: channel.id, orderCode } },
    select: { id: true },
  });

  if (existing) {
    await tx.order.update({
      where: { id: existing.id },
      data: {
        shippingStatus,
        paymentStatus,
        totalAmount,
        ...(trackingCode ? { trackingCode } : {}),
      },
    });
    return { orderId: existing.id, created: false, itemsCreated: 0 };
  }

  const lines = aggregateLineItems(order);

  // Nối SKU sàn → sản phẩm gốc (nếu đã liên kết) để snapshot giá vốn & gắn productId.
  const skus = lines.map((l) => l.channelSku);
  const mappings = skus.length
    ? await tx.channelProduct.findMany({
        where: { channelId: channel.id, channelSku: { in: skus }, productId: { not: null } },
        select: { channelSku: true, productId: true, product: { select: { costPrice: true } } },
      })
    : [];
  const mapBySku = new Map(mappings.map((m) => [m.channelSku, m]));

  const created = await tx.order.create({
    data: {
      channelId: channel.id,
      orderCode,
      customerName,
      customerPhone,
      totalAmount,
      platformFee: Math.round(totalAmount * feeRate), // GĐ1 — tạm tính
      paymentStatus,
      shippingStatus,
      trackingCode,
      itemCount: lines.length,
      createdAt: order.create_time ? new Date(order.create_time * 1000) : undefined,
    },
  });

  for (const line of lines) {
    const mp = mapBySku.get(line.channelSku);
    await tx.orderItem.create({
      data: {
        orderId: created.id,
        productId: mp?.productId ?? null,
        channelSku: line.channelSku,
        productName: line.productName,
        quantity: line.quantity,
        price: line.price,
        costPriceAtSale: String(mp?.product?.costPrice ?? 0),
      },
    });
  }

  return { orderId: created.id, created: true, itemsCreated: lines.length };
}

export interface SyncSettlementsOptions {
  maxPages?: number;
}

export interface SyncSettlementsResult {
  statements: number; // số bản kê quét qua
  transactions: number; // số dòng giao dịch đọc được
  ordersUpdated: number; // số Order được cập nhật quyết toán
  ordersNotFound: number; // giao dịch có order_id nhưng đơn chưa đồng bộ về
  pages: number;
}

/**
 * Kéo đối soát/dòng tiền thật từ TikTok và cập nhật số quyết toán cho từng Order
 * (isSettled/actualPayout/serviceFee...). Gom TẤT CẢ giao dịch của cùng một đơn
 * trong lượt chạy rồi GHI ĐÈ (không cộng dồn) — chạy lại vẫn ra đúng một kết quả.
 *
 * TikTok trả phí gộp (fee_amount); ta dồn vào serviceFee làm "phí sàn thực tế" —
 * đủ để bảng Cash Flow tính đúng tiền về ví (actualPayout). Bóc tách chi tiết
 * từng loại phí để sau khi có nguồn dữ liệu chi tiết hơn.
 */
export async function syncTiktokSettlements(
  channel: Channel,
  opts: SyncSettlementsOptions = {}
): Promise<SyncSettlementsResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const result: SyncSettlementsResult = {
    statements: 0,
    transactions: 0,
    ordersUpdated: 0,
    ordersNotFound: 0,
    pages: 0,
  };

  // Gom theo order_id trong toàn bộ lượt chạy để cập nhật mỗi đơn đúng một lần.
  const byOrder = new Map<
    string,
    { settlement: number; fee: number; time?: number }
  >();

  let stPageToken: string | undefined;
  do {
    const list = await fetchSettlements({
      accessToken,
      shopCipher,
      pageSize: PAGE_SIZE,
      pageToken: stPageToken,
    });
    result.pages++;

    for (const st of list.statements ?? []) {
      result.statements++;

      let txPageToken: string | undefined;
      let txPages = 0;
      do {
        const txData = await fetchStatementTransactions({
          accessToken,
          shopCipher,
          statementId: st.id,
          pageSize: PAGE_SIZE,
          pageToken: txPageToken,
        });
        txPages++;

        for (const trx of txData.statement_transactions ?? []) {
          if (!trx.order_id) continue;
          result.transactions++;
          const acc = byOrder.get(trx.order_id) ?? { settlement: 0, fee: 0 };
          acc.settlement += Number(trx.settlement_amount ?? 0) || 0;
          acc.fee += Math.abs(Number(trx.fee_amount ?? 0) || 0); // phí là số âm → lấy trị tuyệt đối
          acc.time = trx.order_create_time ?? st.statement_time ?? acc.time;
          byOrder.set(trx.order_id, acc);
        }

        txPageToken = txData.next_page_token || undefined;
      } while (txPageToken && txPages < maxPages);
    }

    stPageToken = list.next_page_token || undefined;
  } while (stPageToken && result.pages < maxPages);

  // Áp số quyết toán vào từng Order đã đồng bộ về trước đó.
  for (const [orderId, acc] of byOrder) {
    const order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: orderId } },
      select: { id: true },
    });
    if (!order) {
      result.ordersNotFound++;
      continue;
    }
    await prisma.order.update({
      where: { id: order.id },
      data: {
        isSettled: true,
        settledAt: acc.time ? new Date(acc.time * 1000) : new Date(),
        serviceFee: acc.fee, // dồn toàn bộ phí sàn thực tế vào đây
        actualPayout: acc.settlement,
      },
    });
    result.ordersUpdated++;
  }

  return result;
}

// ============================================================
// WEBHOOK THỜI GIAN THỰC — đơn mới / đổi trạng thái → upsert + trừ/hoàn kho
//
// Khác luồng đồng bộ lô (chỉ upsert), webhook xử lý TỒN KHO real-time: khi đơn
// đã chốt/chờ giao thì trừ kho; khi đơn hủy thì hoàn kho. Cả hai đều idempotent.
// ============================================================

/**
 * Các trạng thái TikTok mà đơn đã ĐƯỢC CHỐT và cần trừ kho (khách đã trả tiền,
 * shop phải giao). Loại UNPAID/ON_HOLD (chưa chắc chắn) và CANCELLED (xử lý riêng).
 */
function shouldDeductStock(tiktokStatus?: string): boolean {
  switch (tiktokStatus) {
    case "AWAITING_SHIPMENT":
    case "AWAITING_COLLECTION":
    case "PARTIALLY_SHIPPING":
    case "IN_TRANSIT":
    case "DELIVERED":
    case "COMPLETED":
      return true;
    default:
      return false;
  }
}

type StockOutcome =
  | "none"
  | "deducted"
  | "already-deducted"
  | "restored"
  | "already-restored";

/**
 * Trừ kho cho một đơn ĐÚNG MỘT LẦN. Chốt chặn: nếu `stockDeductedAt` đã có thì
 * bỏ qua (webhook đẩy lại nhiều lần). Dùng `decrement` nguyên tử (an toàn khi
 * nhiều đơn cùng trừ một SKU); CHO PHÉP tồn về âm để phơi bày tình trạng bán
 * vượt kho thay vì âm thầm chặn — đơn đã phát sinh thật trên sàn rồi.
 * Chỉ trừ các dòng đã liên kết SKU (productId != null); dòng chưa liên kết bỏ qua.
 */
async function deductStockTx(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ deducted: number; outcome: StockOutcome }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      stockDeductedAt: true,
      orderCode: true,
      items: {
        where: { productId: { not: null } },
        select: { productId: true, quantity: true },
      },
    },
  });
  if (!order) return { deducted: 0, outcome: "none" };
  if (order.stockDeductedAt) return { deducted: 0, outcome: "already-deducted" };

  let deducted = 0;
  for (const it of order.items) {
    await tx.product.update({
      where: { id: it.productId! },
      data: { quantityInStock: { decrement: it.quantity } },
    });
    await tx.inventoryLog.create({
      data: {
        productId: it.productId!,
        changeQuantity: -it.quantity,
        type: InventoryLogType.SYNC,
        reason: `Trừ kho tự động — webhook TikTok đơn ${order.orderCode}`,
        orderId,
      },
    });
    deducted += it.quantity;
  }

  // Đánh mốc kể cả khi 0 dòng khớp SKU: coi như đã xử lý, tránh quét lại mỗi webhook.
  await tx.order.update({
    where: { id: orderId },
    data: { stockDeductedAt: new Date() },
  });
  return { deducted, outcome: deducted > 0 ? "deducted" : "none" };
}

/**
 * Hoàn kho khi đơn bị hủy — mirror luồng hủy đơn thủ công ở routes/orders.ts:
 * tìm các bút toán TRỪ kho gắn với đơn, cộng trả lại, ghi mốc `stockRestoredAt`
 * để không hoàn lần hai. Chỉ hoàn khi trước đó thực sự đã trừ.
 */
async function restoreStockTx(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ restored: number; outcome: StockOutcome }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { stockRestoredAt: true, orderCode: true },
  });
  if (!order) return { restored: 0, outcome: "none" };
  if (order.stockRestoredAt) return { restored: 0, outcome: "already-restored" };

  const deductions = await tx.inventoryLog.findMany({
    where: { orderId, changeQuantity: { lt: 0 } },
  });

  let restored = 0;
  for (const log of deductions) {
    const qty = Math.abs(log.changeQuantity);
    await tx.product.update({
      where: { id: log.productId },
      data: { quantityInStock: { increment: qty } },
    });
    await tx.inventoryLog.create({
      data: {
        productId: log.productId,
        changeQuantity: qty,
        type: InventoryLogType.SYNC,
        reason: `Hoàn kho tự động — webhook TikTok hủy đơn ${order.orderCode}`,
        orderId,
      },
    });
    restored += qty;
  }

  if (restored > 0) {
    await tx.order.update({
      where: { id: orderId },
      data: { stockRestoredAt: new Date() },
    });
    return { restored, outcome: "restored" };
  }
  return { restored: 0, outcome: "none" };
}

export interface OrderEventResult {
  found: boolean; // TikTok có trả chi tiết đơn không
  created: boolean; // upsert tạo mới hay cập nhật
  orderStatus?: string; // trạng thái TikTok
  inventory: StockOutcome; // kết quả tác động tồn kho
  deducted?: number;
  restored?: number;
}

/**
 * XỬ LÝ MỘT SỰ KIỆN ĐỔI TRẠNG THÁI ĐƠN (từ webhook). Payload webhook chỉ có
 * order_id + trạng thái, nên phải gọi getOrderDetail để lấy đầy đủ line_items
 * rồi upsert + tác động tồn kho — TẤT CẢ trong một transaction để nguyên tử.
 */
export async function processTiktokOrderEvent(
  channel: Channel,
  orderId: string
): Promise<OrderEventResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const details = await getOrderDetail({ accessToken, shopCipher, orderIds: [orderId] });
  const order = details[0];
  if (!order) {
    return { found: false, created: false, inventory: "none" };
  }

  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.TIKTOK];

  return prisma.$transaction(async (tx) => {
    const up = await upsertOrderTx(tx, channel, order, feeRate);

    // Quyết định tác động tồn kho theo trạng thái TikTok.
    if (order.order_status === "CANCELLED") {
      const r = await restoreStockTx(tx, up.orderId);
      return {
        found: true,
        created: up.created,
        orderStatus: order.order_status,
        inventory: r.outcome,
        restored: r.restored,
      };
    }

    if (shouldDeductStock(order.order_status)) {
      const d = await deductStockTx(tx, up.orderId);
      return {
        found: true,
        created: up.created,
        orderStatus: order.order_status,
        inventory: d.outcome,
        deducted: d.deducted,
      };
    }

    // UNPAID/ON_HOLD… — đã upsert nhưng chưa đụng kho.
    return {
      found: true,
      created: up.created,
      orderStatus: order.order_status,
      inventory: "none",
    };
  });
}

/**
 * Tìm gian TikTok của một shop theo shop_id phía TikTok (externalShopId). Webhook
 * là kênh CÔNG KHAI nên chỉ dựa vào shop_id trong payload đã ký để định danh gian.
 */
export async function findTiktokChannelByShopId(
  shopId: string
): Promise<Channel | null> {
  return prisma.channel.findFirst({
    where: {
      channelName: ChannelName.TIKTOK,
      externalShopId: shopId,
      status: "ACTIVE",
      shopCipher: { not: null },
    },
  });
}
