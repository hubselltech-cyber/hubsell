// ============================================================
// GOOGLE OAUTH 2.0 (server-side code flow) — ĐĂNG NHẬP/ĐĂNG KÝ BẰNG GOOGLE
//
// Tự viết thay vì NextAuth/Passport: session của Hubsell là JWT do Express
// phát, và codebase đã có sẵn 3 luồng OAuth cùng pattern (Shopee/Lazada/
// TikTok) — Google chỉ là luồng thứ 4:
//   FE bấm nút → GET /api/auth/google (redirect sang Google, state ký JWT)
//   → user đồng ý → Google redirect về /api/auth/google/callback?code=&state=
//   → đổi code lấy id_token → upsert User → phát JWT → redirect FE kèm token.
//
// Cấu hình Console (console.cloud.google.com → APIs & Services → Credentials):
//   OAuth client ID dạng Web application, Authorized redirect URI =
//   https://<backend>/api/auth/google/callback. Điền env GOOGLE_CLIENT_ID +
//   GOOGLE_CLIENT_SECRET; thiếu → route trả 503 (đúng pattern Lazada).
// ============================================================

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { getBackendBaseUrl } from "../lib/backend-url";

const STATE_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getGoogleRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ??
    `${getBackendBaseUrl()}/api/auth/google/callback`
  );
}

// ---------- State chống CSRF (JWT ngắn hạn, cùng cơ chế các sàn) ----------

export function signGoogleState(): string {
  return jwt.sign(
    { purpose: "google_oauth", nonce: crypto.randomBytes(8).toString("hex") },
    STATE_SECRET,
    { expiresIn: "10m" }
  );
}

export function verifyGoogleState(token: string): boolean {
  try {
    const payload = jwt.verify(token, STATE_SECRET) as jwt.JwtPayload;
    return payload.purpose === "google_oauth";
  } catch {
    return false;
  }
}

// ---------- URL uỷ quyền + đổi code lấy hồ sơ ----------

export function buildGoogleAuthorizeUrl(state: string): string {
  const qs = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    // Luôn hiện màn chọn tài khoản — cùng bài học re-connect Lazada: trình
    // duyệt dính session Google khác sẽ đăng nhập nhầm người.
    prompt: "select_account",
  }).toString();
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;
}

export interface GoogleProfile {
  /** `sub` — định danh Google ổn định, khoá liên kết tài khoản. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Đổi authorization code lấy id_token rồi bóc hồ sơ. id_token nhận TRỰC TIẾP
 * từ token endpoint của Google qua TLS nên decode payload không cần verify
 * chữ ký JWS (chuẩn thực hành cho server-side flow).
 */
export async function exchangeGoogleCode(code: string): Promise<GoogleProfile> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as { id_token?: string; error_description?: string; error?: string };
  if (!json.id_token) {
    throw new Error(
      `Google không trả id_token: ${json.error_description || json.error || "không rõ"}`
    );
  }
  const payload = JSON.parse(
    Buffer.from(json.id_token.split(".")[1], "base64url").toString("utf8")
  ) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!payload.sub || !payload.email) {
    throw new Error("id_token Google thiếu sub/email");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: Boolean(payload.email_verified),
    name: payload.name?.trim() || payload.email.split("@")[0],
  };
}
