// ============================================================
// SỔ ĐĂNG KÝ ADAPTER XỬ LÝ ĐƠN theo sàn
//
// OFFLINE không có adapter: route tự đổi trạng thái nội bộ (không có sàn nào
// để gọi) và chỉ in phiếu nhặt hàng.
// ============================================================

import { ChannelName } from "@prisma/client";
import { shopeeFulfillment } from "./shopee";
import { lazadaFulfillment } from "./lazada";
import { tiktokFulfillment } from "./tiktok";
import { fakeFulfillment } from "./fake";
import type { FulfillmentAdapter } from "./types";

const ADAPTERS: Partial<Record<ChannelName, FulfillmentAdapter>> = {
  [ChannelName.SHOPEE]: shopeeFulfillment,
  [ChannelName.LAZADA]: lazadaFulfillment,
  [ChannelName.TIKTOK]: tiktokFulfillment,
};

/**
 * FULFILLMENT_FAKE=1 trên máy dev: mọi sàn dùng adapter giả lập (fake.ts) để soi luồng
 * Chuẩn bị hàng → In phiếu với gian seed không có token. Production luôn bỏ qua cờ này.
 */
const FAKE_ON = process.env.FULFILLMENT_FAKE === "1" && process.env.NODE_ENV !== "production";
const fakeCache = new Map<ChannelName, FulfillmentAdapter>();

export function getFulfillmentAdapter(channelName: ChannelName): FulfillmentAdapter | null {
  const real = ADAPTERS[channelName] ?? null;
  if (!FAKE_ON || !real) return real;
  let fake = fakeCache.get(channelName);
  if (!fake) {
    fake = fakeFulfillment(channelName);
    fakeCache.set(channelName, fake);
  }
  return fake;
}

export * from "./types";
export { buildPickListPdf, type PickListOrder } from "./pick-list-pdf";
export { mergePdfParts } from "./merge-pdf";
