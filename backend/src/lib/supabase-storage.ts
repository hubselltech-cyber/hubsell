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
// Thêm về sau (cấu hình + chú thích ngay tại khai báo từng bucket bên dưới):
//  - product-images (30/10/2026): ảnh sản phẩm khách tải lên, bucket CÔNG KHAI, giữ vĩnh viễn.
//  - order-labels (06/11/2026): vận đơn đã in, riêng tư, cron xóa sau 60 ngày.
// Cùng một bộ hàm, khác cấu hình bucket — export tên cũ giữ nguyên cho ảnh
// hỗ trợ; các bucket khác dùng `hqDocuments.*`, `productImages.*`, `orderLabels.*`.
// ============================================================

interface BucketConfig {
  name: string;
  /** Bucket công khai (ảnh sản phẩm — sàn và trình duyệt đọc thẳng URL, không cần ký). Mặc định riêng tư. */
  public?: boolean;
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

/**
 * ẢNH SẢN PHẨM khách tự tải lên ở "Sao chép sản phẩm → Tạo mới" (30/10/2026, docs
 * SAO-CHEP-SAN-PHAM.md mục 24): bucket CÔNG KHAI vì ảnh đằng nào cũng lên sàn, URL
 * bền để ghi vào job.source + Product.imageUrl (signed URL hết hạn thì hỏng). Trần
 * 1 MB — FE đã nén canvas ≤ 400 KB. Giữ vĩnh viễn (đăng lại gian mới sau này).
 */
const PRODUCT_IMAGE_BUCKET: BucketConfig = {
  name: process.env.PRODUCT_IMAGE_BUCKET ?? "product-images",
  public: true,
  fileSizeLimit: 1024 * 1024,
  allowedMime: ["image/jpeg", "image/png", "image/webp"],
  mimeError: "Chỉ nhận ảnh JPG/PNG/WebP",
  sizeError: "Ảnh quá lớn (tối đa 1 MB sau nén)",
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
        public: Boolean(bucket.public),
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

/** Ảnh sản phẩm (bucket công khai) — trả URL bền. */
export const productImages = {
  async upload(path: string, body: Buffer, contentType: string): Promise<string> {
    const cfg = base();
    if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
    await uploadTo(PRODUCT_IMAGE_BUCKET, path, body, contentType);
    return `${cfg.url}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET.name}/${encodePath(path)}`;
  },
  delete(paths: string[]): Promise<void> {
    return deleteIn(PRODUCT_IMAGE_BUCKET, paths);
  },
  mime: PRODUCT_IMAGE_BUCKET.allowedMime,
  sizeLimit: PRODUCT_IMAGE_BUCKET.fileSizeLimit,
};

// ---------- Tệp vận đơn đã in (giữ 60 ngày, 06/11/2026) ----------

/**
 * VẬN ĐƠN ĐÃ IN (docs/LUU-VAN-DON-DA-IN.md): bucket RIÊNG TƯ, không bao giờ ký link công khai —
 * tệp chỉ đi ra qua endpoint in lại của backend (đã kiểm chủ gian + quyền nhân viên). Nhận PDF
 * (phiếu sàn trả, kể cả tệp gộp 50 đơn của Shopee) và JSON (tệp chỉ đường của đơn nằm trong tệp
 * gộp). Trần 20 MB — số tự chọn: tệp gộp 2 đơn Shopee đo thật 06/11 là 184,7 KB (~92 KB / đơn),
 * 50 đơn ≈ 4,6 MB. Dọn sau 60 ngày do cron log-cleanup gọi services/label-archive.
 */
const ORDER_LABEL_BUCKET: BucketConfig = {
  name: process.env.ORDER_LABEL_BUCKET ?? "order-labels",
  fileSizeLimit: 20 * 1024 * 1024,
  allowedMime: ["application/pdf", "application/json"],
  mimeError: "Chỉ nhận PDF hoặc JSON",
  sizeError: "Tệp vận đơn quá lớn (tối đa 20 MB)",
};

/** Một dòng của lệnh liệt kê: thư mục (sàn trả id null) hay tệp. */
export interface StorageListEntry {
  name: string;
  isFolder: boolean;
}

export const orderLabels = {
  /** Tải lên nếu CHƯA có. Đã có sẵn (in lại cùng phiếu) → "exists", không ghi đè, không lỗi. */
  async putIfAbsent(path: string, body: Buffer, contentType: string): Promise<"created" | "exists"> {
    const cfg = base();
    if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
    if (!ORDER_LABEL_BUCKET.allowedMime.includes(contentType)) throw new Error(ORDER_LABEL_BUCKET.mimeError);
    if (body.length > ORDER_LABEL_BUCKET.fileSizeLimit) throw new Error(ORDER_LABEL_BUCKET.sizeError);
    await ensureBucket(ORDER_LABEL_BUCKET);
    const res = await fetch(`${cfg.url}/storage/v1/object/${ORDER_LABEL_BUCKET.name}/${encodePath(path)}`, {
      method: "POST",
      headers: headers(cfg.key, { "Content-Type": contentType, "x-upsert": "false" }),
      body: new Uint8Array(body),
    });
    if (res.ok) return "created";
    const text = await res.text().catch(() => "");
    // Kho trả 409 (hoặc 400 kèm "Duplicate" / "already exists" ở vài phiên bản) khi tệp đã có.
    if (res.status === 409 || /duplicate|already exists/i.test(text)) return "exists";
    throw new Error(`Tải tệp vận đơn lên kho lỗi: ${res.status} ${text.slice(0, 200)}`);
  },

  /** Đọc một tệp; không có (chưa từng lưu / đã dọn) → null. Lỗi khác thì ném. */
  async get(path: string): Promise<Buffer | null> {
    const cfg = base();
    if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
    const res = await fetch(`${cfg.url}/storage/v1/object/${ORDER_LABEL_BUCKET.name}/${encodePath(path)}`, {
      headers: headers(cfg.key),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const text = await res.text().catch(() => "");
    // Bucket chưa từng được tạo (chưa gian nào in khi bật) cũng là "không có tệp".
    if (res.status === 404 || /not.?found/i.test(text)) return null;
    throw new Error(`Tải tệp vận đơn từ kho lỗi: ${res.status} ${text.slice(0, 200)}`);
  },

  /**
   * Liệt kê MỘT cấp dưới `prefix` ("" = gốc bucket), tối đa `limit` dòng, xếp theo tên. Luôn đọc
   * từ đầu (offset 0): nơi gọi xóa xong mới liệt kê tiếp nên không phân trang trên tập tự co.
   */
  async list(prefix: string, limit: number): Promise<StorageListEntry[]> {
    const cfg = base();
    if (!cfg) throw new Error("Supabase Storage chưa cấu hình");
    const res = await fetch(`${cfg.url}/storage/v1/object/list/${ORDER_LABEL_BUCKET.name}`, {
      method: "POST",
      headers: headers(cfg.key, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit, offset: 0, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 404 || /not.?found/i.test(text)) return []; // bucket chưa tạo = chưa có gì để dọn
      throw new Error(`Liệt kê tệp vận đơn lỗi: ${res.status} ${text.slice(0, 200)}`);
    }
    const rows = (await res.json()) as { name?: string; id?: string | null }[];
    return rows.filter((r) => typeof r.name === "string" && r.name).map((r) => ({ name: r.name!, isFolder: !r.id }));
  },

  remove: (paths: string[]) => deleteIn(ORDER_LABEL_BUCKET, paths),
};
