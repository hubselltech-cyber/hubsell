import { api } from "./client";
import type { LoginResponse, MeResponse } from "../types/api";

/** identifier nhận cả 3 dạng: email, username chủ shop, "chủ/nhânviên". */
export function login(identifier: string, password: string) {
  return api<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { identifier: identifier.trim(), password },
    anonymous: true,
  });
}

/** Đăng nhập Google trong app (1.3.0): idToken từ SDK native → backend kiểm JWKS. */
export function loginWithGoogle(idToken: string) {
  return api<LoginResponse>("/api/auth/social/google", {
    method: "POST",
    body: { idToken },
    anonymous: true,
  });
}

/** Sign in with Apple (1.3.0): fullName chỉ có lần đầu — gửi ngay lần đó. */
export function loginWithApple(input: {
  identityToken: string;
  authorizationCode: string | null;
  fullName: { givenName: string | null; familyName: string | null } | null;
}) {
  return api<LoginResponse>("/api/auth/social/apple", {
    method: "POST",
    body: input,
    anonymous: true,
  });
}

/**
 * Đăng ký trong app (1.3.1, anh Trung chốt 18/10 "Salework được thì mình cũng
 * được"). Gỡ 08/10 vì Apple 3.1.1 (luồng đăng ký dẫn tới dùng thử ngoài IAP);
 * từ 10/10 iOS mua gói qua IAP nên tài khoản mới có đường mua hợp lệ. Màn chỉ
 * Họ tên / Email / Mật khẩu + tick điều khoản; `client: "app"` để backend ghi
 * bằng chứng đồng ý nguồn register_app. Trả {token, user} như đăng nhập.
 */
export function register(input: {
  fullName: string;
  email: string;
  password: string;
}) {
  return api<LoginResponse>("/api/auth/register", {
    method: "POST",
    body: {
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      password: input.password,
      acceptTerms: true,
      client: "app",
    },
    anonymous: true,
  });
}

export function fetchMe() {
  return api<MeResponse>("/api/auth/me");
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api<{ ok?: boolean }>("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

/**
 * Tự xóa tài khoản (Apple 5.1.1(v)) — đòi mật khẩu hiện tại; tài khoản
 * Google/Apple chưa đặt mật khẩu (hasPassword=false) gửi null, backend tự
 * quyết theo passwordSetAt. Thành công thì phiên hết hiệu lực.
 */
export function deleteAccount(password: string | null) {
  return api<{ ok?: boolean }>("/api/auth/me/delete", {
    method: "POST",
    body: password ? { password } : {},
  });
}
