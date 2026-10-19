// ============================================================
// ADAPTER GHI ĐƠN 3 SÀN cho máy đọc con trỏ (Pha C lát 2 — docs/CUNG-HOA-LOP-GOI-SAN.md 5d)
//
// Luồng `orders` (cờ gian = dòng sync_cursors stream 'orders', CHƯA bật gian nào):
// đọc cửa sổ update_time qua cổng gọi sàn, lấy CHI TIẾT (Shopee get_order_detail
// ≤ 50 mã/lệnh, Lazada orders/items/get ≤ 50 id/lệnh; TikTok search đã trả trọn
// đơn), rồi ghi Order bằng ĐÚNG hàm upsert của đường cũ (upsert*OrderTx +
// plan*OrderUpdate "chỉ ghi khi khác") — một luật ghi đơn, hai đường đọc.
//
// Ghi từng đơn MỘT giao dịch (như đường cũ): webhook / worker cũ chạy song song
// cùng đơn → đụng unique (P2002) chỉ hỏng đơn đó, đọc lại rồi ghi tiếp; trong
// một giao dịch lớn thì một lỗi làm hỏng cả trang. Con trỏ vẫn ghi SAU khi cả
// trang xong (kho con trỏ) → at-least-once + upsert idempotent = không mất.
//
// CHƯA làm ở lát 2 (đường cũ vẫn chạy song song nên vẫn có): hỏi lại ước tính
// escrow Shopee cho đơn đổi trạng thái, chuông giao thất bại Lazada, mốc nước cũ.
// ============================================================

import type { Channel, Prisma } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { PageResult, StreamSpec } from "../services/cursor-reader";
import { callMarketplace, type Platform } from "../services/marketplace-gateway";
import { PLATFORM_MAX_WINDOW_MS } from "../config/marketplace-read";
import type { TimeWindow } from "../lib/cursor-window";
import { PLATFORM_FEE_RATE } from "../marketplace/mockMarketplace";
import { fetchExistingOrdersByCode, hasPlannedChanges, needsItemImageBackfill } from "./order-sync-write";
import { finishStockPush, stageStockPush, type StockPushTicket } from "./inventory-push";
import {
  fetchOrders as tiktokFetchOrders,
  type TikTokOrder,
  type TikTokOrderSearchData,
} from "./tiktok/client";
import {
  getValidAccessToken as tiktokToken,
  planTiktokOrderUpdate,
  TIKTOK_EXISTING_SELECT,
  upsertTiktokOrderTx,
  type TiktokExistingOrder,
} from "./tiktok/service";
import { getTikTokConfig } from "./tiktok/config";
import {
  getOrderDetail as shopeeOrderDetail,
  getOrderList as shopeeOrderList,
  type ShopeeOrderDetail,
  type ShopeeOrderListData,
} from "./shopee/client";
import {
  getValidShopeeAccessToken,
  planShopeeOrderUpdate,
  SHOPEE_EXISTING_SELECT,
  upsertShopeeOrderTx,
  type ShopeeExistingOrder,
} from "./shopee/service";
import { getShopeeConfig } from "./shopee/config";
import {
  getMultipleOrderItems as lazadaOrderItems,
  getOrders as lazadaGetOrders,
  type LazadaOrder,
  type LazadaOrderItem,
} from "./lazada/client";
import {
  getValidLazadaAccessToken,
  LAZADA_EXISTING_SELECT,
  lazadaOrderNeedsWrite,
  upsertLazadaOrderTx,
  type LazadaExistingOrder,
} from "./lazada/service";
import { getLazadaConfig } from "./lazada/config";
import { lazadaPage, lazadaWindowParams, shopeePage, shopeeWindowParams, tiktokPage, tiktokWindowParams } from "./order-read-adapters";

export const WRITE_STREAM = "orders";

export type WriteRow =
  | { platform: "TIKTOK"; orderCode: string; order: TikTokOrder }
  | { platform: "SHOPEE"; orderCode: string; order: ShopeeOrderDetail }
  | { platform: "LAZADA"; orderCode: string; order: LazadaOrder; items: LazadaOrderItem[] };

/** Số đo một lượt — worker ghi log; đường cũ có `fetched/created/updated/unchanged` cùng nghĩa. */
export interface WriteStats {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Đụng unique với webhook/worker cũ cùng lúc → đọc lại rồi ghi tiếp. */
  raced: number;
}

// ---------- Phần thuần: trang sàn → dòng ghi ----------

export function tiktokWriteRows(data: TikTokOrderSearchData, pageSize: number): PageResult<WriteRow> {
  const p = tiktokPage(data, pageSize);
  return { ...p, rows: (data.orders ?? []).map((o) => ({ platform: "TIKTOK" as const, orderCode: o.id, order: o })) };
}

export function shopeeWriteRows(list: ShopeeOrderListData, details: ShopeeOrderDetail[], pageSize: number): PageResult<WriteRow> {
  const p = shopeePage(list, pageSize);
  return { ...p, rows: details.map((d) => ({ platform: "SHOPEE" as const, orderCode: d.order_sn, order: d })) };
}

export function lazadaWriteRows(
  data: { count: number; orders: LazadaOrder[] },
  itemsByOrder: Map<string, LazadaOrderItem[]>,
  offset: number,
  pageSize: number
): PageResult<WriteRow> {
  const p = lazadaPage(data, offset, pageSize);
  return {
    ...p,
    rows: data.orders
      .filter((o) => o.order_id != null)
      .map((o) => ({
        platform: "LAZADA" as const,
        orderCode: String(o.order_number ?? o.order_id),
        order: o,
        items: itemsByOrder.get(String(o.order_id)) ?? [],
      })),
  };
}

/** Prisma P2002 = đụng unique (channelId, orderCode) với bên ghi song song. */
export function isUniqueRace(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

// ---------- Điểm chạm ra ngoài (test thay bằng bản giả) ----------

export interface OrderWriteDeps {
  tiktok: {
    token: (ch: Channel) => Promise<{ accessToken: string; shopCipher: string }>;
    fetch: typeof tiktokFetchOrders;
    appKey: () => string;
    upsert: typeof upsertTiktokOrderTx;
  };
  shopee: {
    token: (ch: Channel) => Promise<{ accessToken: string; shopId: string }>;
    list: typeof shopeeOrderList;
    detail: (accessToken: string, shopId: string, sns: string[]) => Promise<ShopeeOrderDetail[]>;
    appKey: () => string;
    upsert: typeof upsertShopeeOrderTx;
  };
  lazada: {
    token: (ch: Channel) => Promise<string>;
    list: typeof lazadaGetOrders;
    items: (accessToken: string, ids: (number | string)[]) => Promise<Map<string, LazadaOrderItem[]>>;
    appKey: () => string;
    upsert: typeof upsertLazadaOrderTx;
  };
}

export const defaultOrderWriteDeps: OrderWriteDeps = {
  tiktok: {
    token: (ch) => tiktokToken(ch),
    fetch: tiktokFetchOrders,
    appKey: () => getTikTokConfig().appKey,
    upsert: upsertTiktokOrderTx,
  },
  shopee: {
    token: (ch) => getValidShopeeAccessToken(ch),
    list: shopeeOrderList,
    detail: (t, s, sns) => shopeeOrderDetail(t, s, sns),
    appKey: () => getShopeeConfig().partnerId,
    upsert: upsertShopeeOrderTx,
  },
  lazada: {
    token: (ch) => getValidLazadaAccessToken(ch),
    list: lazadaGetOrders,
    items: (t, ids) => lazadaOrderItems(t, ids),
    appKey: () => getLazadaConfig().appKey,
    upsert: upsertLazadaOrderTx,
  },
};

const PAGE = { TIKTOK: 50, SHOPEE: 100, LAZADA: 100 } as const;
/** Trần sàn: Shopee get_order_detail 50 mã/lệnh; Lazada orders/items/get 50 id/lệnh. */
const DETAIL_BATCH = 50;
const EP = {
  TIKTOK_SEARCH: "/order/202309/orders/search",
  SHOPEE_LIST: "/api/v2/order/get_order_list",
  SHOPEE_DETAIL: "/api/v2/order/get_order_detail",
  LAZADA_LIST: "/orders/get",
  LAZADA_ITEMS: "/orders/items/get",
} as const;

function feeRateOf(channel: Channel, platform: Platform): number {
  return Number(channel.feeRate) > 0 ? Number(channel.feeRate) : PLATFORM_FEE_RATE[ChannelName[platform]];
}

/** StreamSpec ghi đơn của một gian + số đo lượt (worker đọc sau `readByCursor`). */
export function writeOrderSpec(
  channel: Channel,
  deps: OrderWriteDeps = defaultOrderWriteDeps
): { spec: StreamSpec<WriteRow, Prisma.TransactionClient>; stats: WriteStats } {
  const platform = channel.channelName as Platform;
  if (platform !== "SHOPEE" && platform !== "TIKTOK" && platform !== "LAZADA") {
    throw new Error(`ghi đơn: sàn ${channel.channelName} không hỗ trợ`);
  }
  const shop = channel.externalShopId ?? channel.id;
  const gate = <T>(app: string, endpoint: string, fn: () => Promise<T>, tokens = 1) =>
    callMarketplace({ platform, app, shop, endpoint, tokens }, fn);
  const feeRate = feeRateOf(channel, platform);
  const stats: WriteStats = { fetched: 0, created: 0, updated: 0, unchanged: 0, raced: 0 };
  /** Phiếu đẩy tồn Lazada chốt SAU commit (như đường cũ). */
  let pendingTickets: StockPushTicket[] = [];

  const fetchPage = async (win: TimeWindow, token: string | undefined): Promise<PageResult<WriteRow>> => {
    if (platform === "TIKTOK") {
      const { accessToken, shopCipher } = await deps.tiktok.token(channel);
      const data = await gate(deps.tiktok.appKey(), EP.TIKTOK_SEARCH, () =>
        deps.tiktok.fetch({
          accessToken,
          shopCipher,
          ...tiktokWindowParams(win),
          pageSize: PAGE.TIKTOK,
          pageToken: token,
          sortField: "update_time",
          sortOrder: "DESC",
        })
      );
      return tiktokWriteRows(data, PAGE.TIKTOK);
    }
    if (platform === "SHOPEE") {
      const { accessToken, shopId } = await deps.shopee.token(channel);
      const app = deps.shopee.appKey();
      const list = await gate(app, EP.SHOPEE_LIST, () =>
        deps.shopee.list({ accessToken, shopId, ...shopeeWindowParams(win), pageSize: PAGE.SHOPEE, cursor: token, timeRangeField: "update_time" })
      );
      const sns = (list.response?.order_list ?? []).map((o) => o.order_sn);
      const details: ShopeeOrderDetail[] = [];
      for (let i = 0; i < sns.length; i += DETAIL_BATCH) {
        const batch = sns.slice(i, i + DETAIL_BATCH);
        details.push(...(await gate(app, EP.SHOPEE_DETAIL, () => deps.shopee.detail(accessToken, shopId, batch))));
      }
      return shopeeWriteRows(list, details, PAGE.SHOPEE);
    }
    const accessToken = await deps.lazada.token(channel);
    const app = deps.lazada.appKey();
    const offset = token ? Number(token) : 0;
    const data = await gate(app, EP.LAZADA_LIST, () =>
      deps.lazada.list({ accessToken, ...lazadaWindowParams(win), offset, limit: PAGE.LAZADA })
    );
    const ids = data.orders.map((o) => o.order_id).filter((x): x is number | string => x != null);
    const itemsByOrder = new Map<string, LazadaOrderItem[]>();
    for (let i = 0; i < ids.length; i += DETAIL_BATCH) {
      const batch = ids.slice(i, i + DETAIL_BATCH);
      for (const [k, v] of await gate(app, EP.LAZADA_ITEMS, () => deps.lazada.items(accessToken, batch))) itemsByOrder.set(k, v);
    }
    return lazadaWriteRows(data, itemsByOrder, offset, PAGE.LAZADA);
  };

  /** Ghi một đơn trong giao dịch riêng; đụng unique → đọc lại dòng rồi ghi lần hai. */
  async function writeOne(
    run: (existing: TiktokExistingOrder | ShopeeExistingOrder | LazadaExistingOrder | null | undefined) => Promise<{ created: boolean; changed: boolean }>,
    existing: TiktokExistingOrder | ShopeeExistingOrder | LazadaExistingOrder | null
  ) {
    let outcome: { created: boolean; changed: boolean };
    try {
      outcome = await run(existing);
    } catch (err) {
      if (!isUniqueRace(err)) throw err;
      stats.raced++;
      outcome = await run(undefined); // undefined = hàm upsert tự đọc lại dòng hiện có
    }
    if (outcome.created) stats.created++;
    else if (outcome.changed) stats.updated++;
    else stats.unchanged++;
  }

  const persist = async (rows: WriteRow[]): Promise<void> => {
    stats.fetched += rows.length;
    const codes = rows.map((r) => r.orderCode);
    if (platform === "TIKTOK") {
      const existingByCode = await fetchExistingOrdersByCode(prisma, channel.id, codes, TIKTOK_EXISTING_SELECT);
      for (const r of rows) {
        if (r.platform !== "TIKTOK") continue;
        const existing = existingByCode.get(r.orderCode) ?? null;
        if (existing && !hasPlannedChanges(planTiktokOrderUpdate(existing, r.order)) && !needsItemImageBackfill(existing.createdAt)) {
          stats.unchanged++;
          continue;
        }
        await writeOne((ex) => prisma.$transaction((tx) => deps.tiktok.upsert(tx, channel, r.order, feeRate, ex as TiktokExistingOrder | null | undefined)), existing);
      }
      return;
    }
    if (platform === "SHOPEE") {
      const existingByCode = await fetchExistingOrdersByCode(prisma, channel.id, codes, SHOPEE_EXISTING_SELECT);
      for (const r of rows) {
        if (r.platform !== "SHOPEE") continue;
        const existing = existingByCode.get(r.orderCode) ?? null;
        if (existing && !hasPlannedChanges(planShopeeOrderUpdate(existing, r.order)) && !needsItemImageBackfill(existing.createdAt)) {
          stats.unchanged++;
          continue;
        }
        await writeOne((ex) => prisma.$transaction((tx) => deps.shopee.upsert(tx, channel, r.order, feeRate, ex as ShopeeExistingOrder | null | undefined)), existing);
      }
      return;
    }
    const existingByCode = await fetchExistingOrdersByCode(prisma, channel.id, codes, LAZADA_EXISTING_SELECT);
    for (const r of rows) {
      if (r.platform !== "LAZADA") continue;
      const existing = existingByCode.get(r.orderCode) ?? null;
      if (existing && !lazadaOrderNeedsWrite(existing, r.order, r.items)) {
        stats.unchanged++;
        continue;
      }
      await writeOne(
        (ex) =>
          prisma.$transaction(async (tx) => {
            const out = await deps.lazada.upsert(tx, channel, r.order, r.items, ex as LazadaExistingOrder | null | undefined);
            if (out.stockSync) {
              const ticket = await stageStockPush(tx, out.stockSync.productIds, {
                source: `đồng bộ Lazada đơn ${r.orderCode}`,
                oldAvailable: out.stockSync.oldAvailable,
              });
              if (ticket) pendingTickets.push(ticket);
            }
            return out;
          }),
        existing
      );
    }
  };

  const afterCommit = async () => {
    const tickets = pendingTickets;
    pendingTickets = [];
    for (const t of tickets) await finishStockPush(t);
  };

  return {
    stats,
    spec: {
      channelId: channel.id,
      stream: WRITE_STREAM,
      maxWindowMs: PLATFORM_MAX_WINDOW_MS[platform],
      initialCursorAt: (now) => now - 30 * 60_000,
      fetchPage,
      rowKey: (r) => r.orderCode,
      persist,
      afterCommit,
    },
  };
}
