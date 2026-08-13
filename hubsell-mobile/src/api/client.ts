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

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setOnUnauthorized(cb: (() => void) | null) {
  onUnauthorized = cb;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
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
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  // FormData (upload ảnh chat): để fetch TỰ đặt Content-Type multipart kèm
  // boundary — set tay là server không parse được phần file.
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(authToken && !opts.anonymous
          ? { Authorization: `Bearer ${authToken}` }
          : {}),
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

  if (res.status === 401 && authToken && !opts.anonymous) {
    onUnauthorized?.();
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      `Máy chủ trả lỗi (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}
