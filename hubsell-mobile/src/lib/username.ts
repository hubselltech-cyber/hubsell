/**
 * QUY ƯỚC TÊN ĐĂNG NHẬP — bản sao của frontend/src/lib/username.ts (convention
 * chép tay giữa các package): viết LIỀN, KHÔNG DẤU, cùng văn phạm với
 * USERNAME_REGEX phía backend (backend/src/lib/username.ts).
 *
 * Ép ngay khi gõ thay vì báo lỗi sau: "Anh Yêu Em" → "anhyeuem".
 */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._]{2,29}$/;

export function toAsciiUsername(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu tổ hợp (á→a, ê→e…)
    .replace(/[đĐ]/g, "d") // đ không nằm trong dải dấu tổ hợp, thay riêng
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 30);
}
