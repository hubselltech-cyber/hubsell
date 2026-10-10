/**
 * MẪU CÂU PHẢN HỒI ĐÁNH GIÁ THEO SỐ SAO — RANDOMIZER CHỐNG SPAM TRÙNG NỘI DUNG
 *
 * Mỗi mức sao (1★–5★) có tối đa 5 mẫu câu; khi gửi phản hồi hệ thống bốc NGẪU
 * NHIÊN một mẫu rồi thay biến — sàn quét trùng nội dung sẽ không phạt.
 *
 * LƯU Ở ĐÂU (10/10/2026): máy chủ — bảng review_auto_reply_config, đọc/ghi qua
 * fetch/saveReviewAutoReplyConfig. Worker backend tự trả lời MỖI NGÀY MỘT LẦN
 * theo mức sao đang bật (backend/src/services/review-auto-reply.ts giữ bộ mẫu
 * mặc định + cùng luật thay biến). Bản localStorage cũ chỉ còn để CHÉP LÊN máy
 * chủ một lần (readLegacyLocalConfig).
 *
 * BIẾN trong mẫu (thay bằng replaceAll CHUỖI THƯỜNG, không phải regex):
 *   {TEN_KHACH}  → tên khách (khách ẩn danh thì thành "bạn")
 *   {TEN_SHOP}   → tên gian hàng
 *   {SAN_PHAM}   → tên sản phẩm được đánh giá
 */

import {
  fetchReviewAutoReplyConfig,
  saveReviewAutoReplyConfig,
  type ReviewAutoReplyConfigDTO,
  type ReviewReplyTemplatesDTO,
} from "@/lib/api";

export type StarLevel = "1" | "2" | "3" | "4" | "5";

export type ReplyTemplates = ReviewReplyTemplatesDTO;

export const STAR_LEVELS: StarLevel[] = ["1", "2", "3", "4", "5"];

export const TEMPLATE_VARS = ["{TEN_KHACH}", "{TEN_SHOP}", "{SAN_PHAM}"] as const;

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

/** Thay biến vào mẫu bằng replaceAll CHUỖI (không regex). */
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
 * Bốc NGẪU NHIÊN một mẫu của mức sao tương ứng rồi thay biến. Chưa nạp xong bộ
 * mẫu hoặc mức đó không còn mẫu → null để nơi gọi dùng câu của engine.
 */
export function pickRandomReply(
  templates: ReplyTemplates | null,
  rating: number,
  vars: ReplyVars
): string | null {
  const list = (templates?.[toStarLevel(rating)] ?? []).filter((s) => s.trim());
  if (list.length === 0) return null;
  const template = list[Math.floor(Math.random() * list.length)];
  return applyTemplate(template, vars);
}

// ─── CHÉP CẤU HÌNH LOCALSTORAGE CŨ LÊN MÁY CHỦ (một lần) ─────────────────────

const LEGACY_TEMPLATES_KEY = "hubsell_ops_reply_templates_v1";
const LEGACY_STARS_KEY = "hubsell_ops_review_autoreply_v1";
const LEGACY_LEDGER_KEY = "hubsell_ops_review_autoreplied_v1";

/**
 * Cấu hình trình duyệt này từng lưu (bản trước 10/10/2026), null nếu không có.
 * Chỉ dùng khi máy chủ CHƯA có cấu hình của shop (saved = false).
 */
export function readLegacyLocalConfig(): {
  enabledStars: number[];
  templates: Partial<ReplyTemplates> | null;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const rawStars = localStorage.getItem(LEGACY_STARS_KEY);
    const rawTemplates = localStorage.getItem(LEGACY_TEMPLATES_KEY);
    if (!rawStars && !rawTemplates) return null;
    const stars = rawStars ? (JSON.parse(rawStars) as Record<string, unknown>) : {};
    return {
      enabledStars: STAR_LEVELS.filter((s) => stars[s] === true).map(Number),
      templates: rawTemplates ? (JSON.parse(rawTemplates) as Partial<ReplyTemplates>) : null,
    };
  } catch {
    return null;
  }
}

/** Đã chép lên máy chủ → xóa bản cũ để không chép lần hai. */
export function clearLegacyLocalConfig() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_STARS_KEY);
    localStorage.removeItem(LEGACY_TEMPLATES_KEY);
    localStorage.removeItem(LEGACY_LEDGER_KEY);
  } catch {
    // trình duyệt chặn bộ nhớ — bỏ qua
  }
}

/**
 * Nạp cấu hình từ máy chủ; máy chủ chưa có mà trình duyệt còn bản localStorage
 * cũ thì chép lên một lần (để khách đang bật tự trả lời không phải cài lại).
 * Nhân viên không có quyền ghi cấu hình → chép lỗi 403, vẫn trả bản máy chủ.
 */
export async function loadReviewAutoReplyConfig(): Promise<ReviewAutoReplyConfigDTO> {
  const cfg = await fetchReviewAutoReplyConfig();
  if (cfg.saved) return cfg;
  const legacy = readLegacyLocalConfig();
  if (!legacy) return cfg;
  try {
    const migrated = await saveReviewAutoReplyConfig({
      enabledStars: legacy.enabledStars,
      ...(legacy.templates ? { templates: legacy.templates as ReplyTemplates } : {}),
    });
    clearLegacyLocalConfig();
    return migrated;
  } catch {
    return cfg;
  }
}
