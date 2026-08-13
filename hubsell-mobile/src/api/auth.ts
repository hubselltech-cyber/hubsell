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

export function fetchMe() {
  return api<MeResponse>("/api/auth/me");
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api<{ ok?: boolean }>("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}
