import type { NotificationCategoryKey } from "@/types/api";

/**
 * Xếp `type` kỹ thuật của một thông báo vào MỤC CON — bản sao của
 * backend/src/services/notification-categories.ts categoryOf(). App cần bản
 * riêng vì bản app và bản backend không lên cùng lúc (23/10: khách thử
 * TestFlight khi prod chưa deploy → danh sách không có `category`, mọi dòng
 * rơi về icon "i"). Backend có trả `category` thì ưu tiên số của backend.
 * Sửa bảng bên backend thì sửa theo ở đây (convention như types/api.ts).
 */
export function categoryOfType(type: string): NotificationCategoryKey {
  const t = type.toLowerCase();
  const ops = t.startsWith("ops-alert:") ? t.slice("ops-alert:".length) : null;

  if (t === "order_new") return "order_new";
  if (t === "order_express") return "order_express";
  if (t === "cancel_request") return "cancel_request";
  if (t === "return") return "return";
  if (t === "delivery-fail" || ops === "delivery-fail") return "delivery_fail";

  if (t === "weekly-report") return "weekly_report";
  if (ops === "loss-orders" || ops?.startsWith("fee-audit") || ops === "shipping-fee-diff") return "finance_alert";
  if (t.startsWith("invoice")) return "invoice";
  if (t === "tax-deadline") return "tax_deadline";

  if (t === "ads-daily-summary") return "ads_daily";
  if (t === "tiktok-ads-auto" || ops?.startsWith("ads-auto")) return "ads_auto";
  if (ops === "ads-low-balance") return "ads_wallet";
  if (ops?.startsWith("ads-app") || ops?.startsWith("hubsell-ads")) return "ads_link";
  if (t === "tiktok-ads-advice" || t.startsWith("ads-") || ops?.startsWith("ads-")) return "ads_advice";

  if (ops === "stockout") return "stockout";
  if (ops === "low-stock" || ops?.includes("stock")) return "low_stock";

  if (ops === "channel-disconnected" || t.includes("renewal") || t.includes("auth-expir")) return "channel_disconnected";
  if (ops === "channel-sync-stalled") return "sync_stalled";
  if (ops?.startsWith("koc")) return "koc";
  if (ops !== null || t === "ops-alert") return "sync_stalled";

  if (t.startsWith("plan") || t === "subscription") return "plan";
  return "system_other";
}

/** Dòng từ backend cũ không có `category` → tự xếp. */
export function withCategory<T extends { type: string; category?: NotificationCategoryKey | null }>(
  n: T
): T & { category: NotificationCategoryKey } {
  return { ...n, category: n.category ?? categoryOfType(n.type) };
}
