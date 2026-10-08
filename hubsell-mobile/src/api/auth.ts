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

/* Đăng ký + kiểm tên đăng nhập đã GỠ khỏi app 08/10 tối (anh Trung chốt sau
   khi Apple từ chối 3.1.1 lần 2): tài khoản tạo trên bản web, app chỉ đăng nhập. */

export function fetchMe() {
  return api<MeResponse>("/api/auth/me");
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api<{ ok?: boolean }>("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

/** Tự xóa tài khoản (Apple 5.1.1(v)) — đòi mật khẩu hiện tại; thành công thì phiên hết hiệu lực. */
export function deleteAccount(password: string) {
  return api<{ ok?: boolean }>("/api/auth/me/delete", {
    method: "POST",
    body: { password },
  });
}
