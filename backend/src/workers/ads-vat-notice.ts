// ============================================================
// WORKER MỘT LẦN — gửi chuông "Báo cáo có thêm dòng Thuế GTGT quảng cáo" (26/11/2026,
// services/ads-vat-notice.ts; anh Trung duyệt câu chữ + phạm vi).
// Chạy 2 phút sau khi worker khởi động; đã gửi xong (maintenance_jobs.doneAt) thì các lần
// khởi động sau chỉ đọc một dòng rồi thôi. Lỗi → thử lại sau 10 phút, tối đa 6 lần.
// Tắt: env ADS_VAT_NOTICE_OFF=1.
// ⏳ Khi đã thấy doneAt trên prod: gỡ worker này khỏi workers/index.ts (việc một lần).
// ============================================================

import { runAdsVatNotice } from "../services/ads-vat-notice";

const TAG = "[ads-vat-notice]";
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 6;

let started = false;

async function attempt(n: number): Promise<void> {
  try {
    const r = await runAdsVatNotice();
    if (r.outcome === "sent") {
      console.log(`${TAG} ĐÃ GỬI ${r.sent} chuông / ${r.recipients} chủ shop thuộc diện nhận`);
    } else if (r.outcome === "busy" && n < MAX_ATTEMPTS) {
      // Tiến trình khác đang gửi (hoặc vừa bỏ dở) — quay lại xem đã xong chưa.
      setTimeout(() => void attempt(n + 1), RETRY_MS).unref();
    } else if (r.outcome !== "done") {
      console.log(`${TAG} không gửi (${r.outcome})`);
    }
  } catch (err) {
    console.error(`${TAG} lỗi lần ${n}: ${(err as Error).message}`);
    if (n < MAX_ATTEMPTS) setTimeout(() => void attempt(n + 1), RETRY_MS).unref();
  }
}

/** Khởi động worker (gọi 1 lần từ index.ts — KHÔNG gọi trong test). */
export function startAdsVatNoticeWorker(): void {
  if (started) return;
  started = true;
  if (process.env.ADS_VAT_NOTICE_OFF === "1") {
    console.log(`${TAG} TẮT (ADS_VAT_NOTICE_OFF=1)`);
    return;
  }
  setTimeout(() => void attempt(1), FIRST_RUN_DELAY_MS).unref();
}
