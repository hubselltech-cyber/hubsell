// ============================================================
// SUPABASE STORAGE — kho tệp riêng (bucket private), gọi thẳng REST bằng
// fetch của Node, KHÔNG thêm dependency @supabase/supabase-js.
//
// Vì sao có (anh Trung 27/09/2026): ảnh chụp màn hình đính kèm yêu cầu hỗ
// trợ KHÔNG được nhét vào Postgres (phình WAL/backup, mỗi lần HQ mở tab là
// kéo ảnh về tính egress DB — cái vừa làm vượt gói tháng 9). Gói Supabase
// Pro đang trả có sẵn 100 GB kho tệp + 250 GB egress tính riêng, chưa dùng.
//
// Cấu hình (Render): SUPABASE_URL = https://<ref>.supabase.co,
// SUPABASE_SERVICE_ROLE_KEY = khóa service (chỉ backend giữ, KHÔNG bao giờ
// đưa xuống FE). Thiếu một trong hai → isStorageConfigured() = false, mọi
// tính năng đính kèm tự ẩn, không lỗi.
// Bucket tự tạo lần đầu (private, trần 600 KB/tệp, chỉ ảnh).
// ============================================================

const BUCKET = process.env.SUPPORT_ATTACHMENT_BUCKET ?? "support-attachments";
const FILE_SIZE_LIMIT = 600 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

function base(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function isStorageConfigured(): boolean {
  return base() !== null;
}

function headers(key: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${key}`, apikey: key, ...(extra ?? {}) };
}

let bucketReady: Promise<void> | null = null;

/** Tạo bucket nếu chưa có (409 = đã có → coi như xong). Memo theo tiến trình. */
function ensureBucket(): Promise<void> {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const cfg = base();
    if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
    const res = await fetch(`${cfg.url}/storage/v1/bucket`, {
      method: "POST",
      headers: headers(cfg.key, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        id: BUCKET,
        name: BUCKET,
        public: false,
        file_size_limit: FILE_SIZE_LIMIT,
        allowed_mime_types: ALLOWED_MIME,
      }),
    });
    if (res.ok || res.status === 409) return;
    const text = await res.text().catch(() => "");
    // Supabase trả 400 "already exists" ở vài phiên bản — cũng coi là có.
    if (/exist/i.test(text)) return;
    bucketReady = null; // lần sau thử lại
    throw new Error(`Không tạo được bucket ${BUCKET}: ${res.status} ${text.slice(0, 200)}`);
  })();
  return bucketReady;
}

/** Tải một tệp lên `path` trong bucket. Ném lỗi khi thất bại. */
export async function uploadObject(
  path: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const cfg = base();
  if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
  if (!ALLOWED_MIME.includes(contentType)) throw new Error("Chỉ nhận ảnh JPG/PNG/WebP");
  if (body.length > FILE_SIZE_LIMIT) throw new Error("Ảnh quá lớn (tối đa 600 KB sau nén)");
  await ensureBucket();
  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
    method: "POST",
    headers: headers(cfg.key, { "Content-Type": contentType, "x-upsert": "false" }),
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tải ảnh lên kho lỗi: ${res.status} ${text.slice(0, 200)}`);
  }
}

/** Link xem tạm thời (bucket private) — hết hạn sau `expiresInSec`. */
export async function createSignedUrls(paths: string[], expiresInSec: number): Promise<string[]> {
  const cfg = base();
  if (!cfg || paths.length === 0) return [];
  const res = await fetch(`${cfg.url}/storage/v1/object/sign/${BUCKET}`, {
    method: "POST",
    headers: headers(cfg.key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: expiresInSec, paths }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ký link ảnh lỗi: ${res.status} ${text.slice(0, 200)}`);
  }
  const rows = (await res.json()) as { path?: string; signedURL?: string; error?: string | null }[];
  // Giữ đúng thứ tự paths; tệp lỗi/đã xóa → chuỗi rỗng để FE bỏ qua.
  const byPath = new Map(rows.map((r) => [r.path ?? "", r.signedURL ?? ""]));
  return paths.map((p) => {
    const s = byPath.get(p);
    return s ? `${cfg.url}/storage/v1${s}` : "";
  });
}

/** Xóa nhiều tệp một lượt. Tệp không tồn tại không gây lỗi. */
export async function deleteObjects(paths: string[]): Promise<void> {
  const cfg = base();
  if (!cfg || paths.length === 0) return;
  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: headers(cfg.key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Xóa ảnh trong kho lỗi: ${res.status} ${text.slice(0, 200)}`);
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
