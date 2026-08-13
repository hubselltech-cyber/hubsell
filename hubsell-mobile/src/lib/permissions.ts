/**
 * Bản sao RÚT GỌN từ backend/src/permission-registry.ts (convention chép tay
 * giữa các package). Mobile chỉ cần hasPermission để chia luồng sau đăng nhập.
 * ADMIN không đi qua hàm này — chủ shop toàn quyền.
 */
export function hasPermission(perms: readonly string[], key: string): boolean {
  if (perms.includes(key)) return true;
  const prefix = `${key}.`;
  return perms.some((p) => p.startsWith(prefix));
}

import type { AuthUser } from "../types/api";

/** Màn hình mặc định theo vai — trái tim của điều hướng Role-Based. */
export function homePathFor(user: AuthUser): string {
  if (user.role === "ADMIN") return "/(admin)/home";
  if (hasPermission(user.permissions, "warehouse.returns")) {
    return "/(warehouse)/scan";
  }
  return "/no-access";
}
