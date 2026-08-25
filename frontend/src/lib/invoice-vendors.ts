/**
 * MULTI-VENDOR ADAPTER — danh mục nhà cung cấp hóa đơn điện tử.
 *
 * Gom về một chỗ để thêm/bớt NCC chỉ cần sửa đúng file này (thay vì hardcode rải
 * rác). Mỗi NCC là một "adapter" — khi tích hợp API thật, bổ sung cấu hình gọi
 * API tương ứng vào đây mà không đụng tới giao diện.
 */

export type InvoiceVendor =
  | "MISA"
  | "EASYINVOICE"
  | "MINVOICE"
  | "MATBAO"
  | "VIETTEL"
  | "VNPT"
  | "BKAV"
  | "CUSTOM";

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
  /**
   * BỘ NHẬN DIỆN theo NCC (25/08 — anh Trung: "chọn bên nào giao diện phải
   * nhảy theo bên đó, đừng thuần thuật ngữ MISA"). Mọi câu chữ/link trên UI
   * đọc từ đây thay vì hardcode — thêm NCC mới là điền đủ bộ này.
   */
  /** Tên DỊCH VỤ dùng trong câu chữ: "tài khoản {serviceName}", VD "meInvoice". */
  serviceName: string;
  /** Pháp nhân đứng sau — dùng khi nói về quan hệ phí/thuế: "phí trả thẳng cho {companyName}". */
  companyName: string;
  /** Link đăng ký tài khoản NCC (link affiliate khi đàm phán xong — thay đúng 1 chỗ). */
  signupUrl?: string;
  /** Trung tâm trợ giúp của NCC — bullet cuối box Hướng dẫn nhanh. */
  helpUrl?: string;
  /** Cổng tra cứu công khai hóa đơn của NCC. */
  lookupUrl?: string;
  /** Mô tả phương thức ký số của NCC — hiển thị dưới widget Trạng thái kết nối. */
  signNote: string;
  /** true = có API kéo danh sách ký hiệu về chọn (nút "Tải ký hiệu"). */
  canFetchTemplates?: boolean;
  /** NCC tuỳ biến — cần nhập endpoint API riêng. */
  custom?: boolean;
  /**
   * Chưa tích hợp xong — hiển thị "(Sắp ra mắt)", chỉ XEM TRƯỚC giao diện:
   * ô nhập mờ + khóa cứng, nút Lưu/Test khóa (25/08 anh Trung); backend cũng
   * chặn lưu (COMING_SOON_PROVIDERS trong routes/invoice-config.ts).
   */
  soon?: boolean;
  /** Bộ trường credential hiển thị khi chọn NCC này (Dynamic Form). */
  credentialFields: VendorCredentialField[];
}

/** Ghi chú ký số dùng chung cho NCC chưa nối API — chốt câu chữ thật khi tích hợp. */
const SIGN_NOTE_SOON =
  "Phương thức ký số theo quy định của nhà cung cấp — chi tiết được chốt khi Hubsell mở tích hợp chính thức.";

/**
 * Link giới thiệu đăng ký meInvoice (mô hình AFFILIATE — anh Trung chốt 23/08:
 * Hubsell chỉ giới thiệu hưởng hoa hồng, KHÔNG làm đại lý thu tiền/đối soát hộ
 * khách). Khi có link affiliate chính thức từ MISA thì thay đúng MỘT chỗ này.
 */
export const MEINVOICE_SIGNUP_URL = "https://www.meinvoice.vn/dang-ky/";

export const INVOICE_VENDORS: InvoiceVendorMeta[] = [
  {
    // 23/08 — mô hình AFFILIATE (anh Trung chốt): shop đăng nhập bằng tài khoản
    // meInvoice CỦA CHÍNH MÌNH → hóa đơn mang pháp nhân shop, Hubsell chỉ là
    // cầu nối kỹ thuật + giới thiệu. Khóa app (Client ID/Secret) do Hubsell giữ
    // ở server, khách KHÔNG thấy — hết cảnh bắt khách đi xin key ở portal dev.
    value: "MISA",
    label: "MISA meInvoice",
    serviceName: "meInvoice",
    companyName: "MISA",
    signupUrl: MEINVOICE_SIGNUP_URL,
    helpUrl: "https://www.meinvoice.vn/tro-giup/",
    lookupUrl: "https://www.meinvoice.vn/tra-cuu/",
    signNote:
      "Hóa đơn được ký nền tự động (HSM) theo chứng thư gắn với tài khoản meInvoice — không cần USB Token hay cấu hình gì thêm.",
    canFetchTemplates: true,
    credentialFields: [
      {
        key: "meinvoiceUsername",
        label: "Tài khoản meInvoice của shop",
        placeholder: "Email/SĐT đăng nhập meinvoice.vn",
      },
      { key: "meinvoicePassword", label: "Mật khẩu meInvoice", secret: true },
    ],
  },
  // ⏳ CÁC NCC DƯỚI ĐÂY TÍCH HỢP SAU KHI THƯƠNG MẠI HÓA HUBSELL — chiến lược
  // anh Trung chốt 25/08: dùng MISA (bên lớn nhất) làm mặt tiền tiếp thị lấy
  // khách trước; có data khách rồi mới đem đàm phán hoa hồng/chiết khấu với
  // từng bên này. Khi chốt xong một bên: bỏ cờ `soon` ở đây + rút tên khỏi
  // COMING_SOON_PROVIDERS (backend/src/routes/invoice-config.ts) + viết adapter
  // vào PROVIDER_FACTORIES (backend/src/integrations/invoice/index.ts).
  // Khảo sát 25/08: EasyInvoice là đích nhắm chính (SoftDreams, đầu mối trong
  // memory); M-Invoice có sẵn cơ chế affiliate link; Mắt Bão có API + UAT công
  // khai. Đều "soon": form nhảy đúng thuật ngữ, ô nhập khóa, chưa phát hành thật.
  {
    value: "EASYINVOICE",
    label: "EasyInvoice (SoftDreams)",
    serviceName: "EasyInvoice",
    companyName: "SoftDreams",
    signupUrl: "https://easyinvoice.vn/",
    helpUrl: "https://easyinvoice.vn/",
    signNote: SIGN_NOTE_SOON,
    soon: true,
    credentialFields: [
      {
        key: "clientId",
        label: "Tài khoản EasyInvoice của shop",
        placeholder: "Tài khoản đăng nhập easyinvoice.vn",
      },
      { key: "secretKey", label: "Mật khẩu EasyInvoice", secret: true },
    ],
  },
  {
    value: "MINVOICE",
    label: "M-Invoice",
    serviceName: "M-Invoice",
    companyName: "M-Invoice",
    signupUrl: "https://minvoice.vn/",
    helpUrl: "https://minvoice.vn/",
    signNote: SIGN_NOTE_SOON,
    soon: true,
    credentialFields: [
      {
        key: "clientId",
        label: "Tài khoản M-Invoice của shop",
        placeholder: "Tài khoản đăng nhập minvoice.vn",
      },
      { key: "secretKey", label: "Mật khẩu M-Invoice", secret: true },
    ],
  },
  {
    value: "MATBAO",
    label: "Mắt Bão Invoice",
    serviceName: "Matbao-invoice",
    companyName: "Mắt Bão",
    signupUrl: "https://matbao.in/",
    helpUrl: "https://matbao.in/",
    signNote: SIGN_NOTE_SOON,
    soon: true,
    credentialFields: [
      {
        key: "clientId",
        label: "Tài khoản Matbao-invoice của shop",
        placeholder: "Tài khoản đăng nhập matbao.in",
      },
      { key: "secretKey", label: "Mật khẩu Matbao-invoice", secret: true },
    ],
  },
  {
    value: "VIETTEL",
    label: "Viettel SInvoice",
    serviceName: "SInvoice",
    companyName: "Viettel",
    helpUrl: "https://www.sinvoice.com.vn/",
    signNote: SIGN_NOTE_SOON,
    soon: true,
    credentialFields: [
      { key: "clientId", label: "Tài khoản API (Username)", placeholder: "Username SInvoice cấp" },
      { key: "secretKey", label: "Mật khẩu API (Password)", secret: true },
    ],
  },
  {
    value: "VNPT",
    label: "VNPT Invoice",
    serviceName: "VNPT Invoice",
    companyName: "VNPT",
    signNote: SIGN_NOTE_SOON,
    soon: true,
    credentialFields: [
      { key: "clientId", label: "Tài khoản dịch vụ (Account)", placeholder: "Account VNPT cấp" },
      { key: "secretKey", label: "Mật khẩu dịch vụ (ACPass)", secret: true },
    ],
  },
  {
    value: "BKAV",
    label: "Bkav eHoadon",
    serviceName: "eHoadon",
    companyName: "Bkav",
    signNote: SIGN_NOTE_SOON,
    soon: true,
    credentialFields: [
      { key: "clientId", label: "Partner GUID", placeholder: "GUID Bkav cấp" },
      { key: "secretKey", label: "Partner Token", secret: true },
    ],
  },
  {
    value: "CUSTOM",
    label: "Khác (Custom API)",
    serviceName: "nhà cung cấp tùy chỉnh",
    companyName: "nhà cung cấp",
    signNote: SIGN_NOTE_SOON,
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
