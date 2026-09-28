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
//
// HAI BUCKET (28/09/2026):
//  - support-attachments: ảnh hỗ trợ, trần 600 KB, cron xóa sau 7 ngày.
//  - hq-documents: HÓA ĐƠN ĐẦU VÀO của công ty (XML/PDF/ảnh, trần 15 MB) —
//    giữ VĨNH VIỄN, là chứng từ kế toán; không cron nào được đụng.
// Cùng một bộ hàm, khác cấu hình bucket — export tên cũ giữ nguyên cho ảnh
// hỗ trợ, bucket HQ dùng `hqDocuments.*`.
// ============================================================

interface BucketConfig {
  name: string;
  fileSizeLimit: number;
  allowedMime: readonly string[];
  /** Thông báo lỗi khi sai loại tệp / quá cỡ (ngôn ngữ người dùng). */
  mimeError: string;
  sizeError: string;
}

const SUPPORT_BUCKET: BucketConfig = {
  name: process.env.SUPPORT_ATTACHMENT_BUCKET ?? "support-attachments",
  fileSizeLimit: 600 * 1024,
  allowedMime: ["image/jpeg", "image/png", "image/webp"],
  mimeError: "Chỉ nhận ảnh JPG/PNG/WebP",
  sizeError: "Ảnh quá lớn (tối đa 600 KB sau nén)",
};

export const HQ_DOCUMENT_MIME = [
  "application/pdf",
  "application/xml",
  "text/xml",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const HQ_DOCUMENT_SIZE_LIMIT = 15 * 1024 * 1024;

const HQ_BUCKET: BucketConfig = {
  name: process.env.HQ_DOCUMENT_BUCKET ?? "hq-documents",
  fileSizeLimit: HQ_DOCUMENT_SIZE_LIMIT,
  allowedMime: HQ_DOCUMENT_MIME,
  mimeError: "Chỉ nhận PDF, XML hoặc ảnh JPG/PNG/WebP",
  sizeError: "Tệp quá lớn (tối đa 15 MB)",
};

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

const bucketReady = new Map<string, Promise<void>>();

/** Tạo bucket nếu chưa có (409 = đã có → coi như xong). Memo theo tiến trình. */
function ensureBucket(bucket: BucketConfig): Promise<void> {
  const cached = bucketReady.get(bucket.name);
  if (cached) return cached;
  const p = (async () => {
    const cfg = base();
    if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
    const res = await fetch(`${cfg.url}/storage/v1/bucket`, {
      method: "POST",
      headers: headers(cfg.key, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        id: bucket.name,
        name: bucket.name,
        public: false,
        file_size_limit: bucket.fileSizeLimit,
        allowed_mime_types: bucket.allowedMime,
      }),
    });
    if (res.ok || res.status === 409) return;
    const text = await res.text().catch(() => "");
    // Supabase trả 400 "already exists" ở vài phiên bản — cũng coi là có.
    if (/exist/i.test(text)) return;
    bucketReady.delete(bucket.name); // lần sau thử lại
    throw new Error(`Không tạo được bucket ${bucket.name}: ${res.status} ${text.slice(0, 200)}`);
  })();
  bucketReady.set(bucket.name, p);
  return p;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function uploadTo(
  bucket: BucketConfig,
  path: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const cfg = base();
  if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
  if (!bucket.allowedMime.includes(contentType)) throw new Error(bucket.mimeError);
  if (body.length > bucket.fileSizeLimit) throw new Error(bucket.sizeError);
  await ensureBucket(bucket);
  const res = await fetch(`${cfg.url}/storage/v1/object/${bucket.name}/${encodePath(path)}`, {
    method: "POST",
    headers: headers(cfg.key, { "Content-Type": contentType, "x-upsert": "false" }),
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tải tệp lên kho lỗi: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function signIn(
  bucket: BucketConfig,
  paths: string[],
  expiresInSec: number
): Promise<string[]> {
  const cfg = base();
  if (!cfg || paths.length === 0) return [];
  const res = await fetch(`${cfg.url}/storage/v1/object/sign/${bucket.name}`, {
    method: "POST",
    headers: headers(cfg.key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: expiresInSec, paths }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ký link tệp lỗi: ${res.status} ${text.slice(0, 200)}`);
  }
  const rows = (await res.json()) as { path?: string; signedURL?: string; error?: string | null }[];
  // Giữ đúng thứ tự paths; tệp lỗi/đã xóa → chuỗi rỗng để FE bỏ qua.
  const byPath = new Map(rows.map((r) => [r.path ?? "", r.signedURL ?? ""]));
  return paths.map((p) => {
    const s = byPath.get(p);
    return s ? `${cfg.url}/storage/v1${s}` : "";
  });
}

async function deleteIn(bucket: BucketConfig, paths: string[]): Promise<void> {
  const cfg = base();
  if (!cfg || paths.length === 0) return;
  const res = await fetch(`${cfg.url}/storage/v1/object/${bucket.name}`, {
    method: "DELETE",
    headers: headers(cfg.key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Xóa tệp trong kho lỗi: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function downloadFrom(bucket: BucketConfig, path: string): Promise<Buffer> {
  const cfg = base();
  if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
  const res = await fetch(`${cfg.url}/storage/v1/object/${bucket.name}/${encodePath(path)}`, {
    headers: headers(cfg.key),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tải tệp từ kho lỗi: ${res.status} ${text.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------- Ảnh hỗ trợ (API cũ, giữ nguyên tên) ----------

/** Tải một tệp lên `path` trong bucket ảnh hỗ trợ. Ném lỗi khi thất bại. */
export function uploadObject(path: string, body: Buffer, contentType: string): Promise<void> {
  return uploadTo(SUPPORT_BUCKET, path, body, contentType);
}

/** Link xem tạm thời (bucket private) — hết hạn sau `expiresInSec`. */
export function createSignedUrls(paths: string[], expiresInSec: number): Promise<string[]> {
  return signIn(SUPPORT_BUCKET, paths, expiresInSec);
}

/** Xóa nhiều tệp một lượt. Tệp không tồn tại không gây lỗi. */
export function deleteObjects(paths: string[]): Promise<void> {
  return deleteIn(SUPPORT_BUCKET, paths);
}

// ---------- Hóa đơn đầu vào HQ (giữ vĩnh viễn) ----------

export const hqDocuments = {
  upload: (path: string, body: Buffer, contentType: string) =>
    uploadTo(HQ_BUCKET, path, body, contentType),
  signedUrls: (paths: string[], expiresInSec: number) => signIn(HQ_BUCKET, paths, expiresInSec),
  download: (path: string) => downloadFrom(HQ_BUCKET, path),
  remove: (paths: string[]) => deleteIn(HQ_BUCKET, paths),
};
