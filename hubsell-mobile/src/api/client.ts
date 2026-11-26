/**
 * Fetch wrapper duy nhất của app — gắn Bearer token, parse lỗi tiếng Việt của
 * backend, và bắn tín hiệu 401 để AuthContext tự đăng xuất phiên hết hạn.
 */

import { Platform } from "react-native";

const REMOTE_BASE = (
  process.env.EXPO_PUBLIC_API_URL ?? "https://hubsell-backend-sg.onrender.com"
).replace(/\/+$/, "");

// GIẢ LẬP WEB: backend production dùng CORS allowlist hẹp nên trình duyệt tại
// localhost:8081 bị chặn — đi vòng qua proxy dev (scripts/dev-proxy.js).
// App NATIVE không có CORS: gọi thẳng Render.
const API_BASE =
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  window.location.hostname === "localhost"
    ? "http://localhost:8099"
    : REMOTE_BASE;

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onPlanLocked: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Token của phiên đang đăng nhập — để vé phiên quay video gắn với đúng phiên đã xin nó (api/pack-video.ts). */
export function currentAuthToken(): string | null {
  return authToken;
}

export function setOnUnauthorized(cb: (() => void) | null) {
  onUnauthorized = cb;
}

/**
 * Backend trả 403 PLAN_LOCKED khi gói hết hạn quá ân hạn / vượt trần đơn —
 * PlanContext nghe tín hiệu này để tải lại trạng thái gói ngay (dải nhắc đổi
 * sang đỏ mà không chờ nhịp 5 phút).
 */
export function setOnPlanLocked(cb: (() => void) | null) {
  onPlanLocked = cb;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  /** Máy chủ bảo chờ ít nhất ngần này trước khi thử lại (tiêu đề Retry-After của 429 / 503); không có thì bỏ trống. */
  retryAfterMs?: number;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Bỏ qua token (màn đăng nhập). */
  anonymous?: boolean;
  /** Tiêu đề gửi thêm (vé phiên quay video X-Pack-Session). */
  headers?: Record<string, string>;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  // FormData (upload ảnh chat): để fetch TỰ đặt Content-Type multipart kèm
  // boundary — set tay là server không parse được phần file.
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  // Token GỬI KÈM lượt gọi này — so lại lúc nhận 401 (xem dưới).
  const sentToken = opts.anonymous ? null : authToken;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
        ...(opts.headers ?? {}),
      },
      body: isForm
        ? (opts.body as FormData)
        : opts.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined,
    });
  } catch {
    // Render free có thể ngủ đông — câu chữ nhắc thử lại thay vì báo lỗi cụt.
    throw new ApiError(
      "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
      0,
      null
    );
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // body rỗng/không phải JSON — giữ null
  }

  // Chỉ coi là "phiên hết hạn" khi 401 thuộc về CHÍNH token đang dùng. Lượt gọi
  // bắn đi lúc chưa có token (màn dựng trước khi khôi phục phiên xong) hoặc bằng
  // token cũ mà trả 401 thì không được đăng xuất phiên hiện tại.
  if (res.status === 401 && sentToken && sentToken === authToken) {
    onUnauthorized?.();
  }

  if (res.status === 403 && (data as { code?: string } | null)?.code === "PLAN_LOCKED") {
    onPlanLocked?.();
  }

  if (!res.ok) {
    const body = data as { error?: string; code?: string } | null;
    // Apple 3.1.1 (06/10/2026): app KHÔNG được dẫn người dùng tới cách thanh
    // toán ngoài IAP. Backend khi gói hết hạn / vượt trần trả câu "gia hạn /
    // nâng gói…" (code PLAN_*) — trên app thay bằng câu trung tính, không nhắc
    // tới gói, giá hay nơi mua. Gói là hợp đồng B2B mua trên web, app chỉ dùng.
    const message = body?.code?.startsWith("PLAN_")
      ? "Tính năng này hiện chưa được bật cho tài khoản của bạn. Vui lòng liên hệ quản trị viên shop."
      : (body?.error ?? `Máy chủ trả lỗi (${res.status})`);
    const apiError = new ApiError(message, res.status, data);
    const retryAfterSec = Number(res.headers.get("Retry-After"));
    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) apiError.retryAfterMs = retryAfterSec * 1000;
    throw apiError;
  }
  return data as T;
}

/**
 * fetch đọc được BYTE trên máy thật: `expo/fetch` (nằm sẵn trong gói expo; trên web chính là
 * fetch của trình duyệt). fetch mặc định của React Native không bảo đảm đọc được
 * `arrayBuffer`. Nạp MUỘN trong try/catch — mã này có thể tới bản app cũ qua OTA, nạp hỏng
 * thì lùi về fetch mặc định chứ không được làm app văng lúc khởi động.
 */
function binaryFetch(): typeof fetch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo/fetch") as { fetch?: unknown };
    if (typeof mod.fetch === "function") return mod.fetch as typeof fetch;
  } catch {
    // bản app không có module — dùng fetch mặc định
  }
  return fetch;
}

/**
 * Gọi API trả TỆP NHỊ PHÂN (PDF vận đơn) — cùng token, cùng luật 401 với `api`, nhưng trả
 * byte + header thay vì JSON.
 */
export async function apiBinary(
  path: string,
  opts: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<{ bytes: Uint8Array; header: (name: string) => string | null }> {
  const sentToken = authToken;
  let res: Response;
  try {
    res = (await binaryFetch()(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })) as unknown as Response;
  } catch {
    throw new ApiError("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.", 0, null);
  }
  if (res.status === 401 && sentToken && sentToken === authToken) onUnauthorized?.();
  if (!res.ok) {
    let data: { error?: string; code?: string } | null = null;
    try {
      data = (await res.json()) as { error?: string; code?: string };
    } catch {
      // không phải JSON — giữ null
    }
    if (res.status === 403 && data?.code === "PLAN_LOCKED") onPlanLocked?.();
    const message = data?.code?.startsWith("PLAN_")
      ? "Tính năng này hiện chưa được bật cho tài khoản của bạn. Vui lòng liên hệ quản trị viên shop."
      : (data?.error ?? `Máy chủ trả lỗi (${res.status})`);
    throw new ApiError(message, res.status, data);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, header: (name) => res.headers.get(name) };
}

/** Lỗi do gói bị khóa (403 PLAN_LOCKED) — màn gọi hiện thẻ khóa thay ô lỗi. */
export function isPlanLockedError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    (err.body as { code?: string } | null)?.code === "PLAN_LOCKED"
  );
}
