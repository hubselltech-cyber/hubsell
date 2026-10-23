import type { Ionicons } from "@expo/vector-icons";
import type { NotificationCategoryKey, NotificationGroupKey } from "@/types/api";
import type { IconTint } from "@/theme/tokens";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/** Icon + màu chip của từng MỤC thông báo — dùng chung màn Thông báo + Cài đặt. */
export const CATEGORY_META: Record<NotificationCategoryKey, { icon: IoniconName; tint: IconTint }> = {
  order_new: { icon: "bag-handle-outline", tint: "sky" },
  order_express: { icon: "flash-outline", tint: "red" },
  cancel_request: { icon: "close-circle-outline", tint: "red" },
  return: { icon: "return-down-back-outline", tint: "amber" },
  delivery_fail: { icon: "car-outline", tint: "amber" },
  weekly_report: { icon: "stats-chart-outline", tint: "emerald" },
  finance_alert: { icon: "trending-down-outline", tint: "red" },
  invoice: { icon: "document-text-outline", tint: "sky" },
  tax_deadline: { icon: "calendar-outline", tint: "amber" },
  ads_advice: { icon: "megaphone-outline", tint: "violet" },
  ads_auto: { icon: "sparkles-outline", tint: "violet" },
  ads_wallet: { icon: "wallet-outline", tint: "amber" },
  ads_daily: { icon: "sunny-outline", tint: "violet" },
  ads_link: { icon: "link-outline", tint: "slate" },
  stockout: { icon: "cube-outline", tint: "red" },
  low_stock: { icon: "cube-outline", tint: "amber" },
  channel_disconnected: { icon: "cloud-offline-outline", tint: "red" },
  sync_stalled: { icon: "sync-outline", tint: "slate" },
  koc: { icon: "people-outline", tint: "slate" },
  plan: { icon: "ribbon-outline", tint: "emerald" },
  system_other: { icon: "information-circle-outline", tint: "slate" },
};

/** Icon của NHÓM cha trên màn Cài đặt. */
export const GROUP_META: Record<NotificationGroupKey, { icon: IoniconName; tint: IconTint }> = {
  orders: { icon: "bag-handle-outline", tint: "sky" },
  finance: { icon: "cash-outline", tint: "emerald" },
  ads: { icon: "megaphone-outline", tint: "violet" },
  stock: { icon: "cube-outline", tint: "amber" },
  channels: { icon: "storefront-outline", tint: "slate" },
  system: { icon: "shield-checkmark-outline", tint: "emerald" },
};

export function categoryMeta(key: string) {
  return CATEGORY_META[key as NotificationCategoryKey] ?? CATEGORY_META.system_other;
}
export function groupMeta(key: string) {
  return GROUP_META[key as NotificationGroupKey] ?? GROUP_META.system;
}

/** "vừa xong" / "12 phút trước" / "3 giờ trước" / "Hôm qua 14:05" / "21/10 09:30". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = now.getTime() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24 && d.getDate() === now.getDate()) return `${h} giờ trước`;
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Hôm qua ${hhmm}`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hhmm}`;
}
