// ============================================================
// REGISTRY ĐĂNG SẢN PHẨM — gian nào dùng adapter nào (docs/SAO-CHEP-SAN-PHAM.md mục 2, 10).
//
// Gian đã ủy quyền API thật (refreshToken; TikTok thêm shopCipher) → adapter THẬT
// của sàn (Shopee + TikTok đã đăng thật 29/10/2026; Lazada chưa kiểm gian thật).
// Gian không token → adapter giả lập: seed dev local và tài khoản DEMO cho người
// duyệt app sàn (scripts/seed-isv-reviewer.ts cố ý không đặt refreshToken, kể cả
// trên prod). Gian thật không bao giờ bị xóa refreshToken (mất ủy quyền đổi status,
// giữ token) nên không rơi vào giả lập.
// ============================================================

import type { Channel } from "@prisma/client";
import { lazadaListingAdapter } from "./lazada-listing-adapter";
import { mockListingAdapter } from "./mock-listing-adapter";
import { shopeeListingAdapter } from "./shopee-listing-adapter";
import { tiktokListingAdapter } from "./tiktok-listing-adapter";
import type { ListingAdapter } from "./types";

/** true = gian đã ủy quyền API thật. */
export function channelHasRealApi(channel: Channel): boolean {
  if (!channel.refreshToken) return false;
  if (channel.channelName === "TIKTOK" && !channel.shopCipher) return false;
  return channel.channelName !== "OFFLINE";
}

export function getListingAdapter(channel: Channel): ListingAdapter {
  if (!channelHasRealApi(channel)) return mockListingAdapter;
  switch (channel.channelName) {
    case "SHOPEE":
      return shopeeListingAdapter;
    case "TIKTOK":
      return tiktokListingAdapter;
    case "LAZADA":
      return lazadaListingAdapter;
    default:
      return mockListingAdapter;
  }
}
