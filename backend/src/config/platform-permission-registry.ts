/**
 * PLATFORM PERMISSION REGISTRY — cây phân quyền NHÂN VIÊN ĐIỀU HÀNH HUBSELL.
 *
 * ⚠️ GIỮ ĐỒNG BỘ với bản phía giao diện: frontend/src/lib/permission-registry.ts
 *    (khối HQ_*) — hai package riêng nên không import chéo được.
 *
 * Khác permission-registry.ts (cây quyền nhân viên CỦA SHOP): cây này dành cho
 * nhân viên của CHÍNH công ty Hubsell — tài khoản do chủ nền tảng (cờ
 * isPlatformAdmin, hiện là dev@hubsell.tech) tạo qua trang Nhân viên. Họ làm
 * việc trên khu /admin (dữ liệu TOÀN nền tảng), không đụng nghiệp vụ bán hàng
 * của bất kỳ shop nào.
 *
 * Quy ước chung với cây shop:
 *  - DB (User.permissions) CHỈ LƯU KHÓA LÁ; mọi khóa đều mang tiền tố "hq."
 *    nên không bao giờ va chạm với khóa của cây shop.
 *  - "hq" (không chấm) là khóa NHÓM: có bất kỳ lá hq.* nào là thuộc nhóm —
 *    dùng gác cửa mount /api/admin.
 */

import type { PermissionNode } from "./permission-registry";

export const HQ_PERMISSION_TREE: PermissionNode[] = [
  { key: "hq.overview", label: "Tổng quan hệ thống" },
  { key: "hq.customers", label: "Khách hàng đăng ký" },
  { key: "hq.finance", label: "Kế toán nội bộ" },
  { key: "hq.marketing", label: "Marketing & Giới thiệu" },
  { key: "hq.webhooks", label: "Nhật ký Webhook" },
];

/** Mọi khóa LÁ hợp lệ của cây HQ. */
export const ALL_HQ_LEAF_KEYS: readonly string[] = HQ_PERMISSION_TREE.flatMap(
  (n) => (n.children ? n.children.map((c) => c.key) : [n.key])
);

const HQ_LEAF_SET = new Set(ALL_HQ_LEAF_KEYS);

/**
 * Lọc payload quyền từ client về danh sách lá HQ hợp lệ (cùng triết lý
 * sanitizePermissions của cây shop: khóa lạ bỏ trong im lặng).
 */
export function sanitizeHqPermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((k): k is string => typeof k === "string"));
  return ALL_HQ_LEAF_KEYS.filter((k) => wanted.has(k));
}

/**
 * Nhân viên điều hành có quyền `key` không?
 *  - key là LÁ  → phải có đúng lá đó.
 *  - key là NHÓM ("hq") → có BẤT KỲ lá hq.* nào.
 */
export function hasHqPermission(perms: readonly string[], key: string): boolean {
  if (HQ_LEAF_SET.has(key)) return perms.includes(key);
  const prefix = `${key}.`;
  return perms.some((p) => p === key || p.startsWith(prefix));
}

/** PRESET 1-click trên hộp thoại Phân quyền của tài khoản điều hành (khớp FE). */
export const HQ_PERMISSION_PRESETS: {
  key: string;
  label: string;
  description: string;
  permissions: string[];
}[] = [
  {
    key: "HQ_SALE",
    label: "Sale / CSKH khách hàng",
    description: "Danh sách chủ shop đăng ký — chăm sóc, tư vấn khách hàng mới.",
    permissions: ["hq.customers"],
  },
  {
    key: "HQ_ACCOUNTANT",
    label: "Kế toán nội bộ",
    description: "Ví Hubsell toàn hệ thống + duyệt lệnh rút tiền hoa hồng giới thiệu.",
    permissions: ["hq.finance"],
  },
  {
    key: "HQ_MARKETING",
    label: "Marketing / Tiếp thị",
    description: "Hiệu quả chương trình giới thiệu + danh sách khách hàng đăng ký.",
    permissions: ["hq.marketing", "hq.customers"],
  },
  {
    key: "HQ_TECH",
    label: "Kỹ thuật vận hành",
    description: "Tổng quan hệ thống và nhật ký webhook — theo dõi sức khỏe nền tảng.",
    permissions: ["hq.overview", "hq.webhooks"],
  },
  {
    key: "HQ_MANAGER",
    label: "Quản lý điều hành",
    description: "Toàn bộ khu Hệ thống Hubsell.",
    permissions: [...ALL_HQ_LEAF_KEYS],
  },
];
