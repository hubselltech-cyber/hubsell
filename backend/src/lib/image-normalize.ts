// ============================================================
// CHUẨN HÓA ẢNH TRƯỚC KHI ĐẨY LÊN SÀN (30/10/2026 — khách Bunchar chép TikTok →
// Shopee bị "Sàn không nhận ảnh sản phẩm"). Ảnh nguồn sàn/khách tải lên thường là
// ảnh gốc rất lớn (3–6 MB, 3.000–4.000 px) hoặc WebP; Shopee upload_image chỉ nhận
// JPG/PNG ≤ 2 MB. Mọi adapter gọi normalizeImage() với luật của sàn đích:
//   • xoay theo EXIF, bỏ kênh alpha trên nền trắng, xuất JPEG;
//   • cạnh dài > maxSide → thu về maxSide; cạnh ngắn < minSide → phóng lên minSide
//     (Shopee đòi tối thiểu 500×500 — phóng nhẹ còn hơn bị từ chối);
//   • còn nặng hơn maxBytes → hạ chất lượng 85→60 rồi thu cạnh ×0,8 tới khi lọt.
// Dùng sharp (libvips) — cài 30/10, prebuilt linux-x64 trên Render.
// ============================================================

import sharp from "sharp";
import type { FetchedImage } from "./image-fetch";

export interface ImageRule {
  maxBytes: number;
  maxSide: number;
  minSide: number;
}

/** Shopee media_space/upload_image: JPG/PNG ≤ 2 MB; ảnh SP tối thiểu 500×500 (trợ giúp Shopee). */
export const SHOPEE_IMAGE: ImageRule = { maxBytes: 2 * 1024 * 1024, maxSide: 2000, minSide: 500 };
/** TikTok Upload Product Image: ≤ 5 MB, 300–4000 px (docs TikTok Shop). */
export const TIKTOK_IMAGE: ImageRule = { maxBytes: 5 * 1024 * 1024, maxSide: 4000, minSide: 300 };

const QUALITIES = [85, 75, 65, 60];

/** Ảnh đã đúng chuẩn (JPEG, trong khung cạnh, nhẹ hơn trần) thì trả nguyên — không nén lại hai lần. */
async function alreadyFine(img: FetchedImage, rule: ImageRule): Promise<boolean> {
  if (!/jpe?g$/i.test(img.mime)) return false;
  if (img.buffer.length > rule.maxBytes) return false;
  const m = await sharp(img.buffer).metadata();
  const w = m.width ?? 0;
  const h = m.height ?? 0;
  if (!w || !h) return false;
  if (m.orientation && m.orientation > 1) return false;
  return Math.max(w, h) <= rule.maxSide && Math.min(w, h) >= rule.minSide;
}

export async function normalizeImage(img: FetchedImage, rule: ImageRule): Promise<FetchedImage> {
  if (await alreadyFine(img, rule)) return img;
  const meta = await sharp(img.buffer).metadata();
  const w0 = meta.width ?? 0;
  const h0 = meta.height ?? 0;
  if (!w0 || !h0) throw new Error(`Ảnh không đọc được (${img.mime}): ${img.filename}`);

  // Khung cạnh mục tiêu: thu về maxSide; phóng lên minSide nếu quá nhỏ.
  let scale = 1;
  if (Math.max(w0, h0) > rule.maxSide) scale = rule.maxSide / Math.max(w0, h0);
  if (Math.min(w0, h0) * scale < rule.minSide) scale = rule.minSide / Math.min(w0, h0);

  for (let round = 0; round < 6; round++) {
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    for (const quality of QUALITIES) {
      const out = await sharp(img.buffer)
        .rotate()
        .resize(w, h, { fit: "fill", withoutEnlargement: false })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (out.length <= rule.maxBytes) {
        return { buffer: out, mime: "image/jpeg", filename: img.filename.replace(/\.[a-z0-9]{3,4}$/i, "") + ".jpg" };
      }
    }
    // Vẫn nặng → thu cạnh thêm 20 % (không xuống dưới minSide).
    const next = scale * 0.8;
    if (Math.min(w0, h0) * next < rule.minSide) break;
    scale = next;
  }
  throw new Error(`Ảnh quá nặng, không co được dưới ${Math.round(rule.maxBytes / 1048576)} MB: ${img.filename}`);
}
