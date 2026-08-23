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
  key:
    | "partnerCode"
    | "clientId"
    | "secretKey"
    | "customApiUrl"
    // Tài khoản meInvoice CỦA SHOP (multi-tenant 23/08) — 2 cột riêng trong
    // InvoiceConfig, không đổ chung vào clientId/secretKey.
    | "meinvoiceUsername"
    | "meinvoicePassword";
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
    // 23/08 — mô hình AFFILIATE (anh Trung chốt): shop đăng nhập bằng tài khoản
    // meInvoice CỦA CHÍNH MÌNH → hóa đơn mang pháp nhân shop, Hubsell chỉ là
    // cầu nối kỹ thuật + giới thiệu. Khóa app (Client ID/Secret) do Hubsell giữ
    // ở server, khách KHÔNG thấy — hết cảnh bắt khách đi xin key ở portal dev.
    value: "MISA",
    label: "MISA meInvoice",
    credentialFields: [
      {
        key: "meinvoiceUsername",
        label: "Tài khoản meInvoice của shop",
        placeholder: "Email/SĐT đăng nhập meinvoice.vn",
      },
      { key: "meinvoicePassword", label: "Mật khẩu meInvoice", secret: true },
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

// ============================================================
// NCC LUỒNG MÁY TÍNH TIỀN (tab POS) — danh mục RIÊNG với luồng kê khai:
// không có CUSTOM (máy tính tiền phải là NCC được CQT công nhận), và key
// trường map vào cặp cột posClientId/posSecretKey của InvoiceConfig.
// ============================================================

export interface PosVendorCredentialField {
  key: "posClientId" | "posSecretKey";
  label: string;
  placeholder?: string;
  /** true = ô password + luồng che/giữ-nguyên-khi-trống. */
  secret?: boolean;
}

export interface PosVendorMeta {
  value: Exclude<InvoiceVendor, "CUSTOM">;
  label: string;
  soon?: boolean;
  credentialFields: PosVendorCredentialField[];
}

export const POS_VENDORS: PosVendorMeta[] = [
  {
    value: "MISA",
    label: "MISA meInvoice POS",
    credentialFields: [
      { key: "posClientId", label: "POS Client ID", placeholder: "Client ID luồng POS do MISA cấp" },
      { key: "posSecretKey", label: "POS Secret Key", secret: true },
    ],
  },
  {
    value: "VIETTEL",
    label: "Viettel SInvoice POS",
    soon: true,
    credentialFields: [
      { key: "posClientId", label: "Tài khoản API (Username)", placeholder: "Username SInvoice cấp" },
      { key: "posSecretKey", label: "Mật khẩu API (Password)", secret: true },
    ],
  },
  {
    value: "VNPT",
    label: "VNPT Invoice POS",
    soon: true,
    credentialFields: [
      { key: "posClientId", label: "Tài khoản dịch vụ (Account)", placeholder: "Account VNPT cấp" },
      { key: "posSecretKey", label: "Mật khẩu dịch vụ (ACPass)", secret: true },
    ],
  },
  {
    value: "BKAV",
    label: "Bkav eHoadon POS",
    soon: true,
    credentialFields: [
      { key: "posClientId", label: "Partner GUID", placeholder: "GUID Bkav cấp" },
      { key: "posSecretKey", label: "Partner Token", secret: true },
    ],
  },
];

/** Meta NCC POS đang chọn — fallback MISA khi giá trị lạ. */
export function posVendorMeta(v: string): PosVendorMeta {
  return POS_VENDORS.find((x) => x.value === v) ?? POS_VENDORS[0];
}

export function isCustomVendor(v: string): boolean {
  return INVOICE_VENDORS.find((x) => x.value === v)?.custom === true;
}

/**
 * Mã đối tác ISV của Hubsell với nhà cung cấp hóa đơn — CỐ ĐỊNH, không cho shop
 * sửa. Nhờ mã này mà mọi hóa đơn phát hành qua Hubsell được NCC ghi nhận thuộc
 * đại lý Hubsell (hưởng hoa hồng ISV). 23/08: KHÔNG hiển thị trên form nữa
 * (mô hình affiliate — khách không cần biết), nhưng vẫn gửi kèm khi lưu để
 * NCC ghi nhận nguồn giới thiệu.
 */
export const HUBSELL_PARTNER_CODE = "HUBSELL-ISV-2026";

/**
 * Link giới thiệu đăng ký meInvoice (mô hình AFFILIATE — anh Trung chốt 23/08:
 * Hubsell chỉ giới thiệu hưởng hoa hồng, KHÔNG làm đại lý thu tiền/đối soát hộ
 * khách). Khi có link affiliate chính thức từ MISA thì thay đúng MỘT chỗ này.
 */
export const MEINVOICE_SIGNUP_URL = "https://www.meinvoice.vn/dang-ky/";

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

/** MST: 10 số (DN), 12 số (hộ kinh doanh/cá nhân), hoặc 13 số / 10-3 số (đơn vị phụ thuộc). */
export const TAX_CODE_RE = /^\d{10}(-?\d{3})?$|^\d{12}$/;

/** MẪU SỐ = ký tự đầu ký hiệu: 1 GTGT · 2 bán hàng · 5 vé điện tử · 6 phiếu xuất kho. */
export const INVOICE_PATTERN_RE = /^[1256]$/;

/** KÝ HIỆU KÊ KHAI (7 ký tự): VD 1C26TAA — ký tự thứ 5 là T (hóa đơn thường). */
export const INVOICE_SERIES_RE = /^[1256][CK]\d{2}T[A-Z0-9]{2}$/;

/** KÝ HIỆU MÁY TÍNH TIỀN (7 ký tự): ký tự thứ 5 BẮT BUỘC là M, VD 1C26MAA. */
export const POS_SERIES_RE = /^[1256][CK]\d{2}M[A-Z0-9]{2}$/;

/** Thông điệp lỗi định dạng — dùng chung cho validate inline trên UI. */
export const INVOICE_FIELD_HINTS = {
  taxCode:
    "MST gồm 10 số (doanh nghiệp), 12 số (hộ kinh doanh) hoặc 13 số/10-3 số với đơn vị phụ thuộc.",
  invoicePattern:
    "Mẫu số là ký tự đầu của ký hiệu: 1 = HĐ GTGT, 2 = HĐ bán hàng, 5 = vé điện tử, 6 = phiếu xuất kho.",
  invoiceSeries:
    "Ký hiệu 7 ký tự dạng 1C26TAA: mẫu số + C/K (có mã/không mã) + 2 số năm + T (hóa đơn thường) + 2 ký tự tự đặt.",
  posSeries:
    "Ký hiệu máy tính tiền 7 ký tự dạng 1C26MAA — ký tự thứ 5 bắt buộc là M.",
} as const;
