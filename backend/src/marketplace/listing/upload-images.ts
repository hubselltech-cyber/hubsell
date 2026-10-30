// ============================================================
// TẢI ẢNH NGUỒN → CHUẨN HÓA THEO LUẬT SÀN → ĐẨY LÊN SÀN — vòng lặp dùng chung cho
// adapter Shopee / TikTok (Lazada dùng image/migrate theo URL, không qua đây).
// ============================================================

import { fetchImageBuffer, type FetchedImage } from "../../lib/image-fetch";
import { normalizeImage, type ImageRule } from "../../lib/image-normalize";

/** Một ảnh: tải về buffer rồi chuẩn hóa (xoay EXIF, JPEG, cỡ, dung lượng) theo luật sàn. */
export async function prepareImage(url: string, rule: ImageRule): Promise<FetchedImage> {
  return normalizeImage(await fetchImageBuffer(url), rule);
}

/**
 * Tải + chuẩn hóa + đẩy TUẦN TỰ từng ảnh (sàn giới hạn tốc độ upload). Mặc định một ảnh
 * lỗi là ném (ảnh bìa / ảnh mô tả: thiếu là bài sai); `skipFailed` → bỏ ảnh lỗi + ghi log
 * (ảnh phân loại: thiếu ảnh màu vẫn đăng được).
 */
export async function uploadImages<R>(
  urls: string[],
  rule: ImageRule,
  upload: (img: FetchedImage) => Promise<R>,
  opts: { skipFailed?: boolean; label?: string } = {}
): Promise<R[]> {
  const out: R[] = [];
  for (const url of urls) {
    try {
      out.push(await upload(await prepareImage(url, rule)));
    } catch (err) {
      if (!opts.skipFailed) throw err;
      console.warn(`[listing-copy] ${opts.label ?? "ảnh"} không tải được (${(err as Error).message}) — bỏ ảnh này`);
    }
  }
  return out;
}
