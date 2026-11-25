// ============================================================
// AI ĐƯỢC THẤY THÔNG BÁO NÀO — chuông + tin đẩy cho NHÂN VIÊN theo quyền
// (23/11/2026, anh Trung: nhân viên được cấp đủ quyền mà "không nhận được chuông
// thông báo, không có nút chuông"; docs/MOBILE-PHAN-QUYEN-NHAN-VIEN.md mục 8).
//
// Trước đó chuông chỉ mở cho chủ shop vì nhiều loại là tiền (báo cáo tuần, gói
// dịch vụ). Nay nhân viên nhận đúng những MỤC khớp quyền đã tick, và chỉ của
// những GIAN được giao. Một nguồn luật cho cả ba nơi: danh sách chuông, số chưa
// đọc / đánh dấu đã đọc (lọc bằng SQL) và tin đẩy về máy (lọc trong bộ nhớ).
//
// Luật:
//  1. MỤC ↔ QUYỀN: bảng CATEGORY_PERMISSIONS. null = chỉ chủ shop (nối lại gian,
//     gói dịch vụ, thanh toán — việc nhân viên không làm được / không nên thấy).
//  2. GIAN: thông báo ghi các gian nó nói tới (`channelIds`). Nhân viên thấy khi
//     KHÔNG có gian nào trong đó nằm ngoài phần được giao. Thông báo của CẢ SHOP
//     (`channelIds` rỗng: báo cáo tuần, cảnh báo điều hành…) chỉ tới nhân viên
//     được giao ĐỦ mọi gian — người bị giới hạn gian không đọc số gộp cả shop.
//  3. Dòng phát trước ngày lên bản này không có `category` → nhân viên không thấy
//     (không điền bù hàng loạt); chủ shop không đổi gì.
//  4. "Đã đọc" dùng CHUNG cả shop, nhân viên theo cài đặt bật / tắt nhóm của chủ
//     shop (anh duyệt hai mặc định này 23/11) — không có bảng riêng từng người.
// ============================================================

import type { Prisma } from "@prisma/client";
import { hasPermission } from "../config/permission-registry";
import { NOTIFICATION_GROUPS, type NotificationCategoryKey } from "./notification-categories";

/** Quyền (bất kỳ một trong các khóa) để nhân viên nhận mục này; null = chỉ chủ shop. */
export const CATEGORY_PERMISSIONS: Record<NotificationCategoryKey, readonly string[] | null> = {
  // Đơn hàng
  order_new: ["orders"],
  order_express: ["orders"],
  cancel_request: ["orders"],
  // Người nhận hàng hoàn là kho; người có quyền Đơn hàng cũng thấy đơn chuyển sang hoàn.
  return: ["warehouse.returns", "orders"],
  delivery_fail: ["orders"],
  auto_arrange: ["orders"],
  // Video đóng hàng sắp tự xóa: việc cần làm là TẢI VỀ — chỉ chủ shop tải được (routes/pack-videos.ts).
  pack_video: null,
  // Tài chính — cùng quyền với trang Báo cáo dòng tiền (nơi các con số này nằm)
  weekly_report: ["finance.analytics"],
  finance_alert: ["finance.analytics"],
  invoice: ["invoicing"],
  tax_deadline: ["invoicing"],
  // Quảng cáo — có bất kỳ sàn quảng cáo nào
  ads_advice: ["ads"],
  ads_auto: ["ads"],
  ads_wallet: ["ads"],
  ads_daily: ["ads"],
  ads_link: ["ads"],
  // Kho
  stockout: ["warehouse.products"],
  low_stock: ["warehouse.products"],
  // Gian hàng — nối lại gian là việc của chủ shop
  channel_disconnected: null,
  sync_stalled: null,
  koc: ["koc"],
  // Tài khoản & hệ thống
  plan: null,
  system_other: null,
};

const ALL_CATEGORIES: NotificationCategoryKey[] = NOTIFICATION_GROUPS.flatMap((g) => g.items.map((it) => it.key));

/** Các mục nhân viên có bộ quyền này được nhận (giữ thứ tự bảng nhóm). */
export function categoriesForPermissions(permissions: readonly string[]): NotificationCategoryKey[] {
  return ALL_CATEGORIES.filter((key) => {
    const need = CATEGORY_PERMISSIONS[key];
    return need !== null && need.some((p) => hasPermission(permissions, p));
  });
}

export interface StaffNotificationScope {
  /** Mục được nhận theo quyền; rỗng = nhân viên này không có chuông. */
  categories: NotificationCategoryKey[];
  /** Gian của shop mà nhân viên KHÔNG được giao. Rỗng = được giao đủ mọi gian. */
  forbiddenChannelIds: string[];
}

/**
 * Phạm vi thông báo của một nhân viên.
 * `staffChannelIds` = gian được giao (StaffChannel), `ownerChannelIds` = mọi gian của shop.
 */
export function staffNotificationScope(
  permissions: readonly string[],
  staffChannelIds: readonly string[],
  ownerChannelIds: readonly string[]
): StaffNotificationScope {
  const mine = new Set(staffChannelIds);
  return {
    categories: categoriesForPermissions(permissions),
    forbiddenChannelIds: ownerChannelIds.filter((id) => !mine.has(id)),
  };
}

/** Nhân viên có phạm vi này thấy thông báo này không (dùng cho tin đẩy — lọc trong bộ nhớ). */
export function staffCanSeeNotification(
  scope: StaffNotificationScope,
  n: { category: string | null; channelIds: readonly string[] }
): boolean {
  if (!n.category || !(scope.categories as string[]).includes(n.category)) return false;
  if (scope.forbiddenChannelIds.length === 0) return true; // được giao đủ gian
  if (n.channelIds.length === 0) return false; // chuyện của cả shop
  const forbidden = new Set(scope.forbiddenChannelIds);
  return n.channelIds.every((id) => !forbidden.has(id));
}

/**
 * Điều kiện SQL tương đương staffCanSeeNotification — ghép vào `where` của danh
 * sách, số chưa đọc và đánh dấu đã đọc. HAI HÀM PHẢI CÙNG LUẬT (test so từng ca).
 */
export function staffNotificationWhere(scope: StaffNotificationScope): Prisma.NotificationWhereInput {
  const byCategory: Prisma.NotificationWhereInput = { category: { in: scope.categories } };
  if (scope.forbiddenChannelIds.length === 0) return byCategory;
  return {
    ...byCategory,
    channelIds: { isEmpty: false },
    NOT: { channelIds: { hasSome: scope.forbiddenChannelIds } },
  };
}

/** Chuẩn hóa danh sách gian nơi phát đưa vào: bỏ rỗng, bỏ trùng. */
export function cleanChannelIds(raw: readonly (string | null | undefined)[] | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))];
}
