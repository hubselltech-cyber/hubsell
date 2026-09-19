/**
 * GỢI Ý ĐƠN VỊ TÍNH in trên hóa đơn (19/09/2026 — anh Trung: cho khách vài lựa
 * chọn sẵn rồi vẫn cho gõ đơn vị khác). Nuôi ô chọn ở tab Cấu hình (kèm mục
 * "Đơn vị khác…" mở ô gõ) + datalist ở form sản phẩm — KHÔNG phải danh sách
 * đóng: backend nhận mọi chuỗi ≤ 20 ký tự.
 *
 * Cố ý KHÔNG có "pcs"/"set"/"box": chữ viết trên hóa đơn phải là tiếng Việt
 * (tiếng nước ngoài chỉ được đặt trong ngoặc sau chữ Việt) — gợi ý "pcs" là gợi
 * ý khách ghi sai. Khách vẫn tự gõ được nếu muốn.
 * Thứ tự = độ phổ biến với hàng bán lẻ trên sàn (thời trang, mỹ phẩm, gia dụng).
 */
export const INVOICE_UNIT_SUGGESTIONS = [
  "Cái",
  "Chiếc",
  "Bộ",
  "Đôi",
  "Hộp",
  "Gói",
  "Chai",
  "Túi",
  "Kiện",
  "Cuộn",
  "Kg",
] as const;
