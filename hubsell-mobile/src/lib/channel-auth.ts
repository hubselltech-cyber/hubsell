import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

/**
 * ỦY QUYỀN SÀN TỪ APP (28/10/2026).
 *
 * Địa chỉ callback của ba sàn ĐĂNG KÝ CỐ ĐỊNH phía sàn (Shopee/Lazada → backend
 * Render, TikTok → trang web /channels/tiktok/callback) — app không nhận
 * được redirect trực tiếp và cũng không đổi được (đổi = nộp lại hồ sơ ISV).
 * Cách làm: mở trang ủy quyền bằng phiên trình duyệt hệ thống
 * (ASWebAuthenticationSession / Custom Tabs qua expo-web-browser), sàn trả về
 * callback như luồng web; backend/web thấy state mang dấu "từ app" thì nảy
 * tiếp về `hubsellmobile://channels?...` để phiên tự đóng và app đọc kết quả.
 *
 * Lát 2 (28/10/2026) đã có bước nảy: Shopee/Lazada ở backend callback,
 * TikTok ở trang callback web (state tiền tố app_). Backend bản cũ không nảy
 * thì phiên dừng ở trang Kênh bán web, khách bấm Xong → app tải lại danh sách —
 * vẫn nối được, chỉ không tự đóng. Giả lập web: mở tab mới, khách tự quay lại.
 */

export type AuthReturn =
  | { kind: "none" }
  | { kind: "shopee"; status: "connected" | "error" | "code"; shop?: string; isNew?: boolean; msg?: string; code?: string; shopId?: string }
  | { kind: "lazada"; status: "connected" | "error" | "code"; shop?: string; isNew?: boolean; msg?: string; code?: string }
  | { kind: "tiktok"; code: string; state: string | null };

/** Đường quay về trong app — route /channels (màn Gian hàng) nhận tham số. */
export function channelReturnUrl(): string {
  // Không gạch chéo đầu: bản cài đặt ra "hubsellmobile://channels" — khớp đích
  // backend/web nảy về (integrations/app-return.ts, APP_MOBILE_SCHEME).
  return Linking.createURL("channels");
}

/** Đọc kết quả ủy quyền từ URL quay về (cùng tham số callback web đang dùng). */
export function parseAuthReturn(url: string): AuthReturn {
  let params: URLSearchParams;
  try {
    const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    params = new URLSearchParams(q.split("#")[0]);
  } catch {
    return { kind: "none" };
  }
  const shopee = params.get("shopee");
  if (shopee === "connected" || shopee === "error" || shopee === "code") {
    return {
      kind: "shopee",
      status: shopee,
      shop: params.get("shop") ?? undefined,
      isNew: params.get("isNew") === "1",
      msg: params.get("msg") ?? undefined,
      code: params.get("code") ?? undefined,
      shopId: params.get("shop_id") ?? undefined,
    };
  }
  const lazada = params.get("lazada");
  if (lazada === "connected" || lazada === "error" || lazada === "code") {
    return {
      kind: "lazada",
      status: lazada,
      shop: params.get("shop") ?? undefined,
      isNew: params.get("isNew") === "1",
      msg: params.get("msg") ?? undefined,
      code: params.get("code") ?? undefined,
    };
  }
  const code = params.get("code");
  if (code && (params.get("tiktok") === "code" || params.has("state"))) {
    return { kind: "tiktok", code, state: params.get("state") };
  }
  return { kind: "none" };
}

/**
 * Mở trang ủy quyền; trả kết quả khi phiên đóng. "none" = khách đóng phiên /
 * backend chưa nảy về app → màn gọi tải lại danh sách để biết đã nối chưa.
 */
export async function openChannelAuth(url: string): Promise<AuthReturn> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
    return { kind: "none" };
  }
  const res = await WebBrowser.openAuthSessionAsync(url, channelReturnUrl(), {
    // Dùng phiên trình duyệt có sẵn cookie: khách đã đăng nhập sàn trên Safari
    // thì không phải gõ lại; TikTok còn cần phiên web Hubsell ở bước callback.
    preferEphemeralSession: false,
  });
  if (res.type === "success" && res.url) return parseAuthReturn(res.url);
  return { kind: "none" };
}
