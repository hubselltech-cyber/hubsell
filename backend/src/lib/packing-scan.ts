// ============================================================
// QUYẾT ĐỊNH KHI QUÉT KIỆN Ở BƯỚC "ĐÃ ĐÓNG GÓI" (01/11/2026)
//
// Hàm THUẦN, không DB: nhận trạng thái đơn, trả về làm gì + cảnh báo gì. Route
// /api/orders/packing/scan và test dùng chung để câu báo trên màn quét không
// lệch với điều máy chủ thật sự ghi.
//
// Mục đích chính của bước quét (khách dùng Ship Xanh nêu): seller in phiếu
// xong, gói xong, cầm điện thoại quét lại từng kiện → đơn nào ĐÃ HỦY thì bỏ
// lại, không để ship mang đi (ship thường mang cả xấp về bưu cục mới bắn mã,
// lúc đó mới lòi ra đơn hủy). Nên đơn hủy là ca CHẶN CỨNG, còn lại chỉ cảnh báo.
// ============================================================

import { ShippingStatus } from "@prisma/client";

export type PackingScanAction =
  /** Ghi packingDoneAt ngay. */
  | "mark"
  /** Đã quét trước đó — không ghi lại, báo trùng để người gói biết kiện đã qua tay. */
  | "already"
  /** Không ghi — đơn không được đưa ship. */
  | "reject";

export type PackingRejectReason =
  /** Đơn đã hủy (sàn hoặc shop) — BỎ KIỆN LẠI. */
  | "CANCELLED"
  /** Còn Chờ xử lý — chưa chuẩn bị hàng với sàn, chưa có vận đơn, chưa thể bàn giao. */
  | "NOT_CONFIRMED"
  /** Đã giao xong từ lâu — quét nhầm tem cũ. */
  | "DELIVERED"
  /** Đã nằm trong biên bản bàn giao rồi — không gói lại. */
  | "ON_HANDOVER_SHEET";

export type PackingWarning =
  /** Khách đang xin hủy, sàn chờ shop quyết — vẫn ghi, nhưng gói xong có thể phải mở ra. */
  | "CANCEL_REQUESTED"
  /** Chưa in phiếu lần nào — gói mà không có vận đơn dán ngoài? */
  | "NOT_PRINTED"
  /** Sàn đã báo Đang giao (shipper quét trước khi shop quét) — ghi để lên biên bản, không sai. */
  | "ALREADY_SHIPPING";

export interface PackingScanDecision {
  action: PackingScanAction;
  reason?: PackingRejectReason;
  warnings: PackingWarning[];
}

export interface PackingScanInput {
  shippingStatus: ShippingStatus;
  packingDoneAt: Date | null;
  handoverSheetId: string | null;
  labelPrintedAt: Date | null;
  cancelRequestedAt: Date | null;
}

export function decidePackingScan(o: PackingScanInput): PackingScanDecision {
  if (o.shippingStatus === ShippingStatus.CANCELLED) {
    return { action: "reject", reason: "CANCELLED", warnings: [] };
  }
  if (o.shippingStatus === ShippingStatus.DELIVERED) {
    return { action: "reject", reason: "DELIVERED", warnings: [] };
  }
  if (o.shippingStatus === ShippingStatus.PENDING) {
    return { action: "reject", reason: "NOT_CONFIRMED", warnings: [] };
  }
  const warnings: PackingWarning[] = [];
  if (o.cancelRequestedAt) warnings.push("CANCEL_REQUESTED");
  if (!o.labelPrintedAt) warnings.push("NOT_PRINTED");
  if (o.shippingStatus === ShippingStatus.SHIPPING)
    warnings.push("ALREADY_SHIPPING");
  if (o.packingDoneAt) {
    // Đã lên biên bản = đã giao ship (hoặc đang chờ ship ký) → quét lại là nhầm kiện.
    if (o.handoverSheetId)
      return { action: "reject", reason: "ON_HANDOVER_SHEET", warnings };
    return { action: "already", warnings };
  }
  return { action: "mark", warnings };
}

/** Câu báo ngắn in to trên màn quét — một dòng, người gói liếc là hiểu. */
export const PACKING_REJECT_TEXT: Record<PackingRejectReason, string> = {
  CANCELLED: "ĐƠN ĐÃ HỦY — bỏ kiện lại, không đưa ship",
  NOT_CONFIRMED: "Chưa chuẩn bị hàng — đơn còn Chờ xử lý, chưa có vận đơn",
  DELIVERED: "Đơn đã giao xong — quét nhầm tem cũ?",
  ON_HANDOVER_SHEET: "Đơn đã nằm trong biên bản bàn giao trước đó",
};

export const PACKING_WARNING_TEXT: Record<PackingWarning, string> = {
  CANCEL_REQUESTED:
    "Khách đang xin hủy — sàn chờ shop quyết, gói xong có thể phải mở lại",
  NOT_PRINTED: "Chưa in phiếu — kiện này chưa có vận đơn in từ Hubsell",
  ALREADY_SHIPPING:
    "Sàn đã báo Đang giao — shipper quét trước, vẫn ghi vào biên bản",
};

/** Số biên bản in trên tờ: BG-yyMMdd-XXXX (4 ký tự cuối id, chữ hoa). Giờ VN. */
export function handoverSheetCode(id: string, at: Date): string {
  const vn = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  const yy = String(vn.getUTCFullYear()).slice(-2);
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  return `BG-${yy}${mm}${dd}-${id.slice(-4).toUpperCase()}`;
}

/**
 * Gom đơn theo hãng vận chuyển để lập MỖI HÃNG MỘT BIÊN BẢN. Khóa gom = enum
 * Carrier; null (sàn chưa gán hãng) gom riêng thành "Chưa rõ hãng" để không
 * trộn vào tờ của hãng nào. Giữ thứ tự nhóm theo lần gặp đầu tiên.
 */
export function groupByCarrier<T extends { carrier: string | null }>(
  orders: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const o of orders) {
    const key = o.carrier ?? "";
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }
  return groups;
}
