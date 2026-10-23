// ============================================================
// NHÓM THÔNG BÁO CHA → CON — khách bật / tắt theo nhóm (app mobile, 23/10/2026)
//
// Anh Trung chốt 23/10 chiều: màn Cài đặt chia NHÓM (Đơn hàng, Tài chính,
// Quảng cáo, Kho, Gian hàng, Tài khoản), mỗi nhóm một công tắc TỔNG + công
// tắc từng mục con. Mỗi bản ghi Notification mang `type` kỹ thuật
// (return, cancel_request, ops-alert:stockout…); categoryOf(type) xếp vào
// MỤC CON, groupOfCategory() lên NHÓM. Bảng này là nguồn duy nhất cho:
// (1) notify() bỏ qua mục / nhóm đã tắt, (2) màn Cài đặt trên app,
// (3) icon từng dòng chuông.
// Danh sách tắt lưu `mutedCategories`: chứa khóa NHÓM (tắt cả nhóm) và/hoặc
// khóa MỤC. Mục `locked` không tắt được (gói, thanh toán, bảo trì — tắt là
// mất dấu vết tiền).
// ============================================================

export type NotificationGroupKey = "orders" | "finance" | "ads" | "stock" | "channels" | "system";

export type NotificationCategoryKey =
  // Đơn hàng
  | "order_new"
  | "order_express"
  | "cancel_request"
  | "return"
  | "delivery_fail"
  // Tài chính
  | "weekly_report"
  | "finance_alert"
  | "invoice"
  | "tax_deadline"
  // Quảng cáo
  | "ads_advice"
  | "ads_auto"
  | "ads_wallet"
  | "ads_daily"
  | "ads_link"
  // Kho
  | "stockout"
  | "low_stock"
  // Gian hàng
  | "channel_disconnected"
  | "sync_stalled"
  | "koc"
  // Tài khoản & hệ thống
  | "plan"
  | "system_other";

export interface NotificationCategory {
  key: NotificationCategoryKey;
  /** Tên trên công tắc — ngắn, ≤ 30 ký tự để vừa màn 320 px. */
  label: string;
  /** Một câu giải thích khi nào nổ (≤ 90 ký tự). */
  hint: string;
  /** Không cho tắt. */
  locked?: boolean;
}

export interface NotificationGroup {
  key: NotificationGroupKey;
  label: string;
  items: readonly NotificationCategory[];
}

export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = [
  {
    key: "orders",
    label: "Đơn hàng",
    items: [
      { key: "order_new", label: "Đơn hàng mới", hint: "Gom theo đợt vài phút một lần, không báo từng đơn." },
      { key: "order_express", label: "Đơn hỏa tốc", hint: "Báo ngay từng đơn vì hãng đến lấy trong vài giờ." },
      { key: "cancel_request", label: "Khách xin hủy, đơn bị hủy", hint: "Khách xin hủy chờ shop trả lời; đơn đã chuẩn bị hàng bị hủy." },
      { key: "return", label: "Hoàn hàng, trả hàng hoàn tiền", hint: "Sàn báo đơn chuyển sang chờ nhận hàng hoàn." },
      { key: "delivery_fail", label: "Giao không thành công", hint: "Đơn giao hụt nhiều lần, nên gọi khách trước lượt cuối." },
    ],
  },
  {
    key: "finance",
    label: "Tài chính",
    items: [
      { key: "weekly_report", label: "Báo cáo tuần", hint: "Sáng thứ Hai: doanh thu, lãi, đơn của tuần trước." },
      { key: "finance_alert", label: "Đơn lỗ, sai phí sàn", hint: "Đơn bán dưới vốn, sàn thu phí lệch, chênh phí ship." },
      { key: "invoice", label: "Hóa đơn điện tử", hint: "Phát hành tự động, ký nháp, cơ quan thuế từ chối." },
      { key: "tax_deadline", label: "Hạn kê khai thuế", hint: "Nhắc trước hạn nộp tờ khai quý." },
    ],
  },
  {
    key: "ads",
    label: "Quảng cáo",
    items: [
      { key: "ads_advice", label: "Nhận định chiến dịch", hint: "Trợ lý thấy chiến dịch lỗ, đốt tiền không ra đơn, chi tăng vọt." },
      { key: "ads_auto", label: "Trợ lý tự xử lý", hint: "Đã tự dừng, bật lại, loại video hay hoãn vì thiếu số." },
      { key: "ads_wallet", label: "Ví quảng cáo sắp cạn", hint: "Số dư ví sàn không đủ cho ngân sách ngày." },
      { key: "ads_daily", label: "Tổng kết quảng cáo ngày", hint: "Mỗi sáng: chi, doanh thu, ROAS hôm qua." },
      { key: "ads_link", label: "Kết nối Hubsell Ads", hint: "Gian chưa nối hoặc hết hạn ủy quyền quảng cáo." },
    ],
  },
  {
    key: "stock",
    label: "Kho",
    items: [
      { key: "stockout", label: "Hết hàng", hint: "SKU đang bán mà tồn khả dụng về 0." },
      { key: "low_stock", label: "Sắp hết hàng", hint: "Tồn chạm ngưỡng đã đặt cho SKU hoặc shop." },
    ],
  },
  {
    key: "channels",
    label: "Gian hàng",
    items: [
      { key: "channel_disconnected", label: "Mất kết nối, hết hạn ủy quyền", hint: "Gian ngắt kết nối hoặc sắp hết hạn ủy quyền sàn." },
      { key: "sync_stalled", label: "Đồng bộ dừng", hint: "Gian lâu không kéo được đơn mới." },
      { key: "koc", label: "Mẫu KOC quá hạn", hint: "KOC nhận mẫu nhưng chưa đăng bài đúng hẹn." },
    ],
  },
  {
    key: "system",
    label: "Tài khoản và hệ thống",
    items: [
      { key: "plan", label: "Gói dịch vụ, thanh toán", hint: "Luôn bật: hết hạn, vượt trần đơn, thanh toán thành công.", locked: true },
      { key: "system_other", label: "Thông báo hệ thống", hint: "Luôn bật: bảo trì, thay đổi quan trọng.", locked: true },
    ],
  },
];

const GROUP_OF = new Map<NotificationCategoryKey, NotificationGroupKey>();
const ITEM_BY_KEY = new Map<NotificationCategoryKey, NotificationCategory>();
for (const g of NOTIFICATION_GROUPS) {
  for (const it of g.items) {
    GROUP_OF.set(it.key, g.key);
    ITEM_BY_KEY.set(it.key, it);
  }
}
const GROUP_KEYS = new Set<string>(NOTIFICATION_GROUPS.map((g) => g.key));

export function isNotificationCategory(key: string): key is NotificationCategoryKey {
  return ITEM_BY_KEY.has(key as NotificationCategoryKey);
}
export function isNotificationGroup(key: string): key is NotificationGroupKey {
  return GROUP_KEYS.has(key);
}
export function isLockedCategory(key: NotificationCategoryKey): boolean {
  return ITEM_BY_KEY.get(key)?.locked === true;
}
/** Nhóm chỉ toàn mục khóa thì công tắc tổng cũng không tắt được. */
export function isLockedGroup(key: NotificationGroupKey): boolean {
  const g = NOTIFICATION_GROUPS.find((x) => x.key === key);
  return !!g && g.items.every((it) => it.locked);
}
export function groupOfCategory(key: NotificationCategoryKey): NotificationGroupKey {
  return GROUP_OF.get(key) ?? "system";
}

/**
 * Khóa hợp lệ để lưu vào mutedCategories: khóa nhóm (không khóa) hoặc khóa mục
 * (không khóa). Bỏ khóa lạ / khóa bị locked.
 */
export function sanitizeMuted(raw: unknown[]): string[] {
  const out: string[] = [];
  for (const k of new Set(raw.map(String))) {
    if (isNotificationGroup(k) && !isLockedGroup(k)) out.push(k);
    else if (isNotificationCategory(k) && !isLockedCategory(k)) out.push(k);
  }
  return out;
}

/** Mục này đang tắt (chính nó hoặc cả nhóm của nó) theo danh sách đã lưu? */
export function isCategoryMuted(muted: Set<string>, key: NotificationCategoryKey): boolean {
  if (isLockedCategory(key)) return false;
  return muted.has(key) || muted.has(groupOfCategory(key));
}

/**
 * Mục con của một `type` kỹ thuật. Cảnh báo điều hành đi qua chuông với
 * `ops-alert:<loại>` (ops-alerts.ts). Type lạ rơi về `system_other` (luôn bật)
 * — thà báo thừa còn hơn nuốt mất.
 */
export function categoryOf(type: string): NotificationCategoryKey {
  const t = type.toLowerCase();
  const ops = t.startsWith("ops-alert:") ? t.slice("ops-alert:".length) : null;

  // Đơn hàng
  if (t === "order_new") return "order_new";
  if (t === "order_express") return "order_express";
  if (t === "cancel_request" || t === "order_cancelled") return "cancel_request";
  if (t === "return") return "return";
  if (t === "delivery-fail" || ops === "delivery-fail") return "delivery_fail";

  // Tài chính
  if (t === "weekly-report") return "weekly_report";
  if (ops === "loss-orders" || ops?.startsWith("fee-audit") || ops === "shipping-fee-diff") return "finance_alert";
  if (t.startsWith("invoice")) return "invoice";
  if (t === "tax-deadline") return "tax_deadline";

  // Quảng cáo
  if (t === "ads-daily-summary") return "ads_daily";
  if (t === "tiktok-ads-auto" || ops?.startsWith("ads-auto")) return "ads_auto";
  if (ops === "ads-low-balance") return "ads_wallet";
  if (ops?.startsWith("ads-app") || ops?.startsWith("hubsell-ads")) return "ads_link";
  if (t === "tiktok-ads-advice" || t.startsWith("ads-") || ops?.startsWith("ads-")) return "ads_advice";

  // Kho
  if (ops === "stockout") return "stockout";
  if (ops === "low-stock" || ops?.includes("stock")) return "low_stock";

  // Gian hàng
  if (ops === "channel-disconnected" || t.includes("renewal") || t.includes("auth-expir")) return "channel_disconnected";
  if (ops === "channel-sync-stalled") return "sync_stalled";
  if (ops?.startsWith("koc")) return "koc";
  // Cảnh báo điều hành loại mới chưa xếp → coi là gian hàng (nhóm tắt được).
  if (ops !== null || t === "ops-alert") return "sync_stalled";

  // Tài khoản
  if (t.startsWith("plan") || t === "subscription") return "plan";
  return "system_other";
}
