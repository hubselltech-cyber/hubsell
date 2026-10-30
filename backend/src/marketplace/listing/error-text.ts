// ============================================================
// DỊCH LỖI SÀN KHI ĐĂNG SẢN PHẨM → CÂU TIẾNG VIỆT CHO NGƯỜI BÁN
//
// Sàn trả lỗi tiếng Anh kỹ thuật ("invalid Dimension.PackageLength: value must
// be greater than 0"). Khách không đọc được → ghi vào target.error dạng:
//   dòng 1 = câu tiếng Việt nói rõ thiếu gì / sửa ở đâu;
//   dòng 2 = nguyên văn sàn trả (FE tách hai dòng ở shared.ts, hiện nhỏ, mờ).
// Thuần, có test (__tests__/error-text.test.ts). Mẫu khớp theo TỪ KHÓA trong
// thông điệp, không theo mã lỗi — ba sàn ba kiểu mã, từ khóa ổn định hơn.
// ============================================================

import type { ChannelName } from "@prisma/client";

const PLATFORM_LABEL: Record<ChannelName, string> = {
  SHOPEE: "Shopee",
  TIKTOK: "TikTok Shop",
  LAZADA: "Lazada",
  OFFLINE: "Sàn",
};

interface Rule {
  test: RegExp;
  /** Câu cho người bán: nói rõ ô nào, sửa thế nào. */
  text: string;
}

/**
 * Shopee add_item: "You are not in the whitelist to add images in description, can only
 * upload plain text" (product.error_param, lỗi thật gian Bunchar 30/10/2026) — gian chưa được
 * Shopee bật mô tả mở rộng. Adapter bắt lỗi này để đăng lại mô tả chữ thuần.
 */
const SHOPEE_DESC_IMAGE_WHITELIST_RE = /whitelist to add images in description|can only upload plain text/i;

export function isShopeeDescImageWhitelistError(message: string): boolean {
  return SHOPEE_DESC_IMAGE_WHITELIST_RE.test(String(message ?? ""));
}

/** Thứ tự = ưu tiên: mẫu hẹp (kích thước, cân nặng) đứng trước mẫu rộng (param, attribute). */
const RULES: Rule[] = [
  // --- Lỗi phía Hubsell gọi sàn (tham số API) — khách không sửa được, đừng bắt khách mò ---
  {
    test: /not required for this request|Unexpected identifier|invalid_signature|sign (is )?invalid|app_key|unsupported api|api not found/i,
    text: "Lỗi ở phía Hubsell khi gọi sàn (tham số API), không phải do bài đăng — báo Hubsell kèm dòng chi tiết bên dưới; Hubsell sửa xong thì bấm Đăng lại.",
  },
  // --- Shopee gian nhiều kho đòi mã kho ---
  {
    test: /multi warehouse|location.?id/i,
    text: "Gian Shopee bật nhiều kho nên sàn đòi mã kho khi đăng tồn — Hubsell tự gửi kho lấy hàng đầu tiên; vẫn lỗi thì báo Hubsell kèm dòng chi tiết bên dưới.",
  },
  // --- Ủy quyền / quyền ---
  {
    test: /invalid_access_token|access.?token|unauthori[sz]ed|error_auth|auth l[ỗo]i|token (expired|invalid)|refresh_token|error_permission|not allowed|no permission|forbidden/i,
    text: "Gian này mất ủy quyền hoặc chưa cấp quyền đăng sản phẩm cho Hubsell — vào Kênh bán, bấm Kết nối lại gian rồi đăng lại.",
  },
  // --- Quá tải / mạng ---
  {
    test: /rate.?limit|too many request|quá tải|HTTP 429|\b429\b|error_server|internal server|HTTP 5\d\d|timeout|timed out|ECONNRESET|fetch failed|ENOTFOUND|socket hang up/i,
    text: "Sàn đang quá tải hoặc mạng gián đoạn, chưa đăng được — chờ vài phút rồi bấm Đăng lại.",
  },
  // --- Kích thước kiện ---
  {
    test: /dimension|package_?(length|width|height)|PackageLength|PackageWidth|PackageHeight/i,
    text: "Kích thước kiện hàng (Dài × Rộng × Cao, cm) chưa hợp lệ — nhập đủ cả 3 số lớn hơn 0, hoặc để trống cả 3 ô nếu sàn không bắt buộc.",
  },
  // --- Cân nặng ---
  {
    test: /weight/i,
    text: "Cân nặng chưa hợp lệ — nhập số gram lớn hơn 0 (ví dụ 250).",
  },
  // --- Shopee: gian chưa được whitelist chèn ảnh vào mô tả (lỗi thật Bunchar 30/10) ---
  {
    test: SHOPEE_DESC_IMAGE_WHITELIST_RE,
    text: "Gian Shopee này chưa được Shopee cho phép chèn ảnh vào mô tả (chỉ nhận mô tả chữ) — Hubsell tự đăng lại với mô tả dạng chữ, ảnh mô tả bỏ qua; vẫn lỗi thì báo Hubsell kèm dòng chi tiết bên dưới.",
  },
  // --- Ảnh ---
  {
    test: /image|picture|photo|\bimg\b|media/i,
    text: "Sàn không nhận ảnh sản phẩm — ảnh phải tải được, đúng cỡ sàn yêu cầu (Shopee ≤ 2 MB, tối thiểu 500×500) và không quá số ảnh cho phép; thử bớt ảnh hoặc bổ sung ảnh trên sàn sau khi đăng.",
  },
  // --- Tên sản phẩm ---
  {
    test: /item_?name|product.?name|\btitle\b|name (is )?(too )?(long|short)|name length/i,
    text: "Tên sản phẩm chưa đạt chuẩn sàn (quá ngắn, quá dài hoặc có từ bị cấm) — bấm Sửa bài đăng, chỉnh tên theo số ký tự ghi dưới khung rồi đăng lại.",
  },
  // --- Mô tả ---
  {
    test: /description/i,
    text: "Mô tả sản phẩm chưa đạt chuẩn sàn (quá ngắn, quá dài hoặc có nội dung bị cấm) — bấm Sửa bài đăng, chỉnh mô tả rồi đăng lại.",
  },
  // --- Thương hiệu ---
  {
    test: /brand/i,
    text: "Thương hiệu chưa hợp lệ với danh mục này — chọn lại ở ô Thương hiệu (không có thì chọn Không có thương hiệu).",
  },
  // --- Danh mục ---
  {
    test: /categor|leaf/i,
    text: "Danh mục chưa hợp lệ (chưa chọn tới cấp cuối, hoặc danh mục này gian chưa được phép bán) — chọn lại danh mục rồi đăng lại.",
  },
  // --- Vận chuyển ---
  {
    test: /logistic|shipping|delivery|channel/i,
    text: "Kênh vận chuyển chưa hợp lệ — bật ít nhất một kênh đang mở trên sàn ở mục Kênh vận chuyển (bấm Tuỳ chỉnh).",
  },
  // --- SKU trùng ---
  {
    test: /duplicate|already exist|exists|trùng/i,
    text: "Mã SKU đã có trên gian đích — sàn không cho đăng trùng; đổi SKU ở sản phẩm nguồn hoặc xóa sản phẩm cũ trên sàn.",
  },
  // --- Giá / tồn ---
  {
    test: /\bprice\b/i,
    text: "Giá bán chưa hợp lệ với sàn (quá thấp, quá cao hoặc lẻ đồng) — chỉnh % điều chỉnh giá rồi đăng lại.",
  },
  {
    test: /stock|quantity|inventory|warehouse/i,
    text: "Tồn kho đăng chưa hợp lệ (âm, quá trần, hoặc gian chưa có kho mặc định trên sàn) — sửa ô Tồn đăng rồi đăng lại.",
  },
  // --- Thuộc tính bắt buộc ---
  {
    test: /attribute|mandatory|(?<!not )required|missing|is empty|cannot be empty|property/i,
    text: "Còn thuộc tính bắt buộc của danh mục chưa điền hoặc điền sai kiểu — mở Bổ sung, điền hết các ô có nhãn Bắt buộc rồi đăng lại.",
  },
  // --- Phân loại ---
  {
    test: /variation|variant|tier|model|sku/i,
    text: "Phân loại (màu / size…) chưa hợp lệ với sàn — kiểm tra số nhóm, số phân loại và tên phân loại không quá dài; sản phẩm có thể đã tạo nhưng thiếu phân loại, bổ sung trên sàn.",
  },
  // --- Tham số chung (Shopee product.error_param) ---
  {
    test: /error_param|invalid param|parameter|validation/i,
    text: "Sàn báo dữ liệu bài đăng chưa hợp lệ — xem dòng chi tiết bên dưới để biết ô nào, sửa rồi đăng lại.",
  },
];

const VIETNAMESE_RE = /[À-ỹ]/;

/**
 * Trả chuỗi ghi vào target.error: câu tiếng Việt + xuống dòng + nguyên văn sàn.
 * Thông điệp đã là tiếng Việt do mã Hubsell ném (vd "Không tải được ảnh nào lên
 * Shopee") → giữ nguyên, không thêm dòng kỹ thuật.
 */
export function humanizeListingError(platform: ChannelName, raw: string): string {
  const original = String(raw ?? "").trim();
  if (!original) return `${PLATFORM_LABEL[platform]} từ chối bài đăng nhưng không nói lý do — thử đăng lại; vẫn lỗi thì báo Hubsell.`;
  // Khớp từ khóa trên phần KHÔNG có URL: "Tải ảnh thất bại (HTTP 403): https://…/product-images/…"
  // từng bị gán nhầm thành "Sàn không nhận ảnh" chỉ vì đường dẫn chứa chữ image.
  const haystack = original.replace(/https?:\/\/\S+/gi, "");
  const rule = RULES.find((r) => r.test.test(haystack));
  if (rule) return `${PLATFORM_LABEL[platform]} từ chối: ${rule.text}\n${original}`;
  // Bỏ tiền tố "Shopee add_item lỗi:" / "TikTok API lỗi (code 1):" của client Hubsell rồi mới
  // xét: phần còn lại có dấu tiếng Việt = câu Hubsell tự viết → giữ nguyên.
  const body = original.replace(/^(Shopee|TikTok|Lazada)\b[^:]*:\s*/i, "");
  if (VIETNAMESE_RE.test(body)) return original;
  return `${PLATFORM_LABEL[platform]} từ chối bài đăng — xem dòng chi tiết bên dưới; chưa rõ cách sửa thì gửi dòng đó cho Hubsell.\n${original}`;
}
