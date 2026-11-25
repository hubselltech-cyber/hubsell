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

/** Mỗi lượt worker dọn đọc tối đa ngần này video (đọc theo khóa, không quét bảng). SỐ TỰ CHỌN. */
export const PACK_VIDEO_JANITOR_BATCH = 500;

/** Một lượt dọn đi tối đa ngần này lô rồi nghỉ tới nhịp sau — không chiếm database cả giờ. SỐ TỰ CHỌN. */
export const PACK_VIDEO_JANITOR_MAX_BATCHES = 20;
