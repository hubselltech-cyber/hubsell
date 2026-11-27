// Chuẩn hóa ảnh trước khi đẩy lên sàn (docs/SAO-CHEP-SAN-PHAM.md mục 26) — ảnh tạo bằng sharp, không cần tệp.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeImage, SHOPEE_DESC_IMAGE, SHOPEE_IMAGE, TIKTOK_IMAGE } from "../image-normalize";

async function noisy(width: number, height: number, format: "jpeg" | "webp" | "png", quality = 100): Promise<Buffer> {
  const s = sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } });
  if (format === "jpeg") return s.jpeg({ quality }).toBuffer();
  if (format === "webp") return s.webp({ quality }).toBuffer();
  return s.png().toBuffer();
}

describe("normalizeImage", () => {
  it("ảnh TikTok gốc 3.200 px JPEG > 2 MB → JPEG ≤ 2 MB, cạnh dài ≤ 2.000 (Shopee)", async () => {
    const buffer = await noisy(3200, 3200, "jpeg");
    expect(buffer.length).toBeGreaterThan(SHOPEE_IMAGE.maxBytes);
    const out = await normalizeImage({ buffer, mime: "image/jpeg", filename: "goc.jpeg" }, SHOPEE_IMAGE);
    expect(out.mime).toBe("image/jpeg");
    expect(out.filename).toBe("goc.jpg");
    expect(out.buffer.length).toBeLessThanOrEqual(SHOPEE_IMAGE.maxBytes);
    const m = await sharp(out.buffer).metadata();
    expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(2000);
    expect(m.format).toBe("jpeg");
  }, 30_000);
  it("WebP → JPEG; ảnh nhỏ 200 px → phóng lên tối thiểu 500 (Shopee)", async () => {
    const buffer = await noisy(200, 300, "webp", 80);
    const out = await normalizeImage({ buffer, mime: "image/webp", filename: "a.webp" }, SHOPEE_IMAGE);
    const m = await sharp(out.buffer).metadata();
    expect(m.format).toBe("jpeg");
    expect(Math.min(m.width!, m.height!)).toBe(500);
    expect(out.filename).toBe("a.jpg");
  });
  it("ảnh JPEG đã đúng chuẩn → trả nguyên buffer (không nén lại)", async () => {
    const buffer = await noisy(800, 800, "jpeg", 80);
    const img = { buffer, mime: "image/jpeg", filename: "ok.jpg" };
    const out = await normalizeImage(img, SHOPEE_IMAGE);
    expect(out).toBe(img);
  });
  it("PNG trong suốt → JPEG nền trắng; luật TikTok rộng hơn (≤ 5 MB, ≤ 4.000 px) giữ cỡ 3.000", async () => {
    const png = await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await normalizeImage({ buffer: png, mime: "image/png", filename: "t.png" }, SHOPEE_IMAGE);
    const px = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(px.data[0]).toBeGreaterThan(240); // nền trắng
    const big = await noisy(3000, 2000, "jpeg", 70);
    const t = await normalizeImage({ buffer: big, mime: "image/jpeg", filename: "b.jpg" }, TIKTOK_IMAGE);
    const m = await sharp(t.buffer).metadata();
    expect(m.width).toBe(3000);
  }, 30_000);
});

// 26/11/2026 (docs mục 36): Shopee add_item "error_desc_image_no_pass — The width of product description
// image must be between 700 and 100000 pixels" — ảnh mô tả trước đây chuẩn hóa theo luật ảnh sản phẩm (≥ 500).
describe("normalizeImage — ảnh trong mô tả Shopee (bề ngang ≥ 700)", () => {
  const width = async (b: Buffer) => (await sharp(b).metadata()).width!;

  it("ảnh vuông 600 px (đạt luật ảnh sản phẩm) → phóng lên ngang 700, giữ tỉ lệ", async () => {
    const buffer = await noisy(600, 600, "jpeg", 80);
    const img = { buffer, mime: "image/jpeg", filename: "mo-ta.jpg" };
    expect(await normalizeImage(img, SHOPEE_IMAGE)).toBe(img); // luật ảnh sản phẩm: để nguyên → đây là chỗ lọt
    const m = await sharp((await normalizeImage(img, SHOPEE_DESC_IMAGE)).buffer).metadata();
    expect(m.width).toBe(700);
    expect(m.height).toBe(700);
  });
  it("ảnh dọc dài 800×4000 → KHÔNG bị thu hẹp dưới 700 vì trần cạnh dài 2.000", async () => {
    const buffer = await noisy(800, 4000, "jpeg", 60);
    const product = await normalizeImage({ buffer, mime: "image/jpeg", filename: "dai.jpg" }, SHOPEE_IMAGE);
    expect(await width(product.buffer)).toBe(500); // hành vi cũ: 800 → 500, Shopee từ chối nếu là ảnh mô tả
    const desc = await normalizeImage({ buffer, mime: "image/jpeg", filename: "dai.jpg" }, SHOPEE_DESC_IMAGE);
    const m = await sharp(desc.buffer).metadata();
    expect(m.width).toBe(700);
    expect(m.height).toBe(3500);
    expect(desc.buffer.length).toBeLessThanOrEqual(SHOPEE_DESC_IMAGE.maxBytes);
  }, 30_000);
  it("ảnh ngang đủ rộng 1.200×800 JPEG → trả nguyên", async () => {
    const buffer = await noisy(1200, 800, "jpeg", 80);
    const img = { buffer, mime: "image/jpeg", filename: "ok.jpg" };
    expect(await normalizeImage(img, SHOPEE_DESC_IMAGE)).toBe(img);
  });
  it("ảnh có EXIF xoay 90° (lưu 1.000×600, hiển thị 600×1.000) → tính ngang SAU khi xoay, không méo", async () => {
    const buffer = await sharp(await noisy(1000, 600, "jpeg", 80)).withMetadata({ orientation: 6 }).jpeg({ quality: 80 }).toBuffer();
    const out = await normalizeImage({ buffer, mime: "image/jpeg", filename: "xoay.jpg" }, SHOPEE_DESC_IMAGE);
    const m = await sharp(out.buffer).metadata();
    expect(m.width).toBe(700);
    expect(m.height).toBe(1167);
  });
});
