// ============================================================
// KÝ ĐƯỜNG DẪN R2 (SigV4 qua aws4fetch) — KHÔNG gọi mạng
//
// Máy chủ Hubsell không chạm byte video: app tải thẳng lên R2 và trình duyệt đọc thẳng từ R2
// bằng đường dẫn ký sẵn dựng ở đây. Ba rào đã THỬ THẬT ngày 15/11/2026 (tài liệu khảo sát mục 57.2):
//  · ký `content-length` → tải cỡ khác bị 403 (chặn tệp to hơn đã báo), cả tải một lần lẫn từng mảnh;
//  · ký `content-type`  → gửi kiểu khác bị 403;
//  · đổi tên tệp / đổi phương thức / hết hạn → 403.
// Dùng aws4fetch (một gói nhỏ, không kéo gói khác) thay bộ AWS SDK: tiến trình web từng hết bộ nhớ.
// ============================================================

import { AwsClient } from "aws4fetch";

export interface R2Credentials {
  /** https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Tham số chỉ dành cho test: ghim giờ ký để chữ ký lặp lại được. Dạng 20261116T030000Z. */
interface SignClock {
  datetime?: string;
}

export function r2ObjectUrl(cfg: Pick<R2Credentials, "endpoint" | "bucket">, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${cfg.endpoint.replace(/\/+$/, "")}/${cfg.bucket}/${path}`;
}

export function r2Client(cfg: R2Credentials): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

async function presign(
  cfg: R2Credentials,
  method: "GET" | "PUT",
  key: string,
  opts: {
    expiresSec: number;
    query?: Record<string, string>;
    signedHeaders?: Record<string, string>;
  } & SignClock
): Promise<string> {
  if (!Number.isInteger(opts.expiresSec) || opts.expiresSec < 1 || opts.expiresSec > 7 * 24 * 3600) {
    throw new Error("Hạn ký phải từ 1 giây tới 7 ngày");
  }
  const url = new URL(r2ObjectUrl(cfg, key));
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  url.searchParams.set("X-Amz-Expires", String(opts.expiresSec));
  const signed = await r2Client(cfg).sign(url.toString(), {
    method,
    headers: opts.signedHeaders,
    aws: {
      signQuery: true,
      // Ký MỌI tiêu đề truyền vào (mặc định aws4fetch bỏ qua content-length / content-type).
      allHeaders: opts.signedHeaders !== undefined,
      ...(opts.datetime ? { datetime: opts.datetime } : {}),
    },
  });
  return signed.url;
}

/** Tải MỘT LẦN: ký cả cỡ tệp và kiểu tệp. Bên tải phải gửi đúng `Content-Type` này. */
export async function presignPut(
  cfg: R2Credentials,
  key: string,
  opts: { contentLength: number; contentType: string; expiresSec: number } & SignClock
): Promise<string> {
  assertSize(opts.contentLength);
  return presign(cfg, "PUT", key, {
    expiresSec: opts.expiresSec,
    datetime: opts.datetime,
    signedHeaders: {
      "content-length": String(opts.contentLength),
      "content-type": opts.contentType,
    },
  });
}

/** Tải MỘT MẢNH của lượt tải theo mảnh: ký cỡ đúng của mảnh đó. */
export async function presignPart(
  cfg: R2Credentials,
  key: string,
  opts: { uploadId: string; partNumber: number; contentLength: number; expiresSec: number } & SignClock
): Promise<string> {
  assertSize(opts.contentLength);
  if (!Number.isInteger(opts.partNumber) || opts.partNumber < 1 || opts.partNumber > 10_000) {
    throw new Error("Số thứ tự mảnh phải từ 1 tới 10.000");
  }
  return presign(cfg, "PUT", key, {
    expiresSec: opts.expiresSec,
    datetime: opts.datetime,
    query: { partNumber: String(opts.partNumber), uploadId: opts.uploadId },
    signedHeaders: { "content-length": String(opts.contentLength) },
  });
}

/** Xem / tải về. Có `downloadName` thì trình duyệt lưu tệp với tên đó thay vì phát. */
export async function presignGet(
  cfg: R2Credentials,
  key: string,
  opts: { expiresSec: number; downloadName?: string } & SignClock
): Promise<string> {
  const query: Record<string, string> = {};
  if (opts.downloadName) {
    const safe = opts.downloadName.replace(/[^A-Za-z0-9._-]/g, "");
    query["response-content-disposition"] = `attachment; filename="${safe || "video.mp4"}"`;
  }
  return presign(cfg, "GET", key, { expiresSec: opts.expiresSec, datetime: opts.datetime, query });
}

function assertSize(n: number): void {
  if (!Number.isInteger(n) || n <= 0) throw new Error("Cỡ tệp ký vào đường dẫn phải là số nguyên dương");
}
