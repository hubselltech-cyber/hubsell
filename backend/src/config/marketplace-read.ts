// ============================================================
// THÔNG SỐ LỚP ĐỌC SÀN (Pha B "Nền" — docs/CUNG-HOA-LOP-GOI-SAN.md mục 5b)
//
// Phương thức nằm trong mã (máy đọc con trỏ, cổng gọi sàn, làn); DUNG LƯỢNG
// nằm ở đây, đọc env — gian/đơn tăng gấp 10 thì đổi số ở đây, không sửa mã
// (docs mục 1b). Số nào chưa có căn cứ đo thì ghi "TỰ CHỌN" kèm lịch đo.
// ============================================================

function envNum(name: string, fallback: number, min = 0): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > min ? v : fallback;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Máy đọc con trỏ + cửa sổ co (N2 + N3). */
export const CURSOR_READ = {
  /**
   * K — số trang tối đa để đọc TRỌN một cửa sổ; trang K còn tiếp → co cửa sổ.
   * TỰ CHỌN 20 (≈ 2.000 đơn Shopee/TikTok-100): dưới trần 50 trang của mã cũ,
   * đủ để gian 4.000 đơn/ngày (24–32 nghìn biến động, H7) có cửa sổ vài giờ.
   */
  PAGES_PER_WINDOW: envNum("READ_PAGES_PER_WINDOW", 20),
  /** Cửa sổ nhỏ nhất (ms). Tới đây vẫn tràn → đọc tiếp quá K (không bao giờ cắt), ghi số "tràn đáy". TỰ CHỌN 1 phút. */
  MIN_WINDOW_MS: envNum("READ_MIN_WINDOW_MS", 1 * MIN),
  /** Cửa sổ khởi đầu khi chưa học (ms). TỰ CHỌN 1 giờ — học dần lên tới trần sàn. */
  INITIAL_WINDOW_MS: envNum("READ_INITIAL_WINDOW_MS", 1 * HOUR),
  /** Cửa sổ đọc trọn dùng ≤ K × tỷ lệ này số trang → lần sau gấp đôi. */
  GROW_BELOW_RATIO: 0.25,
  /** Co theo tổng sàn báo (TikTok total_count, Lazada countTotal): nhắm lấp tỷ lệ này của K. */
  SHRINK_TARGET_RATIO: 0.7,
  /**
   * Không đọc sát hiện tại: mốc cuối cửa sổ ≤ now − SETTLE (sàn ghi chỉ mục trễ).
   * TỰ CHỌN 2 phút; căn cứ gần nhất: webhook p99 Shopee 18 s (Pha A H3). Đo lại ở Pha C.
   */
  SETTLE_MS: envNum("READ_SETTLE_MS", 2 * MIN),
  /** Một cửa sổ bị sàn đổi tập trong lúc đọc (tổng giảm) → đọc lại tối đa N lần rồi chấp nhận + ghi log. */
  MAX_UNSTABLE_REREADS: 2,
  /** Token trang hết hạn giữa chừng → đọc lại cửa sổ từ trang đầu tối đa N lần. */
  MAX_TOKEN_RESTARTS: 2,
  /** Lỗi tạm có hẹn chờ (cổng ném lùi ngắn) → chờ rồi đọc lại ĐÚNG trang đó, tối đa N lần mỗi trang. TỰ CHỌN 5. */
  MAX_PAGE_RETRIES: 5,
  /**
   * Ngân sách MỘT lượt đọc (chia đều giữa gian — N6): tối đa N trang / X ms rồi trả suất.
   * Chỉ xét ở RANH cửa sổ (cắt giữa cửa sổ = bỏ công cửa sổ đó → gian lớn có thể không bao
   * giờ tiến); một lượt vì thế dài tối đa ngân sách + K trang.
   */
  RUN_MAX_PAGES: envNum("READ_RUN_MAX_PAGES", 40),
  RUN_MAX_MS: envNum("READ_RUN_MAX_MS", 60_000),
} as const;

/** Trần cửa sổ theo sàn (ms) — số của sàn, không phải tự chọn. */
export const PLATFORM_MAX_WINDOW_MS = {
  /** Shopee get_order_list: time_to − time_from ≤ 15 ngày. */
  SHOPEE: 15 * DAY,
  /** TikTok orders/search: không công bố trần; giữ bằng Shopee cho đồng nhất. */
  TIKTOK: 15 * DAY,
  /** Lazada GetOrders: không công bố trần; như trên. */
  LAZADA: 15 * DAY,
} as const;

/** Cổng gọi sàn (N4 + N5). */
export const GATEWAY = {
  /** Chờ lượt ngắn hơn ngưỡng này thì ngủ tại chỗ; dài hơn → ném GatewayDeferError cho làn xếp lại. TỰ CHỌN 2 s. */
  MAX_INLINE_WAIT_MS: envNum("GATEWAY_MAX_INLINE_WAIT_MS", 2_000),
  /** 429 tầng gian: lùi full jitter gốc × 2^(lần−1), trần. Gốc 1 s theo docs TikTok 5.6; trần 15' TỰ CHỌN (cũ: lùi gian 15'). */
  SHOP_BACKOFF: { baseMs: 1_000, capMs: 15 * MIN },
  /** 429 không rõ tầng (Shopee error_rate_limit — H4 rơi vào một endpoint): lùi khóa endpoint + hạ nhịp (AIMD). TỰ CHỌN. */
  ENDPOINT_BACKOFF: { baseMs: 1_000, capMs: 60_000 },
  /**
   * 13.9 BƯỚC A2 (22/10/2026): 429 không rõ tầng trên lệnh CÓ trần gian × endpoint (nhóm Ads Shopee) → lùi đúng khóa
   * gian × endpoint ấy, gốc 60 s × 2^(lần−1) KHÔNG xáo trộn (xáo trộn đã có ở làn), trần 15', + hạ nhịp AIMD khóa ấy.
   * Căn cứ: đo 22/10 một gian lùi 60–80 s vẫn dính, qua sau ~4' (docs ADS-NHIP-CANH-BAO 13.9.5). Khóa app × endpoint
   * KHÔNG hạ nữa (hạ oan cả app: 21–22/10 tụt sàn 0,1 mà vẫn 429).
   */
  SHOP_ENDPOINT_BACKOFF: { baseMs: envNum("GATEWAY_SHOP_EP_BACKOFF_SEC", 60) * 1000, capMs: 15 * MIN },
  /**
   * 13.9 A2: bằng chứng TẦNG APP trên lệnh có khóa gian × endpoint = ≥ `shops` GIAN KHÁC NHAU 429 cùng endpoint trong
   * `windowMs` → mới hạ nhịp khóa app × endpoint (AIMD, hồi 60'). Một gian dính nhiều lần không tính (bài học 16/10: đếm
   * theo LẦN đóng oan cả app). Test I9 N = 1.000 chứng minh cần nó để cổng học trần app thật. TỰ CHỌN 3 gian / 60 s.
   */
  UNKNOWN_429_STORM: { shops: envNum("GATEWAY_STORM_SHOPS", 3), windowMs: 60_000 },
  /** Lỗi cứng theo app (exceed_partner_api, Lazada ApiCallLimit): dừng cả app, không xáo trộn — như cầu dao cũ 5' × 2^bậc, trần 60'. */
  APP_HARD: { baseMs: 5 * MIN, capMs: 60 * MIN },
  /** AIMD: 429 → nhịp × 0,5 (sàn dưới MIN_FACTOR); hồi tuyến tính +1 sau RECOVER_MS (≈ +10 %/6' — docs TikTok "tăng 20–30 % mỗi 10–15'"). */
  AIMD_MIN_FACTOR: 0.1,
  AIMD_RECOVER_MS: 60 * MIN,
} as const;

/** Một trần GCRA: `perSec` lượt/giây, dồn tối đa `burst` lượt. */
export interface RateLimit {
  perSec: number;
  burst: number;
}

/**
 * Trần chỉ BẬT nơi có bằng chứng sàn giới hạn (docs N4); khóa không có ở đây
 * vẫn đi qua cổng để LÙI và ĐO, chỉ không bị chặn trước. Số đều TỰ CHỌN tới khi
 * Pha C chạy bóng đo được tỷ lệ 429 theo khóa.
 */
export const RATE_LIMITS: {
  app: Partial<Record<"SHOPEE" | "TIKTOK" | "LAZADA", RateLimit>>;
  shop: Partial<Record<"SHOPEE" | "TIKTOK" | "LAZADA", RateLimit>>;
  endpoint: Record<string, RateLimit>;
  /** Trần theo TIỀN TỐ đường dẫn cho endpoint không có dòng riêng ở `endpoint` (khớp dài nhất thắng). */
  endpointPrefix: Record<string, RateLimit>;
  /**
   * 13.9 BƯỚC A2 (22/10/2026): trần theo GIAN × ENDPOINT (khóa `<SÀN>:<app>|shop:<id>|ep:<path>`) — chỉ lệnh có gian và
   * có dòng ở đây (hoặc tiền tố) mới lấy khóa này. Căn cứ đo 22/10 (docs ADS-NHIP-CANH-BAO 13.9.5): 106 lần 429/7,7 h
   * trên app Hubsell Ads dù khóa app × endpoint đã tụt sàn; MỘT gian dính 4 lần liền cách 60–80 s trong khi gian khác
   * xen giữa qua → trần thật theo gian; 3 lệnh đầu của xung qua rồi get_all_cpc dính ở MỌI lần thử → theo endpoint.
   */
  shopEndpoint: Record<string, RateLimit>;
  shopEndpointPrefix: Record<string, RateLimit>;
} = {
  app: {},
  shop: {
    // TikTok: đơn vị cô lập nhỏ nhất App × gian, đọc gợi ý 3–10/s (TIKTOK_RATE_LIMIT.START_RPS) → đầu thấp.
    TIKTOK: { perSec: 3, burst: 3 },
  },
  endpoint: {
    // H4 (Pha A): 100 % 429 Shopee rơi vào endpoint này, 2 gian cùng giây → trần app × endpoint.
    "SHOPEE /api/v2/ads/get_all_cpc_ads_daily_performance": { perSec: 1, burst: 2 },
  },
  endpointPrefix: {
    // Thiết kế 13.9 bước A (21/10/2026): MỌI endpoint Ads Shopee phải có trần khởi điểm thì AIMD mới có tác dụng
    // (khóa không trần = hệ số nhân với 0). 2/s burst 2 là TỰ CHỌN — chưa endpoint nào ngoài get_all_cpc thấy 429;
    // cổng tự hạ (× 0,5, hồi 60') nếu sai. Đo lại ở bước A (24 h) rồi Đ1.
    "SHOPEE /api/v2/ads/": { perSec: envNum("GATEWAY_SHOPEE_ADS_PER_SEC", 2), burst: 2 },
  },
  shopEndpoint: {
    // get_all_cpc: 95/106 lần 429 ngày 22/10; một gian thử lại 4 lần trong 3'20" đều dính, qua sau ~4' → khởi điểm
    // 1 lệnh / 5' mỗi gian, không dồn (burst 1). Cổng tự hạ (× 0,5, sàn 0,1 = 1 lệnh / 50') nếu còn dính. Số đo = HQ `factor`.
    "SHOPEE /api/v2/ads/get_all_cpc_ads_daily_performance": {
      perSec: envNum("GATEWAY_SHOPEE_ADS_SHOP_ALLCPC_PER_MIN", 0.2) / 60,
      burst: 1,
    },
  },
  shopEndpointPrefix: {
    // Mọi endpoint Ads Shopee khác: CHỈ ĐO + LÙI KHI 429 (perSec 0 = không chặn trước), KHÔNG chặn trước.
    // ★ 22/10/2026 10:00 — bản A2 đầu đặt 1 lệnh/phút/gian/endpoint không dồn (theo câu "cấp shop ~1 call/phút" của Shopee)
    // và SAI: một BƯỚC xung có thể gồm nhiều lệnh cùng endpoint (id_list / setting_info / daily_performance theo lô 100 → gian
    // > 100 chiến dịch là 2+ trang; chiến dịch Nhóm mỗi id một lệnh; GMS vài lệnh). Trang 2 bị cổng hoãn 60 s, làn xếp lại,
    // lượt sau chạy lại bước ấy từ trang 1 → trang 2 lại hoãn → VÒNG LẶP mỗi ~80 s, xung không bao giờ xong (12 gian >100
    // chiến dịch: BESI FOOD, TAROT ĐỒNG TÂM, Kirei Hair, TIỆM BUÔN HOÀI NIỆM, Cây Giống…, ANO với Nhóm). Bằng chứng tầng gian
    // chỉ có ở get_all_cpc (95/106 lần 429); setting_info 7, toggle 1, các endpoint khác 0 → không có căn cứ chặn trước.
    // Khóa gian × endpoint vẫn tồn tại cho mọi endpoint Ads: 429 → lùi đúng khóa ấy 60 s × 2^n (A2), xung chạy tiếp từ bước dở.
    // Env > 0 để bật chặn trước khi CÓ số đo (đơn vị lệnh/phút/gian/endpoint, cần burst đủ cho một bước nhiều trang).
    "SHOPEE /api/v2/ads/": { perSec: envNum("GATEWAY_SHOPEE_ADS_SHOP_PER_MIN", 0, -1) / 60, burst: 1 },
  },
};

/** Làn nhặt việc (N6) — mỗi làn số luồng riêng: một làn kẹt không lan sang làn khác (bulkhead). */
export type SyncLane = "orders" | "finance" | "ads" | "backfill";

export const LANES: Record<SyncLane, { concurrency: number }> = {
  /** Số luồng mỗi làn mỗi tiến trình — DUNG LƯỢNG, đổi theo gói (docs 1b). TỰ CHỌN, đo ở Pha C. */
  orders: { concurrency: envNum("LANE_ORDERS_CONCURRENCY", 4) },
  finance: { concurrency: envNum("LANE_FINANCE_CONCURRENCY", 2) },
  ads: { concurrency: envNum("LANE_ADS_CONCURRENCY", 2) },
  /** Nạp gian mới: ít luồng để tốc độ ghi DB có kiểm soát (bài học sổ cái đè Nano 30/09). */
  backfill: { concurrency: envNum("LANE_BACKFILL_CONCURRENCY", 1) },
};

export const LEASE = {
  /** Thuê bao sống bao lâu nếu không có nhịp tim (thay khóa 15' cứng). TỰ CHỌN 90 s. */
  TTL_MS: envNum("LEASE_TTL_MS", 90_000),
  /** Nhịp tim mỗi TTL / 3 — lỡ hai nhịp vẫn còn hạn. */
  HEARTBEAT_DIVISOR: 3,
  /** Không có việc tới hạn → ngủ ngần này rồi hỏi lại. Có suất trống mà còn việc → nhặt ngay, không chờ. */
  IDLE_POLL_MS: envNum("LANE_IDLE_POLL_MS", 5_000),
  /** Đuổi kịp → lượt kế sau ngần này (quét đối soát; N1 / lát 3.3 sẽ giãn theo mức hoạt động). TỰ CHỌN = nhịp hiện tại 10'. */
  CAUGHT_UP_RECHECK_MS: envNum("LANE_CAUGHT_UP_RECHECK_MS", 10 * MIN),
  /** Lỗi không phải lùi của cổng (mạng, ủy quyền…) → thử lại sau. TỰ CHỌN 5'. */
  ERROR_RETRY_MS: envNum("LANE_ERROR_RETRY_MS", 5 * MIN),
} as const;
