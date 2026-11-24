// ============================================================
// VIDEO ĐÓNG HÀNG — CỔNG MỞ TÍNH NĂNG (một nguồn duy nhất)
//
// Anh Trung 16/11/2026: "Phần video đóng hàng này chỉ mở cho một mình tài khoản admin@hubsell.vn,
// còn lại mọi người sẽ chỉ thấy mờ."
// Anh Trung 24/11/2026 (docs/VIDEO-DONG-HANG-THIET-KE.md mục 28): mở cho NHÂN VIÊN của chủ đã được mở,
// theo quyền CÓ SẴN, không thêm ô quyền mới:
//  · quyền "Đơn hàng" (`orders`)                → quay video ĐÓNG hàng;
//  · quyền "Đối soát đơn hoàn" (`warehouse.returns`) → quay video KHUI hàng hoàn;
//  · ai quay được thì XEM được danh sách video của shop (theo gian được giao), KHÔNG tải về;
//  · thấy số giờ còn lại, KHÔNG thấy sổ tiền / không mua giờ;
//  · tải về, thống kê, tab đơn hoàn, mua giờ: chỉ CHỦ shop (`manage`).
//
// Mọi nơi hỏi "tài khoản này được làm gì" đều gọi packVideoCaps():
//  · middleware/require-pack-video.ts chặn cả nhóm /api/pack-videos + gắn quyền cho từng đường;
//  · routes/auth.ts trả `features` cho web / app vẽ mục mờ / mở, nút nào hiện.
// Web và app chỉ HIỂN THỊ theo câu trả lời này; lớp chặn thật là máy chủ.
//
// Cổng mở cần ĐỦ: email của CHỦ SHOP nằm trong danh sách thí điểm + kho R2 đã cấu hình đủ bốn biến;
// nhân viên thì thêm: có ít nhất một trong hai quyền trên. Thiếu một là khóa (hỏng thì đóng).
// Khi mở cho khách thật: đổi RUỘT hàm này sang bảng cài đặt theo chủ shop, chữ ký giữ nguyên.
// ============================================================

import { PACK_VIDEO_PILOT_EMAILS } from "../../config/pack-video";
import { hasPermission } from "../../config/permission-registry";
import { isR2Configured } from "../../integrations/r2/client";

export type PackVideoAccess = "open" | "locked";

/** Người đang đăng nhập được làm gì với Video đóng hàng. Cổng khóa = cả ba `false`. */
export interface PackVideoCaps {
  /** Quay video đóng hàng (PACK). */
  pack: boolean;
  /** Quay video khui hàng hoàn (UNBOX). */
  unbox: boolean;
  /** Việc của chủ shop: tải video về, thống kê, tab đơn hoàn, sổ tiền giờ quay, mua giờ. */
  manage: boolean;
}

export const NO_PACK_VIDEO_CAPS: Readonly<PackVideoCaps> = Object.freeze({ pack: false, unbox: false, manage: false });

export interface PackVideoAccessSubject {
  /** Email của CHỦ SHOP (chủ đăng nhập = email của chính họ; nhân viên = email của chủ họ). */
  ownerEmail: string | null | undefined;
  /** true = người đăng nhập là nhân viên của chủ shop đó. */
  isStaff: boolean;
  /** Cây quyền của nhân viên (bỏ qua với chủ shop). */
  permissions?: readonly string[] | null;
}

interface AccessOpts {
  pilotEmails?: readonly string[];
  r2Configured?: boolean;
}

/** Chủ shop này đã được mở tính năng chưa (danh sách thí điểm + kho đã cấu hình). */
export function ownerPackVideoOpen(ownerEmail: string | null | undefined, opts: AccessOpts = {}): boolean {
  const pilot = opts.pilotEmails ?? PACK_VIDEO_PILOT_EMAILS;
  const email = ownerEmail?.trim().toLowerCase();
  if (!email || !pilot.some((e) => e.toLowerCase() === email)) return false;
  return opts.r2Configured ?? isR2Configured();
}

export function packVideoCaps(subject: PackVideoAccessSubject, opts: AccessOpts = {}): PackVideoCaps {
  if (!ownerPackVideoOpen(subject.ownerEmail, opts)) return { ...NO_PACK_VIDEO_CAPS };
  if (!subject.isStaff) return { pack: true, unbox: true, manage: true };
  const perms = subject.permissions ?? [];
  return { pack: hasPermission(perms, "orders"), unbox: hasPermission(perms, "warehouse.returns"), manage: false };
}

/** Cổng tổng: quay được ít nhất một kiểu thì "open" (vào được nhóm /api/pack-videos, mục web hết mờ). */
export function capsAccess(caps: PackVideoCaps): PackVideoAccess {
  return caps.pack || caps.unbox ? "open" : "locked";
}

export function packVideoAccess(subject: PackVideoAccessSubject, opts: AccessOpts = {}): PackVideoAccess {
  return capsAccess(packVideoCaps(subject, opts));
}

export interface UserFeatures {
  packVideo: PackVideoAccess;
  packVideoCaps: PackVideoCaps;
}

/** Khối `features` gắn vào đối tượng user mà /api/auth trả về (tính sẵn từ chủ thể). */
export function featuresOf(subject: PackVideoAccessSubject, opts: AccessOpts = {}): UserFeatures {
  const caps = packVideoCaps(subject, opts);
  return { packVideo: capsAccess(caps), packVideoCaps: caps };
}
