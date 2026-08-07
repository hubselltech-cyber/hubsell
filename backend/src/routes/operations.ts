// ============================================================
// TRỢ LÝ VẬN HÀNH (CSKH đa kênh) — API hợp nhất chat + đánh giá + ngữ cảnh SP
//
// Chuẩn hoá dữ liệu 2 sàn (Shopee sellerchat / Lazada IM, Shopee get_comment /
// Lazada review) về MỘT shape chung cho frontend. Nguyên tắc chịu lỗi: gọi sàn
// theo TỪNG GIAN, gian nào lỗi (hết hạn token, chưa được cấp quyền module chat)
// thì trả lỗi của riêng gian đó trong `errors[]` — không đánh sập cả màn hình.
//
// LƯU Ý QUYỀN SÀN: module sellerchat của Shopee có thể chưa bật cho app —
// thông điệp lỗi trả nguyên văn để chủ shop biết đường xin mở trên Console.
// ============================================================

import { Router } from "express";
import { ChannelName, type Channel } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { channelScope } from "../channel-filter";
import {
  getComments,
  getConversationList,
  getChatMessages,
  getModelList,
  replyComment,
  sendChatMessage,
  shopeeSellerStock,
  type ShopeeConversation,
} from "../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../integrations/shopee/service";
import {
  getImMessages,
  getImSessions,
  getItemReviews,
  replyReview,
  sendImMessage,
} from "../integrations/lazada/client";
import { getValidLazadaAccessToken } from "../integrations/lazada/service";

const router = Router();

// ---------- Shape chuẩn hoá trả cho frontend ----------

interface OpsConversation {
  /** Khoá ghép "channelId:idHộiThoạiPhíaSàn" — frontend dùng nguyên chuỗi. */
  id: string;
  channelId: string;
  channelName: "SHOPEE" | "LAZADA";
  shopName: string;
  customer: string;
  lastMessage: string;
  unread: number;
  /** epoch MILI-giây; null nếu sàn không trả. */
  lastAt: number | null;
  /** Shopee: user_id người mua — BẮT BUỘC để gửi tin. Lazada không cần. */
  buyerId: string | null;
  /** id hội thoại phía sàn (conversation_id / session_id). */
  externalId: string;
}

interface OpsMessage {
  id: string;
  fromShop: boolean;
  text: string;
  at: number | null;
  /** item_id nếu tin nhắn đính kèm sản phẩm — frontend tra ngữ cảnh SP. */
  itemId: string | null;
}

interface OpsReview {
  id: string; // "channelId:reviewId"
  channelId: string;
  channelName: "SHOPEE" | "LAZADA";
  shopName: string;
  customer: string;
  rating: number;
  content: string;
  reply: string | null;
  productName: string;
  orderCode: string | null;
  createdAt: number | null;
  externalId: string;
}

/** Lỗi của riêng một gian — trả kèm để UI ghi chú, không chặn gian khác. */
interface OpsChannelError {
  channelId: string;
  shopName: string;
  message: string;
}

// ---------- Trợ giúp ----------

/** Thông điệp lỗi an toàn để trả về UI. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Chuẩn hoá mốc thời gian sàn trả về ms: Shopee chat trả NANO giây ở một số
 * region, có chỗ MICRO, chỗ khác giây; Lazada trả mili. Chia dần theo bậc độ
 * lớn cho tới khi rơi vào thang mili hợp lý — chịu được MỌI thang đo thay vì
 * đoán cứng từng ngưỡng (ngưỡng cứng từng làm micro giây bị dịch về 1970).
 */
function toMs(v: unknown): number | null {
  let n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 1e14 ms ≈ năm 5138 — lớn hơn chắc chắn là micro/nano, chia 1000 dần
  while (n > 1e14) n = n / 1000;
  // nhỏ hơn 1e11 ms (≈ năm 1973) là thang GIÂY → nhân lên
  if (n < 1e11) n = n * 1000;
  return Math.round(n);
}

// ── Nhãn tiếng Việt cho TIN NHẮN KHÔNG PHẢI VĂN BẢN ──
// Payload thật của sàn chứa đủ loại: ảnh, sticker, thẻ sản phẩm, thẻ đơn,
// voucher… — không map thì UI hiện chuỗi rỗng/`[object]` rất dễ gây hiểu là
// crash. Loại chưa biết vẫn ra `[nhãn thô]` chứ KHÔNG ném lỗi.

const SHOPEE_TYPE_LABEL: Record<string, string> = {
  image: "[Hình ảnh]",
  image_with_text: "[Hình ảnh kèm chữ]",
  sticker: "[Sticker]",
  item: "[Thẻ sản phẩm]",
  product: "[Thẻ sản phẩm]",
  item_list: "[Danh sách sản phẩm]",
  order: "[Thẻ đơn hàng]",
  voucher: "[Voucher]",
  video: "[Video]",
  bundle_deal_info: "[Combo khuyến mãi]",
};

/** Text hiển thị cho một tin Shopee — luôn trả CHUỖI, không bao giờ undefined. */
function shopeeMessageText(messageType?: string, text?: string): string {
  if (typeof text === "string" && text.trim()) return text;
  if (!messageType || messageType === "text") return "";
  return SHOPEE_TYPE_LABEL[messageType] ?? `[${messageType}]`;
}

const LAZADA_TEMPLATE_LABEL: Record<string, string> = {
  "3": "[Hình ảnh]",
  "4": "[Emoji]",
  "6": "[Video]",
  "10006": "[Thẻ sản phẩm]",
  "10007": "[Thẻ đơn hàng]",
  "10008": "[Voucher]",
  "10010": "[Mời theo dõi shop]",
};

/**
 * Text hiển thị cho một tin Lazada. content của template text (1) là JSON
 * string {"txt":"…"} nhưng payload thật có khi trả sẵn OBJECT — đọc cả hai,
 * hỏng thì rơi về nhãn template, tuyệt đối không ném.
 */
function lazadaMessageText(templateId: string, content: unknown): string {
  let txt = "";
  try {
    if (typeof content === "string" && content.trim()) {
      const parsed = JSON.parse(content) as { txt?: unknown };
      if (typeof parsed?.txt === "string") txt = parsed.txt;
    } else if (content && typeof content === "object") {
      const obj = content as { txt?: unknown };
      if (typeof obj.txt === "string") txt = obj.txt;
    }
  } catch {
    // content không phải JSON — với template text thì chính nó là chữ
    if (typeof content === "string") txt = content;
  }
  if (txt.trim()) return txt;
  if (templateId === "1") return "";
  return LAZADA_TEMPLATE_LABEL[templateId] ?? `[tin nhắn dạng ${templateId}]`;
}

// ── LẤY HỘI THOẠI SHOPEE "TỰ HIỆU CHỈNH" ──
// Docs sellerchat bị Shopee khoá quyền xem nên không tra được hành vi chuẩn
// của `direction`/mốc phân trang; thực tế production từng trả 25 hội thoại
// CŨ NHẤT (toàn năm ngoái) làm tin mới không bao giờ hiện. Giải pháp: gọi
// thử CÁC BIẾN THỂ tham số, biến thể nào trả về hội thoại có mốc thời gian
// MỚI NHẤT chính là biến thể đúng — nhớ lại theo shop trong 10 phút để các
// lượt poll sau chỉ gọi 1 lần.

interface ShopeeConvVariant {
  name: string;
  direction?: string;
  nextTimestampNano?: string;
}

function shopeeConvVariants(): ShopeeConvVariant[] {
  return [
    { name: "latest" }, // direction=latest (mặc định hiện tại)
    // Đi LÙI từ mốc "bây giờ" — pattern cursor next_timestamp_nano của sellerchat
    {
      name: "older_from_now",
      direction: "older",
      nextTimestampNano: String(Date.now()) + "000000", // ms → nano
    },
  ];
}

/** Biến thể thắng gần nhất theo shop — đỡ gọi đôi ở mọi lượt poll. */
const shopeeConvWinner = new Map<string, { name: string; expires: number }>();
const SHOPEE_VARIANT_TTL_MS = 10 * 60 * 1000;

async function fetchShopeeConversationsSmart(
  accessToken: string,
  shopId: string
): Promise<ShopeeConversation[]> {
  const readList = (
    d: Awaited<ReturnType<typeof getConversationList>>
  ): ShopeeConversation[] =>
    d.response?.page_result?.conversations ?? d.response?.conversations ?? [];
  const maxAt = (list: { last_message_timestamp?: number }[]) =>
    list.reduce((mx, c) => Math.max(mx, toMs(c.last_message_timestamp) ?? 0), 0);

  const cached = shopeeConvWinner.get(shopId);
  const variants = shopeeConvVariants();
  if (cached && cached.expires > Date.now()) {
    const v = variants.find((x) => x.name === cached.name) ?? variants[0];
    const data = await getConversationList({
      accessToken,
      shopId,
      direction: v.direction,
      nextTimestampNano: v.nextTimestampNano,
    });
    return readList(data);
  }

  // Chưa biết biến thể đúng → gọi song song, chấm theo mốc MỚI nhất
  const results = await Promise.allSettled(
    variants.map((v) =>
      getConversationList({
        accessToken,
        shopId,
        direction: v.direction,
        nextTimestampNano: v.nextTimestampNano,
      })
    )
  );
  let best: { name: string; list: ShopeeConversation[]; score: number } | null = null;
  let firstError: unknown = null;
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      if (!firstError) firstError = r.reason;
      return;
    }
    const list = readList(r.value);
    const score = maxAt(list);
    if (!best || score > best.score || (score === best.score && list.length > best.list.length)) {
      best = { name: variants[i].name, list, score };
    }
  });
  if (!best) throw firstError ?? new Error("Shopee get_conversation_list không trả dữ liệu");
  const winner: { name: string; list: ShopeeConversation[]; score: number } = best;
  shopeeConvWinner.set(shopId, {
    name: winner.name,
    expires: Date.now() + SHOPEE_VARIANT_TTL_MS,
  });
  return winner.list;
}

/** Các gian SHOPEE/LAZADA đã uỷ quyền trong tầm nhìn của người đang xem. */
async function connectedChannels(req: AuthRequest): Promise<Channel[]> {
  return prisma.channel.findMany({
    where: {
      AND: [
        channelScope(req) as object,
        {
          channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
          apiToken: { not: null },
          status: "ACTIVE",
        },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Tìm MỘT gian trong tầm nhìn theo id — dùng cho các thao tác ghi. */
async function findChannel(req: AuthRequest, channelId: string): Promise<Channel | null> {
  const list = await connectedChannels(req);
  return list.find((c) => c.id === channelId) ?? null;
}

// ============================================================
// GET /api/operations/conversations — inbox hợp nhất
// ============================================================
router.get("/conversations", async (req: AuthRequest, res, next) => {
  try {
    const channels = await connectedChannels(req);
    const conversations: OpsConversation[] = [];
    const errors: OpsChannelError[] = [];
    // Trạng thái từng gian kể cả khi THÀNH CÔNG — "kết nối OK nhưng 0 hội
    // thoại" khác hẳn "gian bị lỗi", UI cần phân biệt để người dùng khỏi
    // tưởng tính năng chưa chạy.
    const channelStats: {
      channelId: string;
      shopName: string;
      channelName: string;
      count: number;
    }[] = [];

    await Promise.all(
      channels.map(async (ch) => {
        // Đếm CỤC BỘ từng gian — hai job chạy song song cùng push vào mảng
        // chung nên hiệu số length trước/sau sẽ đếm nhầm của nhau.
        let added = 0;
        try {
          if (ch.channelName === ChannelName.SHOPEE) {
            const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
            const convList = await fetchShopeeConversationsSmart(accessToken, shopId);
            for (const c of convList) {
              if (c.conversation_id == null) continue;
              conversations.push({
                id: `${ch.id}:${c.conversation_id}`,
                channelId: ch.id,
                channelName: "SHOPEE",
                shopName: ch.shopName,
                customer: c.to_name || `Khách ${c.to_id ?? ""}`.trim(),
                lastMessage: shopeeMessageText(
                  c.latest_message_type,
                  c.latest_message_content?.text
                ),
                unread: c.unread_count ?? 0,
                lastAt: toMs(c.last_message_timestamp),
                buyerId: c.to_id != null ? String(c.to_id) : null,
                externalId: String(c.conversation_id),
              });
              added++;
            }
          } else {
            const accessToken = await getValidLazadaAccessToken(ch);
            const sessions = await withLazadaRetry(() => getImSessions({ accessToken }));
            for (const s of sessions) {
              const sid = s.session_id ?? s.sessionId;
              if (!sid) continue;
              conversations.push({
                id: `${ch.id}:${sid}`,
                channelId: ch.id,
                channelName: "LAZADA",
                shopName: ch.shopName,
                customer: s.title || "Khách Lazada",
                // Payload thật có thể trả object thay vì string — ép phòng thủ
                lastMessage: lazadaMessageText(
                  "1",
                  s.last_message_content ?? s.latest_message_content
                ),
                unread: Number(s.unread_count ?? s.unreadCount ?? 0) || 0,
                lastAt: toMs(s.last_message_time),
                buyerId: null,
                externalId: String(sid),
              });
              added++;
            }
          }
          channelStats.push({
            channelId: ch.id,
            shopName: ch.shopName,
            channelName: ch.channelName,
            count: added,
          });
        } catch (e) {
          errors.push({ channelId: ch.id, shopName: ch.shopName, message: errMsg(e) });
        }
      })
    );

    conversations.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    res.json({ conversations, errors, channelStats, channelCount: channels.length });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/operations/conversations/messages?channelId=&conversationId=&buyerId=
// ============================================================
router.get("/conversations/messages", async (req: AuthRequest, res, next) => {
  try {
    const channelId = String(req.query.channelId ?? "");
    const conversationId = String(req.query.conversationId ?? "");
    const buyerId = String(req.query.buyerId ?? "");
    if (!channelId || !conversationId) {
      res.status(400).json({ error: "Thiếu channelId hoặc conversationId" });
      return;
    }
    const ch = await findChannel(req, channelId);
    if (!ch) {
      res.status(404).json({ error: "Không tìm thấy gian hàng đã uỷ quyền" });
      return;
    }

    const messages: OpsMessage[] = [];
    if (ch.channelName === ChannelName.SHOPEE) {
      const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
      const data = await getChatMessages({ accessToken, shopId, conversationId });
      for (const m of data.response?.messages ?? []) {
        // Phía gửi: tin của KHÁCH có from_id = buyerId; còn lại coi là shop.
        const fromShop = buyerId ? String(m.from_id ?? "") !== buyerId : false;
        messages.push({
          id: String(m.message_id ?? messages.length),
          fromShop,
          text: shopeeMessageText(m.message_type, m.content?.text),
          at: toMs(m.created_timestamp),
          itemId: m.content?.item_id != null ? String(m.content.item_id) : null,
        });
      }
    } else {
      const accessToken = await getValidLazadaAccessToken(ch);
      const list = await getImMessages({ accessToken, sessionId: conversationId });
      for (const m of list) {
        const tpl = String(m.template_id ?? m.templateId ?? "1");
        // from_account_type: đối chiếu log thật cho chắc — tạm quy ước tài
        // khoản loại "2" (seller) là shop, còn lại là khách.
        const fromType = String(m.from_account_type ?? m.fromAccountType ?? "");
        messages.push({
          id: String(m.message_id ?? m.messageId ?? messages.length),
          fromShop: fromType === "2",
          text: lazadaMessageText(tpl, m.content),
          at: toMs(m.send_time ?? m.sendTime),
          itemId: null,
        });
      }
    }

    // Sàn trả mới nhất trước — đảo lại thành cũ → mới cho khung chat
    messages.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/operations/conversations/send — gửi tin nhắn văn bản
// Body: { channelId, conversationId, buyerId?, text }
// ============================================================
router.post("/conversations/send", async (req: AuthRequest, res, next) => {
  try {
    const { channelId, conversationId, buyerId, text } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "Nội dung tin nhắn trống" });
      return;
    }
    const ch = await findChannel(req, String(channelId ?? ""));
    if (!ch) {
      res.status(404).json({ error: "Không tìm thấy gian hàng đã uỷ quyền" });
      return;
    }

    if (ch.channelName === ChannelName.SHOPEE) {
      const toId = Number(buyerId);
      if (!Number.isFinite(toId) || toId <= 0) {
        res.status(400).json({ error: "Thiếu buyerId (to_id) của người mua Shopee" });
        return;
      }
      const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
      await sendChatMessage({ accessToken, shopId, toId, text: text.trim() });
    } else {
      const accessToken = await getValidLazadaAccessToken(ch);
      await sendImMessage({
        accessToken,
        sessionId: String(conversationId ?? ""),
        text: text.trim(),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/operations/reviews — đánh giá hợp nhất
//
// Shopee: get_comment lấy được TOÀN SHOP một lượt. Lazada bắt buộc theo từng
// item_id → quét tối đa LAZADA_REVIEW_ITEM_LIMIT sản phẩm sync gần nhất của
// gian (tránh đốt rate limit); đủ dùng cho màn phản hồi, sau này chuyển sang
// đồng bộ nền + bảng ChannelReview nếu cần lịch sử đầy đủ.
// ============================================================
const LAZADA_REVIEW_ITEM_LIMIT = 8;

/** Nghỉ giữa hai lượt gọi Lazada — API bị giới hạn ~1 call/giây TOÀN APP. */
const LAZADA_CALL_GAP_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry khi Lazada trả ApiCallLimit (ban ~1 giây). Rate limit tính TOÀN APP —
 * worker auto-sync trên production dùng chung app_key nên request từ đây có
 * thể dính ban dù là call đầu tiên. Ban ngắn → chờ rồi thử lại là qua.
 */
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

router.get("/reviews", async (req: AuthRequest, res, next) => {
  try {
    const channels = await connectedChannels(req);
    const reviews: OpsReview[] = [];
    const errors: OpsChannelError[] = [];

    /** Map item_id (externalId) → tên sản phẩm của một gian để hiển thị. */
    async function channelProductsOf(chId: string) {
      return prisma.channelProduct.findMany({
        where: { channelId: chId, externalId: { not: null } },
        select: { externalId: true, productName: true, lastSyncedAt: true },
        orderBy: { lastSyncedAt: "desc" },
      });
    }

    // Shopee: mỗi gian MỘT lượt get_comment — chạy song song thoải mái.
    const shopeeJobs = channels
      .filter((ch) => ch.channelName === ChannelName.SHOPEE)
      .map(async (ch) => {
        try {
          const cps = await channelProductsOf(ch.id);
          const nameByItem = new Map(
            cps.map((p) => [String(p.externalId), p.productName])
          );
          const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
          const data = await getComments({ accessToken, shopId });
          for (const c of data.response?.item_comment_list ?? []) {
            if (c.comment_id == null) continue;
            reviews.push({
              id: `${ch.id}:${c.comment_id}`,
              channelId: ch.id,
              channelName: "SHOPEE",
              shopName: ch.shopName,
              customer: c.buyer_username || "Người mua Shopee",
              rating: c.rating_star ?? 0,
              content: c.comment ?? "",
              reply: c.comment_reply?.reply ?? null,
              productName:
                nameByItem.get(String(c.item_id)) ?? `Item ${c.item_id ?? "?"}`,
              orderCode: c.order_sn ?? null,
              createdAt: toMs(c.create_time),
              externalId: String(c.comment_id),
            });
          }
        } catch (e) {
          errors.push({ channelId: ch.id, shopName: ch.shopName, message: errMsg(e) });
        }
      });

    // Lazada: rate limit ~1 call/giây TOÀN APP → mọi gian + mọi item chạy
    // TUẦN TỰ, chen nhịp nghỉ. Đã dính ApiCallLimit khi thử chạy song song.
    const lazadaJob = (async () => {
      for (const ch of channels) {
        if (ch.channelName !== ChannelName.LAZADA) continue;
        try {
          const cps = await channelProductsOf(ch.id);
          const accessToken = await getValidLazadaAccessToken(ch);
          // externalId Lazada lưu dạng "itemId-skuId" (mỗi biến thể một dòng)
          // → tách lấy itemId và KHỬ TRÙNG để không quét một item nhiều lần.
          const itemNames = new Map<string, string>();
          for (const p of cps) {
            const itemId = String(p.externalId).split("-")[0];
            if (itemId && !itemNames.has(itemId)) itemNames.set(itemId, p.productName);
          }
          const items = [...itemNames.entries()].slice(0, LAZADA_REVIEW_ITEM_LIMIT);
          for (const [itemId, productName] of items) {
            const item = { externalId: itemId, productName };
            const groups = await withLazadaRetry(() =>
              getItemReviews({ accessToken, itemId })
            );
            await sleep(LAZADA_CALL_GAP_MS);
            for (const g of groups) {
              for (const r of g.reviews ?? []) {
                if (r.id == null) continue;
                // Chỉ lấy đánh giá SẢN PHẨM (bỏ review seller/logistics trùng đơn)
                if (r.review_type && r.review_type !== "PRODUCT_REVIEW") continue;
                reviews.push({
                  id: `${ch.id}:${r.id}`,
                  channelId: ch.id,
                  channelName: "LAZADA",
                  shopName: ch.shopName,
                  customer: "Người mua Lazada", // API không trả tên khách
                  rating: Number(g.ratings?.product_rating ?? 0) || 0,
                  content: r.review_content ?? "",
                  reply: r.seller_reply || null,
                  productName: item.productName,
                  orderCode: g.order_id != null ? String(g.order_id) : null,
                  createdAt: toMs(r.create_time),
                  externalId: String(r.id),
                });
              }
            }
          }
        } catch (e) {
          errors.push({ channelId: ch.id, shopName: ch.shopName, message: errMsg(e) });
        }
      }
    })();

    await Promise.all([...shopeeJobs, lazadaJob]);

    reviews.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    res.json({ reviews, errors, channelCount: channels.length });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/operations/reviews/reply — trả lời một đánh giá
// Body: { channelId, reviewId, content }
// ============================================================
router.post("/reviews/reply", async (req: AuthRequest, res, next) => {
  try {
    const { channelId, reviewId, content } = req.body ?? {};
    if (typeof content !== "string" || !content.trim()) {
      res.status(400).json({ error: "Nội dung trả lời trống" });
      return;
    }
    const ch = await findChannel(req, String(channelId ?? ""));
    if (!ch) {
      res.status(404).json({ error: "Không tìm thấy gian hàng đã uỷ quyền" });
      return;
    }

    if (ch.channelName === ChannelName.SHOPEE) {
      const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
      const commentId = Number(reviewId);
      if (!Number.isFinite(commentId)) {
        res.status(400).json({ error: "reviewId Shopee không hợp lệ" });
        return;
      }
      await replyComment({ accessToken, shopId, commentId, reply: content.trim() });
    } else {
      const accessToken = await getValidLazadaAccessToken(ch);
      await replyReview({
        accessToken,
        reviewId: String(reviewId ?? ""),
        content: content.trim(),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/operations/product-context?query=... | ?channelId=&itemId=...
//
// Ngữ cảnh sản phẩm cho AI Copilot + widget "Sản phẩm đang chat":
//   - query : tìm theo SKU kho / SKU sàn / tên sản phẩm
//   - itemId: khách chat đính kèm sản phẩm (Shopee trả item_id trong tin nhắn)
// Trả thông số (material/care/sizeChart từ Product) + tồn vật lý; tồn SÀN lấy
// LIVE từ Shopee get_model_list khi sản phẩm thuộc gian Shopee có externalId
// (Lazada chưa có API tra 1 item — trả null, frontend tự fallback tồn vật lý).
// ============================================================
router.get("/product-context", async (req: AuthRequest, res, next) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    const itemId = typeof req.query.itemId === "string" ? req.query.itemId.trim() : "";
    const channelId =
      typeof req.query.channelId === "string" ? req.query.channelId.trim() : "";
    if (!query && !itemId) {
      res.status(400).json({ error: "Thiếu query hoặc itemId" });
      return;
    }

    // Ưu tiên tra theo item đính kèm hội thoại; không có thì tìm text.
    // Thứ tự dò theo query: khớp CHÍNH XÁC channelSku trước, và trong mỗi bậc
    // ưu tiên dòng ĐÃ LIÊN KẾT kho (productId != null) — gõ "TC025" phải ra
    // đúng TC025 kèm tồn vật lý, không phải dòng biến thể mồ côi vừa sync.
    const scope = channelScope(req) as object;
    const cpInclude = { product: true, channel: true } as const;
    let cp = null;
    if (itemId) {
      const byItem = { externalId: itemId, ...(channelId ? { channelId } : {}) };
      cp =
        (await prisma.channelProduct.findFirst({
          where: { ...byItem, channel: scope, productId: { not: null } },
          include: cpInclude,
        })) ??
        (await prisma.channelProduct.findFirst({
          where: { ...byItem, channel: scope },
          include: cpInclude,
        }));
    } else {
      const exact = { channelSku: { equals: query, mode: "insensitive" as const } };
      const fuzzy = {
        OR: [
          { channelSku: { contains: query, mode: "insensitive" as const } },
          { productName: { contains: query, mode: "insensitive" as const } },
        ],
      };
      for (const cond of [
        { ...exact, productId: { not: null } },
        exact,
        { ...fuzzy, productId: { not: null } },
        fuzzy,
      ]) {
        cp = await prisma.channelProduct.findFirst({
          where: { channel: scope, ...cond },
          include: cpInclude,
          orderBy: { lastSyncedAt: "desc" },
        });
        if (cp) break;
      }
    }

    // Không liên kết sẵn → thử thẳng kho vật lý: theo query của nhân viên,
    // hoặc theo channelSku của item khách đính kèm (luồng itemId trước đây bỏ
    // sót bước này nên tồn vật lý luôn null → UI báo 0 dù kho còn hàng).
    let product = cp?.product ?? null;
    if (!product) {
      const skuGuess = query || cp?.channelSku || "";
      if (skuGuess) {
        product =
          (await prisma.product.findFirst({
            where: {
              userId: req.ownerId!,
              skuCode: { equals: skuGuess, mode: "insensitive" },
            },
          })) ??
          (query
            ? await prisma.product.findFirst({
                where: {
                  userId: req.ownerId!,
                  OR: [
                    { skuCode: { contains: query, mode: "insensitive" } },
                    { productName: { contains: query, mode: "insensitive" } },
                  ],
                },
              })
            : null);
      }
    }

    if (!cp && !product) {
      res.json({ found: false });
      return;
    }

    // Tồn SÀN live (chỉ Shopee, best-effort — lỗi thì để null, không chặn)
    let channelStock: number | null = null;
    if (cp?.channel.channelName === ChannelName.SHOPEE && cp.externalId) {
      try {
        const { accessToken, shopId } = await getValidShopeeAccessToken(cp.channel);
        const models = await getModelList(accessToken, shopId, Number(cp.externalId));
        if (models.length > 0) {
          // Có phân loại: cộng đúng model khớp channelSku, không khớp thì cộng hết
          const matched = models.filter(
            (m) => (m.model_sku?.trim() || "") === cp.channelSku
          );
          const stocks = (matched.length > 0 ? matched : models)
            .map((m) => shopeeSellerStock(m.stock_info_v2))
            .filter((s): s is number => s !== null);
          // Không model nào đọc được tồn → trả null (không biết) thay vì 0 —
          // số 0 giả làm widget báo "Hết hàng" trong khi sàn vẫn bán được.
          channelStock = stocks.length > 0 ? stocks.reduce((a, b) => a + b, 0) : null;
        }
      } catch {
        channelStock = null; // token lỗi/permission — widget vẫn hiện phần còn lại
      }
    }

    // Link xem/đặt hàng cho nút "Gửi thẻ sản phẩm": Shopee cần shopId + itemId;
    // Lazada chỉ cần itemId (externalId Lazada lưu dạng "itemId-skuId").
    let productUrl: string | null = null;
    if (cp?.externalId) {
      if (cp.channel.channelName === ChannelName.SHOPEE && cp.channel.externalShopId) {
        productUrl = `https://shopee.vn/product/${cp.channel.externalShopId}/${cp.externalId}`;
      } else if (cp.channel.channelName === ChannelName.LAZADA) {
        productUrl = `https://www.lazada.vn/products/-i${String(cp.externalId).split("-")[0]}.html`;
      }
    }
    // Giá niêm yết trên sàn ưu tiên (đúng số khách thấy); 0 = chưa sync giá.
    const cpPrice = cp ? Number(cp.price) : 0;
    const basePrice = product ? Number(product.sellingPrice) : 0;
    const price = cpPrice > 0 ? cpPrice : basePrice > 0 ? basePrice : null;

    res.json({
      found: true,
      product: {
        sku: product?.skuCode ?? cp?.channelSku ?? "",
        name: product?.productName ?? cp?.productName ?? "",
        imageUrl: product?.imageUrl ?? cp?.imageUrl ?? null,
        material: product?.material ?? null,
        care: product?.careInstructions ?? null,
        sizeChart: product?.sizeChart ?? null,
        physicalStock:
          product != null ? product.quantityInStock - product.holdQuantity : null,
        channelStock,
        channelName: cp?.channel.channelName ?? null,
        variantName: cp?.variantName ?? null,
        linked: product != null,
        productUrl,
        price,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
