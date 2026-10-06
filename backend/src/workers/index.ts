// ============================================================
// BOOTSTRAP WORKER NỀN — 12/09/2026, tách vai tiến trình theo HUBSELL_ROLE
//
// Mọi worker nền (quét sàn theo lịch, hàng đợi webhook, đẩy tồn, refresh
// token, cron hóa đơn/thuế/báo cáo...) khởi động qua MỘT hàm này. index.ts
// gọi theo vai:
//   · HUBSELL_ROLE=all    (mặc định) — web + worker cùng tiến trình như trước.
//     Production hôm nay đi nhánh này cho tới khi tạo service worker riêng.
//   · HUBSELL_ROLE=web    — chỉ API + SSE; KHÔNG chạy worker. Web chỉ ENQUEUE
//     (webhook → hàng đợi bền trong DB), worker tiêu thụ.
//   · HUBSELL_ROLE=worker — chỉ worker, không mở cổng HTTP.
//
// Vì sao tách: deploy/restart web không cắt ngang lượt quét; lượt quét nặng
// không làm API của seller chậm; sau này scale worker độc lập với web. Mọi
// hàng đợi đều bền trong DB + claim bằng UPDATE có điều kiện nên chạy 2 worker
// song song vẫn an toàn (không job nào bị xử lý đôi).
//
// Webhook Shopee / TikTok / Lazada đi qua hàng đợi bền pg-boss (web ghi
// webhook_events + xếp việc, worker xử lý ở workers/event-queue.ts — đăng ký ở
// index.ts sau khi hàng đợi sẵn sàng). Đường cũ của ba sàn và vòng quét đẩy tồn
// một luồng đã gỡ ở bước 6b (05/10/2026).
// ============================================================

import { startInvoiceAutoIssueWorker } from "./invoice-auto-issue";
import { startInvoiceLaneScheduler, startInvoiceRequestScheduler } from "./invoice-lanes";
import { startInvoiceCqtFollowWorker } from "./invoice-cqt-follow";
import { startInvoiceStatusSyncWorker } from "./invoice-status-sync";
import { startInvoiceUnknownRecheckWorker } from "./invoice-unknown-recheck";
import { startLogCleanupWorker } from "./log-cleanup";
import { startOrderAutoSync } from "./order-auto-sync";
import { invoiceCqtMode, invoiceMode } from "../lib/queue-config";
import { startStockReconcileWorker } from "./stock-reconcile";
import { startTokenRefreshWorker } from "./token-refresh";
import { startWeeklyReportWorker } from "./weekly-report";
import { startAdsDailySummaryWorker } from "./ads-daily-summary";
import { startTaxDeadlineReminderWorker } from "./tax-deadline-reminder";
import { startLazadaRenewalReminderWorker } from "./lazada-renewal-reminder";
import { startSubscriptionReminderWorker } from "./subscription-reminder";
import { startHqInvoiceAutoWorker } from "./hq-invoice-auto";
import { startReviewerDemoTopupWorker } from "./reviewer-demo-topup";
import { startMisaWebhookWorker } from "../integrations/invoice/misa-webhook-queue";
import { startHealthWatchWorker } from "./health-watch";
import { startProductCatalogSyncWorker } from "./product-catalog-sync";
import { startOrderLedgerWorker } from "./order-ledger";
import { startStockPushScheduler } from "./stock-queue";

export type HubsellRole = "all" | "web" | "worker";

/** Vai của tiến trình này theo env HUBSELL_ROLE (giá trị lạ → "all" + cảnh báo). */
export function resolveHubsellRole(): HubsellRole {
  const raw = (process.env.HUBSELL_ROLE ?? "all").trim().toLowerCase();
  if (raw === "web" || raw === "worker" || raw === "all") return raw;
  console.warn(`[Role] HUBSELL_ROLE="${raw}" không hợp lệ — chạy như "all"`);
  return "all";
}

let started = false;

/** Khởi động toàn bộ worker nền (gọi 1 lần; KHÔNG gọi trong test). */
export function startAllWorkers(): void {
  if (started) return;
  started = true;

  // Hàng đợi webhook MISA (bảng misa_webhook_logs, gỡ ở bước 6c): nhặt lại job dở
  // dang sau restart, quét job đến hạn retry theo nhịp.
  startMisaWebhookWorker();
  // Worker quét sàn theo LỊCH TỪNG GIAN (đơn, đối soát, ads) — claim vé theo
  // gian, song song có trần, giãn nhịp gian im ắng.
  startOrderAutoSync();
  // Cron refresh token Shopee (app chính + Hubsell Ads) — lưới an toàn cạnh
  // lazy-refresh, quét DB lọc token sắp hết hạn rồi làm mới có giãn cách.
  startTokenRefreshWorker();
  // Dọn log kỹ thuật xoay vòng 7/30 ngày.
  startLogCleanupWorker();
  // Đẩy tồn khả dụng đa sàn — tiêu thụ bảng stock_push_jobs: bộ chạy theo gian +
  // lưới quét (workers/stock-queue.ts).
  startStockPushScheduler();
  // Đối soát tồn sàn ↔ Hubsell mỗi 6h cho gian đang bật đồng bộ.
  startStockReconcileWorker();
  // Sáng thứ 2 đẩy báo cáo tuần qua chuông cho từng chủ shop.
  startWeeklyReportWorker();
  // Tóm tắt cuối ngày Trợ lý quảng cáo (bước 6 sự cố 14/09) — chuông 20h VN.
  startAdsDailySummaryWorker();
  // Tự phát hành hóa đơn cho đơn ĐÃ GIAO (ngủ khi chưa bật MISA). Hai đường, chọn
  // bằng INVOICE_MODE (bước 5 lát 8): vòng chung một cờ của đường cũ, hoặc làn
  // theo shop thuê ở database + lưới quét (workers/invoice-lanes.ts).
  if (invoiceMode() === "legacy") {
    startInvoiceAutoIssueWorker();
  } else {
    startInvoiceLaneScheduler();
  }
  // Yêu cầu xuất hóa đơn bấm tay (bước 5 lát 9): lưới quét invoice_requests gọi làn
  // của shop. Chạy ở mọi INVOICE_MODE — đường lui của tự phát hành không tắt nút bấm tay.
  startInvoiceRequestScheduler();
  // Đồng bộ trạng thái CQT của hóa đơn (meInvoice không có webhook). Hai đường, chọn
  // bằng INVOICE_CQT_MODE (bước 5 lát 12): vòng 12 giờ gọi thẳng MISA của đường cũ,
  // hoặc vòng quét theo giờ hỏi kế tiếp qua adapter (workers/invoice-cqt-follow.ts).
  if (invoiceCqtMode() === "legacy") {
    startInvoiceStatusSyncWorker();
  } else {
    startInvoiceCqtFollowWorker();
  }
  // Tra lại các tờ hóa đơn gửi đi mà chưa rõ kết quả (bước 5 lát 6b).
  startInvoiceUnknownRecheckWorker();
  // Nhắc hạn kê khai thuế quý qua chuông.
  startTaxDeadlineReminderWorker();
  // Nhắc gia hạn kỳ dịch vụ Lazada (app ISV: token sống theo kỳ đăng ký 6 tháng).
  startLazadaRenewalReminderWorker();
  // Nhắc hạn gói Hubsell (thư billing@ + chuông) 7 ngày / 1 ngày trước hạn.
  startSubscriptionReminderWorker();
  // Lưới an toàn tự xuất HĐĐT bán gói + gửi PDF cho khách (06/10): nhặt bút
  // toán lỡ sau restart / MISA lỗi tạm / chờ cấp số / mail lỗi.
  startHqInvoiceAutoWorker();
  // Bồi đơn tài khoản trial reviewer (Xét duyệt app TikTok 16/09, 10-12 ngày) —
  // tắt bằng REVIEWER_DEMO_TOPUP_MINUTES=0 khi có kết quả.
  startReviewerDemoTopupWorker();
  // Radar sức chứa HQ: snapshot + kiểm mốc 2 lần/ngày (chỉ ghi DB, trang HQ tự đỏ).
  startHealthWatchWorker();
  // Danh mục sản phẩm: gian vừa nối kéo ngay, làm mới mỗi đêm (anh Trung 28/09).
  startProductCatalogSyncWorker();
  // Sổ cái đơn (giai đoạn 1 kiến trúc quy mô): tính lại dòng trigger đánh dấu,
  // tạo phân mảnh tháng, đối soát đêm sổ ↔ đơn gốc.
  startOrderLedgerWorker();
}
