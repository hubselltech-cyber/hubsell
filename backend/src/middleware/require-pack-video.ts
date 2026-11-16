// ============================================================
// Gác nhóm /api/pack-videos: chỉ tài khoản được mở Video đóng hàng mới đi tiếp.
// Đặt SAU requireAuth (cần req.userEmail / req.userId / req.ownerId).
// Trả 403 kèm code FEATURE_LOCKED — web / app bắt code này để vẽ trạng thái "chưa mở".
// ============================================================

import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth";
import { packVideoAccess } from "../services/pack-video/access";

export function requirePackVideo(req: AuthRequest, res: Response, next: NextFunction): void {
  // requireAuth đặt ownerId = id chủ shop; trùng userId nghĩa là chính chủ đang đăng nhập.
  const staffOwnerId = req.ownerId && req.ownerId !== req.userId ? req.ownerId : null;
  if (packVideoAccess({ email: req.userEmail, ownerId: staffOwnerId }) !== "open") {
    res.status(403).json({
      error: "Tính năng Video đóng hàng chưa mở cho tài khoản này",
      code: "FEATURE_LOCKED",
    });
    return;
  }
  next();
}
