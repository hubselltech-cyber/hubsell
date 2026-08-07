/**
 * MULTI-VENDOR ADAPTER — danh mục nhà cung cấp hóa đơn điện tử.
 *
 * Gom về một chỗ để thêm/bớt NCC chỉ cần sửa đúng file này (thay vì hardcode rải
 * rác). Mỗi NCC là một "adapter" — khi tích hợp API thật, bổ sung cấu hình gọi
 * API tương ứng vào đây mà không đụng tới giao diện.
 */

export type InvoiceVendor = "MISA" | "VIETTEL" | "VNPT" | "BKAV" | "CUSTOM";

/**
 * MỘT TRƯỜNG CREDENTIAL của form cấu hình NCC (Dynamic Form theo vendor).
 *
 * `key` map THẲNG vào cột sẵn có của InvoiceConfig — thêm NCC mới là thêm
 * preset nhãn/placeholder cho đúng thuật ngữ của NCC đó, KHÔNG thêm cột DB
 * (Viettel gọi là Username/Password, VNPT là Account/ACPass… nhưng về bản chất
 * vẫn là một cặp định danh + bí mật, đổ chung vào clientId/secretKey).
 */
export interface VendorCredentialField {
  key: "partnerCode" | "clientId" | "secretKey" | "customApiUrl";
  label: string;
  placeholder?: string;
  /** true = ô password + luồng che/giữ-nguyên-khi-trống. */
  secret?: boolean;
  /** true = read-only (VD mã ISV cố định của Hubsell). */
  readOnly?: boolean;
}

export interface InvoiceVendorMeta {
  value: InvoiceVendor;
  label: string;
  /** NCC tuỳ biến — cần nhập endpoint API riêng. */
  custom?: boolean;
  /** Chưa tích hợp xong — hiển thị "(Sắp ra mắt)" nhưng vẫn cho cấu hình trước. */
  soon?: boolean;
  /** Bộ trường credential hiển thị khi chọn NCC này (Dynamic Form). */
  credentialFields: VendorCredentialField[];
}

export const INVOICE_VENDORS: InvoiceVendorMeta[] = [
  {
    value: "MISA",
    label: "MISA meInvoice",
    credentialFields: [
      { key: "partnerCode", label: "Mã đại lý ISV (Partner Code)", readOnly: true },
      { key: "clientId", label: "Mã định danh (Client ID)", placeholder: "Client ID do MISA cấp" },
      { key: "secretKey", label: "Khóa bảo mật (Client Secret)", secret: true },
    ],
  },
  {
    value: "VIETTEL",
    label: "Viettel SInvoice",
    soon: true,
    credentialFields: [
      { key: "clientId", label: "Tài khoản API (Username)", placeholder: "Username SInvoice cấp" },
      { key: "secretKey", label: "Mật khẩu API (Password)", secret: true },
    ],
  },
  {
    value: "VNPT",
    label: "VNPT Invoice",
    soon: true,
    credentialFields: [
      { key: "clientId", label: "Tài khoản dịch vụ (Account)", placeholder: "Account VNPT cấp" },
      { key: "secretKey", label: "Mật khẩu dịch vụ (ACPass)", secret: true },
    ],
  },
  {
    value: "BKAV",
    label: "Bkav eHoadon",
    soon: true,
    credentialFields: [
      { key: "clientId", label: "Partner GUID", placeholder: "GUID Bkav cấp" },
      { key: "secretKey", label: "Partner Token", secret: true },
    ],
  },
  {
    value: "CUSTOM",
    label: "Khác (Custom API)",
    custom: true,
    credentialFields: [
      { key: "customApiUrl", label: "Endpoint API (Custom)", placeholder: "https://api.nhacungcap.vn/invoice" },
      { key: "clientId", label: "Mã định danh (Client ID)", placeholder: "Client ID của NCC" },
      { key: "secretKey", label: "Khóa bảo mật (Secret Key)", secret: true },
    ],
  },
];

/** Meta của NCC đang chọn — fallback MISA khi giá trị lạ. */
export function vendorMeta(v: string): InvoiceVendorMeta {
  return INVOICE_VENDORS.find((x) => x.value === v) ?? INVOICE_VENDORS[0];
}

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

/** Phương thức ký số (giá trị lưu DB — backend validate đúng 2 giá trị này). */
export const SIGN_METHODS = [
  { value: "USB_TOKEN", label: "Ký số qua USB Token (Thủ công)" },
  { value: "ESIGN_CLOUD", label: "MISA eSign — Ký số từ xa (Tự động)" },
] as const;

// ============================================================
// VALIDATE THEO TT 78/2021 — bản MIRROR của backend
// (backend/src/integrations/invoice/misa-einvoice.ts, nguồn chuẩn). UI chặn
// sớm để người dùng không phải chờ API MISA trả lỗi định dạng; backend vẫn
// validate lại nên lệch nhau không gây sai dữ liệu.
// ============================================================

/** MST: 10 số (doanh nghiệp/HKD) hoặc 13 số / 10-3 số (đơn vị phụ thuộc). */
export const TAX_CODE_RE = /^\d{10}(-?\d{3})?$/;

/** MẪU SỐ hóa đơn: 1 chữ số 1-6 (1 = HĐ GTGT, 2 = HĐ bán hàng…). */
export const INVOICE_PATTERN_RE = /^[1-6]$/;

/** KÝ HIỆU KÊ KHAI: VD C26TAA — ký tự thứ 4 KHÔNG được là M (M = máy tính tiền). */
export const INVOICE_SERIES_RE = /^[CK]\d{2}[A-LN-Z][A-Z0-9]{2}$/;

/** KÝ HIỆU MÁY TÍNH TIỀN: ký tự thứ 4 BẮT BUỘC là M, VD C26MAA. */
export const POS_SERIES_RE = /^[CK]\d{2}M[A-Z0-9]{2}$/;

/** Thông điệp lỗi định dạng — dùng chung cho validate inline trên UI. */
export const INVOICE_FIELD_HINTS = {
  taxCode: "MST gồm 10 số, hoặc 13 số/10-3 số với đơn vị phụ thuộc (VD 0101243150-001).",
  invoicePattern: "Mẫu số là 1 chữ số từ 1 đến 6 (VD 1 = hóa đơn GTGT).",
  invoiceSeries:
    "Ký hiệu dạng C26TAA: C/K + 2 số năm + chữ loại hóa đơn + 2 ký tự. Chữ thứ 4 không được là M.",
  posSeries: "Ký hiệu máy tính tiền dạng C26MAA — ký tự thứ 4 bắt buộc là M.",
} as const;
