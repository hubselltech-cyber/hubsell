// ============================================================
// VIDEO ĐÓNG HÀNG — CỔNG MỞ TÍNH NĂNG (một nguồn duy nhất)
//
// Anh Trung 16/11/2026: "Phần video đóng hàng này chỉ mở cho một mình tài khoản admin@hubsell.vn,
// còn lại mọi người sẽ chỉ thấy mờ."
//
// Mọi nơi hỏi "tài khoản này có được dùng không" đều gọi packVideoAccess():
//  · middleware/require-pack-video.ts chặn cả nhóm /api/pack-videos;
//  · routes/auth.ts trả `features.packVideo` cho web / app vẽ mục mờ hay mở.
// Web và app chỉ HIỂN THỊ theo câu trả lời này; lớp chặn thật là middleware.
//
// "open" cần ĐỦ BA điều — thiếu một là "locked" (hỏng thì đóng):
//  1. email nằm trong danh sách thí điểm;
//  2. là CHỦ tài khoản (ownerId rỗng) — nhân viên của tài khoản thí điểm cũng bị khóa;
//  3. kho R2 đã cấu hình đủ bốn biến.
// Khi mở cho khách thật: đổi RUỘT hàm này sang bảng cài đặt theo chủ shop, chữ ký giữ nguyên.
// ============================================================

import { PACK_VIDEO_PILOT_EMAILS } from "../../config/pack-video";
import { isR2Configured } from "../../integrations/r2/client";

export type PackVideoAccess = "open" | "locked";

export interface PackVideoAccessSubject {
  email: string | null | undefined;
  /** null / undefined = chủ tài khoản; có giá trị = nhân viên của chủ shop đó. */
  ownerId: string | null | undefined;
}

export function packVideoAccess(
  user: PackVideoAccessSubject,
  opts: { pilotEmails?: readonly string[]; r2Configured?: boolean } = {}
): PackVideoAccess {
  const pilot = opts.pilotEmails ?? PACK_VIDEO_PILOT_EMAILS;
  const email = user.email?.trim().toLowerCase();
  if (!email || !pilot.some((e) => e.toLowerCase() === email)) return "locked";
  if (user.ownerId) return "locked";
  if (!(opts.r2Configured ?? isR2Configured())) return "locked";
  return "open";
}

/** Khối `features` gắn vào đối tượng user mà /api/auth trả về. */
export function userFeatures(user: PackVideoAccessSubject): { packVideo: PackVideoAccess } {
  return { packVideo: packVideoAccess(user) };
}
