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
  /** Cửa sổ kéo lại mỗi lượt lịch sử (ngày) — Lazada: 1 call/ngày nên giữ 7. */
  WINDOW_DAYS: 7,
  /**
   * Cửa sổ lịch sử RIÊNG cho Shopee (ngày): get_product_campaign_daily_performance + get_all_cpc_ads_daily_performance
   * nhận khoảng ≤ 1 tháng trong MỘT call, nên 30 ngày tốn đúng bằng 7 ngày. Lý do (19/10/2026, anh Trung so với
   * Seller Center): Shopee TRỪ LẠI đơn hủy trong cửa sổ quy đổi 7 ngày sau click → số đơn của ngày đã qua còn
   * giảm thêm nhiều ngày sau; chỉ kéo lại 7 ngày thì ngày 8–30 giữ số cũ (ANO 01–18/10: Hubsell 217 đơn, Seller
   * Center 210, chi phí khớp từng đồng). Chi phí không đổi lùi, đơn/GMV thì có.
   */
  WINDOW_DAYS_SHOPEE: 30,
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
  /**
   * THIẾT KẾ 13.9 BƯỚC A (21/10/2026) — lệnh Ads Shopee đi qua CỔNG GỌI SÀN (services/marketplace-gateway.ts:
   * GCRA chung Postgres theo khóa app / app×gian / app×endpoint, AIMD, dừng app chỉ khi mã cứng) thay cho
   * withApiBudget (token bucket RAM + cầu dao "bão"). true (mặc định) = qua cổng; ADS_GATEWAY=0 = ĐƯỜNG LUI về
   * withApiBudget như trước 21/10. Khi qua cổng, lát 2 (adsBackoff*) không còn được ghi cho Shopee.
   */
  GATEWAY: (process.env.ADS_GATEWAY ?? "1").trim() !== "0",
  /**
   * 13.9 BƯỚC A2 (22/10/2026): sàn 429 (cổng lùi khóa gian × endpoint) → làn xếp lại gian sau ÍT NHẤT ngần này phút
   * (trước: 1' → gian thử lại mỗi phút, chạy lại từ bước 1 rồi dính lại bước 4 — HPGear VN 4 lần liền 22/10). Chờ lượt
   * GCRA (throttled) vẫn tối thiểu 1'. 5 TỰ CHỌN (đo 22/10: gian qua được sau ~4').
   */
  DEFER_AFTER_429_MIN: envNum("ADS_DEFER_AFTER_429_MIN", 5),
  /**
   * 13.9 BƯỚC A2: xung bị cổng hoãn ở bước k → lượt sau CHẠY TIẾP từ bước k (không hỏi lại 3 bước đã có số — I7),
   * nếu mốc dở (Channel.adsPulseStepAt) chưa cũ hơn ngần này phút; cũ hơn → chạy lại từ đầu. 15 TỰ CHỌN.
   */
  PULSE_RESUME_TTL_MIN: envNum("ADS_PULSE_RESUME_TTL_MIN", 15),
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

  /**
   * LÁT 2 — cách ly theo gian: gian dính 429 tầng shop lùi riêng theo bậc, bậc LƯU DB (Channel.adsBackoffLevel /
   * adsBackoffUntil). Lùi = SHOP_BACKOFF_MIN × 2^bậc, trần SHOP_BACKOFF_MAX_MIN, có xáo trộn ±15 %. 15' có từ 28/09;
   * 120' tự chọn. Đo lại Đ1.
   */
  SHOP_BACKOFF_MIN: envNum("ADS_SHOP_BACKOFF_MIN", 15),
  SHOP_BACKOFF_MAX_MIN: envNum("ADS_SHOP_BACKOFF_MAX_MIN", 120),
  /**
   * LÁT 2 — giãn lệnh trong MỘT xung của cùng gian (giây): hai lệnh Ads API liên tiếp của một gian cách nhau ít nhất
   * ngần này. 0 = tắt (mặc định). Thử 5 để kiểm giả thuyết 13.1 (Shopee 10/10: "cấp shop ~1 call/phút"; lệnh thứ 4
   * của xung hay dính 429). Áp ở services/api-budget.ts cho mọi app Ads (Shopee + Lazada). Đo lại Đ1 (so 429 bật/tắt).
   */
  SHOP_CALL_GAP_SEC: envNum("ADS_SHOP_CALL_GAP_SEC", 0, -1),

  // ---- THIẾT KẾ 13.9 BƯỚC B (21/10/2026) — nhu cầu tự co theo sức chứa (services/ads-demand.ts). Đây là CHÍNH SÁCH,
  // không phải ngưỡng phản ứng: nhịp từng lớp là hàm của (số gian, lệnh/xung, sức chứa khóa), không ai sửa tay khi gian tăng.

  /** Nhu cầu phải ≤ tỷ lệ này × sức chứa khóa (0,8 TỰ CHỌN — chừa 20 % cho lệnh tay: Làm mới, Trợ lý ghi, nạp gian mới). */
  DEMAND_UTILIZATION: envNum("ADS_DEMAND_UTILIZATION", 0.8),
  /**
   * Trần nhịp xung (phút) từng lớp khi phải giãn: lớp 3 (nối Ads, không chiến dịch) tới 24 h, lớp 2 (có chiến dịch)
   * 6 h, lớp 1 (đang tiêu tiền + Trợ lý bật) 2 h. Lớp 1 phải giãn = thiếu quota thật = HQ đỏ + ticket Shopee (13.9.2).
   */
  DEMAND_CAP_MIN: {
    1: envNum("ADS_DEMAND_CAP_P1_MIN", 120),
    2: envNum("ADS_DEMAND_CAP_P2_MIN", 360),
    3: envNum("ADS_DEMAND_CAP_P3_MIN", 1440),
  } as Record<1 | 2 | 3, number>,
  /** Xung trễ quá (hạn chót = nhịp lớp × hệ số này) → tính là "trễ hạn chót" cho HQ (đo, không bỏ xung — 13.9.6). */
  DEADLINE_X: envNum("ADS_PULSE_DEADLINE_X", 2),
  /** Tính lại nhịp theo sức chứa mỗi N phút (đếm gian theo lớp + hệ số AIMD từ api_rate_keys). */
  DEMAND_REFRESH_MIN: envNum("ADS_DEMAND_REFRESH_MIN", 5),
  /**
   * Tầng lịch sử cho gian LỚP 3 (nối Ads, không chiến dịch) chạy mỗi N giờ thay vì FULL_HOURS: không có chiến dịch
   * thì chi tiêu 30 ngày không đổi, kéo lại 6 h/lần chỉ tốn get_all_cpc — khóa chặt nhất (test I9 20.000 gian lớp 3
   * chỉ ra). 24 TỰ CHỌN.
   */
  FULL_HOURS_NO_CAMPAIGN: envNum("ADS_SYNC_HOURS_NO_CAMPAIGN", 24),
} as const;
