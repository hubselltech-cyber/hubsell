// ============================================================
// HÀNG CHỜ XỬ LÝ ĐƠN cho app mobile (19/11/2026, docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md)
//
// App không có bảng tích chọn từng đơn như web: người bán bấm MỘT nút là làm cả nhóm
// ("chuẩn bị mọi đơn Chờ xử lý", "in mọi đơn Chưa in phiếu"). Muốn vậy app cần biết nhóm
// đó gồm những đơn nào, thuộc gian nào, hãng nào — mà không phải kéo cả trang đơn kèm
// dòng hàng + ảnh (GET /api/orders, 100 đơn / trang). Tệp này gom các dòng tối thiểu
// thành cây gian → hãng vận chuyển. Thuần hàm, không đụng DB.
// ============================================================

import type { Carrier, ChannelName } from "@prisma/client";
import { CARRIER_LABEL, isExpressShipping } from "../services/shipping";

/** ARRANGE = Chờ xử lý · PRINT = Đã xử lý, chưa in phiếu · REPRINT = đã in, chưa đóng gói. */
export type QueueStage = "ARRANGE" | "PRINT" | "REPRINT";

export function parseQueueStage(raw: unknown): QueueStage | null {
  return raw === "ARRANGE" || raw === "PRINT" || raw === "REPRINT" ? raw : null;
}

export interface QueueRow {
  id: string;
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  carrier: Carrier | null;
  shippingCarrierName: string | null;
  cancelRequested: boolean;
}

export interface QueueCarrier {
  /** "EXPRESS" (hỏa tốc mọi hãng) · mã hãng · "NONE" (sàn chưa gán hãng). */
  key: string;
  label: string;
  express: boolean;
  count: number;
  orderIds: string[];
}

export interface QueueGroup {
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  count: number;
  /** Số đơn hỏa tốc trong nhóm — app tô đỏ để người bán làm trước. */
  express: number;
  /** Số đơn khách đang xin hủy — vẫn nằm trong nhóm, app chỉ nhắc. */
  cancelRequested: number;
  carriers: QueueCarrier[];
}

const CHANNEL_ORDER: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA", "OFFLINE"];

/**
 * Gom đơn thành cây gian → hãng. Thứ tự đơn trong từng hãng giữ nguyên thứ tự đầu vào
 * (route đã xếp hỏa tốc trước, rồi đơn cũ trước). Gian xếp theo sàn rồi tên; trong gian,
 * hỏa tốc đứng đầu, còn lại hãng nhiều đơn trước.
 */
export function groupQueue(rows: QueueRow[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup & { byCarrier: Map<string, QueueCarrier> }>();
  for (const r of rows) {
    let g = groups.get(r.channelId);
    if (!g) {
      g = {
        channelId: r.channelId,
        channelName: r.channelName,
        shopName: r.shopName,
        count: 0,
        express: 0,
        cancelRequested: 0,
        carriers: [],
        byCarrier: new Map(),
      };
      groups.set(r.channelId, g);
    }
    const express = isExpressShipping(r.shippingCarrierName);
    const key = express ? "EXPRESS" : (r.carrier ?? "NONE");
    let c = g.byCarrier.get(key);
    if (!c) {
      c = {
        key,
        label: express ? "Hỏa tốc" : r.carrier ? CARRIER_LABEL[r.carrier] : "Chưa gán hãng",
        express,
        count: 0,
        orderIds: [],
      };
      g.byCarrier.set(key, c);
    }
    c.count += 1;
    c.orderIds.push(r.id);
    g.count += 1;
    if (express) g.express += 1;
    if (r.cancelRequested) g.cancelRequested += 1;
  }
  return [...groups.values()]
    .map(({ byCarrier, ...g }) => ({
      ...g,
      carriers: [...byCarrier.values()].sort(
        (a, b) => Number(b.express) - Number(a.express) || b.count - a.count || a.label.localeCompare(b.label, "vi")
      ),
    }))
    .sort(
      (a, b) =>
        CHANNEL_ORDER.indexOf(a.channelName) - CHANNEL_ORDER.indexOf(b.channelName) ||
        a.shopName.localeCompare(b.shopName, "vi")
    );
}
