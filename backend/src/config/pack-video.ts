// ============================================================
// VIDEO ĐÓNG HÀNG — hằng số cấu hình (16/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md)
//
// Mọi con số của tính năng nằm ở đây, kèm CĂN CỨ. Số nào ghi "tự chọn" là mặc định
// em đặt, chưa có số đo / chưa có quyết định của anh Trung — đổi thì đổi ở đây.
// ============================================================

/**
 * Tài khoản THÍ ĐIỂM được mở tính năng (anh Trung 16/11: "chỉ mở cho một mình tài khoản
 * admin@hubsell.vn, còn lại mọi người sẽ chỉ thấy mờ"). So khớp không phân biệt hoa thường,
 * theo email CHỦ shop — 24/11/2026 nhân viên của chủ này vào được theo quyền có sẵn (services/pack-video/access.ts).
 * Tắt gấp: để mảng rỗng → mọi đường /api/pack-videos trả 403, mục con trên sidebar mờ với mọi người.
 */
export const PACK_VIDEO_PILOT_EMAILS: readonly string[] = ["admin@hubsell.vn"];

/**
 * CỔNG MỞ CHO AI — anh Trung 26/11/2026: "bật xóa thật và mở ra cho khách hàng dùng bản web luôn".
 *   "all"   (mặc định) = mọi chủ shop CÒN HẠN GÓI (kể cả dùng thử, kể cả đang trong ân hạn) + nhân viên của họ theo quyền.
 *                        Gói hết hạn quá ân hạn → khóa như các tính năng nâng cao khác (services/plan-enforcement.ts).
 *   "pilot"            = chỉ các tài khoản thí điểm ở trên (trạng thái trước 26/11).
 *   "off"              = đóng với mọi người — công tắc TẮT GẤP.
 * Đổi bằng env PACK_VIDEO_GATE trên tiến trình WEB ở Render, không cần ra bản.
 * Tài khoản thí điểm luôn vào được trừ khi "off". Khách vào lần đầu phải bấm đồng ý (services/pack-video/consent.ts).
 */
export type PackVideoGate = "all" | "pilot" | "off";
export function packVideoGate(env: NodeJS.ProcessEnv = process.env): PackVideoGate {
  const v = env.PACK_VIDEO_GATE?.trim().toLowerCase();
  return v === "pilot" || v === "off" ? v : "all";
}

const MIB = 1024 * 1024;

/** Chỉ nhận đúng một kiểu tệp — đường dẫn ký sẵn ký luôn tiêu đề này (đã thử thật, tài liệu khảo sát mục 57.2). */
export const PACK_VIDEO_CONTENT_TYPE = "video/mp4";

/**
 * Trần thời lượng một video: 60 phút. SỐ TỰ CHỌN (tài liệu khảo sát mục 53); anh Trung nói đóng gói
 * 15 phút / đơn là bình thường (mục 42) nên trần phải cao hơn hẳn mức đó. Chưa có số đo quay > 25 phút.
 */
export const PACK_VIDEO_MAX_DURATION_SEC = 60 * 60;

/**
 * Trần cỡ một tệp: 400 MiB. SỐ TỰ CHỌN = 60 phút × 6,1 MB + 0,4 MB ≈ 366 MB, làm tròn lên cho dư.
 * R2 nhận tới 5 GiB / lượt tải nên trần này là của mình, không phải của kho.
 */
export const PACK_VIDEO_MAX_SIZE_BYTES = 400 * MIB;

/** Cỡ mảnh khi tải theo mảnh: 8 MiB — số đã chạy thật ở mục 57 (chưa so với cỡ khác). */
export const PACK_VIDEO_PART_SIZE_BYTES = 8 * MIB;

/** Tệp lớn hơn ngưỡng này thì tải theo mảnh: 32 MB (tự chọn, mục 53) — clip ≈ 5 phút trở lên. */
export const PACK_VIDEO_MULTIPART_THRESHOLD_BYTES = 32 * MIB;

/** Hạn đường dẫn TẢI LÊN: 15 phút (tự chọn) — đủ cho một mảnh 8 MiB qua mạng yếu, hết hạn thì xin ký lại. */
export const PACK_VIDEO_PUT_EXPIRES_SEC = 15 * 60;

/** Hạn đường dẫn XEM / TẢI VỀ: 5 phút (tự chọn) — ngắn để đường dẫn bị chuyển tiếp cũng sớm chết. */
export const PACK_VIDEO_GET_EXPIRES_SEC = 5 * 60;

/** Mỗi lượt xin ký tối đa ngần này mảnh (400 MiB / 8 MiB = 50 mảnh là hết một tệp). */
export const PACK_VIDEO_MAX_PARTS_PER_REQUEST = 50;

/**
 * KIỂM CHÉO thời lượng app báo ↔ cỡ tệp thật. Số đo trên Note8 ở 720p · 800k · 15 khung/giây
 * (tài liệu khảo sát mục 39, 55.13): cỡ tệp ≈ 0,4 MB cố định + 6,1 MB mỗi phút.
 * BIÊN ±40 % là SỐ TỰ CHỌN — chưa có số của máy khác / iPhone, nên bản thí điểm chỉ GẮN CỜ
 * (cột durationFlag), không từ chối và không trừ giờ theo cờ.
 */
export const PACK_VIDEO_SIZE_BASE_BYTES = 0.4 * 1_000_000;
export const PACK_VIDEO_SIZE_BYTES_PER_MIN = 6.1 * 1_000_000;
export const PACK_VIDEO_DURATION_TOLERANCE = 0.4;

/** Phân trang danh sách. */
export const PACK_VIDEO_PAGE_DEFAULT = 20;
export const PACK_VIDEO_PAGE_MAX = 100;

// ---------- MUA GIỜ QUAY (docs/VIDEO-DONG-HANG-THIET-KE.md mục 16 + 19) ----------

/**
 * ĐƠN GIÁ một giờ quay: 2.000 đ, TÍNH THẲNG, không bậc — anh Trung 21/11/2026: "Nâng giờ quay video lên 2000đ đi"
 * (16/11 chốt 1.500 đ; giờ đã mua ở giá cũ giữ nguyên, không tính lại).
 * Trả trước, không thu theo tháng, giờ đã mua không hết hạn, không trừ VAT trong phép tính.
 * Máy chủ TỰ tính tiền = số giờ × đơn giá (lib/pack-video-hour-pricing.ts); không tin số tiền trình duyệt gửi.
 * Mã QR lấy ở giá cũ mà trả SAU khi đổi giá: tiền về không khớp số giờ × giá mới → đơn thành MISMATCH, KHÔNG cộng
 * giờ, HQ nhận thư để xử lý tay (services/gateway-checkout.ts) — mã QR chỉ sống vài chục phút nên hiếm.
 */
export const PACK_VIDEO_HOUR_PRICE_VND = 2_000;

/**
 * TẶNG MỖI CHỦ SHOP 2 GIỜ QUAY MIỄN PHÍ, một lần — anh Trung 21/11/2026: "tặng cho mỗi khách hàng 2 giờ quay miễn
 * phí". Tự cộng lần đầu tài khoản chạm vào Video đóng hàng (services/pack-video/hours.ts → ensureWelcomeHours),
 * là một dòng GRANT trong sổ giờ; dùng như giờ mua, KHÔNG hết hạn (anh chưa nói hạn — mặc định em chọn).
 * Đặt 0 = ngừng tặng cho tài khoản CHƯA nhận; ai đã nhận thì giữ.
 */
export const PACK_VIDEO_WELCOME_HOURS = 2;

/**
 * Ba gói sẵn — chỉ là LỐI TẮT, cùng đơn giá, không giảm giá. 50 / 200 / 500 giờ là đề xuất của em 16/11
 * (anh không phản đối): ≈ shop 100 / 400 / 1.000 đơn một ngày trong một tháng nếu mỗi video ≈ 1 phút.
 */
export const PACK_VIDEO_HOUR_PRESETS: readonly number[] = [50, 200, 500];

/** Mua tối thiểu 20 giờ = 40.000 đ (ở giá 2.000 đ). SỐ TỰ CHỌN (16/11): mỗi lần mua kéo theo một hóa đơn + phí cổng. */
export const PACK_VIDEO_HOUR_MIN_PURCHASE = 20;

/**
 * Mua tối đa một lần 10.000 giờ = 20.000.000 đ (ở giá 2.000 đ). SỐ TỰ CHỌN: chặn gõ nhầm thêm số 0 (shop 1.000 đơn/ngày
 * dùng ≈ 500 giờ/tháng → 10.000 giờ ≈ 20 tháng). Không phải trần của payOS (em chưa có số hạn mức payOS).
 */
export const PACK_VIDEO_HOUR_MAX_PURCHASE = 10_000;

/**
 * Đã MỞ THANH TOÁN giờ quay chưa — công tắc env `PACK_VIDEO_HOUR_SALES_OPEN=1`, mặc định TẮT.
 * 18/11 tối anh Trung: "Làm phần mua giờ" → đã nối payOS + chứng từ + sổ quỹ + hóa đơn (mục 20 của tài
 * liệu thiết kế). Tắt = hộp mua vẫn hiện đủ giá + phép tính, nút "Thanh toán" báo "chưa mở thanh toán" và
 * máy chủ từ chối tạo mã. Đơn đã tạo mã từ trước mà tiền về sau khi tắt thì VẪN được cộng giờ.
 */
export function packVideoHourSalesOpen(): boolean {
  return process.env.PACK_VIDEO_HOUR_SALES_OPEN === "1";
}

/**
 * Phần MÃ trong nội dung chuyển khoản payOS của khoản mua giờ: "PAC" + số giờ → khách và kế toán nhìn
 * sao kê thấy "HS PAC200 45678901" (tiền tố sản phẩm · PAC + số giờ · 8 số cuối mã đơn). Dài nhất
 * "HS PAC10000 12345678" = 20 ký tự ≤ trần 25 của payOS.
 */
export const PACK_VIDEO_HOUR_TRANSFER_CODE = "PAC";

/**
 * Hết giờ thì DỪNG (anh chốt 14/11): không mở được video MỚI khi số dư ≤ 0. Video đang quay dở lúc hết
 * giờ vẫn được tải lên — máy chủ nhận ra bằng giờ BẮT ĐẦU quay của clip (services/pack-video/hours.ts).
 * Lùi giờ bắt đầu quá mức này thì không còn được coi là "đang quay dở" (60 phút trần một video + 24 giờ
 * chờ tải khi mất mạng — SỐ TỰ CHỌN).
 */
export const PACK_VIDEO_OVERRUN_LOOKBACK_SEC = PACK_VIDEO_MAX_DURATION_SEC + 24 * 60 * 60;

// ---------- TỰ XÓA THEO TRẠNG THÁI ĐƠN (lát W5, mục 19.4) ----------

/**
 * Công tắc XÓA THẬT trên R2. Mặc định TẮT = chạy bóng: worker chỉ ghi hạn giữ + "sẽ xóa", không xóa
 * tệp nào. Bật bằng env PACK_VIDEO_DELETE_ENABLED=1 SAU KHI đã chạy bóng đủ một tuần và anh duyệt.
 */
export function packVideoDeleteEnabled(): boolean {
  return process.env.PACK_VIDEO_DELETE_ENABLED === "1";
}

/**
 * Công tắc DỌN VIDEO KHI CHỦ SHOP XÓA TÀI KHOẢN. Mặc định TẮT = chỉ ghi nhật ký "sẽ xóa N video".
 * Bật bằng env PACK_VIDEO_ACCOUNT_PURGE=1 khi mở cho khách thứ hai (điều kiện 1 mục 8).
 */
export function packVideoAccountPurgeEnabled(): boolean {
  return process.env.PACK_VIDEO_ACCOUNT_PURGE === "1";
}

/**
 * Lượt tải lên DỞ DANG (dòng PENDING) quá ngần này ngày thì dọn: hủy lượt tải theo mảnh, xóa mảnh tệp, đánh dấu
 * LOST. 7 ngày = cùng mốc "video chờ tải lên" của bảng gộp giờ (FREEZE_LAG_DAYS) — SỐ TỰ CHỌN. Máy khách gửi tiếp
 * sau mốc này nhận 409 "Video này đã bị xóa" (services/pack-video/upload.ts), không hỏng gì.
 */
export const PACK_VIDEO_PENDING_STALE_DAYS = 7;

// ---------- HQ THEO DÕI KHO R2 (26/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 36) ----------

/**
 * Giá R2 Standard — trang giá Cloudflare, đọc 24/11/2026 (mục 29.6). R2 KHÔNG có trần dung lượng: quá phần miễn phí
 * thì Cloudflare tự trừ thẻ theo tháng. Băng thông ra và lệnh xóa không tính tiền. Cloudflare đổi giá thì sửa ở đây.
 * GB tính theo 10^9 byte — em CHƯA thấy trang giá nói rõ 10^9 hay 2^30; chọn 10^9 vì ra tiền cao hơn (lệch ≈ 7 %).
 */
export const R2_PRICING = {
  freeStorageGb: 10,
  storageUsdPerGbMonth: 0.015,
  /** Lượt ghi (PutObject, mỗi mảnh của tải theo mảnh) — 1 triệu lượt đầu mỗi tháng miễn phí. */
  freeClassAOps: 1_000_000,
  classAUsdPerMillion: 4.5,
} as const;

/** Tỷ giá quy đổi để so tiền kho (USD) với tiền bán giờ (đồng). SỐ TỰ CHỌN, cùng số mục 29.6 — chỉ để ước. */
export const PACK_STORAGE_USD_VND = 26_000;

/**
 * Câu đếm kho chỉ đọc các mảnh tháng trong ngần này ngày gần nhất (trần giữ 60 ngày + 40 ngày dư). Video còn lưu
 * cũ hơn mức này không được đếm — khi đó đèn "quá trần" đã đỏ từ trước.
 */
export const PACK_STORAGE_WINDOW_DAYS = 100;

/** Video có hạn xóa đã qua quá ngần này ngày mà vẫn còn = luật xóa không chạy. 1 ngày = 4 nhịp dọn 6 giờ. */
export const PACK_STORAGE_OVERDUE_GRACE_DAYS = 1;

/** Số của lượt dọn cũ hơn ngần này giờ = worker dọn không chạy. 13 = hai nhịp 6 giờ + 1 giờ dư. */
export const PACK_STORAGE_STALE_HOURS = 13;

/**
 * Câu đếm kho chạy lâu hơn mức này thì HQ báo vàng: tới lúc đổi sang cộng dồn theo ngày thay vì đếm lại cả cửa sổ.
 * 5 giây là SỐ TỰ CHỌN (câu chạy trên worker mỗi 6 giờ, không nằm trên đường khách bấm).
 */
export const PACK_STORAGE_SLOW_MS = 5_000;

/**
 * Tiền kho ước một tháng vượt ngần này % tiền bán giờ 30 ngày thì HQ báo vàng. Mục 29.6 tính kho ≈ 7 % doanh thu
 * giờ quay; 20 % (gấp ≈ 3 lần) là SỐ TỰ CHỌN. Chỉ xét khi tiền kho đã ≥ PACK_STORAGE_COST_FLOOR_USD (số nhỏ không báo).
 */
export const PACK_STORAGE_COST_WARN_PCT = 20;
export const PACK_STORAGE_COST_FLOOR_USD = 5;

/** Mỗi lượt worker dọn đọc tối đa ngần này video (đọc theo khóa, không quét bảng). SỐ TỰ CHỌN. */
export const PACK_VIDEO_JANITOR_BATCH = 500;

/** Một lượt dọn đi tối đa ngần này lô rồi nghỉ tới nhịp sau — không chiếm database cả giờ. SỐ TỰ CHỌN. */
export const PACK_VIDEO_JANITOR_MAX_BATCHES = 20;

// ---------- M2: ĐƯỜNG NÓNG NHẸ DATABASE (26/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 29 + 38) ----------

/**
 * Hạn của VÉ PHIÊN QUAY (M2.1): 10 phút — SỐ TỰ CHỌN (mục 29.8 Q-2). Trong hạn vé, các đường nóng của màn quay
 * (hỏi tem, xin vé tải, ký mảnh, báo tải xong) không đọc bảng User / StaffChannel. Giá phải trả: rút quyền một
 * nhân viên / xóa tài khoản có hiệu lực chậm tối đa ngần này trên ĐÚNG các đường đó (đường khác vẫn tức thì).
 * Công tắc tắt gấp PACK_VIDEO_GATE=off vẫn có hiệu lực ngay (kiểm mỗi lượt, không tốn database).
 */
export const PACK_SESSION_TTL_SEC = 10 * 60;

/** Tắt nhận vé phiên quay (mọi lượt quay về xác thực thường) mà không cần ra bản: env PACK_SESSION_OFF=1. */
export function packSessionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PACK_SESSION_OFF !== "1";
}

/**
 * VÉ KHÔNG GHI + GHI GỘP LÚC XONG (M2.4, 26/11/2026 — thiết kế mục 29.5): công tắc env `PACK_UPLOAD_V2`, CHỈ đúng giá trị
 * `on` mới mở đường xin vé tải bản 2 (POST /api/pack-videos/v2). Mặc định (không đặt) = TẮT → máy quay đi đường bản 1.
 * Máy quay biết qua `uploadV2` trong câu trả lời của POST /session, không cần ra bản. Tắt giữa chừng: vé tải ĐÃ cấp vẫn
 * ký mảnh / báo xong được (đường /v2/parts + /v2/complete không xét công tắc) — không clip nào kẹt.
 */
export function packUploadV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PACK_UPLOAD_V2 === "on";
}

/**
 * Hạn của VÉ TẢI (M2.4): 7 ngày — SỐ TỰ CHỌN. Vé mang sẵn mọi thứ để ghi dòng sổ lúc báo xong; hàng chờ trên điện thoại
 * mất mạng có thể báo "tải xong" sau nhiều ngày. Cùng mốc 7 ngày với PACK_VIDEO_PENDING_STALE_DAYS của đường bản 1.
 */
export const PACK_UPLOAD_TICKET_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * GHI GỘP dòng sổ lúc báo tải xong (M2.4, lib/group-commit.ts): gom tối đa 100 dòng hoặc chờ tối đa 200 ms rồi ghi MỘT câu
 * INSERT nhiều dòng; từng lượt gọi chỉ được trả lời sau khi mẻ của nó đã ghi xong. Hai số là SỐ TỰ CHỌN theo thiết kế
 * mục 29.5 — chưa có số đo; 200 ms là độ trễ thêm tối đa của lượt "báo tải xong".
 */
export const PACK_STORE_BATCH = { maxItems: 100, maxWaitMs: 200 } as const;

/**
 * ĐỆM SỐ DƯ GIỜ theo chủ shop (M2.3): 15 giây — SỐ TỰ CHỌN (mục 29.5). Đệm nằm trong từng tiến trình web; chỉ dùng
 * để trả lời "còn giờ không" lúc mở clip mới và để gửi số giờ kèm câu trả lời. Sai lệch tối đa = vài giây quay —
 * luật 14/11 cho phép quay lố ("phần lố trừ lần mua sau"). Đệm báo HẾT giờ thì luôn đọc lại database trước khi chặn.
 */
export const PACK_HOURS_CACHE_TTL_MS = 15_000;
/**
 * HẠN MỨC GỌI các đường nóng của màn quay, theo TÀI KHOẢN đang đăng nhập, trong từng tiến trình web (M2.6,
 * lib/pack-rate-limit.ts): đều 5 lượt / giây, cho dồn 50 lượt. SỐ TỰ CHỌN. Căn cứ ước lượng: một bàn ra một clip /
 * ≈ 40 giây (số đo 20/11, mục 25.13) = 3 lượt gọi / 40 giây; một tài khoản dùng chung cho 20 bàn ≈ 1,5 lượt / giây; hàng
 * chờ 200 clip gửi lại sau khi mất mạng đi tuần tự ≈ 2 lượt / giây. Một vòng lặp lỗi thì hàng trăm lượt / giây.
 * Chưa có số của khách thật → mặc định CHẠY BÓNG (chỉ ghi nhật ký), bật chặn thật bằng env PACK_RATE_LIMIT=on.
 */
export const PACK_HOT_RATE = { perSec: 5, burst: 50 } as const;

/** Trần số chủ shop nằm trong đệm của một tiến trình (đầy thì xóa sạch, đọc lại dần). SỐ TỰ CHỌN. */
export const PACK_HOURS_CACHE_MAX = 50_000;
