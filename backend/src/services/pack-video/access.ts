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

import { PACK_VIDEO_PILOT_EMAILS, packVideoGate, type PackVideoGate } from "../../config/pack-video";
import { hasPermission } from "../../config/permission-registry";
import { isR2Configured } from "../../integrations/r2/client";

/** "consent" = cổng đã mở cho chủ shop này nhưng chủ shop CHƯA bấm đồng ý lần đầu (consent.ts) — chưa gọi được API. */
export type PackVideoAccess = "open" | "locked" | "consent";

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
  /** Gói của CHỦ SHOP còn dùng được (chưa bị khóa vì hết hạn quá ân hạn). Không đưa vào = coi như không. */
  ownerPlanActive?: boolean;
}

interface AccessOpts {
  pilotEmails?: readonly string[];
  r2Configured?: boolean;
  gate?: PackVideoGate;
}

/** Email này có trong danh sách thí điểm không (không phân biệt hoa thường). */
export function isPackVideoPilot(ownerEmail: string | null | undefined, pilotEmails?: readonly string[]): boolean {
  const email = ownerEmail?.trim().toLowerCase();
  return !!email && (pilotEmails ?? PACK_VIDEO_PILOT_EMAILS).some((e) => e.toLowerCase() === email);
}

/**
 * Chủ shop này đã được mở tính năng chưa: kho R2 đã cấu hình + cổng không "off" + (tài khoản thí điểm, hoặc cổng
 * "all" và gói còn dùng được). Hỏng thì đóng.
 */
export function ownerPackVideoOpen(
  ownerEmail: string | null | undefined,
  opts: AccessOpts & { planActive?: boolean } = {}
): boolean {
  if (!(opts.r2Configured ?? isR2Configured())) return false;
  const gate = opts.gate ?? packVideoGate();
  if (gate === "off") return false;
  if (isPackVideoPilot(ownerEmail, opts.pilotEmails)) return true;
  return gate === "all" && opts.planActive === true;
}

export function packVideoCaps(subject: PackVideoAccessSubject, opts: AccessOpts = {}): PackVideoCaps {
  if (!ownerPackVideoOpen(subject.ownerEmail, { ...opts, planActive: subject.ownerPlanActive })) {
    return { ...NO_PACK_VIDEO_CAPS };
  }
  if (!subject.isStaff) return { pack: true, unbox: true, manage: true };
  const perms = subject.permissions ?? [];
  return { pack: hasPermission(perms, "orders"), unbox: hasPermission(perms, "warehouse.returns"), manage: false };
}

/** Cổng tổng: quay được ít nhất một kiểu thì "open" (vào được nhóm /api/pack-videos, mục web hết mờ). */
export function capsAccess(caps: PackVideoCaps): "open" | "locked" {
  return caps.pack || caps.unbox ? "open" : "locked";
}

export function packVideoAccess(subject: PackVideoAccessSubject, opts: AccessOpts = {}): "open" | "locked" {
  return capsAccess(packVideoCaps(subject, opts));
}

export interface UserFeatures {
  packVideo: PackVideoAccess;
  packVideoCaps: PackVideoCaps;
}

/** Khối `features` gắn vào đối tượng user mà /api/auth trả về (tính sẵn từ chủ thể). */
export function featuresOf(
  subject: PackVideoAccessSubject,
  opts: AccessOpts & { consented?: boolean } = {}
): UserFeatures {
  const caps = packVideoCaps(subject, opts);
  if (capsAccess(caps) !== "open") return { packVideo: "locked", packVideoCaps: caps };
  // Cổng mở mà chủ shop chưa đồng ý: web hiện thẻ đồng ý; quyền thao tác chưa cấp cho tới lúc đó.
  if (opts.consented === false) return { packVideo: "consent", packVideoCaps: { ...NO_PACK_VIDEO_CAPS } };
  return { packVideo: "open", packVideoCaps: caps };
}
