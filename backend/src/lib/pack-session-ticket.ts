// ============================================================
// VIDEO ĐÓNG HÀNG — VÉ PHIÊN QUAY (M2.1, 26/11/2026 — docs/VIDEO-DONG-HANG-THIET-KE.md mục 29.4 + 38)
//
// Màn quay xin MỘT vé qua xác thực thường (POST /api/pack-videos/session), rồi gửi kèm vé ở các đường nóng. Vé là
// JWT ngắn hạn mang sẵn: chủ shop, người quay, quyền đóng / khui, gian được giao → đường nóng KHÔNG đọc database
// để xác thực. Không lưu trạng thái ở máy chủ: máy web nào cũng kiểm được vé (thêm máy là thêm sức).
//
// Vé KHÔNG phải token đăng nhập và ngược lại:
//  · vé mang `aud` riêng, KHÔNG có `sub` → requireAuth (đòi `sub`) từ chối vé;
//  · kiểm vé đòi đúng `aud` → token đăng nhập (không có `aud`) không giả làm vé được.
// Thuần (không đọc database, không đọc env ngoài khóa ký) để test được.
// ============================================================

import jwt from "jsonwebtoken";
import { PACK_SESSION_TTL_SEC } from "../config/pack-video";

const AUDIENCE = "pack-video-session";
/** Trần số gian ghi trong vé — nhân viên được giao nhiều hơn thế thì không cấp vé (đi đường xác thực thường). */
export const PACK_SESSION_MAX_CHANNELS = 200;

export interface PackSessionClaims {
  userId: string;
  ownerId: string;
  /** true = nhân viên (chỉ chạm video mình quay, không có việc của chủ shop). */
  staff: boolean;
  pack: boolean;
  unbox: boolean;
  /** Chủ shop là tài khoản thí điểm — để cổng "pilot" vẫn kiểm được mà không đọc database. */
  pilot: boolean;
  /** null = mọi gian của chủ shop; mảng = chỉ các gian này (nhân viên). */
  allowedChannelIds: string[] | null;
}

/** Khóa ký vé của Video đóng hàng — vé phiên quay ở đây và vé tải (lib/pack-upload-ticket.ts) dùng chung. */
export function packTicketSecret(env: NodeJS.ProcessEnv = process.env): string {
  // Cùng khóa với token đăng nhập (middleware/auth.ts); tách bằng `aud`, không thêm biến môi trường mới.
  return env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";
}
const secretOf = packTicketSecret;

export function signPackSessionTicket(
  claims: PackSessionClaims,
  opts: { ttlSec?: number; now?: Date } = {}
): { ticket: string; expiresAt: string; ttlSec: number } {
  const ttlSec = opts.ttlSec ?? PACK_SESSION_TTL_SEC;
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const ticket = jwt.sign(
    {
      uid: claims.userId,
      oid: claims.ownerId,
      st: claims.staff ? 1 : 0,
      p: claims.pack ? 1 : 0,
      x: claims.unbox ? 1 : 0,
      pl: claims.pilot ? 1 : 0,
      ch: claims.allowedChannelIds,
      iat,
      exp: iat + ttlSec,
    },
    secretOf(),
    { audience: AUDIENCE }
  );
  return { ticket, expiresAt: new Date((iat + ttlSec) * 1000).toISOString(), ttlSec };
}

/** Vé hợp lệ → quyền ghi trong vé; sai chữ ký / hết hạn / không phải vé → null (người gọi quay về xác thực thường). */
export function verifyPackSessionTicket(raw: string, now: Date = new Date()): PackSessionClaims | null {
  try {
    const p = jwt.verify(raw, secretOf(), {
      audience: AUDIENCE,
      clockTimestamp: Math.floor(now.getTime() / 1000),
    }) as jwt.JwtPayload;
    if (typeof p.uid !== "string" || !p.uid || typeof p.oid !== "string" || !p.oid) return null;
    const ch = p.ch;
    if (ch !== null && !(Array.isArray(ch) && ch.every((c) => typeof c === "string"))) return null;
    return {
      userId: p.uid,
      ownerId: p.oid,
      staff: p.st === 1,
      pack: p.p === 1,
      unbox: p.x === 1,
      pilot: p.pl === 1,
      allowedChannelIds: ch as string[] | null,
    };
  } catch {
    return null;
  }
}
