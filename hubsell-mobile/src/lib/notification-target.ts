/**
 * ĐÍCH ĐẾN CỦA MỘT THÔNG BÁO trên app (25/10/2026, bản 1.4.1).
 *
 * Bản ghi Notification chỉ mang `link` = đường dẫn WEB mà backend ghi cho chuông
 * web (/orders?search=…, /ads/tiktok/campaign?id=…, /ads/shopee?channelId=…).
 * App KHÔNG nhảy theo chuỗi đó trực tiếp mà đọc thành một ĐÍCH CÓ KIỂU
 * (NotificationTarget) rồi mới đổi sang màn ở notification-links.ts. Tách hai
 * bước vì:
 *   1. bảng "link web → đích" là TypeScript thuần, test bằng node không cần
 *      React Native (notification-target.test.ts = bảng rà mọi link backend ghi);
 *   2. màn app đổi tên / đổi tham số chỉ sửa một chỗ (notification-links.ts);
 *   3. cùng một link nhưng LOẠI thông báo khác nhau tới chỗ khác nhau — Trợ lý
 *      đã loại video (tiktok-ads-auto) → tab Lịch sử có mã video + lý do; nhận
 *      định chiến dịch → tab Video.
 * Trả null = app không có màn cho việc đó (hóa đơn, gian hàng, KOC) — dòng chỉ
 * để đọc, màn Thông báo ghi "Xem trên máy tính".
 *
 * Tệp này cố ý KHÔNG import gì để chạy được dưới node --test.
 */

export type AdsPlatformTarget = "shopee" | "lazada" | "tiktok";

export type NotificationTarget =
  /** Tab Đơn hàng, lọc sẵn theo mã / trạng thái / khách xin hủy. */
  | { kind: "orders"; search?: string; status?: "SHIPPING"; cancelRequested?: boolean }
  /** Tab Kho: Tồn kho (hết hàng, sắp hết) hoặc Đơn hoàn. */
  | { kind: "warehouse"; tab: "stock" | "returns" }
  /** Trang Tài chính của pager Trang chủ (đơn lỗ, sai phí, chênh phí ship, báo cáo). */
  | { kind: "finance" }
  /** Trang Quảng cáo của pager Trang chủ: chọn sẵn sàn / gian / mở thẳng chiến dịch. */
  | {
      kind: "ads";
      platform: AdsPlatformTarget;
      channelId?: string;
      /** campaign_id của sàn (AdsCampaignDto.campaignId) — mở hộp chi tiết khi danh sách về. */
      campaignId?: string;
      /** Cảnh báo gom nhiều chiến dịch → mở tab Cần xử lý. */
      needsAction?: boolean;
    }
  /** Màn Video của một chiến dịch GMV Max TikTok (route /tiktok-campaign). */
  | { kind: "tiktok_campaign"; id: string; tab: "videos" | "history" }
  /** Trợ lý Hubsell với câu hỏi gửi sẵn (báo cáo tuần). */
  | { kind: "assistant"; prompt: string }
  /** Gói dịch vụ (chỉ iOS có màn mua). */
  | { kind: "plan" }
  /** Link ngoài (Seller Center) — mở trình duyệt. */
  | { kind: "external"; url: string };

export interface NotificationLike {
  /** Type kỹ thuật backend ghi (tiktok-ads-auto, ops-alert:stockout…). */
  type: string;
  link: string | null | undefined;
}

function str(v: string | null): string | undefined {
  return v ? v : undefined;
}

/**
 * Đọc link web + type → đích có kiểu. Bảng ánh xạ theo đúng những link backend
 * đang ghi (rà 25/10/2026, xem notification-target.test.ts); link lạ cùng họ
 * (/orders/…, /ads/…) vẫn về màn gần nhất để không "chết" khi backend thêm trang.
 */
export function resolveNotificationTarget(n: NotificationLike): NotificationTarget | null {
  const link = (n.link ?? "").trim();
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return { kind: "external", url: link };

  const [rawPath, rawQuery = ""] = link.split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";
  const q = new URLSearchParams(rawQuery);

  // Báo cáo tuần: web mở bong bóng Trợ lý với câu hỏi sẵn (/?assistant=…).
  if (path === "/" ) {
    const prompt = q.get("assistant")?.trim();
    return prompt ? { kind: "assistant", prompt } : null;
  }

  // ───────── Đơn hàng ─────────
  if (path.startsWith("/orders")) {
    const t: NotificationTarget = { kind: "orders" };
    const search = q.get("search")?.trim();
    if (search) t.search = search;
    if (q.get("cancelRequested") === "1") t.cancelRequested = true;
    return t;
  }
  if (path.startsWith("/operations-assistant")) {
    // Đơn lỗ sống ở Tài chính; Giao không thành công = đơn còn đang giao.
    if (path.includes("loss-orders")) return { kind: "finance" };
    if (q.get("tab") === "delivery-fail") return { kind: "orders", status: "SHIPPING" };
    return { kind: "orders" };
  }

  // ───────── Kho ─────────
  if (path.startsWith("/warehouse/returns") || path.startsWith("/returns")) {
    return { kind: "warehouse", tab: "returns" };
  }
  if (path.startsWith("/warehouse/shipping-alerts")) return { kind: "finance" }; // chênh phí ship = tiền
  if (path.startsWith("/products") || path.startsWith("/inventory") || path.startsWith("/warehouse")) {
    return { kind: "warehouse", tab: "stock" };
  }

  // ───────── Quảng cáo ─────────
  if (path.startsWith("/ads/tiktok/campaign")) {
    const id = q.get("id")?.trim();
    if (id) {
      return { kind: "tiktok_campaign", id, tab: n.type === "tiktok-ads-auto" ? "history" : "videos" };
    }
    return { kind: "ads", platform: "tiktok" };
  }
  if (path.startsWith("/ads") || path.includes("quang-cao")) {
    const platform: AdsPlatformTarget = path.includes("lazada") ? "lazada" : path.includes("tiktok") ? "tiktok" : "shopee";
    const t: NotificationTarget = { kind: "ads", platform };
    const channelId = str(q.get("channelId"));
    const campaignId = str(q.get("campaign_id") ?? q.get("campaignId"));
    if (channelId) t.channelId = channelId;
    if (campaignId) t.campaignId = campaignId;
    if (q.get("needs_action") === "1") t.needsAction = true;
    return t;
  }

  // ───────── Tài chính ─────────
  if (
    path.startsWith("/finance") ||
    path.startsWith("/cash-flow") ||
    path.startsWith("/reports") ||
    path.startsWith("/dashboard")
  ) {
    return { kind: "finance" };
  }

  // ───────── Tài khoản ─────────
  if (path.startsWith("/settings/plan")) return { kind: "plan" };

  // /channels, /invoicing/*, /koc-marketing/*: app chưa có màn → chỉ đọc.
  return null;
}
