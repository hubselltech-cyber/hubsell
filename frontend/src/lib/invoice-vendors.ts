/**
 * MULTI-VENDOR ADAPTER — danh mục nhà cung cấp hóa đơn điện tử.
 *
 * Gom về một chỗ để thêm/bớt NCC chỉ cần sửa đúng file này (thay vì hardcode rải
 * rác). Mỗi NCC là một "adapter" — khi tích hợp API thật, bổ sung cấu hình gọi
 * API tương ứng vào đây mà không đụng tới giao diện.
 */

export type InvoiceVendor = "MISA" | "VIETTEL" | "BKAV" | "CUSTOM";

export interface InvoiceVendorMeta {
  value: InvoiceVendor;
  label: string;
  /** NCC tuỳ biến — cần nhập endpoint API riêng. */
  custom?: boolean;
}

export const INVOICE_VENDORS: InvoiceVendorMeta[] = [
  { value: "MISA", label: "MISA meInvoice" },
  { value: "VIETTEL", label: "Viettel Sinvoice" },
  { value: "BKAV", label: "Bkav eHoadon" },
  { value: "CUSTOM", label: "Khác (Custom API)", custom: true },
];

export function isCustomVendor(v: string): boolean {
  return INVOICE_VENDORS.find((x) => x.value === v)?.custom === true;
}

/** Phương thức ký số. */
export const SIGN_METHODS = [
  { value: "usb", label: "Ký số qua USB Token (Thủ công)" },
  { value: "hsm", label: "Ký số từ xa Cloud HSM (Tự động)" },
] as const;
