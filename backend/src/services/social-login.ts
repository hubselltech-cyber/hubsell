// ============================================================
// ĐĂNG NHẬP XÃ HỘI TRONG APP MOBILE — GOOGLE + SIGN IN WITH APPLE (18/10/2026)
//
// Vì sao có: khách đăng ký web bằng nút Google không có mật khẩu → app mobile
// (chỉ ô email + mật khẩu) không vào được. Anh Trung chốt bản 1.3.0: app có nút
// Google; Apple 4.8 bắt kèm Sign in with Apple. Thiết kế đầy đủ ở
// docs/DANG-NHAP-GOOGLE-APPLE-TRONG-APP.md.
//
// Khác luồng web (google-oauth.ts, server-side code flow): app lấy id_token /
// identityToken bằng SDK native rồi gửi lên — backend KHÔNG đổi code với Google,
// nên phải TỰ KIỂM CHỮ KÝ JWS bằng JWKS công khai của Google / Apple (jose).
//
// `upsertSocialUser` là lõi dùng chung cho cả 3 lối (Google web, Google app,
// Apple app): tìm theo id nhà cung cấp → liên kết theo email → tạo mới.
// ============================================================

import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  SignJWT,
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { prisma } from "../lib/prisma";
import { PRIVACY_VERSION, TERMS_VERSION, type TermsAcceptanceSource } from "../lib/legal";
import { encryptSecret } from "../lib/secret-box";
import { generateUsername } from "../lib/username";

// ---------- Lỗi có mã để route dịch sang HTTP ----------

export type SocialLoginErrorCode =
  | "NOT_CONFIGURED" // thiếu env → 503
  | "INVALID_TOKEN" // chữ ký / iss / aud / exp sai → 401
  | "EMAIL_NOT_VERIFIED" // Google email_verified=false → 401
  | "APPLE_NO_EMAIL"; // Apple không trả email và chưa từng thấy sub này → 409

export class SocialLoginError extends Error {
  constructor(
    public readonly code: SocialLoginErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SocialLoginError";
  }
}

// ---------- Hồ sơ chuẩn hóa từ cả hai nhà cung cấp ----------

export type SocialProvider = "google" | "apple";

export interface SocialProfile {
  provider: SocialProvider;
  /** `sub` của nhà cung cấp — khóa liên kết ổn định. */
  providerId: string;
  /** Đã lower. Apple có thể là email relay (`@privaterelay.appleid.com`) hoặc null ở lần sau. */
  email: string | null;
  emailVerified: boolean;
  /** Tên hiển thị đã có phương án dự phòng (phần trước @ hoặc "Chủ shop"). */
  name: string;
}

// ============================================================
// GOOGLE — id_token từ SDK native (@react-native-google-signin)
// aud = client id iOS hoặc Android (mỗi nền một client), chấp nhận thêm client
// web sẵn có để một token web cũng dùng được khi cần thử.
// ============================================================

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export function googleAudiences(): string[] {
  return [
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID,
  ].filter((v): v is string => Boolean(v));
}

/**
 * Có ít nhất một client id để kiểm aud. SDK Android phát idToken với aud =
 * client WEB (GOOGLE_CLIENT_ID sẵn có từ nút Google web) → Android chạy ngay
 * không cần env mới; iOS cần GOOGLE_IOS_CLIENT_ID (aud = client iOS).
 */
export function isGoogleAppConfigured(): boolean {
  return googleAudiences().length > 0;
}

let googleJwks: JWTVerifyGetKey | null = null;
function getGoogleJwks(): JWTVerifyGetKey {
  // createRemoteJWKSet tự cache theo Cache-Control và tự tải lại khi gặp kid lạ.
  googleJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return googleJwks;
}

/**
 * Kiểm id_token Google và bóc hồ sơ. `opts.jwks` để test tiêm bộ khóa cục bộ.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  opts: { jwks?: JWTVerifyGetKey; audiences?: string[] } = {}
): Promise<SocialProfile> {
  const audiences = opts.audiences ?? googleAudiences();
  if (audiences.length === 0) {
    throw new SocialLoginError("NOT_CONFIGURED", "Đăng nhập Google trong app chưa được bật");
  }
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, opts.jwks ?? getGoogleJwks(), {
      issuer: GOOGLE_ISSUERS,
      audience: audiences,
    }));
  } catch (err) {
    throw new SocialLoginError("INVALID_TOKEN", `Token Google không hợp lệ: ${(err as Error).message}`);
  }
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!sub || !email) {
    throw new SocialLoginError("INVALID_TOKEN", "Token Google thiếu sub/email");
  }
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw new SocialLoginError("EMAIL_NOT_VERIFIED", "Email Google chưa được xác minh");
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  return {
    provider: "google",
    providerId: sub,
    email,
    emailVerified: true,
    name: name || email.split("@")[0],
  };
}

// ============================================================
// APPLE — identityToken từ expo-apple-authentication
// iss https://appleid.apple.com, aud = bundle id app. Email có thể là relay và
// CHỈ chắc chắn có ở lần đăng nhập đầu; tên không nằm trong token (client gửi
// kèm, cũng chỉ lần đầu).
// ============================================================

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

export function appleClientId(): string {
  return process.env.APPLE_SIWA_CLIENT_ID ?? "vn.hubsell.app";
}

/** Đủ để KIỂM identityToken (chỉ cần client id — có mặc định). */
export function isAppleSignInConfigured(): boolean {
  return process.env.APPLE_SIWA_ENABLED !== "0";
}

/** Đủ để ĐỔI authorizationCode / THU HỒI token (cần key Sign in with Apple .p8). */
export function isAppleKeyConfigured(): boolean {
  return Boolean(
    process.env.APPLE_SIWA_TEAM_ID && process.env.APPLE_SIWA_KEY_ID && process.env.APPLE_SIWA_PRIVATE_KEY
  );
}

let appleJwks: JWTVerifyGetKey | null = null;
function getAppleJwks(): JWTVerifyGetKey {
  appleJwks ??= createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return appleJwks;
}

export interface AppleClientName {
  givenName?: string | null;
  familyName?: string | null;
}

/** Tên hiển thị từ fullName Apple gửi lần đầu; không có → phần trước @; không có nữa → "Chủ shop". */
export function appleDisplayName(name: AppleClientName | null | undefined, email: string | null): string {
  const joined = [name?.givenName, name?.familyName]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(" ");
  if (joined) return joined;
  if (email) return email.split("@")[0];
  return "Chủ shop";
}

export function isPrivateRelayEmail(email: string | null): boolean {
  return Boolean(email && email.toLowerCase().endsWith("@privaterelay.appleid.com"));
}

export async function verifyAppleIdentityToken(
  identityToken: string,
  clientName: AppleClientName | null | undefined,
  opts: { jwks?: JWTVerifyGetKey; audience?: string } = {}
): Promise<SocialProfile> {
  if (!isAppleSignInConfigured()) {
    throw new SocialLoginError("NOT_CONFIGURED", "Đăng nhập Apple chưa được bật");
  }
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(identityToken, opts.jwks ?? getAppleJwks(), {
      issuer: APPLE_ISSUER,
      audience: opts.audience ?? appleClientId(),
    }));
  } catch (err) {
    throw new SocialLoginError("INVALID_TOKEN", `Token Apple không hợp lệ: ${(err as Error).message}`);
  }
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) throw new SocialLoginError("INVALID_TOKEN", "Token Apple thiếu sub");
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  // Apple trả chuỗi "true"/"false" (đôi khi boolean) cho email_verified.
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  return {
    provider: "apple",
    providerId: sub,
    email: email || null,
    emailVerified: Boolean(email) && emailVerified,
    name: appleDisplayName(clientName, email || null),
  };
}

/**
 * client_secret cho token endpoint của Apple = JWT ES256 ký bằng key Sign in
 * with Apple (.p8). `privateKeyPem` để test tiêm khóa; mặc định đọc env (PEM
 * thô hoặc base64 của PEM — Render dán một dòng tiện hơn).
 */
export async function buildAppleClientSecret(opts: {
  teamId?: string;
  keyId?: string;
  privateKeyPem?: string;
  clientId?: string;
  now?: Date;
} = {}): Promise<string> {
  const teamId = opts.teamId ?? process.env.APPLE_SIWA_TEAM_ID;
  const keyId = opts.keyId ?? process.env.APPLE_SIWA_KEY_ID;
  const rawKey = opts.privateKeyPem ?? process.env.APPLE_SIWA_PRIVATE_KEY;
  if (!teamId || !keyId || !rawKey) {
    throw new SocialLoginError("NOT_CONFIGURED", "Thiếu APPLE_SIWA_TEAM_ID / KEY_ID / PRIVATE_KEY");
  }
  const pem = rawKey.includes("-----BEGIN")
    ? rawKey.replace(/\\n/g, "\n")
    : Buffer.from(rawKey, "base64").toString("utf8");
  const key = await importPKCS8(pem, "ES256");
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60) // Apple cho tối đa 6 tháng; 1 giờ là đủ cho một lượt gọi.
    .setAudience(APPLE_ISSUER)
    .setSubject(opts.clientId ?? appleClientId())
    .sign(key);
}

/**
 * Đổi authorizationCode lấy refresh_token — CHỈ để thu hồi khi khách xóa tài
 * khoản (Apple 5.1.1(v)). Chưa cấu hình key → null, không chặn đăng nhập.
 * Lỗi mạng/Apple cũng không chặn đăng nhập: ghi log, trả null.
 */
export async function exchangeAppleAuthorizationCode(code: string): Promise<string | null> {
  if (!isAppleKeyConfigured()) return null;
  try {
    const res = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appleClientId(),
        client_secret: await buildAppleClientSecret(),
        code,
        grant_type: "authorization_code",
      }),
    });
    const json = (await res.json()) as { refresh_token?: string; error?: string };
    if (!json.refresh_token) {
      console.warn("[social-login] Apple không trả refresh_token:", json.error ?? res.status);
      return null;
    }
    return json.refresh_token;
  } catch (err) {
    console.warn("[social-login] Đổi authorizationCode Apple lỗi:", (err as Error).message);
    return null;
  }
}

/** Thu hồi refresh_token Apple khi xóa tài khoản. Trả true nếu Apple nhận (200). */
export async function revokeAppleToken(refreshToken: string): Promise<boolean> {
  if (!isAppleKeyConfigured()) return false;
  try {
    const res = await fetch(APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appleClientId(),
        client_secret: await buildAppleClientSecret(),
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
    });
    if (!res.ok) console.warn("[social-login] Apple revoke trả", res.status);
    return res.ok;
  } catch (err) {
    console.warn("[social-login] Apple revoke lỗi:", (err as Error).message);
    return false;
  }
}

// ============================================================
// LÕI DÙNG CHUNG: tìm → liên kết → tạo
// ============================================================

export interface TermsMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface UpsertSocialResult {
  user: { id: string; email: string | null; fullName: string };
  /** true = vừa tạo chủ shop mới (route gửi thư chào + gán gói mặc định). */
  created: boolean;
}

/**
 * 1. Theo id nhà cung cấp (googleId / appleUserId) → đăng nhập.
 * 2. Theo email → LIÊN KẾT id vào tài khoản sẵn có (đăng ký form trước, bấm
 *    Google/Apple sau là vào thẳng). Email relay Apple không trùng ai → bước 3.
 * 3. Tạo chủ shop mới: mật khẩu ngẫu nhiên, passwordSetAt NULL (đặt mật khẩu ở
 *    Cài đặt → "Đặt mật khẩu"), ghi log đồng ý điều khoản cùng transaction.
 * Apple lần sau không trả email + chưa thấy sub → APPLE_NO_EMAIL (khách đã xóa
 * tài khoản Hubsell nhưng chưa "Dừng sử dụng" Hubsell trong Apple ID).
 */
export async function upsertSocialUser(
  profile: SocialProfile,
  source: TermsAcceptanceSource,
  terms: TermsMeta,
  extra: { appleRefreshToken?: string | null } = {}
): Promise<UpsertSocialResult> {
  const idField = profile.provider === "google" ? "googleId" : "appleUserId";
  const refreshEnc =
    profile.provider === "apple" && extra.appleRefreshToken
      ? encryptSecret(extra.appleRefreshToken, `apple-refresh:${profile.providerId}`)
      : undefined;

  const existing = await prisma.user.findUnique({
    where: { [idField]: profile.providerId } as { googleId: string } | { appleUserId: string },
    select: { id: true, email: true, fullName: true, deletedAt: true },
  });
  if (existing && !existing.deletedAt) {
    if (refreshEnc) {
      await prisma.user.update({ where: { id: existing.id }, data: { appleRefreshTokenEnc: refreshEnc } });
    }
    return { user: existing, created: false };
  }

  if (profile.email) {
    const byEmail = await prisma.user.findUnique({
      where: { email: profile.email },
      select: { id: true, email: true, fullName: true, deletedAt: true },
    });
    if (byEmail && !byEmail.deletedAt) {
      const linked = await prisma.user.update({
        where: { id: byEmail.id },
        data: { [idField]: profile.providerId, ...(refreshEnc ? { appleRefreshTokenEnc: refreshEnc } : {}) },
        select: { id: true, email: true, fullName: true },
      });
      return { user: linked, created: false };
    }
  } else {
    throw new SocialLoginError(
      "APPLE_NO_EMAIL",
      "Apple không gửi email cho lần đăng nhập này. Vào Cài đặt iPhone → Apple ID → Đăng nhập bằng Apple → Hubsell → Dừng sử dụng, rồi thử lại."
    );
  }

  const username = await generateUsername(profile.email);
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const created = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: profile.email!,
        username,
        [idField]: profile.providerId,
        ...(refreshEnc ? { appleRefreshTokenEnc: refreshEnc } : {}),
        fullName: profile.name,
        passwordHash,
        passwordSetAt: null,
        role: "ADMIN",
      },
      select: { id: true, email: true, fullName: true },
    });
    await tx.termsAcceptance.create({
      data: {
        userId: u.id,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        source,
        ip: terms.ip,
        userAgent: terms.userAgent,
      },
    });
    return u;
  });
  return { user: created, created: true };
}
