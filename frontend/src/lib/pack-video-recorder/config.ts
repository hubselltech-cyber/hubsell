// ============================================================
// QUAY VIDEO ĐÓNG HÀNG BẰNG WEBCAM — hằng số (docs/VIDEO-DONG-HANG-THIET-KE.md mục 13)
//
// Mọi con số ở đây là số ĐÃ ĐO trên trang thử `tools/thu-webcam` ngày 16/11/2026 với webcam thật
// ("Web Camera" cb07:1bcf, Chrome trên Windows), không phải số đoán. Đổi thì đổi ở đây.
// Người đóng hàng KHÔNG chọn các thông số này (anh Trung: màn quay chỉ có nút cần dùng).
// ============================================================

/** Khổ hình quay. 1280×720 đo được 29,8 khung/giây, 0 khung rớt trên webcam thử. */
export const RECORD_WIDTH = 1280;
export const RECORD_HEIGHT = 720;
export const RECORD_FPS = 30;

/**
 * Bitrate đặt cho bộ mã hóa H.264. Đặt 800k thì tệp thật ra 793–978 kbps ≈ 5,7–6,2 MB / phút
 * (hai clip tem thật 49 giây và 41 giây, 16/11/2026) — cùng cỡ với điện thoại (Note8 ≈ 6,1 MB / phút).
 */
export const RECORD_BITRATE = 800_000;

/** Một khung khóa mỗi giây — tua được tới từng giây, và cắt clip chỉ phải chờ tối đa một khung. */
export const KEY_FRAME_INTERVAL_US = 1_000_000;

/** Hàng chờ bộ mã hóa dài hơn mức này thì bỏ khung (quay thời gian thực, không để dồn). */
export const MAX_ENCODE_QUEUE = 10;

/**
 * Bộ ghép MP4 gom dữ liệu thành khúc cỡ này rồi mới ghi xuống ổ (≈ 8 giây quay / khúc; đo M0: 4–5 ms / lần ghi).
 * Cũng là phần tối đa bị mất ở CUỐI một clip được cứu sau khi trang sập (khúc đang nằm trong bộ nhớ).
 */
export const WRITE_CHUNK_BYTES = 1024 * 1024;

/** Thử đọc mã mỗi 200 ms: giải mã trung bình 53 ms, lâu nhất 142 ms trong Worker — không lần nào bị dồn. */
export const SCAN_INTERVAL_MS = 200;

/** Thấy cùng một mã ở ngần này lần đọc LIÊN TIẾP mới nhận (chống đọc nhầm một khung). */
export const CONFIRM_READS = 2;

/** Tem đã quay rồi mà còn nằm trong hình: chỉ nhắc lại mỗi ngần này mili giây. */
export const REPEAT_NOTICE_MS = 3000;

/**
 * Mở camera lỗi `NotReadableError` / `AbortError` thì thử lại: thấy thật 16/11/2026 — webcam USB cắm qua
 * bộ chia tự rớt rồi nối lại, vài chục giây sau đó Chrome chưa đọc được camera dù không ứng dụng nào giữ.
 */
export const CAMERA_OPEN_ATTEMPTS = 6;
export const CAMERA_OPEN_RETRY_MS = 1500;

/** Windows báo đổi thiết bị vài lần liền nhau khi cắm lại → chờ yên rồi mới thử mở lại camera. */
export const CAMERA_RECOVER_DEBOUNCE_MS = 1500;

/** Chiều cao hộp ngày giờ so với chiều cao khung hình (≈ 3,5 %, góc trái trên — anh Trung chốt 14/11). */
export const STAMP_BOX_RATIO = 0.035;

/**
 * Tệp WebAssembly của bộ đọc mã (zxing-wasm), phục vụ từ `frontend/public` — không gọi mạng ngoài.
 * Tên tệp mang số phiên bản: nâng `zxing-wasm` trong package.json thì PHẢI chép tệp mới và đổi tên ở đây.
 */
export const ZXING_READER_WASM_URL = "/vendor/zxing/zxing_reader-3.1.7.wasm";

/** Định dạng mã cần đọc trên tem: mã vạch Code 128 và mã QR. */
export const SCAN_FORMATS = ["code_128", "qr_code"] as const;
