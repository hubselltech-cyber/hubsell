// ============================================================
// REGISTRY ĐĂNG SẢN PHẨM — gian nào dùng adapter nào (docs/SAO-CHEP-SAN-PHAM.md mục 2, 10).
//
// Gian đã ủy quyền API thật (refreshToken; TikTok thêm shopCipher) → adapter
// THẬT của sàn (lát 1b, chưa kiểm trên gian thật). Gian không token (seed dev,
// demo) → adapter giả lập. Không bao giờ để gian thật rơi vào giả lập: khách
// sẽ thấy "Đã đăng" mà sàn không có gì.
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

/**
 * Cờ bật tính năng ở production (lát 1b chưa kiểm gian thật): đặt
 * LISTING_COPY_ENABLED=1 trên Render mới mở; dev/local luôn bật.
 */
export function listingCopyEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.LISTING_COPY_ENABLED === "1";
}
