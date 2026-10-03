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

export interface RegisterPayload {
  email: string;
  password: string;
  fullName: string;
  /** Bỏ trống → backend tự sinh từ email. */
  username?: string;
  /** ISO alpha-2, mặc định "VN". */
  country?: string;
  /** Số TRONG NƯỚC ("0912345678") — backend ghép mã vùng theo country. */
  phoneNumber?: string;
  /** Mã giới thiệu Affiliate — sai thì backend bỏ qua, không chặn đăng ký. */
  referralCode?: string;
  /** Click-wrap: backend từ chối nếu không phải true. */
  acceptTerms: true;
}

/** Đăng ký chủ shop mới — cùng body với form web (POST /api/auth/register). */
export function register(data: RegisterPayload) {
  return api<LoginResponse>("/api/auth/register", {
    method: "POST",
    body: data,
    anonymous: true,
  });
}

/** Báo "tên này đã có người dùng" NGAY KHI GÕ — endpoint công khai. */
export function checkUsernameAvailable(username: string) {
  return api<{ available: boolean }>(
    `/api/auth/check-username?username=${encodeURIComponent(username)}`,
    { anonymous: true }
  );
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
