/**
 * QUY ƯỚC TÊN ĐĂNG NHẬP (anh Trung chốt 10/08): viết LIỀN, KHÔNG DẤU —
 * dùng chung cho ô đăng ký chủ shop và ô tạo nhân viên "chủ/nhânviên".
 *
 * Ép ngay khi gõ thay vì báo lỗi sau: "Anh Yêu Em" → "anhyeuem" — bỏ dấu
 * tiếng Việt (kể cả đ→d), thường hóa, xoá khoảng trắng/ký tự lạ, tối đa 30 ký
 * tự. Cùng văn phạm với USERNAME_REGEX phía backend (backend/src/username.ts).
 */
export function toAsciiUsername(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu tổ hợp (á→a, ê→e…)
    .replace(/[đĐ]/g, "d") // đ không nằm trong dải dấu tổ hợp, thay riêng
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 30);
}
