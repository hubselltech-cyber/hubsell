/**
 * PHÂN QUYỀN PHÍA GIAO DIỆN (mô hình cây phân quyền 10/08)
 *
 * Đây chỉ là lớp trải nghiệm: ẩn menu và chặn vào trang để nhân viên không đâm
 * vào màn hình "không có quyền". Lớp chặn THẬT nằm ở backend (requirePermission
 * trên từng nhóm API + canSeeFinancials trong controller) — kể cả người dùng
 * sửa localStorage cũng không lấy được dữ liệu.
 *
 * Mọi hàm nhận CẢ AuthUser (không chỉ role): quyền của nhân viên giờ nằm trong
 * user.permissions (mảng khóa lá — xem lib/permission-registry.ts), role chỉ còn
 * phân biệt chủ shop / nhân viên.
 */

import type { AuthUser } from "./api";
import { hasPermission, HOME_PRIORITY } from "./permission-registry";

type MaybeUser = AuthUser | null | undefined;

/** Chủ shop — toàn quyền. */
export function isAdmin(user?: MaybeUser): boolean {
  return user?.role === "ADMIN";
}

/**
 * CỔNG KIỂM DUY NHẤT: user có quyền `key` không? Chủ shop luôn có; nhân viên
 * tra cây quyền (lá khớp đúng lá, nhóm khớp mọi lá con). Các hàm canAccess*
 * bên dưới chỉ là bí danh dễ đọc của hàm này.
 */
export function can(user: MaybeUser, key: string): boolean {
  if (isAdmin(user)) return true;
  return hasPermission(user?.permissions ?? [], key);
}

/**
 * Được xem giá vốn, lợi nhuận, chi phí vận hành. "Tick gì thấy nấy" (chốt
 * 10/08): chủ shop, và nhân viên có BẤT KỲ quyền Tài chính nào.
 */
export function canSeeFinancials(user?: MaybeUser): boolean {
  return can(user, "finance");
}

/** Được vào trang Tổng quan. */
export function canAccessDashboard(user?: MaybeUser): boolean {
  return can(user, "dashboard");
}

/** Được vào nhóm "Trợ lý vận hành" (CSKH: chat, phản hồi đánh giá, kịch bản AI). */
export function canAccessOperations(user?: MaybeUser): boolean {
  return can(user, "operations");
}

/** Được vào nhóm "Mạng lưới KOC & Marketing" (mục nguyên khối trong cây quyền). */
export function canAccessKocMarketing(user?: MaybeUser): boolean {
  return can(user, "koc");
}

/**
 * Được cấu hình gian hàng, liên kết sản phẩm, quản lý nhân viên — các khu
 * VĨNH VIỄN chỉ chủ shop, cố tình không nằm trong cây phân quyền.
 */
export function canManageShop(user?: MaybeUser): boolean {
  return isAdmin(user);
}

/**
 * Thuộc KHÔNG GIAN ĐIỀU HÀNH HUBSELL (chủ nền tảng hoặc nhân viên điều hành)?
 * Ưu tiên cờ platformWorkspace backend tính sẵn; fallback isPlatformAdmin cho
 * user cũ còn nằm trong localStorage từ trước khi có cờ mới.
 */
export function isPlatformWorkspace(user?: MaybeUser): boolean {
  return user?.platformWorkspace === true || user?.isPlatformAdmin === true;
}

/**
 * Trang mặc định sau khi đăng nhập: trang đầu tiên trong danh sách ưu tiên mà
 * user vào được. Nhân viên chưa được cấp quyền nào → /guide (mở cho mọi người,
 * không gọi API dữ liệu nên không dội thêm 403).
 */
export function homePathFor(user?: MaybeUser): string {
  // Khu điều hành Hubsell: chủ nền tảng về trang Nhân viên (việc chính của
  // họ); nhân viên điều hành về khu Hệ thống nếu được cấp lá hq.* bất kỳ.
  if (isPlatformWorkspace(user)) {
    if (isAdmin(user)) return "/staff";
    return can(user, "hq") ? "/admin" : "/guide";
  }
  if (isAdmin(user)) return "/";
  for (const { key, path } of HOME_PRIORITY) {
    if (can(user, key)) return path;
  }
  return "/guide";
}
