/**
 * BẢNG MÀU BIỂU ĐỒ DÙNG CHUNG (Design System)
 *
 * Nguồn chân lý duy nhất cho màu nhận diện kênh trên mọi biểu đồ — trước đây
 * mỗi trang tự khai một bản (Dashboard, P&L thực tế…) nên chỉ cần một nơi gõ
 * lệch mã hex là hai biểu đồ cùng nói về Shopee bằng hai màu khác nhau.
 *
 * Nguyên tắc: màu kênh là màu NHẬN DIỆN thương hiệu sàn đúng mã gốc (Shopee
 * #EE4D2D, TikTok đen, Lazada navy #0F146D — chốt 19/08). Riêng OFFLINE/khác
 * dùng emerald "màu Hubsell" theo quyết định anh Trung — ngoại lệ có chủ đích
 * của quy tắc "màu kênh không vay màu tín hiệu lãi–lỗ (lib/typography.ts)";
 * các sàn thật vẫn tuyệt đối không dùng emerald/red.
 */
export const CHANNEL_COLORS: Record<string, string> = {
  // Giá trị là CSS VAR khai báo trong globals.css (:root + .dark): màu gốc
  // thương hiệu ở light mode; TikTok (đen) & Lazada (navy sẫm) có bản SÁNG
  // HƠN trong dark mode vì màu gốc chìm vào nền tối. var() dùng được cả cho
  // fill SVG (Recharts) lẫn style.backgroundColor (chấm legend).
  SHOPEE: "var(--channel-shopee)", // #EE4D2D cam đỏ Shopee
  TIKTOK: "var(--channel-tiktok)", // #000000 đen TikTok (dark: zinc-200)
  LAZADA: "var(--channel-lazada)", // #0F146D navy Lazada (dark: indigo-500)
  OFFLINE: "var(--channel-offline)", // #10B981 emerald — kênh ngoài sàn / khác
};

/** Màu dự phòng cho kênh chưa có trong bảng (kênh mới thêm sau). */
export const CHANNEL_COLOR_FALLBACK = "var(--channel-other)"; // violet-500
