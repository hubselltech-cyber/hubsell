// ============================================================
// REGISTRY — chọn Adapter phù hợp cho từng gian hàng.
//
// Đây là điểm quyết định "gian này dùng API thật hay mock". Tầng trên chỉ hỏi
// registry, không tự if/else theo sàn ở khắp nơi. Thêm sàn mới = đăng ký ở đây.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import type { MarketplaceProductAdapter } from "./types";
import { shopeeProductAdapter } from "./adapters/shopee-adapter";
import { mockProductAdapter } from "./adapters/mock-adapter";

/**
 * Trả về adapter sản phẩm cho một gian:
 *   - Shopee đã uỷ quyền API thật (có refresh_token) → adapter Shopee thật.
 *   - Còn lại (Lazada, gian mock cũ, TikTok chưa có adapter SP) → adapter mock.
 *
 * Nhờ kiểm `refreshToken`, các gian Shopee MOCK cũ (không có token) vẫn chạy mock
 * → dữ liệu demo trên UI được giữ nguyên, chỉ gian Shopee thật mới kéo API thật.
 */
export function getProductAdapter(channel: Channel): MarketplaceProductAdapter {
  if (channel.channelName === ChannelName.SHOPEE && channel.refreshToken) {
    return shopeeProductAdapter;
  }
  return mockProductAdapter;
}
