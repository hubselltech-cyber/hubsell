// ============================================================
// NHỊP ĐỒNG BỘ & CẢNH BÁO QUẢNG CÁO — NGUỒN DUY NHẤT (12/09/2026)
//
// Thiết kế 3 tầng, có tính toán tải, xem docs/ADS-NHIP-CANH-BAO.md. Mọi hằng
// nhịp/cửa sổ của tầng ads phải lấy từ đây — KHÔNG rải số ở worker/route/FE.
//
//   Tầng A — XUNG (pulse): mỗi PULSE_MIN cho gian ĐANG TIÊU TIỀN (có campaign
//            chạy + chi trong 2 ngày). Cấu hình campaign + số hôm nay + ví.
//            Đây là nhịp quyết định độ trễ cảnh báo "cắn tiền" / "ví cạn".
//   Tầng B — LỊCH SỬ: mỗi FULL_HOURS kéo lại WINDOW_DAYS ngày (sàn chỉnh số
//            muộn); lần đầu / nối lại kéo BACKFILL_DAYS.
//   Tầng C — VAN AN TOÀN theo app (services/api-budget.ts): APP_QPS.
// ============================================================

function envNum(name: string, fallback: number, min = 0): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > min ? v : fallback;
}

export const ADS_CADENCE = {
  /** Xung Shopee (phút). Anh Trung chốt 12/09: 30. */
  PULSE_MIN: envNum("ADS_PULSE_MINUTES", 30),
  /** Xung Lazada (phút) — 60 tới khi có quota app ISV (code ghi ~10k call/ngày/app). */
  PULSE_LAZADA_MIN: envNum("ADS_PULSE_LAZADA_MINUTES", 60),
  /** Gian có campaign chạy nhưng 2 ngày không chi → xung giãn (phút). */
  PULSE_IDLE_MIN: 120,
  /** Gian đã nối Ads API nhưng chưa có campaign nào chạy → xung nhẹ 1 call (phút). */
  PULSE_NO_CAMPAIGN_MIN: 120,
  /** Tầng lịch sử (giờ). */
  FULL_HOURS: envNum("ADS_SYNC_HOURS", 6),
  /** Cửa sổ kéo lại mỗi lượt lịch sử (ngày) — sàn chỉnh số vài ngày đầu. */
  WINDOW_DAYS: 7,
  /** Cửa sổ lần đầu / vừa nối Hubsell Ads (ngày). */
  BACKFILL_DAYS: 30,
  /** Mở trang Trợ lý mà số cũ hơn ngưỡng này (phút) → nudge xung ngay. */
  STALE_NUDGE_MIN: 30,
  /** Hai lần bấm Làm mới cách nhau dưới ngưỡng này (phút) → không kéo lại. */
  REFRESH_GAP_MIN: 2,
  /** Ví ads còn dưới N giờ đốt → cảnh báo (ops-alerts). */
  WALLET_LOW_HOURS: 24,
  /** Trần call/giây của MỖI app cho nhóm Ads API — thận trọng tới khi Shopee trả lời ticket. */
  APP_QPS: envNum("ADS_APP_QPS", 3),
} as const;

/** Chữ hiển thị cho seller (FE/docs) — đổi nhịp là đổi một chỗ. */
export const ADS_CADENCE_LABEL = `Hubsell tự kiểm tra mỗi ${ADS_CADENCE.PULSE_MIN} phút khi campaign đang chạy`;
