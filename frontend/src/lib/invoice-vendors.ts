/**
 * MULTI-VENDOR ADAPTER — danh mục nhà cung cấp hóa đơn điện tử.
 *
 * Gom về một chỗ để thêm/bớt NCC chỉ cần sửa đúng file này (thay vì hardcode rải
 * rác). Mỗi NCC là một "adapter" — khi tích hợp API thật, bổ sung cấu hình gọi
 * API tương ứng vào đây mà không đụng tới giao diện.
 */

export type InvoiceVendor = "MISA" | "VIETTEL" | "VNPT" | "BKAV" | "CUSTOM";

export interface InvoiceVendorMeta {
  value: InvoiceVendor;
  label: string;
  /** NCC tuỳ biến — cần nhập endpoint API riêng. */
  custom?: boolean;
  /** Chưa tích hợp xong — hiển thị "(Sắp ra mắt)" nhưng vẫn cho cấu hình trước. */
  soon?: boolean;
}

export const INVOICE_VENDORS: InvoiceVendorMeta[] = [
  { value: "MISA", label: "MISA meInvoice" },
  { value: "VIETTEL", label: "Viettel SInvoice", soon: true },
  { value: "VNPT", label: "VNPT Invoice", soon: true },
  { value: "BKAV", label: "Bkav eHoadon", soon: true },
  { value: "CUSTOM", label: "Khác (Custom API)", custom: true },
];

export function isCustomVendor(v: string): boolean {
  return INVOICE_VENDORS.find((x) => x.value === v)?.custom === true;
}

/**
 * Mã đối tác ISV của Hubsell với nhà cung cấp hóa đơn — CỐ ĐỊNH, không cho shop
 * sửa. Nhờ mã này mà mọi hóa đơn phát hành qua Hubsell được NCC ghi nhận thuộc
 * đại lý Hubsell (hưởng hoa hồng ISV). Trường Partner Code ở giao diện phải
 * read-only và luôn gửi đúng giá trị này khi lưu.
 */
export const HUBSELL_PARTNER_CODE = "HUBSELL-ISV-2026";

/** Phương thức ký số. */
export const SIGN_METHODS = [
  { value: "usb", label: "Ký số qua USB Token (Thủ công)" },
  { value: "hsm", label: "Ký số từ xa Cloud HSM (Tự động)" },
] as const;
