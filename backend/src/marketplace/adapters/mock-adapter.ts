// ============================================================
// ADAPTER GIẢ LẬP — cho các gian CHƯA nối API thật.
//
// Dùng cho: các sàn chưa tích hợp (Lazada), hoặc các gian mock cũ (Shopee/TikTok
// tạo thủ công lúc dev, không có refresh_token). Giữ nguyên hành vi cũ (đọc
// MOCK_CATALOG) để dữ liệu demo trên UI không mất — chỉ chuẩn hoá lại đầu ra.
// ============================================================

import type { Channel } from "@prisma/client";
import { MOCK_CATALOG, mockImageFor } from "../mockMarketplace";
import type { MarketplaceProductAdapter, NormalizedChannelProduct } from "../types";

export const mockProductAdapter: MarketplaceProductAdapter = {
  name: "mock",
  async fetchProducts(channel: Channel): Promise<NormalizedChannelProduct[]> {
    const catalog = MOCK_CATALOG[channel.channelName] ?? [];
    return catalog.map((item) => ({
      channelSku: item.channelSku,
      productName: item.name,
      variantName: null,
      price: item.price,
      imageUrl: mockImageFor(channel.channelName, item.name),
      externalId: null,
      itemSku: null,
      channelStock: null, // gian mock không có tồn sàn thật
      channelStockLocationId: null,
      status: "ACTIVE" as const,
    }));
  },
};
