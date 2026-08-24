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
  // 23/08: BẬT — tích hợp MISA chạy thật. 24/08 tối: module MỞ THƯƠNG MẠI
  // (đã gỡ thí điểm), quyền vào theo khóa "invoicing" + trần gói.
  is_tax_module_enabled: true,
};

export type FeatureFlag = keyof FeatureFlags;

/** Cờ này đang bật chưa? */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}

// 24/08 tối: THÍ ĐIỂM Hóa đơn & Thuế ĐÃ GỠ (TAX_PILOT_EMAILS/isTaxPilotUser
// xóa khỏi FE) — module mở thương mại theo quyền "invoicing" + trần gói như
// mọi module; backend/src/tax-pilot.ts còn lại chỉ để chặn MST sandbox MISA.
