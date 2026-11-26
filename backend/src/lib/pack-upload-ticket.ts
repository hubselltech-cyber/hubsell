// ============================================================
// VIDEO ĐÓNG HÀNG — VÉ TẢI (M2.4, 26/11/2026 — docs/VIDEO-DONG-HANG-THIET-KE.md mục 29.5)
//
// Đường bản 2 KHÔNG ghi database lúc "đã quay xong": máy chủ ký một vé mang sẵn mọi thứ cần để ghi dòng sổ SAU, lúc app
// báo "tải xong" (services/pack-video/upload-v2.ts). Vé là JWT ĐÃ KÝ, KHÔNG MÃ HÓA — app đọc được nội dung nhưng sửa
// một chữ là hỏng chữ ký. Không lưu trạng thái ở máy chủ: máy web nào cũng kiểm được vé.
//
// Vé tải KHÔNG phải vé phiên quay, cũng không phải token đăng nhập:
//  · `aud` riêng ("pack-video-upload") → kiểm vé phiên quay (đòi "pack-video-session") từ chối vé tải, và ngược lại;
//  · không có `sub` → requireAuth từ chối; token đăng nhập không có `aud` → không giả làm vé tải được.
// ĐƯỜNG DẪN TỆP không nằm trong vé: người dùng vé tự dựng lại từ (chủ shop, ngày, id) bằng buildPackVideoKey.
// Thuần (không đọc database, không đọc env ngoài khóa ký) để test được.
// ============================================================

import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import { PACK_UPLOAD_TICKET_TTL_SEC } from "../config/pack-video";
import { packTicketSecret } from "./pack-session-ticket";
import { PACK_VIDEO_KINDS, type PackVideoKind } from "./pack-video-rules";

const AUDIENCE = "pack-video-upload";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Mọi thứ cần để ghi MỘT dòng pack_videos lúc báo tải xong. */
export interface PackUploadClaims {
  id: string;
  /** Ngày tạo vé theo giờ VN của máy chủ (yyyy-mm-dd) — khóa chia mảnh + phần ngày của đường dẫn tệp. */
  dateKey: string;
  ownerId: string;
  /** Người quay (recordedById). */
  userId: string;
  /** Người quay là nhân viên (không phải chủ shop). */
  staff: boolean;
  clientId: string;
  trackingCode: string;
  kind: PackVideoKind;
  recordedAt: Date;
  durationSec: number;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  deviceName: string | null;
  /** Ba trường dưới trống = tem chưa khớp được đơn nào lúc xin vé. */
  channelId: string | null;
  orderId: string | null;
  orderCode: string | null;
  /** Lượt tải theo mảnh của R2 — chỉ có với tệp tải theo mảnh. */
  uploadId: string | null;
}

/**
 * Id video CỐ ĐỊNH theo (chủ shop, clientId): 32 ký tự hex đầu của HMAC-SHA256 bằng khóa ký vé. Xin vé lại cho cùng một
 * clip trong cùng ngày ra cùng id → cùng đường dẫn tệp, không bỏ lại tệp mồ côi trên kho.
 */
export function packUploadIdOf(ownerId: string, clientId: string): string {
  return createHmac("sha256", packTicketSecret()).update(`${ownerId}|${clientId}`).digest("hex").slice(0, 32);
}

export function signPackUploadTicket(
  c: PackUploadClaims,
  opts: { ttlSec?: number; now?: Date } = {}
): { ticket: string; expiresAt: string } {
  const ttlSec = opts.ttlSec ?? PACK_UPLOAD_TICKET_TTL_SEC;
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  // Tên trường ngắn để vé gọn (vé đi kèm thân của mỗi lượt ký mảnh / báo xong).
  const ticket = jwt.sign(
    {
      id: c.id,
      dk: c.dateKey,
      oid: c.ownerId,
      uid: c.userId,
      st: c.staff ? 1 : 0,
      cid: c.clientId,
      tc: c.trackingCode,
      k: c.kind,
      ra: c.recordedAt.getTime(),
      d: c.durationSec,
      sz: c.sizeBytes,
      w: c.width,
      h: c.height,
      dn: c.deviceName,
      ch: c.channelId,
      or: c.orderId,
      oc: c.orderCode,
      up: c.uploadId,
      iat,
      exp: iat + ttlSec,
    },
    packTicketSecret(),
    { audience: AUDIENCE }
  );
  return { ticket, expiresAt: new Date((iat + ttlSec) * 1000).toISOString() };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isPosIntOrNull = (v: unknown): v is number | null => v === null || isPosInt(v);

/** Vé hợp lệ → nội dung vé; sai chữ ký / hết hạn / không phải vé tải / thiếu trường → null. */
export function verifyPackUploadTicket(raw: string, now: Date = new Date()): PackUploadClaims | null {
  try {
    const p = jwt.verify(raw, packTicketSecret(), {
      audience: AUDIENCE,
      clockTimestamp: Math.floor(now.getTime() / 1000),
    }) as jwt.JwtPayload;
    if (!isStr(p.id) || !isStr(p.dk) || !DATE_RE.test(p.dk) || !isStr(p.oid) || !isStr(p.uid)) return null;
    if (!isStr(p.cid) || !isStr(p.tc) || !PACK_VIDEO_KINDS.includes(p.k as PackVideoKind)) return null;
    if (typeof p.ra !== "number" || !Number.isFinite(p.ra) || !isPosInt(p.d) || !isPosInt(p.sz)) return null;
    if (!isPosIntOrNull(p.w) || !isPosIntOrNull(p.h) || !isStrOrNull(p.dn)) return null;
    if (!isStrOrNull(p.ch) || !isStrOrNull(p.or) || !isStrOrNull(p.oc) || !isStrOrNull(p.up)) return null;
    return {
      id: p.id,
      dateKey: p.dk,
      ownerId: p.oid,
      userId: p.uid,
      staff: p.st === 1,
      clientId: p.cid,
      trackingCode: p.tc,
      kind: p.k as PackVideoKind,
      recordedAt: new Date(p.ra),
      durationSec: p.d,
      sizeBytes: p.sz,
      width: p.w,
      height: p.h,
      deviceName: p.dn,
      channelId: p.ch,
      orderId: p.or,
      orderCode: p.oc,
      uploadId: p.up,
    };
  } catch {
    return null;
  }
}
