// ============================================================
// PHÂN LOẠI — hàm thuần dùng chung cho 3 adapter thật (có test).
//
// Tên phân loại nguồn là chuỗi ("Đen, M" / "Màu: Đen, Size: M"); sàn đích cần
// chỉ số theo từng nhóm (Shopee tier_index), hoặc cặp tên nhóm–giá trị (TikTok
// sales_attributes, Lazada saleProp). Các hàm này quy đổi, không gọi API.
// ============================================================

import type { ListingOption, ListingVariant } from "./types";

/** Tách "Màu: Đen, Size: M" / "Đen, M" thành mảng giá trị theo thứ tự nhóm. */
export function splitVariantValues(name: string | null): string[] {
  if (!name) return [];
  return name
    .split(/[,|/;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^([^:]{1,30}):\s*(.+)$/);
      return (m ? m[2] : p).trim();
    });
}

/** Chỉ số option của một phân loại theo từng nhóm; thiếu → -1. */
export function tierIndexes(variant: ListingVariant, options: ListingOption[]): number[] {
  const values = splitVariantValues(variant.name);
  return options.map((opt, i) => {
    const v = values[i];
    if (v === undefined) return -1;
    const idx = opt.values.findIndex((x) => x.toLowerCase() === v.toLowerCase());
    return idx;
  });
}

/**
 * Ảnh theo GIÁ TRỊ của một nhóm phân loại (vd Màu: Đen → ảnh đen): lấy ảnh của phân loại
 * đầu tiên mang giá trị đó. Sàn chỉ cho ảnh ở MỘT nhóm (Shopee tier 1, TikTok một sales
 * attribute) nên trả thêm nhóm nào nhiều ảnh nhất.
 */
export function optionImages(
  variants: ListingVariant[],
  options: ListingOption[]
): { byOption: Map<string, string>[]; imageOptionIndex: number } {
  const byOption = options.map(() => new Map<string, string>());
  for (const v of variants) {
    if (!v.imageUrl) continue;
    const idx = tierIndexes(v, options);
    idx.forEach((i, oi) => {
      if (i >= 0) {
        const key = options[oi].values[i];
        if (!byOption[oi].has(key)) byOption[oi].set(key, v.imageUrl!);
      }
    });
  }
  // Nhóm "có ảnh" = nhiều ảnh KHÁC NHAU nhất (Size M/L cùng một ảnh đen → không phải nhóm ảnh; Màu Đen/Trắng 2 ảnh → đúng).
  let imageOptionIndex = -1;
  let best = 0;
  byOption.forEach((m, i) => {
    const distinct = new Set(m.values()).size;
    if (distinct > best) {
      best = distinct;
      imageOptionIndex = i;
    }
  });
  return { byOption, imageOptionIndex };
}

/**
 * Đưa nhóm có ảnh lên ĐẦU (Shopee chỉ nhận ảnh ở tier 1, TikTok ở sales attribute đầu).
 * Không nhóm nào có ảnh → giữ nguyên thứ tự.
 */
export function reorderOptionsForImages(options: ListingOption[], variants: ListingVariant[]): ListingOption[] {
  const { imageOptionIndex } = optionImages(variants, options);
  if (imageOptionIndex <= 0) return options;
  return [options[imageOptionIndex], ...options.filter((_, i) => i !== imageOptionIndex)];
}

/** Cặp tên nhóm → giá trị cho một phân loại (TikTok sales_attributes / Lazada saleProp). */
export function variantPairs(variant: ListingVariant, options: ListingOption[]): { name: string; value: string }[] {
  const values = splitVariantValues(variant.name);
  return options
    .map((opt, i) => ({ name: opt.name, value: values[i] ?? "" }))
    .filter((p) => p.value);
}

/** Giá sàn VN: số nguyên đồng. */
export function vndInt(price: number): number {
  return Math.max(0, Math.round(price));
}

/** Gram → kg chuỗi 3 số lẻ (TikTok/Lazada/Shopee đều nhận kg). */
export function gramsToKg(grams: number | null | undefined): number {
  const g = grams && grams > 0 ? grams : 0;
  return Math.round((g / 1000) * 1000) / 1000;
}

/** Mô tả text thuần → HTML đơn giản (TikTok/Lazada nhận HTML). */
export function textToHtml(text: string): string {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = safe.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);
  return paras.join("");
}

/** HTML → text thuần giữ xuống dòng (Shopee chỉ nhận text). */
/**
 * Tách ảnh chèn trong mô tả HTML (TikTok/Lazada): trả danh sách src theo thứ tự + HTML đã bỏ thẻ img.
 * Bỏ qua data URI và src rỗng; không trùng.
 */
export function extractHtmlImages(html: string): { html: string; images: string[] } {
  const images: string[] = [];
  const stripped = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const src = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
    if (src && !/^data:/i.test(src) && !images.includes(src)) images.push(src);
    return "";
  });
  return { html: stripped, images };
}

/** Ghép ảnh vào cuối mô tả HTML: mỗi ảnh một đoạn. */
export function appendHtmlImages(html: string, urls: string[]): string {
  if (urls.length === 0) return html;
  return html + urls.map((u) => `<p><img src="${u.replace(/"/g, "&quot;")}" /></p>`).join("");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .trim();
}
