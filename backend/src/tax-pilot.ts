/**
 * DẤU TÍCH SANDBOX MODULE HÓA ĐƠN & THUẾ.
 *
 * 24/08/2026 tối: cổng thí điểm ĐÃ GỠ (middleware requireTaxPilot xóa khỏi
 * app.ts — module mở thương mại theo quyền "invoicing" + trần gói). File này
 * còn lại đúng MỘT vai trò: nhận diện tài khoản nội bộ được phép dùng MST
 * sandbox của MISA — khách thường cấu hình MST sandbox sẽ bị chặn phát hành
 * (routes/tax.ts → sandboxTaxCodeBlocked), tránh xuất hóa đơn dưới pháp nhân
 * "CÔNG TY CỔ PHẦN MISA(SANDBOX)".
 */

export const TAX_PILOT_EMAILS = new Set(["admin@hubsell.vn"]);

/**
 * MST tài khoản SANDBOX của MISA (dùng chung cho mọi bên tích hợp) — hóa đơn
 * phát hành từ tài khoản này mang pháp nhân "CÔNG TY CỔ PHẦN MISA(SANDBOX)".
 * Chỉ tài khoản thí điểm được cấu hình MST này; khách thường mà lọt vào là
 * xuất hóa đơn dưới pháp nhân MISA — phải chặn từ route phát hành.
 */
export const MISA_SANDBOX_TAX_CODE = "0101243150-732";

/** Tài khoản nội bộ được phép dùng MST sandbox MISA (test không ra CQT thật)? */
export function isTaxPilotUser(email: string | null | undefined): boolean {
  return !!email && TAX_PILOT_EMAILS.has(email.toLowerCase());
}
