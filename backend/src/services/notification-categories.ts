// ============================================================
// NHÓM THÔNG BÁO — khách bật / tắt theo nhóm (app mobile 23/10/2026)
//
// Mỗi bản ghi Notification mang `type` kỹ thuật (return, cancel_request,
// ops-alert:stockout…). Khách không cần biết type; họ chọn theo NHÓM nghiệp
// vụ. Bảng này là nguồn duy nhất cho: (1) notify() bỏ qua nhóm đã tắt,
// (2) màn Cài đặt thông báo trên app liệt kê nhóm, (3) icon từng dòng chuông.
// Nhóm `system` luôn bật — hóa đơn / gói / thanh toán là việc của tài khoản,
// tắt đi là mất dấu vết tiền.
// ============================================================

export type NotificationCategoryKey =
  | "order_new"
  | "order_express"
  | "cancel_request"
  | "return"
  | "delivery_fail"
  | "ads"
  | "stock"
  | "ops"
  | "system";

export interface NotificationCategory {
  key: NotificationCategoryKey;
  /** Tên hiện trên công tắc — ngắn, ≤ 32 ký tự để vừa màn 320 px. */
  label: string;
  /** Một câu giải thích khi nào nhóm này nổ (≤ 90 ký tự). */
  hint: string;
  /** Không cho tắt. */
  locked?: boolean;
}

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  { key: "order_new", label: "Đơn hàng mới", hint: "Gom theo đợt vài phút một lần, không báo từng đơn." },
  { key: "order_express", label: "Đơn hỏa tốc", hint: "Báo ngay từng đơn vì hãng đến lấy trong vài giờ." },
  { key: "cancel_request", label: "Khách xin hủy đơn", hint: "Sàn chờ shop trả lời, quá hạn sàn tự hủy." },
  { key: "return", label: "Hoàn hàng, trả hàng hoàn tiền", hint: "Sàn báo đơn chuyển sang chờ nhận hàng hoàn." },
  { key: "delivery_fail", label: "Giao không thành công", hint: "Đơn giao hụt nhiều lần, nên gọi khách trước lượt cuối." },
  { key: "ads", label: "Quảng cáo", hint: "Trợ lý nhận định chiến dịch, tự dừng, ví sắp cạn, tổng kết ngày." },
  { key: "stock", label: "Kho: hết hàng, sắp hết", hint: "SKU cháy hàng hoặc chạm ngưỡng tồn đã đặt." },
  { key: "ops", label: "Vận hành khác", hint: "Gian mất kết nối, đơn lỗ, sai phí sàn, đồng bộ dừng." },
  { key: "system", label: "Hệ thống và gói dịch vụ", hint: "Luôn bật: hóa đơn, gói, thanh toán, bảo trì.", locked: true },
];

const KEYS = new Set<string>(NOTIFICATION_CATEGORIES.map((c) => c.key));

export function isNotificationCategory(key: string): key is NotificationCategoryKey {
  return KEYS.has(key);
}

export function isLockedCategory(key: NotificationCategoryKey): boolean {
  return NOTIFICATION_CATEGORIES.find((c) => c.key === key)?.locked === true;
}

/**
 * Nhóm của một `type` kỹ thuật. Cảnh báo điều hành đi qua chuông với type
 * `ops-alert:<loại cảnh báo>` (ops-alerts.ts) nên tách được kho / ads / khác.
 * Type lạ rơi về `system` (luôn bật) — thà báo thừa còn hơn nuốt mất.
 */
export function categoryOf(type: string): NotificationCategoryKey {
  const t = type.toLowerCase();
  if (t === "order_new") return "order_new";
  if (t === "order_express") return "order_express";
  if (t === "cancel_request") return "cancel_request";
  if (t === "return") return "return";
  if (t === "delivery-fail" || t === "ops-alert:delivery-fail") return "delivery_fail";
  if (
    t.startsWith("tiktok-ads") ||
    t.startsWith("ads-") ||
    t.startsWith("ops-alert:ads-") ||
    t.startsWith("ops-alert:hubsell-ads")
  ) {
    return "ads";
  }
  if (t.startsWith("ops-alert:")) {
    const sub = t.slice("ops-alert:".length);
    if (sub.includes("stock")) return "stock";
    return "ops";
  }
  // "ops-alert" trần (bản ghi cũ trước 23/10/2026) không biết loại → vận hành.
  if (t === "ops-alert") return "ops";
  return "system";
}
