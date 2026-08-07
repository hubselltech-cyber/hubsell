/**
 * MẪU CÂU PHẢN HỒI ĐÁNH GIÁ THEO SỐ SAO — RANDOMIZER CHỐNG SPAM TRÙNG NỘI DUNG
 *
 * Mỗi mức sao (1★–5★) có 5 mẫu câu; khi gửi phản hồi (đơn lẻ lẫn hàng loạt)
 * hệ thống bốc NGẪU NHIÊN một mẫu rồi thay biến — sàn quét trùng nội dung sẽ
 * không phạt vì các câu trả lời khác nhau.
 *
 * LƯU Ở ĐÂU: localStorage (per trình duyệt) — cùng cách TikTok assistant lưu
 * cấu hình (tiktok-assistant.ts). Khi module có bảng cấu hình user ở DB thì
 * chuyển load/save sang API, chữ ký hàm giữ nguyên.
 *
 * BIẾN trong mẫu (thay bằng replaceAll CHUỖI THƯỜNG, không phải regex — nên
 * nội dung khách/shop có ký tự đặc biệt gì cũng không vỡ chuỗi):
 *   {TEN_KHACH}  → tên khách (khách ẩn danh thì thành "bạn")
 *   {TEN_SHOP}   → tên gian hàng
 *   {SAN_PHAM}   → tên sản phẩm được đánh giá
 */

export type StarLevel = "1" | "2" | "3" | "4" | "5";

export type ReplyTemplates = Record<StarLevel, string[]>;

export const TEMPLATE_VARS = ["{TEN_KHACH}", "{TEN_SHOP}", "{SAN_PHAM}"] as const;

export const DEFAULT_REPLY_TEMPLATES: ReplyTemplates = {
  "5": [
    "Cảm ơn {TEN_KHACH} đã tin tưởng và dành 5 sao cho {SAN_PHAM}! {TEN_SHOP} rất vui khi sản phẩm vừa ý bạn. Hẹn gặp lại bạn ở những đơn hàng sau ạ!",
    "5 sao của {TEN_KHACH} là động lực lớn nhất của {TEN_SHOP}! Cảm ơn bạn đã ủng hộ, shop luôn có ưu đãi riêng cho khách quen nha!",
    "{TEN_SHOP} cảm ơn {TEN_KHACH} nhiều lắm ạ! Rất vui khi {SAN_PHAM} đến tay bạn trọn vẹn. Chúc bạn một ngày thật đẹp!",
    "Cảm ơn {TEN_KHACH} đã dành thời gian đánh giá! {TEN_SHOP} sẽ tiếp tục giữ chất lượng để không phụ lòng tin của bạn ạ.",
    "Yêu quá, cảm ơn {TEN_KHACH} đã cho {SAN_PHAM} 5 sao! Bạn nhớ theo dõi {TEN_SHOP} để săn ưu đãi đợt mới nha!",
  ],
  "4": [
    "Cảm ơn {TEN_KHACH} đã đánh giá {SAN_PHAM}! {TEN_SHOP} ghi nhận góp ý của bạn để hoàn thiện hơn nữa. Mong được phục vụ bạn lần sau ạ!",
    "{TEN_SHOP} cảm ơn {TEN_KHACH} đã ủng hộ! Nếu có điểm nào chưa vừa ý, bạn nhắn shop để được hỗ trợ ngay nha.",
    "Cảm ơn {TEN_KHACH} nhiều ạ! Shop rất mong nhận thêm góp ý để {SAN_PHAM} tốt hơn từng ngày.",
    "Cảm ơn đánh giá của {TEN_KHACH}! {TEN_SHOP} sẽ cố gắng để lần sau bạn hài lòng trọn vẹn 5 sao ạ!",
    "{TEN_SHOP} cảm ơn {TEN_KHACH} đã tin tưởng! Chúc bạn nhiều sức khỏe và hẹn gặp lại ạ.",
  ],
  "3": [
    "Chào {TEN_KHACH}, cảm ơn bạn đã góp ý về {SAN_PHAM}. Shop xin lỗi vì trải nghiệm chưa trọn vẹn — bạn nhắn tin cho {TEN_SHOP} để được hỗ trợ ngay nha!",
    "{TEN_SHOP} cảm ơn phản hồi thẳng thắn của {TEN_KHACH}. Shop ghi nhận và sẽ cải thiện; rất mong có cơ hội phục vụ bạn tốt hơn ạ.",
    "Chào {TEN_KHACH}, shop tiếc vì {SAN_PHAM} chưa đúng kỳ vọng của bạn. Bạn inbox {TEN_SHOP} để shop hỗ trợ đổi trả hoặc tư vấn thêm nha!",
    "Cảm ơn {TEN_KHACH} đã đánh giá. Góp ý của bạn giúp {TEN_SHOP} hoàn thiện sản phẩm hơn — có gì cần hỗ trợ bạn cứ nhắn shop ạ.",
    "Chào {TEN_KHACH}, shop rất muốn biết thêm điều gì khiến bạn chưa hài lòng về {SAN_PHAM} — nhắn cho {TEN_SHOP} để shop khắc phục ngay nha!",
  ],
  "2": [
    "Chào {TEN_KHACH}, {TEN_SHOP} thành thật xin lỗi vì trải nghiệm chưa tốt với {SAN_PHAM}. Bạn vui lòng nhắn tin cho shop kèm chi tiết, shop hỗ trợ đổi trả/khắc phục trong 24h ạ!",
    "{TEN_SHOP} rất tiếc về sự cố bạn gặp phải. {TEN_KHACH} inbox shop giúp mình nhé, shop cam kết xử lý thỏa đáng ngay ạ!",
    "Xin lỗi {TEN_KHACH} vì {SAN_PHAM} chưa đạt kỳ vọng. Shop đã ghi nhận và rất mong được bù đắp — bạn nhắn {TEN_SHOP} để shop hỗ trợ liền nha.",
    "Chào {TEN_KHACH}, shop xin nhận thiếu sót này. Bạn cho {TEN_SHOP} cơ hội khắc phục bằng cách nhắn tin cho shop nhé, shop ưu tiên xử lý ngay ạ!",
    "{TEN_SHOP} chân thành xin lỗi {TEN_KHACH}. Shop muốn hiểu rõ vấn đề để xử lý dứt điểm — mong bạn phản hồi qua tin nhắn giúp shop ạ.",
  ],
  "1": [
    "Chào {TEN_KHACH}, {TEN_SHOP} thành thật xin lỗi về trải nghiệm rất không tốt này. Bạn vui lòng nhắn tin cho shop kèm ảnh/chi tiết, shop cam kết hoàn tiền hoặc đổi mới trong 24h ạ!",
    "{TEN_SHOP} xin nhận trách nhiệm và gửi lời xin lỗi tới {TEN_KHACH}. Shop đã chuyển ngay cho bộ phận xử lý — bạn inbox shop để được giải quyết ưu tiên ạ!",
    "Xin lỗi {TEN_KHACH} rất nhiều! Sự cố với {SAN_PHAM} là điều shop không mong muốn. Shop sẵn sàng đổi trả miễn phí — bạn nhắn {TEN_SHOP} ngay giúp mình nhé.",
    "Chào {TEN_KHACH}, shop rất tiếc và xin lỗi bạn. {TEN_SHOP} mong được khắc phục ngay: bạn để lại tin nhắn, shop phản hồi trong ít phút ạ!",
    "{TEN_SHOP} chân thành xin lỗi {TEN_KHACH} về {SAN_PHAM}. Shop cam kết xử lý thỏa đáng (đổi mới/hoàn tiền) — rất mong bạn cho shop cơ hội sửa sai ạ.",
  ],
};

const STORAGE_KEY = "hubsell_ops_reply_templates_v1";

/** Đọc bộ mẫu từ localStorage, thiếu/hỏng mức nào thì đắp mặc định mức đó. */
export function loadReplyTemplates(): ReplyTemplates {
  if (typeof window === "undefined") return DEFAULT_REPLY_TEMPLATES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_REPLY_TEMPLATES;
    const parsed = JSON.parse(raw) as Partial<ReplyTemplates>;
    const merged = { ...DEFAULT_REPLY_TEMPLATES };
    for (const star of ["1", "2", "3", "4", "5"] as StarLevel[]) {
      const list = parsed[star];
      if (Array.isArray(list) && list.some((s) => typeof s === "string" && s.trim())) {
        merged[star] = list
          .filter((s): s is string => typeof s === "string")
          .slice(0, 5);
      }
    }
    return merged;
  } catch {
    return DEFAULT_REPLY_TEMPLATES;
  }
}

export function saveReplyTemplates(templates: ReplyTemplates) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export interface ReplyVars {
  customer: string;
  shopName: string;
  productName: string;
}

/** Tên khách ẩn danh/trống → "bạn" cho câu văn tự nhiên. */
function displayName(customer: string): string {
  const c = customer.trim();
  if (!c || /^người mua/i.test(c)) return "bạn";
  return c;
}

/**
 * Thay biến vào mẫu bằng replaceAll CHUỖI (không regex) — nội dung có ký tự
 * đặc biệt ($, \, "…") cũng không vỡ; biến lạ không khai báo thì giữ nguyên
 * để người dùng nhìn thấy mà sửa mẫu.
 */
export function applyTemplate(template: string, vars: ReplyVars): string {
  return template
    .replaceAll("{TEN_KHACH}", displayName(vars.customer))
    .replaceAll("{TEN_SHOP}", vars.shopName.trim() || "Shop")
    .replaceAll("{SAN_PHAM}", vars.productName.trim() || "sản phẩm");
}

/** Quy rating tự do (0, 4.5…) về mức sao 1–5 của bộ mẫu. */
export function toStarLevel(rating: number): StarLevel {
  const r = Math.min(5, Math.max(1, Math.round(rating) || 5));
  return String(r) as StarLevel;
}

/**
 * Bốc NGẪU NHIÊN một mẫu của mức sao tương ứng rồi thay biến. Mức sao đó
 * không còn mẫu nào (user xoá sạch) → trả null để nơi gọi fallback sang
 * generateReviewReply của engine.
 */
export function pickRandomReply(rating: number, vars: ReplyVars): string | null {
  const list = loadReplyTemplates()[toStarLevel(rating)].filter((s) => s.trim());
  if (list.length === 0) return null;
  const template = list[Math.floor(Math.random() * list.length)];
  return applyTemplate(template, vars);
}
