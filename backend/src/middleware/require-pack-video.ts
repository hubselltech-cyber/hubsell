// ============================================================
// Gác nhóm /api/pack-videos: chỉ tài khoản được mở Video đóng hàng mới đi tiếp.
// Đặt SAU requireAuth (cần req.userEmail / req.userId / req.ownerId).
// Trả 403 kèm code FEATURE_LOCKED — web / app bắt code này để vẽ trạng thái "chưa mở".
//
// Qua cửa rồi thì bảo đảm chủ shop đã nhận GIỜ QUAY TẶNG (anh Trung 21/11/2026: "tặng cho mỗi khách hàng 2 giờ
// quay miễn phí") — một lần cho mỗi chủ shop, chống trùng bằng chỉ mục duy nhất (services/pack-video/hours.ts).
// Tặng hỏng (database trục trặc) KHÔNG chặn request: ghi log rồi đi tiếp, request sau tự thử lại.
// ============================================================

import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth";
import { packVideoAccess } from "../services/pack-video/access";
import { ensureWelcomeHours } from "../services/pack-video/hours";

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
  // req.ownerId = id CHỦ shop (kể cả khi sau này mở cho nhân viên) — giờ tặng ghi cho chủ shop.
  const ownerId = req.ownerId ?? req.userId;
  if (!ownerId) {
    next();
    return;
  }
  ensureWelcomeHours(ownerId)
    .catch((err) => console.error("[pack-video] tặng giờ quay hỏng:", err instanceof Error ? err.message : err))
    .finally(() => next());
}
