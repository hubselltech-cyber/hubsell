/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNotificationTarget, type NotificationTarget } from "./notification-target";

/**
 * BẢNG RÀ: mọi link backend đang ghi vào Notification (grep `link:` / `href:`
 * trong backend/src ngày 25/10/2026) → đích trên app. Thêm notify() mới ở
 * backend thì thêm một dòng ở đây; dòng nào đích null là app chưa có màn.
 *
 * Chạy (không cần RN): từ backend/  npx tsx --test ../hubsell-mobile/src/lib/notification-target.test.ts
 */
const CASES: Array<{ name: string; type: string; link: string | null; want: NotificationTarget | null }> = [
  // ── Đơn hàng (services/new-order-notify.ts, integrations/cancel-request.ts) ──
  { name: "đơn mới gom đợt", type: "order_new", link: "/orders", want: { kind: "orders" } },
  { name: "đơn hỏa tốc", type: "order_express", link: "/orders?search=2510ABC", want: { kind: "orders", search: "2510ABC" } },
  { name: "khách xin hủy", type: "cancel_request", link: "/orders?cancelRequested=1", want: { kind: "orders", cancelRequested: true } },
  {
    name: "đơn đã chuẩn bị bị hủy",
    type: "order_cancelled",
    link: "/orders?search=261023CTJDFRH4",
    want: { kind: "orders", search: "261023CTJDFRH4" },
  },
  { name: "hoàn hàng 3 sàn", type: "return", link: "/warehouse/returns", want: { kind: "warehouse", tab: "returns" } },
  {
    name: "giao không thành công (tab trong Phản hồi đánh giá trên web)",
    type: "ops-alert:delivery-fail",
    link: "/operations-assistant/reviews?tab=delivery-fail",
    want: { kind: "orders", status: "SHIPPING" },
  },

  // ── Tài chính (ops-alerts.ts, workers/*) ──
  {
    name: "báo cáo tuần → Trợ lý với câu hỏi sẵn",
    type: "weekly-report",
    link: `/?assistant=${encodeURIComponent("Báo cáo tuần trước")}`,
    want: { kind: "assistant", prompt: "Báo cáo tuần trước" },
  },
  { name: "đơn lỗ", type: "ops-alert:loss-orders", link: "/operations-assistant/loss-orders", want: { kind: "finance" } },
  { name: "sàn thu phí lệch", type: "ops-alert:fee-audit-shortfall", link: "/finance/fee-audit?tab=payout", want: { kind: "finance" } },
  { name: "phí chờ đối soát", type: "ops-alert:fee-audit-pending", link: "/finance/fee-audit?tab=pending", want: { kind: "finance" } },
  { name: "chênh phí ship", type: "ops-alert:shipping-fee-diff", link: "/warehouse/shipping-alerts", want: { kind: "finance" } },
  { name: "hóa đơn điện tử — chưa có màn", type: "INVOICE_ISSUED", link: "/invoicing/history", want: null },
  { name: "hạn kê khai thuế — chưa có màn", type: "tax-deadline", link: "/invoicing/history?period=2026Q3", want: null },

  // ── Quảng cáo TikTok (integrations/tiktok-ads/*) ──
  {
    name: "Trợ lý đã loại N video → tab Lịch sử (mã video + lý do)",
    type: "tiktok-ads-auto",
    link: "/ads/tiktok/campaign?id=cmp_1",
    want: { kind: "tiktok_campaign", id: "cmp_1", tab: "history" },
  },
  {
    name: "nhận định chiến dịch → tab Video",
    type: "tiktok-ads-advice",
    link: "/ads/tiktok/campaign?id=cmp_1",
    want: { kind: "tiktok_campaign", id: "cmp_1", tab: "videos" },
  },
  { name: "link TikTok thiếu id → trang Quảng cáo TikTok", type: "tiktok-ads-advice", link: "/ads/tiktok/campaign", want: { kind: "ads", platform: "tiktok" } },

  // ── Quảng cáo Shopee / Lazada (ops-alerts.ts, workers/ads-daily-summary.ts) ──
  { name: "tổng kết ngày Shopee", type: "ads-daily-summary", link: "/ads/shopee", want: { kind: "ads", platform: "shopee" } },
  { name: "tổng kết ngày Lazada", type: "ads-daily-summary", link: "/ads/lazada", want: { kind: "ads", platform: "lazada" } },
  {
    name: "Trợ lý đã tạm dừng một chiến dịch Shopee → mở thẳng chiến dịch",
    type: "ops-alert:ads-auto-paused",
    link: "/ads/shopee?channelId=ch_9&campaign_id=1234567",
    want: { kind: "ads", platform: "shopee", channelId: "ch_9", campaignId: "1234567" },
  },
  {
    name: "nhiều chiến dịch đốt tiền → tab Cần xử lý của gian",
    type: "ops-alert:ads-zero-order-drain",
    link: "/ads/lazada?channelId=ch_2&needs_action=1",
    want: { kind: "ads", platform: "lazada", channelId: "ch_2", needsAction: true },
  },
  { name: "ví quảng cáo sắp cạn", type: "ops-alert:ads-low-balance", link: "/ads/lazada?channelId=ch_2", want: { kind: "ads", platform: "lazada", channelId: "ch_2" } },
  { name: "kết nối Hubsell Ads", type: "ops-alert:ads-app-expired", link: "/ads/shopee?channelId=ch_9", want: { kind: "ads", platform: "shopee", channelId: "ch_9" } },
  { name: "chi Ads tăng đột biến → Seller Center", type: "ops-alert:ads-spike", link: "https://banhang.shopee.vn", want: { kind: "external", url: "https://banhang.shopee.vn" } },
  { name: "API mới /api/quang-cao", type: "ads-x", link: "/quang-cao/shopee", want: { kind: "ads", platform: "shopee" } },

  // ── Kho ──
  { name: "hết hàng", type: "ops-alert:stockout", link: "/products", want: { kind: "warehouse", tab: "stock" } },
  { name: "sắp hết hàng", type: "ops-alert:low-stock", link: "/products", want: { kind: "warehouse", tab: "stock" } },

  // ── Gian hàng: app chưa có màn Kênh bán ──
  { name: "gian mất kết nối", type: "ops-alert:channel-disconnected", link: "/channels", want: null },
  { name: "Lazada hết hạn gói", type: "lazada-renewal", link: "/channels", want: null },
  { name: "KOC quá hạn (đã ẩn)", type: "ops-alert:koc-sample-overdue", link: "/koc-marketing/samples?overdue=1", want: null },

  // ── Tài khoản ──
  { name: "gói / thanh toán", type: "plan_expiring", link: "/settings/plan", want: { kind: "plan" } },
  { name: "hệ thống không link", type: "system", link: null, want: null },
  { name: "link rỗng", type: "system", link: "   ", want: null },
];

for (const c of CASES) {
  test(c.name, () => {
    assert.deepEqual(resolveNotificationTarget({ type: c.type, link: c.link }), c.want);
  });
}

test("link có dấu / thừa và query lạ vẫn đọc được", () => {
  assert.deepEqual(resolveNotificationTarget({ type: "x", link: "/orders/?foo=1&search=%20A1%20" }), {
    kind: "orders",
    search: "A1",
  });
});
