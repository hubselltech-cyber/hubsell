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
  /** Xung TikTok GMV Max (phút) — 1 call/lượt; số của sàn vốn trễ nên 60 là đủ. */
  PULSE_TIKTOK_MIN: envNum("ADS_PULSE_TIKTOK_MINUTES", 60),
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
  /** Trần call/giây của MỖI app cho nhóm Ads API — MẶC ĐỊNH TỰ CHỌN: Shopee trả lời 10/10/2026 là
   *  không công khai ngưỡng (cấp shop ~1 call/phút OK, dính 429 thì gọi lại lúc khác); qua ~800 gian
   *  chạy ads thì đo mã exceed_partner_api thật rồi mới chỉnh. */
  APP_QPS: envNum("ADS_APP_QPS", 3),

  // ---- Chống lỗi dây chuyền — 4 lát (docs/ADS-NHIP-CANH-BAO.md mục 13, anh Trung chốt 17/10/2026).
  // Mọi số dưới đây TỰ CHỌN tới khi đo (bảng 13.4, mốc Đ1–Đ4) — đo xong chỉ đổi env.

  /**
   * LÁT 1 — làn Ads riêng (workers/ads-lane.ts). true (mặc định) = xung + lịch sử ads do worker ads-lane nhặt với vé
   * riêng; ADS_LANE=0 = ĐƯỜNG LUI: vòng đồng bộ đơn (order-auto-sync) nhặt lại cả hai tầng như trước 19/10/2026.
   */
  LANE: (process.env.ADS_LANE ?? "1").trim() !== "0",
  /** Số gian chạy xung/lịch sử ads SONG SONG trong một worker ads-lane. Đo lại Đ1, Đ2. */
  CONCURRENCY: envNum("ADS_CONCURRENCY", 2),
  /** Vé làn Ads (Channel.adsLockedAt) cũ hơn ngưỡng này (phút) = worker cầm vé đã chết → nhặt lại. Lượt ngày TikTok
   *  của gian lớn kéo dài nhiều phút nên rộng hơn khóa đơn (15'). */
  LOCK_STALE_MIN: envNum("ADS_LOCK_STALE_MINUTES", 30),
  /**
   * Bão 429 (services/api-budget.ts): số gian dính 429 phải ≥ tỷ lệ này trong số gian ĐÃ GỌI 10' qua mới đóng
   * cầu dao theo app. 0,2 tự chọn 17/10 (429 lẻ tẻ đo ~1–4 %/gian/ngày; trần app thật thì gần như mọi gian cùng
   * dính). Lát 3 thay bằng ngưỡng AIMD.
   */
  STORM_RATIO: envNum("ADS_STORM_RATIO", 0.2),
} as const;
