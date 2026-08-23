/**
 * CỔNG THÍ ĐIỂM MODULE HÓA ĐƠN & THUẾ (anh Trung chốt 23/08/2026).
 *
 * Tích hợp MISA meInvoice mới thông sandbox — trước khi mở cho khách, toàn bộ
 * module (cấu hình kết nối, thuế bổ sung, báo cáo, PHÁT HÀNH hóa đơn) chỉ mở
 * cho đúng danh sách tài khoản thí điểm dưới đây để anh Trung theo dõi và test.
 *
 * Chặn theo EMAIL CỦA CHÍNH NGƯỜI ĐĂNG NHẬP (req.userEmail): nhân viên
 * "chủ/nhânviên" không có email nên mặc định cũng bị chặn — đúng chủ đích,
 * thí điểm không mở cho nhân viên. FE ẩn menu theo cùng danh sách (mirror ở
 * frontend/src/lib/feature-flags.ts) nhưng lớp chặn thật là ở đây.
 *
 * Mở rộng thí điểm = thêm email vào TAX_PILOT_EMAILS (cả 2 file) — khi mở
 * thương mại thì gỡ middleware này khỏi app.ts.
 */

import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth";

export const TAX_PILOT_EMAILS = new Set(["admin@hubsell.vn"]);

/** Tài khoản này có trong danh sách thí điểm Hóa đơn & Thuế không? */
export function isTaxPilotUser(email: string | null | undefined): boolean {
  return !!email && TAX_PILOT_EMAILS.has(email.toLowerCase());
}

/** Middleware chặn 403 mọi tài khoản ngoài danh sách thí điểm. */
export function requireTaxPilot(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (isTaxPilotUser(req.userEmail)) {
    next();
    return;
  }
  res.status(403).json({
    error:
      "Module Hóa đơn & Thuế đang chạy thí điểm nội bộ, chưa mở cho tài khoản này.",
    code: "TAX_PILOT_ONLY",
  });
}
