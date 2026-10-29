// ============================================================
// REGISTRY ĐĂNG SẢN PHẨM — gian nào dùng adapter nào (docs/SAO-CHEP-SAN-PHAM.md mục 2).
//
// Lát 1 (29/10/2026): CHỈ có adapter giả lập. Adapter thật Shopee/TikTok/Lazada
// (add_item / Create Product / product/create) là lát 1b — khi có, gian có
// refreshToken (TikTok thêm shopCipher) sẽ được trỏ sang adapter thật, giống
// marketplace/registry.ts chiều đọc.
// ============================================================

import type { Channel } from "@prisma/client";
import { mockListingAdapter } from "./mock-listing-adapter";
import type { ListingAdapter } from "./types";

/** true = gian đã ủy quyền API thật (sẽ cần adapter thật ở lát 1b). */
export function channelHasRealApi(channel: Channel): boolean {
  if (!channel.refreshToken) return false;
  if (channel.channelName === "TIKTOK" && !channel.shopCipher) return false;
  return channel.channelName !== "OFFLINE";
}

export function getListingAdapter(_channel: Channel): ListingAdapter {
  return mockListingAdapter;
}
