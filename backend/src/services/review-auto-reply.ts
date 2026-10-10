// ============================================================
// TỰ ĐỘNG TRẢ LỜI ĐÁNH GIÁ THEO SỐ SAO — LÕI CHẠY NỀN (10/10/2026)
//
// Anh Trung 10/10: "thỉnh thoảng nó không tự phản hồi, anh phải vào bấm nó mới
// làm" — gốc: engine cũ chạy TRONG TRÌNH DUYỆT (trang Phản hồi đánh giá đang mở
// mới quét), cờ + bộ mẫu nằm localStorage. Anh chốt: chạy nền, MỖI NGÀY MỘT LẦN.
//
// Một lượt của một chủ shop:
//   · Shopee: get_comment toàn shop theo trang (mới → cũ) tới mốc cửa sổ quét
//     (lượt trước − 2 ngày; lần đầu 14 ngày), tối đa SHOPEE_MAX_PAGES trang.
//     Gửi GỘP bằng reply_comment (≤100 đánh giá/lượt gọi).
//   · Lazada: API bắt buộc theo từng item → lọc NOT_REPLIED, tối đa
//     LAZADA_MAX_ITEMS sản phẩm/gian, TUẦN TỰ có nhịp nghỉ (trần ~1 call/giây
//     TOÀN APP). Gửi từng đánh giá một (API không có bản gộp).
//   · Chỉ đánh giá CHƯA có trả lời trên sàn, đúng mức sao đang bật, chưa có
//     trong sổ review_auto_replies. Ghi sổ TRƯỚC khi gửi (unique chặn đôi).
//
// Hằng số dưới đây là mặc định em tự chọn (chưa có số đo): 14 ngày lần đầu đủ
// vét đánh giá tồn của shop vừa bật; 10 trang × 50 = 500 đánh giá/gian/ngày.
// ============================================================

import { ChannelName, type Channel, type ReviewAutoReplyConfig } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getComments, replyComments, SHOPEE_REPLY_COMMENT_MAX } from "../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../integrations/shopee/service";
import { getItemReviews, replyReview } from "../integrations/lazada/client";
import { getValidLazadaAccessToken } from "../integrations/lazada/service";

export type StarLevel = "1" | "2" | "3" | "4" | "5";
export type ReplyTemplates = Record<StarLevel, string[]>;

export const STAR_LEVELS: StarLevel[] = ["1", "2", "3", "4", "5"];
/** Mỗi mức sao tối đa 5 mẫu, mỗi mẫu tối đa 500 ký tự (trần trả lời Lazada). */
const MAX_TEMPLATES_PER_STAR = 5;
const MAX_TEMPLATE_CHARS = 500;

export const DEFAULT_REPLY_TEMPLATES: ReplyTemplates = {
  "5": [
    "Cảm ơn {TEN_KHACH} đã tin tưởng và dành 5 sao cho {SAN_PHAM}! {TEN_SHOP} rất vui khi sản phẩm vừa ý bạn. Hẹn gặp lại bạn ở những đơn hàng sau ạ!",
    "5 sao của {TEN_KHACH} là động lực lớn nhất của {TEN_SHOP}! Cảm ơn bạn đã ủng hộ, shop luôn có ưu đãi riêng cho khách quen nha!",
    "{TEN_SHOP} cảm ơn {TEN_KHACH} nhiều lắm ạ! Rất vui khi {SAN_PHAM} đến tay bạn trọn vẹn. Chúc bạn một ngày thật đẹp!",
    "Cảm ơn {TEN_KHACH} đã dành thời gian đánh giá! {TEN_SHOP} sẽ tiếp tục giữ chất lượng để không phụ lòng tin của bạn ạ.",
    "Yêu quá, cảm ơn {TEN_KHACH} đã cho {SAN_PHAM} 5 sao! Bạn nhớ theo dõi {TEN_SHOP} để săn ưu đãi đợt mới nha!",
  ],
  "4": [
    "Cảm ơn {TEN_KHACH} đã đánh giá {SAN_PHAM}! {TEN_SHOP} ghi nhận góp ý của bạn để hoàn thiện hơn nữa. Mong được phục vụ bạn lần sau ạ!",
    "{TEN_SHOP} cảm ơn {TEN_KHACH} đã ủng hộ! Nếu có điểm nào chưa vừa ý, bạn nhắn shop để được hỗ trợ ngay nha.",
    "Cảm ơn {TEN_KHACH} nhiều ạ! Shop rất mong nhận thêm góp ý để {SAN_PHAM} tốt hơn từng ngày.",
    "Cảm ơn đánh giá của {TEN_KHACH}! {TEN_SHOP} sẽ cố gắng để lần sau bạn hài lòng trọn vẹn 5 sao ạ!",
    "{TEN_SHOP} cảm ơn {TEN_KHACH} đã tin tưởng! Chúc bạn nhiều sức khỏe và hẹn gặp lại ạ.",
  ],
  "3": [
    "Chào {TEN_KHACH}, cảm ơn bạn đã góp ý về {SAN_PHAM}. Shop xin lỗi vì trải nghiệm chưa trọn vẹn — bạn nhắn tin cho {TEN_SHOP} để được hỗ trợ ngay nha!",
    "{TEN_SHOP} cảm ơn phản hồi thẳng thắn của {TEN_KHACH}. Shop ghi nhận và sẽ cải thiện; rất mong có cơ hội phục vụ bạn tốt hơn ạ.",
    "Chào {TEN_KHACH}, shop tiếc vì {SAN_PHAM} chưa đúng kỳ vọng của bạn. Bạn inbox {TEN_SHOP} để shop hỗ trợ đổi trả hoặc tư vấn thêm nha!",
    "Cảm ơn {TEN_KHACH} đã đánh giá. Góp ý của bạn giúp {TEN_SHOP} hoàn thiện sản phẩm hơn — có gì cần hỗ trợ bạn cứ nhắn shop ạ.",
    "Chào {TEN_KHACH}, shop rất muốn biết thêm điều gì khiến bạn chưa hài lòng về {SAN_PHAM} — nhắn cho {TEN_SHOP} để shop khắc phục ngay nha!",
  ],
  "2": [
    "Chào {TEN_KHACH}, {TEN_SHOP} thành thật xin lỗi vì trải nghiệm chưa tốt với {SAN_PHAM}. Bạn vui lòng nhắn tin cho shop kèm chi tiết, shop hỗ trợ đổi trả/khắc phục trong 24h ạ!",
    "{TEN_SHOP} rất tiếc về sự cố bạn gặp phải. {TEN_KHACH} inbox shop giúp mình nhé, shop cam kết xử lý thỏa đáng ngay ạ!",
    "Xin lỗi {TEN_KHACH} vì {SAN_PHAM} chưa đạt kỳ vọng. Shop đã ghi nhận và rất mong được bù đắp — bạn nhắn {TEN_SHOP} để shop hỗ trợ liền nha.",
    "Chào {TEN_KHACH}, shop xin nhận thiếu sót này. Bạn cho {TEN_SHOP} cơ hội khắc phục bằng cách nhắn tin cho shop nhé, shop ưu tiên xử lý ngay ạ!",
    "{TEN_SHOP} chân thành xin lỗi {TEN_KHACH}. Shop muốn hiểu rõ vấn đề để xử lý dứt điểm — mong bạn phản hồi qua tin nhắn giúp shop ạ.",
  ],
  "1": [
    "Chào {TEN_KHACH}, {TEN_SHOP} thành thật xin lỗi về trải nghiệm rất không tốt này. Bạn vui lòng nhắn tin cho shop kèm ảnh/chi tiết, shop cam kết hoàn tiền hoặc đổi mới trong 24h ạ!",
    "{TEN_SHOP} xin nhận trách nhiệm và gửi lời xin lỗi tới {TEN_KHACH}. Shop đã chuyển ngay cho bộ phận xử lý — bạn inbox shop để được giải quyết ưu tiên ạ!",
    "Xin lỗi {TEN_KHACH} rất nhiều! Sự cố với {SAN_PHAM} là điều shop không mong muốn. Shop sẵn sàng đổi trả miễn phí — bạn nhắn {TEN_SHOP} ngay giúp mình nhé.",
    "Chào {TEN_KHACH}, shop rất tiếc và xin lỗi bạn. {TEN_SHOP} mong được khắc phục ngay: bạn để lại tin nhắn, shop phản hồi trong ít phút ạ!",
    "{TEN_SHOP} chân thành xin lỗi {TEN_KHACH} về {SAN_PHAM}. Shop cam kết xử lý thỏa đáng (đổi mới/hoàn tiền) — rất mong bạn cho shop cơ hội sửa sai ạ.",
  ],
};

// ---------- Chuẩn hóa dữ liệu cấu hình (route + worker dùng chung) ----------

/** Bộ mẫu từ JSON bất kỳ: mức nào thiếu/hỏng/rỗng sạch thì đắp mặc định mức đó. */
export function normalizeTemplates(raw: unknown): ReplyTemplates {
  const out = { ...DEFAULT_REPLY_TEMPLATES };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const star of STAR_LEVELS) {
    const list = obj[star];
    if (!Array.isArray(list)) continue;
    const clean = list
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.slice(0, MAX_TEMPLATE_CHARS))
      .slice(0, MAX_TEMPLATES_PER_STAR);
    if (clean.some((s) => s.trim())) out[star] = clean;
  }
  return out;
}

/**
 * Bộ mẫu để GHI DB: trùng hẳn mặc định → null (đa số shop không sửa mẫu; khỏi
 * lưu ~5 KB JSON mỗi dòng, sau này đổi câu mặc định trong code cũng tự áp).
 */
export function templatesForStorage(raw: unknown): ReplyTemplates | null {
  const t = normalizeTemplates(raw);
  return JSON.stringify(t) === JSON.stringify(DEFAULT_REPLY_TEMPLATES) ? null : t;
}

/** Mức sao bật từ đầu vào bất kỳ → mảng số 1..5 không trùng, tăng dần. */
export function normalizeStars(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 5) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Quy rating tự do (0, 4.5…) về mức sao 1–5 của bộ mẫu. */
export function toStarLevel(rating: number): StarLevel {
  const r = Math.min(5, Math.max(1, Math.round(rating) || 5));
  return String(r) as StarLevel;
}

export interface ReplyVars {
  customer: string;
  shopName: string;
  productName: string;
}

function displayName(customer: string): string {
  const c = customer.trim();
  if (!c || /^người mua/i.test(c)) return "bạn";
  return c;
}

/** Thay biến bằng replaceAll CHUỖI (không regex) — nội dung có $, \ cũng không vỡ. */
export function applyTemplate(template: string, vars: ReplyVars): string {
  return template
    .replaceAll("{TEN_KHACH}", displayName(vars.customer))
    .replaceAll("{TEN_SHOP}", vars.shopName.trim() || "Shop")
    .replaceAll("{SAN_PHAM}", vars.productName.trim() || "sản phẩm");
}

/** Bốc NGẪU NHIÊN một mẫu đúng mức sao rồi thay biến; mức không còn mẫu → null. */
export function pickReply(
  templates: ReplyTemplates,
  rating: number,
  vars: ReplyVars,
  rand: () => number = Math.random
): string | null {
  const list = templates[toStarLevel(rating)].filter((s) => s.trim());
  if (list.length === 0) return null;
  const t = list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  return applyTemplate(t, vars).slice(0, MAX_TEMPLATE_CHARS);
}

// ---------- Lịch chạy mỗi ngày ----------

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/**
 * Khung giờ VN mỗi shop được chạy: 08:00 + (0..719 phút) → rải đều tới 20:00.
 * Phút trong khung CỐ ĐỊNH theo ownerId (băm) — shop nào cũng chạy cùng giờ mỗi
 * ngày, 50.000 shop trải đều ~70 shop/phút thay vì dồn một mốc.
 */
export const DAILY_WINDOW = { startHour: 8, spreadMin: 12 * 60 } as const;

function ownerMinute(ownerId: string): number {
  let h = 0;
  for (let i = 0; i < ownerId.length; i++) h = (h * 31 + ownerId.charCodeAt(i)) >>> 0;
  return h % DAILY_WINDOW.spreadMin;
}

/** Hàm thuần (test): khung giờ của shop vào NGÀY KẾ TIẾP (giờ VN) — luôn là ngày mai. */
export function nextDailySlot(now: Date, ownerId: string): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const tomorrowVn = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + 1);
  const slotVn =
    tomorrowVn + DAILY_WINDOW.startHour * 3_600_000 + ownerMinute(ownerId) * 60_000;
  return new Date(slotVn - VN_OFFSET_MS);
}

// ---------- DTO trả cho trang Cấu hình ----------

export interface ReviewAutoReplyConfigDTO {
  /** false = chủ shop chưa từng lưu (trang dùng để chép cấu hình localStorage cũ lên). */
  saved: boolean;
  enabledStars: number[];
  templates: ReplyTemplates;
  defaultTemplates: ReplyTemplates;
  nextRunAt: string | null;
  /** Lượt kế đã tới hạn — worker nhặt trong vài phút (trang hiện "trong vài phút tới"). */
  dueNow: boolean;
  lastRunAt: string | null;
  lastRunReplied: number;
  lastRunFailed: number;
  lastRunError: string | null;
}

export function toConfigDTO(
  row: ReviewAutoReplyConfig | null,
  now: Date = new Date()
): ReviewAutoReplyConfigDTO {
  return {
    saved: row != null,
    enabledStars: normalizeStars(row?.enabledStars ?? []),
    templates: normalizeTemplates(row?.templates ?? null),
    defaultTemplates: DEFAULT_REPLY_TEMPLATES,
    nextRunAt: row?.nextRunAt?.toISOString() ?? null,
    dueNow: row?.nextRunAt != null && row.nextRunAt.getTime() <= now.getTime(),
    lastRunAt: row?.lastRunAt?.toISOString() ?? null,
    lastRunReplied: row?.lastRunReplied ?? 0,
    lastRunFailed: row?.lastRunFailed ?? 0,
    lastRunError: row?.lastRunError ?? null,
  };
}

/**
 * Lịch sau khi chủ shop đổi mức sao: tắt hết → null; vừa BẬT từ trạng thái tắt
 * → chạy ngay lượt quét kế (khách bật xong thấy kết quả trong vài phút, không
 * phải chờ tới mai); đang bật mà đổi mức → giữ lịch cũ.
 */
export function scheduleAfterConfigChange(
  prevStars: number[],
  prevNextRunAt: Date | null,
  nextStars: number[],
  now: Date
): Date | null {
  if (nextStars.length === 0) return null;
  if (prevStars.length === 0 || prevNextRunAt == null) return now;
  return prevNextRunAt;
}

// ---------- Một lượt chạy của một chủ shop ----------

/** Đánh giá chưa trả lời đủ điều kiện gửi. */
interface Target {
  reviewId: string;
  rating: number;
  customer: string;
  productName: string;
}

export interface OwnerRunResult {
  replied: number;
  failed: number;
  firstError: string | null;
}

const SHOPEE_PAGE_SIZE = 50;
const SHOPEE_MAX_PAGES = 10;
const FIRST_RUN_LOOKBACK_MS = 14 * 86_400_000;
const RERUN_OVERLAP_MS = 2 * 86_400_000;
const LAZADA_MAX_ITEMS = 30;
const LAZADA_CALL_GAP_MS = 400;
/** Gian Shopee của MỘT chủ shop chạy song song tối đa N (mỗi gian một shop_id riêng). */
const SHOPEE_CHANNEL_CONCURRENCY = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function withLazadaRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!errMsg(e).includes("ApiCallLimit")) throw e;
      await sleep(1300);
    }
  }
  throw lastErr;
}

/**
 * Tên sản phẩm theo item id phía sàn. ChannelProduct chỉ có chỉ mục channelId nên
 * mỗi câu là một lượt đọc danh mục của gian → gom lô 500 item (thực tế 1 câu/gian/ngày).
 */
async function productNamesOf(channelId: string, itemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(itemIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await prisma.channelProduct.findMany({
      where: {
        channelId,
        OR: chunk.flatMap((id) => [
          { externalId: id },
          { externalId: { startsWith: `${id}-` } },
        ]),
      },
      select: { externalId: true, productName: true },
    });
    for (const r of rows) {
      const item = String(r.externalId ?? "").split("-")[0];
      if (item && !out.has(item)) out.set(item, r.productName);
    }
  }
  return out;
}

/**
 * Đánh giá có thuộc mức sao đang bật không. Sàn không trả số sao (0/thiếu) thì
 * BỎ QUA — toStarLevel quy 0 về 5 sao, gửi lời cảm ơn cho đánh giá chưa rõ sao
 * là rủi ro.
 */
export function isEnabledRating(rating: number, stars: Set<number>): boolean {
  if (!(rating >= 1)) return false;
  return stars.has(Number(toStarLevel(rating)));
}

/**
 * Ghi sổ trước khi gửi — trả về id đánh giá GIÀNH được. Một câu lệnh cho cả lô:
 * dòng đã có (lượt trước / tiến trình khác) bị ON CONFLICT bỏ qua, RETURNING chỉ
 * trả dòng vừa chèn.
 */
async function claimTargets(channelId: string, targets: Target[]): Promise<Set<string>> {
  const won = new Set<string>();
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    const rows = await prisma.$queryRaw<{ reviewId: string }[]>`
      INSERT INTO "review_auto_replies" ("channelId", "reviewId", "rating")
      SELECT ${channelId}, x."reviewId", x."rating"
      FROM UNNEST(${chunk.map((t) => t.reviewId)}::text[], ${chunk.map((t) => Math.round(t.rating))}::smallint[])
        AS x("reviewId", "rating")
      ON CONFLICT ("channelId", "reviewId") DO NOTHING
      RETURNING "reviewId"`;
    for (const r of rows) won.add(r.reviewId);
  }
  return won;
}

async function settleTargets(channelId: string, sent: string[], failed: string[]): Promise<void> {
  if (sent.length > 0) {
    await prisma.reviewAutoReply.updateMany({
      where: { channelId, reviewId: { in: sent } },
      data: { status: "SENT" },
    });
  }
  if (failed.length > 0) {
    // Xóa để lượt hôm sau thử lại.
    await prisma.reviewAutoReply.deleteMany({
      where: { channelId, reviewId: { in: failed }, status: "SENDING" },
    });
  }
}

async function runShopeeChannel(
  ch: Channel,
  stars: Set<number>,
  templates: ReplyTemplates,
  sinceSec: number,
  result: OwnerRunResult
): Promise<void> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
  const raw: { id: number; rating: number; customer: string; itemId: string }[] = [];
  let cursor = "";
  for (let page = 0; page < SHOPEE_MAX_PAGES; page++) {
    const data = await getComments({ accessToken, shopId, cursor, pageSize: SHOPEE_PAGE_SIZE });
    const list = data.response?.item_comment_list ?? [];
    let reachedOld = false;
    for (const c of list) {
      if (c.comment_id == null) continue;
      if ((c.create_time ?? 0) < sinceSec) {
        reachedOld = true;
        continue;
      }
      if (c.comment_reply?.reply) continue;
      const rating = c.rating_star ?? 0;
      if (!isEnabledRating(rating, stars)) continue;
      raw.push({
        id: c.comment_id,
        rating,
        customer: c.buyer_username || "Người mua Shopee",
        itemId: String(c.item_id ?? ""),
      });
    }
    if (reachedOld || !data.response?.more || !data.response.next_cursor) break;
    cursor = data.response.next_cursor;
  }
  if (raw.length === 0) return;

  const names = await productNamesOf(ch.id, raw.map((r) => r.itemId));
  const targets: Target[] = raw.map((r) => ({
    reviewId: String(r.id),
    rating: r.rating,
    customer: r.customer,
    productName: names.get(r.itemId) ?? "",
  }));
  const won = await claimTargets(ch.id, targets);
  const toSend = targets.filter((t) => won.has(t.reviewId));

  for (let i = 0; i < toSend.length; i += SHOPEE_REPLY_COMMENT_MAX) {
    const batch = toSend.slice(i, i + SHOPEE_REPLY_COMMENT_MAX);
    const items: { commentId: number; reply: string }[] = [];
    const noTemplate: string[] = [];
    for (const t of batch) {
      const reply = pickReply(templates, t.rating, {
        customer: t.customer,
        shopName: ch.shopName,
        productName: t.productName,
      });
      if (reply) items.push({ commentId: Number(t.reviewId), reply });
      else noTemplate.push(t.reviewId);
    }
    try {
      const { failed } = await replyComments({ accessToken, shopId, items });
      const failedIds = new Set(failed.map((f) => String(f.commentId)));
      const sent = items.map((x) => String(x.commentId)).filter((id) => !failedIds.has(id));
      await settleTargets(ch.id, sent, [...failedIds, ...noTemplate]);
      result.replied += sent.length;
      result.failed += failedIds.size;
      if (failed.length > 0 && !result.firstError) {
        result.firstError = `${ch.shopName}: ${failed[0].message}`;
      }
    } catch (e) {
      await settleTargets(ch.id, [], batch.map((t) => t.reviewId));
      result.failed += items.length;
      if (!result.firstError) result.firstError = `${ch.shopName}: ${errMsg(e)}`;
    }
  }
}

async function runLazadaChannel(
  ch: Channel,
  stars: Set<number>,
  templates: ReplyTemplates,
  sinceMs: number,
  result: OwnerRunResult
): Promise<void> {
  const accessToken = await getValidLazadaAccessToken(ch);
  // externalId Lazada lưu "itemId-skuId" → tách itemId, khử trùng.
  const cps = await prisma.channelProduct.findMany({
    where: { channelId: ch.id, externalId: { not: null } },
    select: { externalId: true, productName: true },
    orderBy: { lastSyncedAt: "desc" },
    take: LAZADA_MAX_ITEMS * 10,
  });
  const itemNames = new Map<string, string>();
  for (const p of cps) {
    const itemId = String(p.externalId).split("-")[0];
    if (itemId && !itemNames.has(itemId)) itemNames.set(itemId, p.productName);
    if (itemNames.size >= LAZADA_MAX_ITEMS) break;
  }

  const targets: Target[] = [];
  for (const [itemId, productName] of itemNames) {
    const groups = await withLazadaRetry(() =>
      getItemReviews({ accessToken, itemId, statusFilter: "NOT_REPLIED" })
    );
    await sleep(LAZADA_CALL_GAP_MS);
    for (const g of groups) {
      const rating = Number(g.ratings?.product_rating ?? 0) || 0;
      if (!isEnabledRating(rating, stars)) continue;
      for (const r of g.reviews ?? []) {
        if (r.id == null || r.seller_reply) continue;
        if (r.review_type && r.review_type !== "PRODUCT_REVIEW") continue;
        const created = Number(r.create_time ?? 0);
        if (created > 0 && created < sinceMs) continue;
        targets.push({
          reviewId: String(r.id),
          rating,
          customer: "Người mua Lazada", // API không trả tên khách
          productName,
        });
      }
    }
  }
  const won = await claimTargets(ch.id, targets);

  for (const t of targets) {
    if (!won.has(t.reviewId)) continue;
    const reply = pickReply(templates, t.rating, {
      customer: t.customer,
      shopName: ch.shopName,
      productName: t.productName,
    });
    if (!reply) {
      await settleTargets(ch.id, [], [t.reviewId]);
      continue;
    }
    try {
      await withLazadaRetry(() => replyReview({ accessToken, reviewId: t.reviewId, content: reply }));
      await settleTargets(ch.id, [t.reviewId], []);
      result.replied++;
    } catch (e) {
      await settleTargets(ch.id, [], [t.reviewId]);
      result.failed++;
      if (!result.firstError) result.firstError = `${ch.shopName}: ${errMsg(e)}`;
    }
    await sleep(LAZADA_CALL_GAP_MS);
  }
}

/** Một lượt tự trả lời cho MỘT chủ shop (mọi gian Shopee + Lazada đang nối). */
export async function runReviewAutoReplyForOwner(
  cfg: ReviewAutoReplyConfig,
  now: Date = new Date()
): Promise<OwnerRunResult> {
  const result: OwnerRunResult = { replied: 0, failed: 0, firstError: null };
  const stars = new Set(normalizeStars(cfg.enabledStars));
  if (stars.size === 0) return result;
  const templates = normalizeTemplates(cfg.templates);
  const sinceMs = cfg.lastRunAt
    ? cfg.lastRunAt.getTime() - RERUN_OVERLAP_MS
    : now.getTime() - FIRST_RUN_LOOKBACK_MS;

  const channels = await prisma.channel.findMany({
    where: {
      userId: cfg.ownerId,
      channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
      apiToken: { not: null },
      status: "ACTIVE",
    },
    orderBy: { createdAt: "asc" },
  });

  const noteError = (ch: Channel, e: unknown) => {
    if (!result.firstError) result.firstError = `${ch.shopName}: ${errMsg(e)}`;
  };

  const shopee = channels.filter((c) => c.channelName === ChannelName.SHOPEE);
  for (let i = 0; i < shopee.length; i += SHOPEE_CHANNEL_CONCURRENCY) {
    await Promise.all(
      shopee.slice(i, i + SHOPEE_CHANNEL_CONCURRENCY).map((ch) =>
        runShopeeChannel(ch, stars, templates, Math.floor(sinceMs / 1000), result).catch(
          (e) => noteError(ch, e)
        )
      )
    );
  }
  for (const ch of channels) {
    if (ch.channelName !== ChannelName.LAZADA) continue;
    await runLazadaChannel(ch, stars, templates, sinceMs, result).catch((e) =>
      noteError(ch, e)
    );
  }
  return result;
}

/** id đánh giá (dạng "channelId:reviewId") đã được hệ thống tự trả lời — trang Phản hồi đánh giá gắn badge. */
export async function autoRepliedKeys(
  pairs: { channelId: string; reviewId: string }[]
): Promise<Set<string>> {
  const out = new Set<string>();
  const byChannel = new Map<string, string[]>();
  for (const p of pairs) {
    const list = byChannel.get(p.channelId) ?? [];
    list.push(p.reviewId);
    byChannel.set(p.channelId, list);
  }
  for (const [channelId, reviewIds] of byChannel) {
    const rows = await prisma.reviewAutoReply.findMany({
      where: { channelId, reviewId: { in: reviewIds } },
      select: { reviewId: true },
    });
    for (const r of rows) out.add(`${channelId}:${r.reviewId}`);
  }
  return out;
}
