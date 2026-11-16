// ============================================================
// CLOUDFLARE R2 — kho tệp của Video đóng hàng (16/11/2026)
//
// Chỉ các lệnh QUẢN LÝ đi qua đây (hỏi cỡ, xóa, mở / chốt / hủy lượt tải theo mảnh, liệt kê mảnh).
// Byte video KHÔNG đi qua máy chủ: app và trình duyệt dùng đường dẫn ký sẵn (lib/r2-sign.ts).
//
// Cấu hình (Render / backend/.env): R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
// Thiếu một biến → isR2Configured() = false → tính năng tự KHÓA (services/pack-video/access.ts).
// Khóa dùng thật do anh Trung tự tạo, quyền Object Read & Write trên ĐÚNG một bucket.
//
// `R2Storage` là cổng để service nhận kho qua tham số — test tiêm kho giả, không gọi mạng.
// ============================================================

import { XMLParser } from "fast-xml-parser";
import {
  PACK_VIDEO_CONTENT_TYPE,
  PACK_VIDEO_GET_EXPIRES_SEC,
  PACK_VIDEO_PUT_EXPIRES_SEC,
} from "../../config/pack-video";
import {
  presignGet,
  presignPart,
  presignPut,
  r2Client,
  r2ObjectUrl,
  type R2Credentials,
} from "../../lib/r2-sign";

export interface R2Part {
  partNumber: number;
  etag: string;
  size: number;
}

export interface R2Storage {
  /** Đường dẫn tải một lần — ký cỡ + kiểu tệp. */
  presignPut(key: string, contentLength: number): Promise<string>;
  /** Đường dẫn tải một mảnh — ký cỡ mảnh. */
  presignPart(key: string, uploadId: string, partNumber: number, contentLength: number): Promise<string>;
  /** Đường dẫn xem; có `downloadName` thì là tải về. */
  presignGet(key: string, downloadName?: string): Promise<string>;
  /** Cỡ thật của tệp; chưa có tệp → null. */
  head(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
  createMultipart(key: string): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: Pick<R2Part, "partNumber" | "etag">[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  listParts(key: string, uploadId: string): Promise<R2Part[]>;
}

export class R2Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "R2Error";
  }
}

const ENV_KEYS = ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;

export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Credentials | null {
  const [endpoint, bucket, accessKeyId, secretAccessKey] = ENV_KEYS.map((k) => env[k]?.trim() ?? "");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

export function isR2Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return r2ConfigFromEnv(env) !== null;
}

/** Mỗi lệnh quản lý chờ tối đa ngần này — không để một request của khách treo theo R2. */
const R2_TIMEOUT_MS = 15_000;

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function createR2Storage(cfg: R2Credentials): R2Storage {
  const client = r2Client(cfg);
  const urlOf = (key: string, query = "") => `${r2ObjectUrl(cfg, key)}${query}`;

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    return client.fetch(url, { ...init, signal: AbortSignal.timeout(R2_TIMEOUT_MS) });
  }

  async function fail(res: Response, what: string): Promise<never> {
    const body = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? null;
    throw new R2Error(`R2 ${what} thất bại (${res.status}${code ? ` ${code}` : ""})`, res.status, code);
  }

  return {
    presignPut: (key, contentLength) =>
      presignPut(cfg, key, {
        contentLength,
        contentType: PACK_VIDEO_CONTENT_TYPE,
        expiresSec: PACK_VIDEO_PUT_EXPIRES_SEC,
      }),

    presignPart: (key, uploadId, partNumber, contentLength) =>
      presignPart(cfg, key, {
        uploadId,
        partNumber,
        contentLength,
        expiresSec: PACK_VIDEO_PUT_EXPIRES_SEC,
      }),

    presignGet: (key, downloadName) =>
      presignGet(cfg, key, { expiresSec: PACK_VIDEO_GET_EXPIRES_SEC, downloadName }),

    async head(key) {
      const res = await call(urlOf(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) return fail(res, "hỏi cỡ tệp");
      return { size: Number(res.headers.get("content-length") ?? NaN) };
    },

    async remove(key) {
      const res = await call(urlOf(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) await fail(res, "xóa tệp");
    },

    async createMultipart(key) {
      const res = await call(urlOf(key, "?uploads"), {
        method: "POST",
        headers: { "content-type": PACK_VIDEO_CONTENT_TYPE },
      });
      if (!res.ok) return fail(res, "mở lượt tải theo mảnh");
      const parsed = xml.parse(await res.text()) as {
        InitiateMultipartUploadResult?: { UploadId?: string };
      };
      const uploadId = parsed.InitiateMultipartUploadResult?.UploadId;
      if (!uploadId) throw new R2Error("R2 không trả UploadId", res.status, null);
      return uploadId;
    },

    async completeMultipart(key, uploadId, parts) {
      const body =
        "<CompleteMultipartUpload>" +
        [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`)
          .join("") +
        "</CompleteMultipartUpload>";
      const res = await call(urlOf(key, `?uploadId=${encodeURIComponent(uploadId)}`), {
        method: "POST",
        body,
      });
      if (!res.ok) return fail(res, "chốt lượt tải theo mảnh");
      // Lệnh chốt có thể trả 200 mà thân là <Error> (hành vi của giao thức S3).
      const text = await res.text();
      if (/<Error>/.test(text)) {
        const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? null;
        throw new R2Error(`R2 chốt lượt tải theo mảnh thất bại (${code ?? "không rõ"})`, 200, code);
      }
    },

    async abortMultipart(key, uploadId) {
      const res = await call(urlOf(key, `?uploadId=${encodeURIComponent(uploadId)}`), { method: "DELETE" });
      if (!res.ok && res.status !== 404) await fail(res, "hủy lượt tải theo mảnh");
    },

    async listParts(key, uploadId) {
      const out: R2Part[] = [];
      let marker = "";
      // Mỗi trang tối đa 1.000 mảnh; tệp của mình ≤ 50 mảnh nên thường đúng một vòng.
      for (let guard = 0; guard < 20; guard++) {
        const q =
          `?uploadId=${encodeURIComponent(uploadId)}` +
          (marker ? `&part-number-marker=${encodeURIComponent(marker)}` : "");
        const res = await call(urlOf(key, q));
        if (!res.ok) return fail(res, "liệt kê mảnh");
        const parsed = xml.parse(await res.text()) as {
          ListPartsResult?: {
            IsTruncated?: string;
            NextPartNumberMarker?: string;
            Part?: { PartNumber: string; ETag: string; Size: string } | { PartNumber: string; ETag: string; Size: string }[];
          };
        };
        const r = parsed.ListPartsResult;
        for (const p of asArray(r?.Part)) {
          out.push({ partNumber: Number(p.PartNumber), etag: String(p.ETag), size: Number(p.Size) });
        }
        if (r?.IsTruncated !== "true" || !r.NextPartNumberMarker) break;
        marker = r.NextPartNumberMarker;
      }
      return out;
    },
  };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;"
  );
}

/** Kho thật theo biến môi trường. Gọi khi chưa cấu hình là lỗi lập trình: cổng phải chặn trước. */
export function getR2Storage(): R2Storage {
  const cfg = r2ConfigFromEnv();
  if (!cfg) throw new Error("R2 chưa cấu hình (thiếu R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
  return createR2Storage(cfg);
}
