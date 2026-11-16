// ============================================================
// VIDEO ĐÓNG HÀNG — hằng số cấu hình (16/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md)
//
// Mọi con số của tính năng nằm ở đây, kèm CĂN CỨ. Số nào ghi "tự chọn" là mặc định
// em đặt, chưa có số đo / chưa có quyết định của anh Trung — đổi thì đổi ở đây.
// ============================================================

/**
 * Tài khoản THÍ ĐIỂM được mở tính năng (anh Trung 16/11: "chỉ mở cho một mình tài khoản
 * admin@hubsell.vn, còn lại mọi người sẽ chỉ thấy mờ"). So khớp không phân biệt hoa thường,
 * và chỉ CHỦ tài khoản — nhân viên của tài khoản này cũng bị khóa (services/pack-video/access.ts).
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

/**
 * GÓI GIỜ QUAY. Cỡ gói 100 và 200 giờ là số anh Trung nêu 14/11 ("gói theo giờ quay: 100 giờ,
 * 200 giờ..."). GIÁ CHƯA CHỐT → priceVnd = null, web hiện "chưa công bố" chứ không vẽ số.
 */
export const PACK_VIDEO_HOUR_PACKAGES: readonly { hours: number; priceVnd: number | null }[] = [
  { hours: 100, priceVnd: null },
  { hours: 200, priceVnd: null },
];

/**
 * Đã mở bán giờ quay chưa. false = nút "Mua thêm giờ quay" chỉ mở hộp xem gói, CHƯA có bước thanh
 * toán (chưa có giá, chưa nối cổng thanh toán). Bật khi anh chốt giá + cách thu.
 */
export const PACK_VIDEO_HOUR_SALES_OPEN = false;
