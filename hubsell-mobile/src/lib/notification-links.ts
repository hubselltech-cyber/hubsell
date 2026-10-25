import { Platform } from "react-native";
import type { Href } from "expo-router";
import { resolveNotificationTarget, type NotificationTarget } from "@/lib/notification-target";

/**
 * ĐÍCH CÓ KIỂU → MÀN APP (bước 2 của luồng thông báo; bước 1 ở notification-target.ts).
 * Một chỗ duy nhất biết tên route + tên tham số của từng màn:
 *   orders          → tab Đơn hàng  ?search= ?status= ?cancelRequested=1
 *   warehouse       → tab Kho       ?tab=stock|returns
 *   finance / ads   → Trang chủ     ?page=1|2 (+ platform, channelId, campaignId, needsAction cho Quảng cáo)
 *   tiktok_campaign → /tiktok-campaign ?id= ?tab=videos|history (kỳ xem màn tự mặc định 7 ngày)
 *   assistant       → /assistant ?prompt=
 *   plan            → /plan (chỉ iOS có màn mua; Android: dòng chỉ đọc)
 *   external        → mở trình duyệt (nơi gọi dùng Linking)
 * Tham số `n` = id thông báo: hai thông báo khác nhau cùng đích vẫn đổi params →
 * màn đang mở sẵn áp lại bộ lọc (khách đã bấm X xóa tìm kiếm rồi bấm lại tin vẫn tới).
 */
export type NotificationDestination = { kind: "screen"; href: Href } | { kind: "external"; url: string };

type Params = Record<string, string>;

function href(pathname: string, params: Params): Href {
  return { pathname, params } as Href;
}

export function hrefForTarget(
  t: NotificationTarget,
  nonce: string | undefined,
  os: string = Platform.OS
): NotificationDestination | null {
  const base: Params = nonce ? { n: nonce } : {};
  switch (t.kind) {
    case "orders": {
      const p: Params = { ...base };
      if (t.search) p.search = t.search;
      if (t.status) p.status = t.status;
      if (t.cancelRequested) p.cancelRequested = "1";
      return { kind: "screen", href: href("/(admin)/orders", p) };
    }
    case "warehouse":
      return { kind: "screen", href: href("/(admin)/warehouse", { ...base, tab: t.tab }) };
    case "finance":
      return { kind: "screen", href: href("/(admin)/home", { ...base, page: "1" }) };
    case "ads": {
      const p: Params = { ...base, page: "2", platform: t.platform };
      if (t.channelId) p.channelId = t.channelId;
      if (t.campaignId) p.campaignId = t.campaignId;
      if (t.needsAction) p.needsAction = "1";
      return { kind: "screen", href: href("/(admin)/home", p) };
    }
    case "tiktok_campaign":
      return { kind: "screen", href: href("/tiktok-campaign", { ...base, id: t.id, tab: t.tab }) };
    case "assistant":
      return { kind: "screen", href: href("/assistant", { ...base, prompt: t.prompt }) };
    case "plan":
      return os === "ios" ? { kind: "screen", href: href("/plan", base) } : null;
    case "external":
      return { kind: "external", url: t.url };
  }
}

/**
 * Thông báo (dòng chuông hoặc data của tin đẩy) → nơi cần tới. null = không có
 * màn trên app (dòng chỉ để đọc).
 */
export function destinationFor(n: { id?: string | null; type: string; link: string | null | undefined }): NotificationDestination | null {
  const target = resolveNotificationTarget(n);
  if (!target) return null;
  return hrefForTarget(target, n.id ?? undefined);
}
