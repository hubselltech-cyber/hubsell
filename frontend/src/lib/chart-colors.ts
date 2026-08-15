/**
 * BẢNG MÀU BIỂU ĐỒ DÙNG CHUNG (Design System)
 *
 * Nguồn chân lý duy nhất cho màu nhận diện kênh trên mọi biểu đồ — trước đây
 * mỗi trang tự khai một bản (Dashboard, P&L thực tế…) nên chỉ cần một nơi gõ
 * lệch mã hex là hai biểu đồ cùng nói về Shopee bằng hai màu khác nhau.
 *
 * Nguyên tắc: màu kênh là màu NHẬN DIỆN thương hiệu sàn (Shopee cam, Lazada
 * xanh dương…), tách bạch với màu TÍN HIỆU lãi–lỗ (emerald-500/red-500 trong
 * lib/typography.ts) — hai hệ không được vay mượn lẫn nhau.
 */
export const CHANNEL_COLORS: Record<string, string> = {
  SHOPEE: "#f97316", // orange-500 — nhận diện Shopee
  TIKTOK: "#18181b", // zinc-900 — nhận diện TikTok
  LAZADA: "#3b82f6", // blue-500 — nhận diện Lazada
  OFFLINE: "#a1a1aa", // zinc-400 — kênh ngoài sàn, trung tính
};

/** Màu dự phòng cho kênh chưa có trong bảng (kênh mới thêm sau). */
export const CHANNEL_COLOR_FALLBACK = "#8b5cf6"; // violet-500
