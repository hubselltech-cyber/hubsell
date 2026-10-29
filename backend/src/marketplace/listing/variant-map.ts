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
