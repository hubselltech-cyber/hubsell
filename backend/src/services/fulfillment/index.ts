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
import type { FulfillmentAdapter } from "./types";

const ADAPTERS: Partial<Record<ChannelName, FulfillmentAdapter>> = {
  [ChannelName.SHOPEE]: shopeeFulfillment,
  [ChannelName.LAZADA]: lazadaFulfillment,
  [ChannelName.TIKTOK]: tiktokFulfillment,
};

export function getFulfillmentAdapter(channelName: ChannelName): FulfillmentAdapter | null {
  return ADAPTERS[channelName] ?? null;
}

export * from "./types";
export { buildPickListPdf, type PickListOrder } from "./pick-list-pdf";
export { mergePdfParts } from "./merge-pdf";
