// ============================================================
// ADAPTER TIKTOK SHOP — GIỮ CHỖ (04/09/2026, anh Trung: "giữ chỗ trong code")
//
// Luồng thật của sàn (API 202309, đã đối chiếu partner.tiktokshop.com):
//   1. Order detail trả `packages[].id` (mỗi đơn có thể nhiều kiện).
//   2. Ship Package: POST /fulfillment/202309/packages/{package_id}/ship
//      body { handover_method: "PICKUP" | "DROP_OFF", pickup_slot?: {start_time,
//      end_time} } — pickup được LSP tới lấy trong 48h; drop-off seller tự mang.
//   3. Get Package Shipping Document: GET /fulfillment/202309/packages/{package_id}
//      /shipping_documents?document_type=SHIPPING_LABEL&document_size=A6
//      → data.doc_url (PDF). Chỉ áp dụng đơn "TikTok Shipping" đã ship.
//
// Khi có gian TikTok thật: bật supported=true, nối callApi() của integrations/
// tiktok/client.ts theo 3 bước trên — hợp đồng adapter giữ nguyên, route và
// hộp thoại không cần sửa.
// ============================================================

import { ChannelName } from "@prisma/client";
import type { FulfillmentAdapter } from "./types";

export const TIKTOK_FULFILLMENT_PATHS = {
  shipPackage: (packageId: string) => `/fulfillment/202309/packages/${packageId}/ship`,
  shippingDocuments: (packageId: string) =>
    `/fulfillment/202309/packages/${packageId}/shipping_documents`,
} as const;

const NOT_READY = "TikTok Shop: sắp hỗ trợ sắp xếp vận chuyển qua Hubsell — tạm xử lý trên Seller Center";

export const tiktokFulfillment: FulfillmentAdapter = {
  channelName: ChannelName.TIKTOK,
  supported: false,

  async getShippingOptions() {
    return { methods: [], pickupAddresses: [], dropoffBranches: [], note: NOT_READY };
  },

  async arrangeShipment() {
    return { ok: false, error: NOT_READY };
  },

  async fetchLabels(_channel, orders) {
    return {
      pdfs: new Map(),
      discovered: new Map(),
      failed: orders.map((o) => ({ orderId: o.id, orderCode: o.orderCode, reason: NOT_READY })),
    };
  },
};
