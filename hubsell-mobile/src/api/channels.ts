import { api } from "./client";
import type { CatalogPendingChannel, ChannelListItem } from "../types/api";

/** DS gian hàng của shop — màn lọc đơn ("Lọc theo shop") và màn Gian hàng. */
export function fetchChannels() {
  return api<ChannelListItem[]>("/api/channels");
}

/** Ba sàn nối bằng ủy quyền thật; OFFLINE chỉ quản trị nền tảng tạo trên web. */
export type OauthPlatform = "SHOPEE" | "TIKTOK" | "LAZADA";

/**
 * Link trang ủy quyền của sàn — backend ký state (Shopee/Lazada mang ownerId,
 * TikTok trả `state` ngẫu nhiên để app đối chiếu lúc quay về). `channelId` =
 * luồng KẾT NỐI LẠI một gian cụ thể (backend đối chiếu shop_id, không ghi nhầm
 * gian). Link Shopee luồng cũ sống ~5 phút → xin đúng lúc bấm.
 */
export function fetchAuthUrl(platform: OauthPlatform, channelId?: string) {
  // client=app: backend ký dấu vào state → callback nảy về hubsellmobile://channels
  // (Shopee/Lazada ở backend, TikTok ở trang callback web) — lát 2, 28/10/2026.
  const q = new URLSearchParams({ client: "app" });
  if (channelId) q.set("channelId", channelId);
  return api<{ url: string; state?: string }>(
    `/api/channels/${platform.toLowerCase()}/auth-url?${q.toString()}`
  );
}

interface ConnectedChannel {
  id: string;
  channelName: string;
  shopName: string;
  status?: string;
  isNew?: boolean;
}

/** Shopee bật `code` + `shop_id` về app (thay vì tự đổi token ở callback). */
export function connectShopeeCode(code: string, shopId: string, channelId?: string) {
  return api<{ message: string; channel: ConnectedChannel }>("/api/channels/shopee/connect", {
    method: "POST",
    body: { code, shopId, channelId },
  });
}

export function connectLazadaCode(code: string, channelId?: string) {
  return api<{ message: string; channel: ConnectedChannel }>("/api/channels/lazada/connect", {
    method: "POST",
    body: { code, channelId },
  });
}

/** TikTok: app cầm auth_code → backend đổi token + lấy shop_cipher + lưu gian. */
export function connectTiktokCode(code: string, channelId?: string) {
  return api<{ message?: string; connected: number; channels: ConnectedChannel[] }>(
    "/api/channels/tiktok/callback",
    { method: "POST", body: { code, channelId } }
  );
}

/** Gian vừa nối mà danh mục sản phẩm chưa về lần đầu — để dải tiến độ hỏi nhịp. */
export function fetchCatalogPending() {
  return api<{ pending: CatalogPendingChannel[] }>("/api/finance/sku-products/catalog-pending");
}
