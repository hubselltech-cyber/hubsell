/**
 * FEATURE FLAGS — công tắc bật/tắt module ở tầng giao diện.
 *
 * Gom về một chỗ để bật/tắt an toàn các module đang dựng khung mà chưa muốn cho
 * chạy trên dữ liệu thật. Mặc định TẮT: module hiện dưới dạng Placeholder/Beta,
 * không thực thi ghi/gọi API thương mại — tránh ảnh hưởng số liệu thật.
 *
 * Sau này có thể thay bằng cờ đọc từ backend theo từng shop; hiện để hằng số
 * biên dịch cho đơn giản và tường minh.
 */
export interface FeatureFlags {
  /** Module Hóa đơn điện tử & Đối soát Thuế (Multi-Vendor). TẮT = chế độ Beta. */
  is_tax_module_enabled: boolean;
}

export const FEATURE_FLAGS: FeatureFlags = {
  is_tax_module_enabled: false,
};

export type FeatureFlag = keyof FeatureFlags;

/** Cờ này đang bật chưa? */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}

/**
 * THÍ ĐIỂM MODULE HÓA ĐƠN & THUẾ (23/08/2026): tích hợp MISA mới thông sandbox,
 * toàn module chỉ mở cho các tài khoản dưới đây để anh Trung theo dõi và test.
 * MIRROR của backend/src/tax-pilot.ts — lớp chặn thật (403) nằm ở backend,
 * đây chỉ là lớp ẩn menu/trang; sửa danh sách phải sửa CẢ HAI file.
 */
export const TAX_PILOT_EMAILS = ["admin@hubsell.vn"];

/** Tài khoản (theo email đăng nhập) có trong thí điểm Hóa đơn & Thuế không? */
export function isTaxPilotUser(user: { email?: string | null } | null): boolean {
  const email = user?.email?.toLowerCase();
  return !!email && TAX_PILOT_EMAILS.includes(email);
}
