// ============================================================
// CỬA của nhóm /api/pack-videos (M2.1, 26/11/2026 — docs/VIDEO-DONG-HANG-THIET-KE.md mục 38).
//
// Hai lối vào, cùng ra một kiểu request (userId / ownerId / allowedChannelIds / packVideoCaps):
//  1. VÉ PHIÊN QUAY — chỉ ở các ĐƯỜNG NÓNG của màn quay (hỏi tem, xin vé tải, ký mảnh, báo tải xong — cả bản 2 /v2) và chỉ khi
//     tiêu đề X-Pack-Session mang một vé còn hạn: KHÔNG đọc database (lib/pack-session-ticket.ts).
//  2. XÁC THỰC THƯỜNG — mọi trường hợp còn lại: requireAuth → requirePackVideo như trước 26/11.
// Vé hỏng / hết hạn / cổng không cho → KHÔNG trả lỗi, đi lối 2 (máy quay luôn gửi kèm token đăng nhập) — vé chỉ là
// lối tắt, không tạo thêm cách hỏng mới. App bản cũ không biết vé vẫn chạy nguyên.
// ============================================================

import type { NextFunction, Response } from "express";
import { Role } from "@prisma/client";
import { packSessionEnabled, packVideoGate } from "../config/pack-video";
import { isR2Configured } from "../integrations/r2/client";
import { verifyPackSessionTicket } from "../lib/pack-session-ticket";
import { requireAuth } from "./auth";
import { requirePackVideo, type PackVideoRequest } from "./require-pack-video";

export const PACK_SESSION_HEADER = "x-pack-session";

export type PackSessionRequest = PackVideoRequest & {
  /** true = lượt này vào bằng vé phiên quay (không qua requireAuth). */
  viaPackSession?: boolean;
};

/**
 * Đường nóng của màn quay — `path` là phần sau /api/pack-videos. Thuần, để test được.
 * Bản 2 (M2.4): POST /v2 khai riêng; /v2/parts + /v2/complete khớp sẵn khuôn "/<một đoạn>/(parts|complete)".
 */
export function isPackHotPath(method: string, path: string): boolean {
  if (method === "GET") return path === "/match";
  if (method !== "POST") return false;
  return path === "/" || path === "" || path === "/v2" || /^\/[A-Za-z0-9_-]{1,64}\/(parts|complete)$/.test(path);
}

export function packVideoGateway(req: PackSessionRequest, res: Response, next: NextFunction): void {
  const raw = req.headers[PACK_SESSION_HEADER];
  if (typeof raw === "string" && raw && packSessionEnabled() && isPackHotPath(req.method, req.path)) {
    const t = verifyPackSessionTicket(raw);
    // Công tắc tắt gấp + cổng thí điểm + cấu hình kho: kiểm MỖI lượt (đọc env, không tốn database).
    const gate = packVideoGate();
    if (t && isR2Configured() && gate !== "off" && (gate === "all" || t.pilot) && (t.pack || t.unbox)) {
      req.userId = t.userId;
      req.ownerId = t.ownerId;
      req.userRole = t.staff ? Role.SALES : Role.ADMIN;
      req.userEmail = null;
      req.isPlatformAdmin = false;
      req.permissions = [];
      req.allowedChannelIds = t.allowedChannelIds;
      req.packVideoCaps = { pack: t.pack, unbox: t.unbox, manage: !t.staff };
      req.viaPackSession = true;
      next();
      return;
    }
  }
  void requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    void requirePackVideo(req, res, next);
  });
}
