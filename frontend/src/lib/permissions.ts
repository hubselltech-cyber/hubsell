/**
 * PHÂN QUYỀN PHÍA GIAO DIỆN
 *
 * Đây chỉ là lớp trải nghiệm: ẩn menu và chặn vào trang để nhân viên không đâm
 * vào màn hình "không có quyền". Lớp chặn THẬT nằm ở backend (requireRole +
 * canSeeFinancials) — mọi hàm ở đây đều có một chốt tương ứng bên máy chủ, nên
 * kể cả người dùng sửa localStorage cũng không lấy được dữ liệu.
 *
 * Gom về một chỗ để khi thêm vai trò mới chỉ phải sửa đúng file này, thay vì đi
 * tìm từng câu `role === "..."` rải rác trong các trang rồi bỏ sót một chỗ.
 */

import type { Role } from "./api";

/** Chủ shop — toàn quyền. */
export function isAdmin(role?: Role): boolean {
  return role === "ADMIN";
}

/**
 * Được xem giá vốn, lợi nhuận, chi phí vận hành.
 * Chỉ chủ shop: SALES thấy doanh thu nhưng không thấy lãi, kho không thấy gì.
 */
export function canSeeFinancials(role?: Role): boolean {
  return role === "ADMIN";
}

/** Được vào nhóm menu "Quản lý Tài chính" (dòng tiền, chi phí, đơn lỗ, giá vốn). */
export function canAccessFinance(role?: Role): boolean {
  return role === "ADMIN";
}

/** Được vào trang Tổng quan. Kho không có việc gì ở đây nên bị ẩn hẳn. */
export function canAccessDashboard(role?: Role): boolean {
  return role === "ADMIN" || role === "SALES";
}

/** Được cấu hình gian hàng, liên kết sản phẩm, quản lý nhân viên. */
export function canManageShop(role?: Role): boolean {
  return role === "ADMIN";
}

/** Trang mặc định sau khi đăng nhập — kho không vào được Tổng quan. */
export function homePathFor(role?: Role): string {
  return canAccessDashboard(role) ? "/" : "/orders";
}
