// ============================================================
// ADAPTER ĐỌC ĐƠN 3 SÀN cho máy đọc con trỏ (Pha C lát 1 — "đọc bóng",
// docs/CUNG-HOA-LOP-GOI-SAN.md mục 5c)
//
// Mỗi sàn chỉ khai: gọi MỘT trang trong cửa sổ [from, to) trục update_time
// qua CỔNG GỌI SÀN, khóa dòng, cách lấy mốc/trạng thái. Phần thuần (dựng tham
// số từ cửa sổ, đọc trang sàn trả về) tách ra để test không cần mạng.
//
// Lát 1 chỉ đọc DANH SÁCH (Shopee get_order_list, TikTok orders/search, Lazada
// orders/get) — không gọi chi tiết, không ghi Order. Ghi bảng bóng
// sync_shadow_orders để so với đường cũ (SQL ở docs 5c).
// ============================================================

import type { Channel } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { PageResult, StreamSpec } from "../services/cursor-reader";
import { callMarketplace, type Platform } from "../services/marketplace-gateway";
import { PLATFORM_MAX_WINDOW_MS } from "../config/marketplace-read";
import type { TimeWindow } from "../lib/cursor-window";
import { fetchOrders as tiktokFetchOrders, type TikTokOrderSearchData } from "./tiktok/client";
import { getValidAccessToken as tiktokToken } from "./tiktok/service";
import { getTikTokConfig } from "./tiktok/config";
import { getOrderList as shopeeOrderList, type ShopeeOrderListData } from "./shopee/client";
import { getValidShopeeAccessToken } from "./shopee/service";
import { getShopeeConfig } from "./shopee/config";
import { getOrders as lazadaGetOrders, type LazadaOrder } from "./lazada/client";
import { getValidLazadaAccessToken } from "./lazada/service";
import { getLazadaConfig } from "./lazada/config";

/** Một dòng bóng: khóa sàn + mốc biến động (nếu sàn trả ở danh sách) + trạng thái sàn. */
export interface ShadowRow {
  orderCode: string;
  /** Giây Unix; null khi danh sách không mang update_time (Shopee). */
  updateTime: number | null;
  status: string | null;
}

export const SHADOW_STREAM = "orders-shadow";

// ---------- Phần thuần: cửa sổ → tham số, trang sàn → PageResult ----------

const sec = (ms: number) => Math.floor(ms / 1000);

/** TikTok: update_time_ge (đóng) / update_time_lt (mở) đúng [from, to). */
export function tiktokWindowParams(win: TimeWindow) {
  return { updateTimeGe: sec(win.from), updateTimeLt: Math.ceil(win.to / 1000) };
}

export function tiktokPage(data: TikTokOrderSearchData, pageSize: number): PageResult<ShadowRow> {
  return {
    rows: (data.orders ?? []).map((o) => ({ orderCode: o.id, updateTime: o.update_time ?? null, status: o.status ?? null })),
    nextToken: data.next_page_token || null,
    total: data.total_count,
    pageSize,
  };
}

/** Shopee: time_from / time_to đều đóng, giây → phủ rộng hơn ở ranh (đọc trùng vô hại). */
export function shopeeWindowParams(win: TimeWindow) {
  return { timeFrom: sec(win.from), timeTo: Math.ceil(win.to / 1000) };
}

export function shopeePage(data: ShopeeOrderListData, pageSize: number): PageResult<ShadowRow> {
  const r = data.response;
  return {
    rows: (r?.order_list ?? []).map((o) => ({ orderCode: o.order_sn, updateTime: null, status: o.order_status ?? null })),
    nextToken: r?.more && r.next_cursor ? r.next_cursor : null,
    pageSize,
  };
}

/** Lazada: update_after / update_before ISO; phân trang OFFSET (token = offset kế). */
export function lazadaWindowParams(win: TimeWindow) {
  return { updatedAfter: new Date(win.from).toISOString(), updatedBefore: new Date(win.to).toISOString() };
}

export function lazadaPage(
  data: { count: number; orders: LazadaOrder[] },
  offset: number,
  pageSize: number
): PageResult<ShadowRow> {
  const rows = data.orders.map((o) => {
    const t = o.updated_at ? Date.parse(o.updated_at) : NaN;
    return {
      orderCode: String(o.order_number ?? o.order_id ?? ""),
      updateTime: Number.isFinite(t) ? Math.floor(t / 1000) : null,
      status: o.statuses?.[0] ?? null,
    };
  });
  const next = offset + data.orders.length;
  return {
    rows: rows.filter((r) => r.orderCode),
    nextToken: data.orders.length >= pageSize && next < data.count ? String(next) : null,
    total: data.count,
    pageSize,
  };
}

// ---------- Ghi bảng bóng (một câu INSERT … ON CONFLICT cho cả trang) ----------

export async function persistShadowRows(channelId: string, rows: ShadowRow[], tx: Prisma.TransactionClient): Promise<void> {
  if (!rows.length) return;
  // Trùng mã trong cùng trang (sàn trả trùng) → giữ mốc mới nhất, tránh "ON CONFLICT … affect row a second time".
  const byCode = new Map<string, ShadowRow>();
  for (const r of rows) {
    const prev = byCode.get(r.orderCode);
    if (!prev || (r.updateTime ?? 0) >= (prev.updateTime ?? 0)) byCode.set(r.orderCode, r);
  }
  const uniq = [...byCode.values()];
  await tx.$executeRaw`
    INSERT INTO "sync_shadow_orders" ("channelId", "orderCode", "platformUpdatedAt", "status", "firstSeenAt", "lastSeenAt", "seenCount")
    SELECT ${channelId}, u.code, to_timestamp(u.ts) AT TIME ZONE 'UTC', u.st, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), 1
      FROM unnest(${uniq.map((r) => r.orderCode)}::text[], ${uniq.map((r) => r.updateTime)}::bigint[], ${uniq.map((r) => r.status)}::text[]) AS u(code, ts, st)
    ON CONFLICT ("channelId", "orderCode") DO UPDATE SET
      "platformUpdatedAt" = GREATEST(COALESCE(EXCLUDED."platformUpdatedAt", "sync_shadow_orders"."platformUpdatedAt"), COALESCE("sync_shadow_orders"."platformUpdatedAt", EXCLUDED."platformUpdatedAt")),
      "status" = COALESCE(EXCLUDED."status", "sync_shadow_orders"."status"),
      "lastSeenAt" = (now() AT TIME ZONE 'UTC'),
      "seenCount" = "sync_shadow_orders"."seenCount" + 1`;
}

// ---------- Dựng StreamSpec cho một gian ----------

/** Điểm chạm ra sàn — test thay bằng bản giả, mã thật dùng client hiện có. */
export interface OrderReadDeps {
  tiktok: {
    token: (ch: Channel) => Promise<{ accessToken: string; shopCipher: string }>;
    fetch: typeof tiktokFetchOrders;
    appKey: () => string;
  };
  shopee: {
    token: (ch: Channel) => Promise<{ accessToken: string; shopId: string }>;
    list: typeof shopeeOrderList;
    appKey: () => string;
  };
  lazada: {
    token: (ch: Channel) => Promise<string>;
    list: typeof lazadaGetOrders;
    appKey: () => string;
  };
}

export const defaultOrderReadDeps: OrderReadDeps = {
  tiktok: { token: (ch) => tiktokToken(ch), fetch: tiktokFetchOrders, appKey: () => getTikTokConfig().appKey },
  shopee: { token: (ch) => getValidShopeeAccessToken(ch), list: shopeeOrderList, appKey: () => getShopeeConfig().partnerId },
  lazada: { token: (ch) => getValidLazadaAccessToken(ch), list: lazadaGetOrders, appKey: () => getLazadaConfig().appKey },
};

const PAGE = { TIKTOK: 50, SHOPEE: 100, LAZADA: 100 } as const;
const ENDPOINT = {
  TIKTOK: "/order/202309/orders/search",
  SHOPEE: "/api/v2/order/get_order_list",
  LAZADA: "/orders/get",
} as const;

/**
 * StreamSpec "đọc bóng đơn" của một gian. `initialCursorAt` do nơi ghi danh quyết
 * (enrollStream) — ở đây chỉ dùng khi dòng con trỏ chưa có.
 */
export function shadowOrderSpec(
  channel: Channel,
  deps: OrderReadDeps = defaultOrderReadDeps
): StreamSpec<ShadowRow, Prisma.TransactionClient> {
  const platform = channel.channelName as Platform;
  if (platform !== "SHOPEE" && platform !== "TIKTOK" && platform !== "LAZADA") {
    throw new Error(`đọc bóng đơn: sàn ${channel.channelName} không hỗ trợ`);
  }
  const shop = channel.externalShopId ?? channel.id;
  const gate = <T>(app: string, fn: () => Promise<T>) =>
    callMarketplace({ platform, app, shop, endpoint: ENDPOINT[platform] }, fn);

  const fetchPage = async (win: TimeWindow, token: string | undefined): Promise<PageResult<ShadowRow>> => {
    if (platform === "TIKTOK") {
      const { accessToken, shopCipher } = await deps.tiktok.token(channel);
      const data = await gate(deps.tiktok.appKey(), () =>
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
      return tiktokPage(data, PAGE.TIKTOK);
    }
    if (platform === "SHOPEE") {
      const { accessToken, shopId } = await deps.shopee.token(channel);
      const data = await gate(deps.shopee.appKey(), () =>
        deps.shopee.list({
          accessToken,
          shopId,
          ...shopeeWindowParams(win),
          pageSize: PAGE.SHOPEE,
          cursor: token,
          timeRangeField: "update_time",
        })
      );
      return shopeePage(data, PAGE.SHOPEE);
    }
    const accessToken = await deps.lazada.token(channel);
    const offset = token ? Number(token) : 0;
    const data = await gate(deps.lazada.appKey(), () =>
      deps.lazada.list({ accessToken, ...lazadaWindowParams(win), offset, limit: PAGE.LAZADA })
    );
    return lazadaPage(data, offset, PAGE.LAZADA);
  };

  return {
    channelId: channel.id,
    stream: SHADOW_STREAM,
    maxWindowMs: PLATFORM_MAX_WINDOW_MS[platform],
    initialCursorAt: (now) => now - 30 * 60_000,
    fetchPage,
    rowKey: (r) => r.orderCode,
    persist: (rows, tx) => persistShadowRows(channel.id, rows, tx),
  };
}
