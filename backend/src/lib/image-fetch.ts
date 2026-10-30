// ============================================================
// TẢI ẢNH TỪ URL VỀ BUFFER — dùng khi đăng sản phẩm lên sàn (3 sàn đều không
// nhận URL ngoài: Shopee/TikTok phải upload file, Lazada có migrate nhưng kén).
// Chỉ tải; đổi cỡ / nén / đổi định dạng theo luật sàn ở lib/image-normalize.ts.
// ============================================================

export interface FetchedImage {
  buffer: Buffer;
  mime: string;
  filename: string;
}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export async function fetchImageBuffer(url: string): Promise<FetchedImage> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    if (!m) throw new Error("Ảnh data URI không hợp lệ");
    const mime = m[1];
    const buffer = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
    return { buffer, mime, filename: `image.${extOf(mime)}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Tải ảnh thất bại (HTTP ${res.status}): ${url.slice(0, 120)}`);
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_IMAGE_BYTES) throw new Error(`Ảnh quá lớn (${Math.round(ab.byteLength / 1024)} KB): ${url.slice(0, 120)}`);
    const name = url.split("?")[0].split("/").pop() || "image";
    const filename = /\.[a-z0-9]{3,4}$/i.test(name) ? name : `${name}.${extOf(mime)}`;
    return { buffer: Buffer.from(ab), mime, filename };
  } finally {
    clearTimeout(timer);
  }
}

function extOf(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("svg")) return "svg";
  return "jpg";
}
