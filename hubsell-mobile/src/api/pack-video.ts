// ============================================================
// VIDEO ĐÓNG HÀNG — các lượt gọi máy chủ của màn quay trên app (26/11/2026).
// Cùng hợp đồng với màn quay webcam của web (frontend/src/lib/api.ts) — docs/VIDEO-DONG-HANG-THIET-KE.md
// mục 38 (vé phiên quay, số giờ kèm câu trả lời), mục 39 (Retry-After), mục 40 (M2.4: vé tải lên không ghi sổ).
//
// Tệp này KHÔNG nhập thư viện camera — nằm trong gói mã của mọi bản app, kể cả bản chưa có phần gốc camera.
// ============================================================

import { api, currentAuthToken } from "./client";

export type PackVideoKind = "PACK" | "UNBOX";

export type UploadPlan =
  | { mode: "single"; url: string; headers: Record<string, string>; expiresAt: string }
  | {
      mode: "multipart";
      partSize: number;
      parts: { partNumber: number; url: string }[];
      uploadedParts?: number[];
      expiresAt: string;
    };

export interface BeginPayload {
  clientId: string;
  trackingCode: string;
  kind: PackVideoKind;
  recordedAt: string;
  durationSec: number;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  deviceName: string | null;
}

export interface BeginResponse {
  video: { id: string; status: string };
  /** null = video này đã lên kho từ lượt trước. */
  upload: UploadPlan | null;
  /**
   * Chỉ đường v2 (M2.4): VÉ TẢI LÊN — máy chủ chưa ghi sổ, mọi thứ cần ghi nằm trong vé. Có vé thì ký mảnh / báo xong
   * phải đi đường v2 kèm vé; null = máy chủ đã có dòng sổ cho clip này → đi tiếp đường cũ theo `video.id`.
   */
  ticket?: string | null;
  /** Số giờ đi kèm câu trả lời (M2.2) — vắng ở máy chủ bản cũ. */
  hours?: unknown;
}

// ---------- VÉ PHIÊN QUAY (M2.1) ----------
// Màn quay xin MỘT vé 10 phút rồi gửi kèm ở các đường nóng (hỏi tem, xin vé tải, ký mảnh, báo tải xong); trong hạn vé
// máy chủ không đọc database để xác thực. Vé chỉ là LỐI TẮT: không xin được (máy chủ đang tắt, mất mạng) thì các
// đường đó vẫn chạy bằng token đăng nhập như trước — không có cách hỏng mới. Câu trả lời xin vé cũng cho biết máy
// chủ có đang mở đường tải lên v2 không (`uploadV2`) → bật / tắt ở máy chủ, app không phải ra bản mới.

/** Xin vé mới trước khi vé cũ hết hạn ngần này (đồng hồ máy; vé hết hạn thật thì máy chủ tự rơi về xác thực thường). */
const TICKET_RENEW_BEFORE_MS = 60_000;
/** Xin vé hỏng / máy chủ không cấp → thôi hỏi trong ngần này. */
const TICKET_RETRY_MS = 60_000;

let session: { forToken: string; ticket: string | null; uploadV2: boolean; untilMs: number } | null = null;
let sessionInflight: Promise<void> | null = null;

async function ensureSession(): Promise<typeof session> {
  const token = currentAuthToken();
  if (!token) return null;
  // Vé gắn với ĐÚNG phiên đăng nhập đã xin nó: đăng xuất / đổi tài khoản thì bỏ vé cũ.
  if (!session || session.forToken !== token || Date.now() >= session.untilMs) {
    sessionInflight ??= (async () => {
      let ticket: string | null = null;
      let uploadV2 = false;
      let untilMs = Date.now() + TICKET_RETRY_MS;
      try {
        const r = await api<{ ticket: string | null; ttlSec: number; uploadV2?: boolean }>("/api/pack-videos/session", {
          method: "POST",
          body: {},
        });
        uploadV2 = r.uploadV2 === true;
        if (r.ticket && r.ttlSec > 0) {
          ticket = r.ticket;
          untilMs = Date.now() + Math.max(TICKET_RETRY_MS, r.ttlSec * 1000 - TICKET_RENEW_BEFORE_MS);
        }
      } catch {
        // không có vé — gọi bằng token đăng nhập, tải lên đi đường cũ
      }
      session = { forToken: token, ticket, uploadV2, untilMs };
      sessionInflight = null;
    })();
    await sessionInflight;
  }
  return session && session.forToken === token ? session : null;
}

async function hotHeaders(): Promise<Record<string, string>> {
  const s = await ensureSession();
  return s?.ticket ? { "X-Pack-Session": s.ticket } : {};
}

/** Máy chủ có đang mở đường tải lên v2 (vé không ghi sổ) không. Không hỏi được thì coi như không. */
export async function uploadV2Enabled(): Promise<boolean> {
  return (await ensureSession())?.uploadV2 === true;
}

/** Máy chủ vừa báo đường v2 đang tắt → thôi thử v2 cho tới lượt xin vé kế. */
export function noteUploadV2Off(): void {
  if (session) session = { ...session, uploadV2: false };
}

// ---------- Hỏi tem · số giờ · đồng ý ----------

/** Mã trên tem này khớp đơn nào (để in mã đơn hàng lên video). Chỉ đọc. */
export async function matchTem(code: string, kind: PackVideoKind) {
  return api<{ order: { orderCode: string } | null }>(
    `/api/pack-videos/match?code=${encodeURIComponent(code)}&kind=${kind}`,
    { headers: await hotHeaders() }
  );
}

export function fetchPackHours() {
  return api<unknown>("/api/pack-videos/hours");
}

/** Chủ shop đồng ý lần đầu (máy chủ ghi sổ đồng ý + tặng giờ quay). Gọi lại khi đã đồng ý cũng trả ok. */
export function acceptPackVideoConsent() {
  return api<{ ok: boolean }>("/api/pack-videos/consent", { method: "POST", body: {} });
}

// ---------- Tải lên — đường cũ (v1: máy chủ ghi dòng PENDING lúc bắt đầu) ----------

export async function beginUploadV1(payload: BeginPayload) {
  return api<BeginResponse>("/api/pack-videos", { method: "POST", body: payload, headers: await hotHeaders() });
}

export async function signPartsV1(videoId: string, partNumbers: number[]) {
  return api<{ parts: { partNumber: number; url: string }[] }>(
    `/api/pack-videos/${encodeURIComponent(videoId)}/parts`,
    { method: "POST", body: { partNumbers }, headers: await hotHeaders() }
  );
}

export async function completeUploadV1(videoId: string) {
  return api<{ hours?: unknown }>(`/api/pack-videos/${encodeURIComponent(videoId)}/complete`, {
    method: "POST",
    body: {},
    headers: await hotHeaders(),
  });
}

// ---------- Tải lên — đường v2 (M2.4: vé tải lên, máy chủ chỉ ghi sổ MỘT lần lúc báo xong) ----------

export async function beginUploadV2(payload: BeginPayload) {
  return api<BeginResponse>("/api/pack-videos/v2", { method: "POST", body: payload, headers: await hotHeaders() });
}

export async function signPartsV2(ticket: string, partNumbers: number[]) {
  return api<{ parts: { partNumber: number; url: string }[]; uploadedParts?: number[] }>("/api/pack-videos/v2/parts", {
    method: "POST",
    body: { ticket, partNumbers },
    headers: await hotHeaders(),
  });
}

export async function completeUploadV2(ticket: string) {
  return api<{ hours?: unknown }>("/api/pack-videos/v2/complete", {
    method: "POST",
    body: { ticket },
    headers: await hotHeaders(),
  });
}
