/**
 * PHIÊN BẢN TÀI LIỆU PHÁP LÝ — nguồn duy nhất backend dùng khi ghi log đồng ý.
 *
 * Giá trị = ngày "Cập nhật lần cuối" in trên trang landing
 * (hubsell-landing/src/app/terms/page.tsx và privacy/page.tsx). Sửa nội dung
 * điều khoản thì đổi CẢ HAI nơi: ngày trên landing + hằng số ở đây, để log
 * TermsAcceptance nói đúng khách đã đồng ý bản nào.
 *
 * Căn cứ: Luật Giao dịch điện tử 2023 Đ.34-35 (hợp đồng giao kết qua hệ thống
 * tự động có giá trị) — muốn viện dẫn được thì phải chứng minh ĐÃ đồng ý bản
 * nào, lúc nào, từ đâu. Đó là lý do có bảng log thay vì một cờ boolean.
 */
export const TERMS_VERSION = "2026-09-19";
export const PRIVACY_VERSION = "2026-09-19";

export const TERMS_URL = "https://hubsell.vn/terms";
export const PRIVACY_URL = "https://hubsell.vn/privacy";

/** Nguồn đồng ý — phân biệt tick tay với đồng ý ngầm qua nút Google. */
export type TermsAcceptanceSource =
  | "register_form" // tick ô đồng ý trên form Tạo tài khoản
  | "google_register" // tick ô rồi bấm "Tiếp tục với Google" ở form đăng ký
  | "google_login"; // bấm Google ở form ĐĂNG NHẬP, tài khoản chưa tồn tại → dòng "Bằng việc tiếp tục..." dưới nút

export const TERMS_SOURCES: readonly TermsAcceptanceSource[] = [
  "register_form",
  "google_register",
  "google_login",
];

export function isTermsSource(v: unknown): v is TermsAcceptanceSource {
  return typeof v === "string" && (TERMS_SOURCES as readonly string[]).includes(v);
}
