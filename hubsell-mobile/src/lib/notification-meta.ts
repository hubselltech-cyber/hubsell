import type { Ionicons } from "@expo/vector-icons";
import type { NotificationCategoryKey } from "@/types/api";
import type { IconTint } from "@/theme/tokens";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/** Icon + màu chip của từng NHÓM thông báo — dùng chung màn Thông báo + Cài đặt. */
export const CATEGORY_META: Record<NotificationCategoryKey, { icon: IoniconName; tint: IconTint }> = {
  order_new: { icon: "bag-handle-outline", tint: "sky" },
  order_express: { icon: "flash-outline", tint: "red" },
  cancel_request: { icon: "close-circle-outline", tint: "red" },
  return: { icon: "return-down-back-outline", tint: "amber" },
  delivery_fail: { icon: "car-outline", tint: "amber" },
  ads: { icon: "megaphone-outline", tint: "violet" },
  stock: { icon: "cube-outline", tint: "amber" },
  ops: { icon: "pulse-outline", tint: "slate" },
  system: { icon: "information-circle-outline", tint: "emerald" },
};

export function categoryMeta(key: string) {
  return CATEGORY_META[key as NotificationCategoryKey] ?? CATEGORY_META.system;
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
