// ============================================================
// Gác nhóm /api/pack-videos: chỉ người được quay Video đóng hàng mới đi tiếp.
// Đặt SAU requireAuth (cần req.userEmail / req.userId / req.ownerId / req.permissions).
// Trả 403 kèm code FEATURE_LOCKED — web / app bắt code này để vẽ trạng thái "chưa mở".
//
// Qua cửa thì gắn `req.packVideoCaps` (access.ts) — từng đường trong routes/pack-videos.ts tự kiểm thêm:
// quay đóng hàng / khui hàng / việc của chủ shop (tải về, thống kê, đơn hoàn, sổ tiền, mua giờ).
// 24/11/2026: nhân viên của chủ đã mở được vào theo quyền có sẵn (docs VIDEO-DONG-HANG-THIET-KE mục 28).
//
// Qua cửa rồi thì bảo đảm chủ shop đã nhận GIỜ QUAY TẶNG (anh Trung 21/11/2026: "tặng cho mỗi khách hàng 2 giờ
// quay miễn phí") — một lần cho mỗi chủ shop, chống trùng bằng chỉ mục duy nhất (services/pack-video/hours.ts).
// Tặng hỏng (database trục trặc) KHÔNG chặn request: ghi log rồi đi tiếp, request sau tự thử lại.
// ============================================================

import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth";
import { capsAccess, type PackVideoCaps } from "../services/pack-video/access";
import { ensureWelcomeHours } from "../services/pack-video/hours";
import { capsForUser } from "../services/pack-video/subject";

export type PackVideoRequest = AuthRequest & { packVideoCaps?: PackVideoCaps };

export async function requirePackVideo(req: PackVideoRequest, res: Response, next: NextFunction): Promise<void> {
  let caps: PackVideoCaps;
  try {
    caps = await capsForUser({
      id: req.userId ?? "",
      email: req.userEmail ?? null,
      // requireAuth đặt ownerId = id chủ shop; trùng userId nghĩa là chính chủ đang đăng nhập.
      ownerId: req.ownerId ?? null,
      permissions: req.permissions,
    });
  } catch (err) {
    next(err);
    return;
  }
  if (capsAccess(caps) !== "open") {
    res.status(403).json({
      error: "Tính năng Video đóng hàng chưa mở cho tài khoản này",
      code: "FEATURE_LOCKED",
    });
    return;
  }
  req.packVideoCaps = caps;
  // req.ownerId = id CHỦ shop (kể cả khi nhân viên gọi) — giờ tặng ghi cho chủ shop.
  const ownerId = req.ownerId ?? req.userId;
  if (!ownerId) {
    next();
    return;
  }
  ensureWelcomeHours(ownerId)
    .catch((err) => console.error("[pack-video] tặng giờ quay hỏng:", err instanceof Error ? err.message : err))
    .finally(() => next());
}
