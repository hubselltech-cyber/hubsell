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
import { lazadaProductAdapter } from "./adapters/lazada-adapter";
import { mockProductAdapter } from "./adapters/mock-adapter";

/**
 * Trả về adapter sản phẩm cho một gian:
 *   - Shopee/Lazada đã uỷ quyền API thật (có refresh_token) → adapter thật.
 *   - Còn lại (gian mock cũ, TikTok chưa có adapter SP) → adapter mock.
 *
 * Nhờ kiểm `refreshToken`, các gian MOCK cũ (không có token) vẫn chạy mock
 * → dữ liệu demo trên UI được giữ nguyên, chỉ gian nối thật mới kéo API thật.
 */
export function getProductAdapter(channel: Channel): MarketplaceProductAdapter {
  if (channel.channelName === ChannelName.SHOPEE && channel.refreshToken) {
    return shopeeProductAdapter;
  }
  if (channel.channelName === ChannelName.LAZADA && channel.refreshToken) {
    return lazadaProductAdapter;
  }
  return mockProductAdapter;
}
