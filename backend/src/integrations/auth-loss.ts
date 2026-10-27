// ============================================================
// MẤT ỦY QUYỀN PHÍA SÀN — MỘT LUẬT CHUNG cho Shopee / TikTok / Lazada / Hubsell Ads (27/10/2026).
//
// Vì sao có tệp này: ba lần cùng một kiểu sự cố — gian vẫn "đang nối" trong khi sàn đã
// từ chối quyền, worker thử lại hàng trăm lượt, chủ shop không có nút Kết nối lại:
//   03/10 The White Active (55 lượt) + Shopee 321947895 (1.069 lượt): `shop_access_expired`;
//   26–27/10 HPGear VN (158 lượt / 25 giờ): `shop_no_linked` (chủ shop gỡ app).
// Gốc chung: mã chỉ nhận diện mất quyền bằng DANH SÁCH MÃ LỖI đã gặp; sàn trả mã mới là
// kẹt. Luật mới KHÔNG phụ thuộc mã:
//
//   1. Phân loại lỗi làm mới token theo NGUỒN, không theo mã (classifyRefreshFailure):
//      - "transient": không tới được sàn / sàn hỏng / trần gọi / Hubsell tự ném → không đếm;
//      - "lost_now": mã sàn nói thẳng "shop không còn ủy quyền app" → hạ ngay;
//      - "rejected": sàn TRẢ LỜI và từ chối bằng mã nghiệp vụ bất kỳ → đếm.
//   2. Đếm lần sàn từ chối theo gian (authRejectCount / authRejectSince) — chỉ khi gian còn
//      ACTIVE và vẫn cầm đúng refresh_token vừa bị từ chối (tiến trình khác đã làm mới xong
//      thì không đếm → không hạ oan vì đua rotate). Đủ AUTH_REJECT_MAX lần trải ít nhất
//      AUTH_REJECT_MIN_SPAN_MS → DISCONNECTED, lưu mã ở authLostReason cho thẻ gian.
//   3. Lưới thứ hai (workers/order-auto-sync.ts): lượt quét gặp lỗi LỚP QUYỀN (gateway
//      classify kind "auth") → ép làm mới token ở lượt kế (forceTokenRefresh) để luật 1–2
//      phán xử, không chờ access_token tự hết hạn (TikTok 7 ngày).
//   4. Làm mới thành công / ủy quyền lại → AUTH_REJECT_RESET.
//
// Ngưỡng (căn cứ ghi rõ, không chọn bừa): AUTH_REJECT_MAX = 3 và 30 phút = đúng ngưỡng
// SYNC_STALL_THRESHOLD (3 nhịp quét 10′) đã dùng cho thẻ "trễ đồng bộ" từ 09/2026; một
// gian khỏe không thể bị sàn từ chối cùng một refresh_token 3 lần trải 30 phút, còn đua
// rotate chỉ kéo dài vài giây và luôn đổi token trong DB.
// ============================================================
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { classifierFor, type Platform } from "../services/marketplace-gateway";

export const AUTH_REJECT_MAX = 3;
export const AUTH_REJECT_MIN_SPAN_MS = 30 * 60 * 1000;

/** Mã sàn nói thẳng shop không còn ủy quyền app → hạ ngay (prod 03/10/2026 + 26/10/2026). */
const AUTH_LOST_NOW_RE = /\b(shop_access_expired|shop_no_linked)\b/i;

/**
 * KHÔNG phải sàn từ chối: mạng, sàn hỏng, trần gọi, hoặc câu Hubsell tự ném (thiếu token,
 * sàn không trả token). Danh sách này là lớp "tạm thời" hữu hạn theo docs sàn — mọi mã
 * còn lại của sàn đều coi là từ chối.
 */
const TRANSIENT_RE =
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|fetch failed|timeout|HTTP 5\d\d|HTTP 429|error_rate_limit|error_server|error_system|error_internal|system busy|too many|36009003|36009002|ApiCallLimit|CallLimit|không trả token/i;

/** Hình dạng câu trả lời CÓ MÃ của sàn khi làm mới token (client.ts từng sàn đặt tiền tố). */
const PLATFORM_REPLY_RE = /^(Shopee refresh token lỗi:|TikTok auth lỗi \(code \d+\)|Lazada refresh token lỗi:)/;

export type RefreshFailureKind = "lost_now" | "rejected" | "transient";

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err ?? ""));

export function classifyRefreshFailure(err: unknown): RefreshFailureKind {
  const m = msgOf(err);
  if (AUTH_LOST_NOW_RE.test(m)) return "lost_now";
  if (TRANSIENT_RE.test(m)) return "transient";
  if (PLATFORM_REPLY_RE.test(m)) return "rejected";
  // Hình dạng lạ (lỗi Hubsell tự ném, lỗi chưa gặp) → không bao giờ hạ gian vì thứ chưa hiểu.
  return "transient";
}

/** Mã ngắn để lưu authLostReason + log: "shop_no_linked", "TikTok code 105002", "IllegalRefreshToken"… */
export function authRejectReason(err: unknown): string {
  const m = msgOf(err);
  const coded = /^(?:Shopee|Lazada) refresh token lỗi: ([^—\n]+?)\s*(?:—|$)/.exec(m);
  if (coded) return coded[1].trim().slice(0, 120);
  const tiktok = /^TikTok auth lỗi \(code (\d+)\)/.exec(m);
  if (tiktok) return `TikTok code ${tiktok[1]}`;
  return m.slice(0, 120);
}

/** Giữ tên cũ cho mã đang gọi (shopee/service.ts, test 03/10): mã sàn nói thẳng mất quyền. */
export function isShopeeAccessExpiredError(err: unknown): boolean {
  return classifyRefreshFailure(err) === "lost_now";
}

/** Ghi vào lượt làm mới thành công / ủy quyền lại. */
export const AUTH_REJECT_RESET = { authRejectCount: 0, authRejectSince: null, authLostReason: null } as const;

export interface AuthSubject {
  /** "channel" = app chính (bảng Channel); "appAuth" = Hubsell Ads (bảng channel_app_auths). */
  kind: "channel" | "appAuth";
  id: string;
  /** refresh_token vừa bị sàn từ chối — điều kiện ghi: DB vẫn cầm đúng token này. */
  refreshToken: string | null;
  /** Tên gian để log. */
  label: string;
}

export interface RecordResult {
  kind: RefreshFailureKind;
  /** Lượt này đã hạ gian xuống DISCONNECTED. */
  disconnected: boolean;
  /** Số lần sàn từ chối liên tiếp sau lượt này (0 = không đếm). */
  count: number;
}

const tableOf = (s: AuthSubject) => Prisma.raw(s.kind === "channel" ? '"Channel"' : '"channel_app_auths"');

/**
 * Gọi ở nơi làm mới token thất bại, NGOÀI giao dịch của khóa (ném trong giao dịch là
 * rollback mất dấu). Mọi điều kiện (ACTIVE, đúng token, ngưỡng) kiểm ngay trong SQL —
 * nhiều tiến trình cùng ghi vẫn đúng. Mốc giờ dùng now() AT TIME ZONE 'UTC' cho khớp cột
 * TIMESTAMP không múi giờ mà Prisma ghi (xem gotcha TIMESTAMP + now()).
 */
export async function recordRefreshFailure(subject: AuthSubject, err: unknown): Promise<RecordResult> {
  const kind = classifyRefreshFailure(err);
  if (kind === "transient" || !subject.refreshToken) return { kind, disconnected: false, count: 0 };
  const reason = authRejectReason(err);
  const t = tableOf(subject);
  try {
    const rows = await prisma.$queryRaw<{ authRejectCount: number; span_s: number | null }[]>`
      UPDATE ${t}
      SET "authRejectCount" = "authRejectCount" + 1,
          "authLostReason" = ${reason},
          "authRejectSince" = COALESCE("authRejectSince", now() AT TIME ZONE 'UTC')
      WHERE "id" = ${subject.id} AND "status" = 'ACTIVE' AND "refreshToken" = ${subject.refreshToken}
      RETURNING "authRejectCount",
                EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - "authRejectSince"))::int AS span_s`;
    const row = rows[0];
    if (!row) return { kind, disconnected: false, count: 0 }; // gian đã hạ / đã làm mới bởi tiến trình khác
    const count = Number(row.authRejectCount);
    const spanMs = Number(row.span_s ?? 0) * 1000;
    const drop = kind === "lost_now" || (count >= AUTH_REJECT_MAX && spanMs >= AUTH_REJECT_MIN_SPAN_MS);
    if (!drop) {
      console.warn(
        `[Auth-loss] ${subject.label}: sàn từ chối làm mới quyền (${reason}) lần ${count}/${AUTH_REJECT_MAX}, ${Math.round(spanMs / 60000)}′ — còn giữ ACTIVE`
      );
      return { kind, disconnected: false, count };
    }
    const n = await prisma.$executeRaw`
      UPDATE ${t} SET "status" = 'DISCONNECTED', "disconnectedAt" = now() AT TIME ZONE 'UTC'
      WHERE "id" = ${subject.id} AND "status" = 'ACTIVE' AND "refreshToken" = ${subject.refreshToken}`;
    if (n > 0) {
      console.warn(
        `[Auth-loss] ${subject.label}: sàn từ chối làm mới quyền (${reason}) ${kind === "lost_now" ? "— mã chắc chắn" : `${count} lần trải ${Math.round(spanMs / 60000)}′`} → DISCONNECTED, cần kết nối lại`
      );
    }
    return { kind, disconnected: n > 0, count };
  } catch (e) {
    console.error(`[Auth-loss] Không ghi được dấu từ chối cho ${subject.label}:`, (e as Error).message);
    return { kind, disconnected: false, count: 0 };
  }
}

/** Lỗi của một lượt quét/gọi API thuộc LỚP QUYỀN theo bảng phân loại của cổng gọi sàn. */
export function isAuthClassError(platform: Platform, err: unknown): boolean {
  return classifierFor(platform)(err).kind === "auth";
}

/**
 * Lưới thứ hai: lượt quét gặp lỗi lớp quyền → đặt access_token "đã hết hạn" để lượt gọi
 * kế phải làm mới ngay; làm mới bị sàn từ chối thì luật đếm phán xử (không chờ TikTok
 * 7 ngày / Shopee 4 giờ). Làm mới được thì chỉ tốn một lệnh refresh — vô hại.
 */
export async function forceTokenRefresh(channelId: string, label: string, err: unknown): Promise<void> {
  try {
    const n = await prisma.channel.updateMany({
      where: { id: channelId, status: "ACTIVE", refreshToken: { not: null } },
      data: { accessTokenExpireAt: new Date(0) },
    });
    if (n.count > 0) {
      console.warn(`[Auth-loss] ${label}: lỗi lớp quyền khi quét (${msgOf(err).slice(0, 100)}) → ép làm mới token ở lượt kế`);
    }
  } catch (e) {
    console.error(`[Auth-loss] Không ép làm mới token được cho ${label}:`, (e as Error).message);
  }
}
