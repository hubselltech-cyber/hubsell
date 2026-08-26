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
import multer from "multer";
import {
  ChannelName,
  DeliveryFailChatStatus,
  ReturnStatus,
  ShippingStatus,
  type Channel,
} from "@prisma/client";
import { prisma } from "../prisma";
import { requirePermission, type AuthRequest } from "../auth";
import { channelScope } from "../channel-filter";
import {
  getComments,
  getConversationList,
  getChatMessages,
  getTrackingInfo,
  getItemBaseInfo,
  getModelList,
  replyComment,
  sendChatImageMessage,
  sendChatItemMessage,
  sendChatMessage,
  shopeeSellerStock,
  uploadChatImage,
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
import {
  copilotConfigured,
  generateCopilotSuggestion,
} from "../integrations/ai/copilot";
import {
  classifyDeliveryFailOutcome,
  countFailedDeliveries,
  effectiveDeliveryFailConfig,
  mergeDeliveryFailOutcome,
} from "../integrations/shopee/delivery-fail";

const router = Router();

// Siết quyền theo LÁ (mount app.ts chỉ kiểm "có lá operations.* bất kỳ"):
// chat và đánh giá là hai quyền tách bạch; product-context phục vụ khung chat;
// copilot gợi ý cho cả hai nghiệp vụ nên ai có một trong hai là dùng được.
router.use("/conversations", requirePermission("operations.chat"));
router.use("/product-context", requirePermission("operations.chat"));
router.use("/reviews", requirePermission("operations.reviews"));
router.use("/copilot-suggest", requirePermission("operations.chat", "operations.reviews"));
// Cứu đơn giao thất bại nằm trong màn Cấu hình kịch bản AI → cùng lá quyền.
router.use("/delivery-fail", requirePermission("operations.ai-rules"));

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
  /**
   * Tin CUỐI là của shop? — nguồn cho bộ lọc Đã/Chưa trả lời trên client.
   * Shopee so latest_message_from_id với to_id (người mua); Lazada không trả
   * người gửi trong session list → null (chỉ hiện ở tab "Tất cả").
   */
  lastFromShop: boolean | null;
}

interface OpsMessage {
  id: string;
  fromShop: boolean;
  text: string;
  at: number | null;
  /** item_id nếu tin nhắn đính kèm sản phẩm — frontend tra ngữ cảnh SP. */
  itemId: string | null;
  /** url ảnh nếu là tin kiểu image — client render bong bóng ảnh. */
  imageUrl: string | null;
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
  // ── Bổ sung 14/08 từ danh sách type đầy đủ của docs sellerchat (khảo sát
  // qua AI Assistant open.shopee.com — docs gốc bị khoá quyền xem) ──
  faq: "[Hỏi đáp với bot Shopee]",
  faq_question: "[Câu hỏi gửi bot Shopee]",
  faq_bot_response: "[Bot Shopee trả lời]",
  faq_feedback_prompt: "[Bot hỏi khách có hài lòng]",
  faq_feedback: "[Khách chấm bot]",
  faq_unsupported: "[Nội dung bot không hỗ trợ]",
  faq_liveagent_prompt: "[Bot gợi ý gặp Người bán]",
  notification: "[Thông báo hệ thống]",
  webview: "[Nội dung tương tác]",
  shopping_cart: "[Giỏ hàng]",
  flash_sale: "[Flash sale]",
  add_on_deal: "[Deal mua kèm]",
  bundle_deal: "[Combo khuyến mãi]",
  unrated_order_reminder: "[Nhắc đánh giá đơn]",
  customer_service_entrance: "[Khách vào từ mục CSKH]",
  feed_story: "[Bài đăng Shopee Feed]",
  return_refund_card: "[Thẻ Trả hàng/Hoàn tiền]",
  rr_entrance_card: "[Thẻ mở yêu cầu Trả/Hoàn]",
  track_rr_status_card: "[Thẻ trạng thái Trả/Hoàn]",
  rr_operate_feedback_card: "[Thẻ phản hồi Trả/Hoàn]",
  logistics_card: "[Thẻ vận chuyển]",
  logistics_issue_enquiry_card: "[Thẻ hỏi vấn đề vận chuyển]",
  expedited_logistics_card: "[Thẻ giao hỏa tốc]",
  late_delivery_compensation_voucher: "[Voucher đền giao trễ]",
  crm_item_list: "[Tin quảng bá sản phẩm]",
  crm_order_rate: "[Tin mời đánh giá]",
  crm_bundle_item_inform_promotion: "[Tin báo khuyến mãi]",
  crm_bundle_item_new_arrival: "[Tin hàng mới về]",
  crm_bundle_item_custom_message: "[Tin chăm sóc khách]",
};

/**
 * Text hiển thị cho một tin Shopee — luôn trả CHUỖI, không bao giờ undefined.
 * Nhận cả content để xử lý các tin bot/FAQ ("Lịch sử hỏi đáp" — probe 14/08):
 * hai type này phải bắt TRƯỚC nhánh text vì content.text của chúng là chữ hệ
 * thống ("Chat với Người bán") — hiện trần thì trông như khách tự gõ.
 */
function shopeeMessageText(
  messageType?: string,
  content?: { text?: string; messages?: string[] } | null
): string {
  if (messageType === "faq_liveagent") {
    return "🤖 Khách đã hỏi đáp với bot Shopee, bấm «Chat với Người bán»";
  }
  if (messageType === "bundle_message") {
    // Vỏ gói "Lịch sử hỏi đáp": chỉ đếm được số lượt — Shopee giấu nội dung
    // tin con khỏi API (đã probe đủ hướng), nói thẳng để người trực chat hiểu.
    const n = Array.isArray(content?.messages) ? content.messages.length : 0;
    return `🤖 Khách hỏi đáp với bot Shopee${n ? ` (${n} tin)` : ""} — sàn không cung cấp nội dung qua API`;
  }
  const text = content?.text;
  if (typeof text === "string" && text.trim()) return text;
  if (!messageType || messageType === "text") return "";
  return SHOPEE_TYPE_LABEL[messageType] ?? `[${messageType}]`;
}

/**
 * Url ảnh của tin Shopee kiểu image / image_with_text — null nếu payload
 * không có (khi đó UI rơi về nhãn "[Hình ảnh]"). Tên trường tuỳ region:
 * image_url / url / thumb_url — đọc phòng thủ cả ba.
 */
function shopeeMessageImageUrl(
  messageType?: string,
  content?: { image_url?: string; url?: string; thumb_url?: string } | null
): string | null {
  if (messageType !== "image" && messageType !== "image_with_text") return null;
  return content?.image_url ?? content?.url ?? content?.thumb_url ?? null;
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

/**
 * Url ảnh của tin Lazada template 3 (ảnh) — content là JSON string
 * {"iUrl":"…"} nhưng đề phòng payload trả sẵn object / tên trường khác
 * (imgUrl, url) như mọi chỗ đọc IM Lazada. Hỏng thì null, không ném.
 */
function lazadaMessageImageUrl(templateId: string, content: unknown): string | null {
  if (templateId !== "3") return null;
  let obj: Record<string, unknown> | null = null;
  if (typeof content === "string" && content.trim()) {
    try {
      obj = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (content && typeof content === "object") {
    obj = content as Record<string, unknown>;
  }
  const url = obj?.iUrl ?? obj?.imgUrl ?? obj?.url;
  return typeof url === "string" && url.trim() ? url : null;
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
                  c.latest_message_content
                ),
                unread: c.unread_count ?? 0,
                lastAt: toMs(c.last_message_timestamp),
                buyerId: c.to_id != null ? String(c.to_id) : null,
                externalId: String(c.conversation_id),
                lastFromShop:
                  c.latest_message_from_id != null && c.to_id != null
                    ? String(c.latest_message_from_id) !== String(c.to_id)
                    : null,
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
                lastFromShop: null,
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
        // faq_liveagent: nội dung hỏi đáp với bot bị sàn giấu, nhưng
        // source_content kèm SP/đơn khách đang xem lúc bấm nút — ngữ cảnh
        // quý nhất để biết khách cần gì, nối vào text + itemId (ra thẻ SP).
        const isLiveagent = m.message_type === "faq_liveagent";
        const imageUrl = shopeeMessageImageUrl(m.message_type, m.content);
        let text = shopeeMessageText(m.message_type, m.content);
        // Có ảnh thật thì bỏ nhãn thay thế "[Hình ảnh]" — bong bóng chỉ cần
        // ảnh; image_with_text giữ nguyên chữ thật khách gõ kèm.
        if (imageUrl && text === SHOPEE_TYPE_LABEL[m.message_type ?? ""]) text = "";
        if (isLiveagent && m.source_content?.order_sn) {
          text += ` — về đơn ${m.source_content.order_sn}`;
        }
        const itemId =
          m.content?.item_id != null
            ? String(m.content.item_id)
            : isLiveagent && m.source_content?.item_id != null
              ? String(m.source_content.item_id)
              : null;
        messages.push({
          id: String(m.message_id ?? messages.length),
          fromShop,
          text,
          at: toMs(m.created_timestamp),
          itemId,
          imageUrl,
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
        const imageUrl = lazadaMessageImageUrl(tpl, m.content);
        let text = lazadaMessageText(tpl, m.content);
        if (imageUrl && text === LAZADA_TEMPLATE_LABEL[tpl]) text = "";
        messages.push({
          id: String(m.message_id ?? m.messageId ?? messages.length),
          fromShop: fromType === "2",
          text,
          at: toMs(m.send_time ?? m.sendTime),
          itemId: null,
          imageUrl,
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
// POST /api/operations/conversations/send-image — gửi ẢNH (multipart "image")
// Fields: channelId, buyerId. Chỉ Shopee: upload lên file server sàn lấy url
// rồi send_message kiểu image. Lazada thiếu quyền im/* — trả 400 nói thẳng.
// ============================================================

// Ảnh chat vào bộ nhớ (không lưu đĩa), giới hạn 8MB — Shopee nhận jpg/png/gif
const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpe?g|png|gif|webp)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Chỉ chấp nhận ảnh JPG/PNG/GIF/WebP"));
    }
  },
});

router.post(
  "/conversations/send-image",
  chatImageUpload.single("image"),
  async (req: AuthRequest, res, next) => {
    try {
      const { channelId, buyerId } = req.body ?? {};
      if (!req.file) {
        res.status(400).json({ error: "Thiếu file ảnh (field \"image\")" });
        return;
      }
      const ch = await findChannel(req, String(channelId ?? ""));
      if (!ch) {
        res.status(404).json({ error: "Không tìm thấy gian hàng đã uỷ quyền" });
        return;
      }
      if (ch.channelName !== ChannelName.SHOPEE) {
        res.status(400).json({
          error: "Gửi ảnh hiện chỉ hỗ trợ Shopee — Lazada chưa được sàn cấp quyền chat.",
        });
        return;
      }
      const toId = Number(buyerId);
      if (!Number.isFinite(toId) || toId <= 0) {
        res.status(400).json({ error: "Thiếu buyerId (to_id) của người mua Shopee" });
        return;
      }
      const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
      const imageUrl = await uploadChatImage({
        accessToken,
        shopId,
        buffer: req.file.buffer,
        filename: req.file.originalname || "photo.jpg",
        mime: req.file.mimetype,
      });
      await sendChatImageMessage({ accessToken, shopId, toId, imageUrl });
      res.json({ ok: true, imageUrl });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// POST /api/operations/conversations/send-item — gửi THẺ SẢN PHẨM chuẩn sàn
// Body: { channelId, buyerId, itemId }
//
// Chỉ Shopee (message_type "item"): khách thấy card sản phẩm bấm mua được
// ngay trong app. Lazada có template 10006 nhưng app đang thiếu quyền im/* —
// frontend tự fallback text + link đúng sàn, route này trả 400 nói thẳng.
// ============================================================
router.post("/conversations/send-item", async (req: AuthRequest, res, next) => {
  try {
    const { channelId, buyerId, itemId } = req.body ?? {};
    const ch = await findChannel(req, String(channelId ?? ""));
    if (!ch) {
      res.status(404).json({ error: "Không tìm thấy gian hàng đã uỷ quyền" });
      return;
    }
    if (ch.channelName !== ChannelName.SHOPEE) {
      res.status(400).json({
        error: "Gửi thẻ sản phẩm hiện chỉ hỗ trợ Shopee — Lazada dùng tin nhắn kèm link.",
      });
      return;
    }
    const toId = Number(buyerId);
    const item = Number(itemId);
    if (!Number.isFinite(toId) || toId <= 0) {
      res.status(400).json({ error: "Thiếu buyerId (to_id) của người mua Shopee" });
      return;
    }
    if (!Number.isFinite(item) || item <= 0) {
      res.status(400).json({ error: "itemId sản phẩm Shopee không hợp lệ" });
      return;
    }
    const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
    await sendChatItemMessage({ accessToken, shopId, toId, itemId: item });
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
    //
    // ⚠️ KHÔNG dùng channelScope(req) ở đây: hàm đó TỰ ĐỌC ?channelId và ghim
    // cứng gian vào scope — làm pass "tìm chéo gian" bên dưới thành fallback
    // giả (gian chưa đồng bộ danh mục là found:false vĩnh viễn). Tự dựng scope
    // chủ sở hữu + giới hạn gian nhân viên; việc ghim gian để pass 1 cầm riêng.
    const scope: { userId: string; id?: { in: string[] } } = {
      userId: req.ownerId!,
    };
    if (req.allowedChannelIds) scope.id = { in: req.allowedChannelIds };
    const cpInclude = { product: true, channel: true } as const;
    let cp = null;
    if (itemId) {
      // externalId sản phẩm CÓ phân loại lưu "itemId-modelId" (cả Shopee lẫn
      // Lazada) — tin nhắn khách đính kèm chỉ mang itemId gốc nên phải khớp
      // cả dạng đúng bằng lẫn dạng có đuôi "-modelId".
      const byItem = {
        OR: [{ externalId: itemId }, { externalId: { startsWith: `${itemId}-` } }],
        ...(channelId ? { channelId } : {}),
      };
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
      // STRICT CHANNEL ISOLATION: hội thoại gửi kèm channelId thì tìm TRONG
      // gian đó trước — thà không có link còn hơn dính link sàn khác (bug
      // thật: chat Shopee mà thẻ SP sinh link lazada.vn vì TC025 khớp dòng
      // Lazada trước). Gian chưa đồng bộ danh mục (bảng đệm rỗng) thì rơi
      // xuống tìm CHÉO GIAN chỉ để lấy thông số — link/itemId/tồn sàn của
      // gian khác bị lược sạch ở dưới, ô tra cứu không chết cứng.
      const exact = { channelSku: { equals: query, mode: "insensitive" as const } };
      const fuzzy = {
        OR: [
          { channelSku: { contains: query, mode: "insensitive" as const } },
          { productName: { contains: query, mode: "insensitive" as const } },
        ],
      };
      const tiers = [
        { ...exact, productId: { not: null } },
        exact,
        { ...fuzzy, productId: { not: null } },
        fuzzy,
      ];
      const passes = channelId ? [{ channelId }, {}] : [{}];
      for (const pass of passes) {
        for (const cond of tiers) {
          cp = await prisma.channelProduct.findFirst({
            where: { channel: scope, ...pass, ...cond },
            include: cpInclude,
            orderBy: { lastSyncedAt: "desc" },
          });
          if (cp) break;
        }
        if (cp) break;
      }
    }
    // Match nằm NGOÀI gian hội thoại → chỉ được dùng thông số, cấm link/tồn
    const crossChannel = Boolean(channelId && cp && cp.channelId !== channelId);

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

    // externalId có thể là "itemId-modelId" (sản phẩm có phân loại) — mọi chỗ
    // gọi sàn / dựng link / trả itemId đều phải dùng itemId GỐC đã tách.
    const rootItemId = cp?.externalId ? String(cp.externalId).split("-")[0] : null;

    // Tồn SÀN live + THÔNG SỐ SÀN (chỉ Shopee, best-effort — lỗi thì để null,
    // không chặn). getModelList vẽ ma trận tồn thật; getItemBaseInfo lấy mô tả
    // + thuộc tính seller khai trên sàn (Chất liệu, Xuất xứ…) — nguồn thông số
    // CHÍNH cho AI Copilot, thay cho cấu hình material/care ở Kho vật lý.
    let channelStock: number | null = null;
    let channelVariants: { name: string; stock: number | null }[] | null = null;
    let channelDescription: string | null = null;
    let channelAttributes: { name: string; value: string }[] | null = null;
    let channelMaterial: string | null = null;
    if (!crossChannel && cp?.channel.channelName === ChannelName.SHOPEE && rootItemId) {
      try {
        const { accessToken, shopId } = await getValidShopeeAccessToken(cp.channel);
        // allSettled: một trong hai API hỏng thì vẫn dùng được nửa còn lại
        const [modelsRs, baseRs] = await Promise.allSettled([
          getModelList(accessToken, shopId, Number(rootItemId)),
          getItemBaseInfo(accessToken, shopId, [Number(rootItemId)]),
        ]);
        const models = modelsRs.status === "fulfilled" ? modelsRs.value : [];
        if (models.length > 0) {
          channelVariants = models.map((m) => ({
            name: m.model_name?.trim() || m.model_sku?.trim() || "Phân loại",
            stock: shopeeSellerStock(m.stock_info_v2),
          }));
          const stocks = channelVariants
            .map((v) => v.stock)
            .filter((s): s is number => s !== null);
          // Không model nào đọc được tồn → trả null (không biết) thay vì 0 —
          // số 0 giả làm widget báo "Hết hàng" trong khi sàn vẫn bán được.
          channelStock = stocks.length > 0 ? stocks.reduce((a, b) => a + b, 0) : null;
        }
        const base = baseRs.status === "fulfilled" ? baseRs.value[0] : undefined;
        if (base) {
          // Mô tả thường + mô tả mở rộng (item bật extended description thì
          // text nằm rải trong field_list) — cắt 1500 ký tự đủ cho AI đọc.
          const extended = (base.description_info?.extended_description?.field_list ?? [])
            .map((f) => f.text?.trim())
            .filter(Boolean)
            .join("\n");
          const desc = (base.description?.trim() || extended).trim();
          channelDescription = desc ? desc.slice(0, 1500) : null;
          const attrs = (base.attribute_list ?? [])
            .map((a) => ({
              name: a.original_attribute_name?.trim() ?? "",
              value: (a.attribute_value_list ?? [])
                .map((v) => v.original_value_name?.trim())
                .filter(Boolean)
                .join(", "),
            }))
            .filter((a) => a.name && a.value);
          // Chất liệu tách riêng (dòng khách hỏi nhiều nhất) — phần còn lại
          // giữ nguyên danh sách cho widget + ngữ cảnh AI.
          const materialAttr = attrs.find((a) => /chất liệu|material|vải|fabric/i.test(a.name));
          channelMaterial = materialAttr?.value ?? null;
          const rest = attrs.filter((a) => a !== materialAttr);
          channelAttributes = rest.length > 0 ? rest : null;
        }
      } catch {
        channelStock = null; // token lỗi/permission — widget vẫn hiện phần còn lại
      }
    }

    // Link xem/đặt hàng cho nút "Gửi thẻ sản phẩm": Shopee cần shopId + itemId;
    // Lazada chỉ cần itemId (externalId Lazada lưu dạng "itemId-skuId").
    let productUrl: string | null = null;
    if (!crossChannel && cp && rootItemId) {
      if (cp.channel.channelName === ChannelName.SHOPEE && cp.channel.externalShopId) {
        productUrl = `https://shopee.vn/product/${cp.channel.externalShopId}/${rootItemId}`;
      } else if (cp.channel.channelName === ChannelName.LAZADA) {
        productUrl = `https://www.lazada.vn/products/-i${rootItemId}.html`;
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
        // Thông số ưu tiên TỪ SÀN (đúng thứ khách đang đọc trên listing);
        // Kho vật lý chỉ còn là fallback khi sàn không khai.
        material: channelMaterial ?? product?.material ?? null,
        care: product?.careInstructions ?? null,
        channelDescription,
        channelAttributes,
        sizeChart: product?.sizeChart ?? null,
        physicalStock:
          product != null ? product.quantityInStock - product.holdQuantity : null,
        channelStock,
        channelVariants,
        // Match chéo gian: giấu danh tính sàn để frontend không dán nhãn/tồn
        // của gian khác vào hội thoại đang mở
        channelName: crossChannel ? null : cp?.channel.channelName ?? null,
        variantName: cp?.variantName ?? null,
        linked: product != null,
        productUrl,
        price,
        // item_id GỐC phía sàn — nguồn cho nút gửi thẻ SP chuẩn Shopee
        itemId: !crossChannel ? rootItemId : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/operations/copilot-suggest — AI Copilot THẬT (Claude API)
//
// Body: { context: string|null, customerMessage: string, channelLabel: string|null }
// Trả { text, intent } cùng hợp đồng với engine luật ở frontend.
// Chưa cấu hình ANTHROPIC_API_KEY → 503 code NO_AI_KEY, frontend tự rơi về
// engine luật và ngưng gọi lại trong phiên — chat không phụ thuộc AI.
// ============================================================
router.post("/copilot-suggest", async (req: AuthRequest, res, next) => {
  try {
    const { context, customerMessage, channelLabel } = req.body ?? {};
    if (typeof customerMessage !== "string" || !customerMessage.trim()) {
      res.status(400).json({ error: "Thiếu customerMessage" });
      return;
    }
    if (!copilotConfigured()) {
      res.status(503).json({
        error: "Chưa cấu hình ANTHROPIC_API_KEY cho AI Copilot",
        code: "NO_AI_KEY",
      });
      return;
    }
    const suggestion = await generateCopilotSuggestion({
      context: typeof context === "string" && context.trim() ? context : null,
      customerMessage,
      channelLabel:
        typeof channelLabel === "string" && channelLabel.trim() ? channelLabel : null,
    });
    res.json(suggestion);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// CỨU ĐƠN GIAO THẤT BẠI — cấu hình + nhật ký (tab "Giao không thành công")
//
// Worker scanShopeeDeliveryFails (order-auto-sync nhịp giờ) là bên GHI notice;
// ba route dưới chỉ đọc/ghi cấu hình theo CHỦ SHOP (req.ownerId — nhân viên
// được tick lá operations.ai-rules thao tác trên cấu hình của chủ).
// ============================================================

router.get("/delivery-fail/config", async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.deliveryFailConfig.findUnique({
      where: { ownerId: req.ownerId! },
    });
    // Trả bản HIỆU LỰC (template rỗng đã điền mặc định) — ô soạn thảo hiện
    // đúng câu sẽ được gửi, không bắt người dùng đoán mặc định là gì.
    res.json(effectiveDeliveryFailConfig(row));
  } catch (err) {
    next(err);
  }
});

router.put("/delivery-fail/config", async (req: AuthRequest, res, next) => {
  try {
    const { alertEnabled, autoChatEnabled, chatTemplate } = req.body ?? {};
    if (
      typeof alertEnabled !== "boolean" ||
      typeof autoChatEnabled !== "boolean" ||
      typeof chatTemplate !== "string"
    ) {
      res.status(400).json({ error: "Thiếu alertEnabled / autoChatEnabled / chatTemplate" });
      return;
    }
    const data = {
      alertEnabled,
      autoChatEnabled,
      chatTemplate: chatTemplate.trim().slice(0, 1000),
    };
    const row = await prisma.deliveryFailConfig.upsert({
      where: { ownerId: req.ownerId! },
      create: { ownerId: req.ownerId!, ...data },
      update: data,
    });
    res.json(effectiveDeliveryFailConfig(row));
  } catch (err) {
    next(err);
  }
});

router.get("/delivery-fail/log", async (req: AuthRequest, res, next) => {
  try {
    const notices = await prisma.deliveryFailNotice.findMany({
      where: { ownerId: req.ownerId! },
      orderBy: { detectedAt: "desc" },
      take: 50,
      select: {
        id: true,
        failCount: true,
        detectedAt: true,
        outcome: true,
        chatStatus: true,
        chatError: true,
        sentMessage: true,
        sentAt: true,
        order: {
          select: {
            orderCode: true,
            customerName: true,
            shippingStatus: true,
            returnStatus: true,
            channel: { select: { shopName: true, channelName: true } },
          },
        },
      },
    });
    // ---- BÁO CÁO "KẾT QUẢ CỨU ĐƠN" — tính trên TOÀN BỘ cảnh báo của chủ
    // shop (bảng trên chỉ hiện 50 dòng mới nhất, số tổng phải đủ lịch sử).
    const all = await prisma.deliveryFailNotice.findMany({
      where: { ownerId: req.ownerId! },
      select: {
        outcome: true,
        chatStatus: true,
        order: {
          select: { shippingStatus: true, returnStatus: true, totalAmount: true },
        },
      },
    });
    const summary = {
      total: all.length,
      saved: 0,
      lost: 0,
      pending: 0,
      savedRevenue: 0,
      // Số đơn "cứu được" MÀ Hubsell thực sự đã nhắn khách — phần còn lại là
      // shipper tự giao lại thành công (anh Trung 26/08: đừng nhận vơ công).
      savedMessaged: 0,
    };
    for (const n of all) {
      // Gộp: Order đã chốt thì thắng; Order còn mù (TO_CONFIRM_RECEIVE/SHIPPED)
      // thì lấy kết quả worker chốt từ tracking — hết cảnh 0-0 ảo (probe 26/08).
      const outcome = mergeDeliveryFailOutcome(classifyDeliveryFailOutcome(n.order), n.outcome);
      summary[outcome]++;
      if (outcome === "saved") {
        summary.savedRevenue += Number(n.order.totalAmount);
        if (n.chatStatus === DeliveryFailChatStatus.SENT) summary.savedMessaged++;
      }
    }

    res.json({
      notices: notices.map((n) => ({
        id: n.id,
        orderCode: n.order.orderCode,
        customerName: n.order.customerName,
        shopName: n.order.channel.shopName,
        channelName: n.order.channel.channelName,
        shippingStatus: n.order.shippingStatus,
        returnStatus: n.order.returnStatus,
        outcome: mergeDeliveryFailOutcome(classifyDeliveryFailOutcome(n.order), n.outcome),
        failCount: n.failCount,
        detectedAt: n.detectedAt,
        chatStatus: n.chatStatus,
        chatError: n.chatError,
        sentMessage: n.sentMessage,
        sentAt: n.sentAt,
      })),
      summary,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /delivery-fail/probe — DỤNG CỤ CHẨN ĐOÁN (chỉ ĐỌC, dùng tay 25/08).
//
// Trả lời hai câu hỏi khi chủ shop "đơn hoàn nhiều mà không thấy cảnh báo":
//   1. THỰC ĐỊA: các đơn đã HOÀN/HỦY gần đây (mặc định 7 ngày, ?days= đổi
//      được) — hành trình get_tracking_info của chúng có bao nhiêu mốc
//      FAILED_DELIVERED? Sàn có dùng đúng enum như docs không? Nếu đa số đơn
//      hoàn chỉ có 0-1 mốc thì ngưỡng 2 lượt của worker KHÔNG BAO GIỜ chạm.
//   2. SỨC KHỎE VÒNG QUÉT: hiện có bao nhiêu đơn SHIPPING đủ điều kiện được
//      hỏi tracking, bao nhiêu đơn đang giao mà THIẾU mã vận đơn (bị lọt
//      lưới), cấu hình hiệu lực, tổng notice đã tạo.
//
// Tiết chế quota: tối đa 12 đơn/gian × số gian Shopee — một lần bấm tay,
// không nằm trong nhịp worker nào.
// ============================================================

router.get("/delivery-fail/probe", async (req: AuthRequest, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Đơn hủy không có mốc thời gian riêng (Order không có updatedAt) — dò
    // theo createdAt nới gấp ba: đơn tạo rồi hủy vì giao thất bại gói gọn
    // trong vài tuần.
    const sinceWide = new Date(Date.now() - days * 3 * 24 * 60 * 60 * 1000);

    const channels = await prisma.channel.findMany({
      where: {
        userId: req.ownerId!,
        channelName: ChannelName.SHOPEE,
        status: "ACTIVE",
        refreshToken: { not: null },
      },
    });

    const orders: {
      shopName: string;
      orderCode: string;
      createdAt: Date;
      shippingStatus: ShippingStatus;
      returnStatus: ReturnStatus;
      returnRequestedAt: Date | null;
      hasTrackingCode: boolean;
      failedDeliveredCount: number | null;
      orderLevelStatus: string | null;
      timeline: { time: string; status: string; desc: string }[] | null;
      error: string | null;
    }[] = [];
    /** Tần suất từng giá trị logistics_status gặp trong MỌI hành trình — để
     *  đối chiếu enum thật của sàn với enum docs mà worker đang đếm. */
    const statusTally: Record<string, number> = {};
    const failCountDist: Record<string, number> = {};

    for (const channel of channels) {
      const rows = await prisma.order.findMany({
        where: {
          channelId: channel.id,
          OR: [
            { returnRequestedAt: { gte: since } },
            { returnStatus: { not: ReturnStatus.NONE }, createdAt: { gte: sinceWide } },
            {
              shippingStatus: ShippingStatus.CANCELLED,
              trackingCode: { not: null },
              createdAt: { gte: sinceWide },
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          orderCode: true,
          createdAt: true,
          shippingStatus: true,
          returnStatus: true,
          returnRequestedAt: true,
          trackingCode: true,
        },
      });
      if (rows.length === 0) continue;

      let accessToken: string;
      let shopId: string;
      try {
        ({ accessToken, shopId } = await getValidShopeeAccessToken(channel));
      } catch (err) {
        for (const o of rows) {
          orders.push({
            shopName: channel.shopName,
            orderCode: o.orderCode,
            createdAt: o.createdAt,
            shippingStatus: o.shippingStatus,
            returnStatus: o.returnStatus,
            returnRequestedAt: o.returnRequestedAt,
            hasTrackingCode: !!o.trackingCode,
            failedDeliveredCount: null,
            orderLevelStatus: null,
            timeline: null,
            error: `Token gian lỗi: ${(err as Error).message}`,
          });
        }
        continue;
      }

      for (const o of rows) {
        try {
          const info = await getTrackingInfo(accessToken, shopId, o.orderCode);
          const events = info.response?.tracking_info ?? [];
          for (const e of events) {
            const s = String(e.logistics_status ?? "(trống)").toUpperCase();
            statusTally[s] = (statusTally[s] ?? 0) + 1;
          }
          const fails = countFailedDeliveries(events);
          failCountDist[String(fails)] = (failCountDist[String(fails)] ?? 0) + 1;
          orders.push({
            shopName: channel.shopName,
            orderCode: o.orderCode,
            createdAt: o.createdAt,
            shippingStatus: o.shippingStatus,
            returnStatus: o.returnStatus,
            returnRequestedAt: o.returnRequestedAt,
            hasTrackingCode: !!o.trackingCode,
            failedDeliveredCount: fails,
            orderLevelStatus: info.response?.logistics_status ?? null,
            timeline: events.map((e) => ({
              time: e.update_time
                ? new Date(e.update_time * 1000).toISOString()
                : "",
              status: String(e.logistics_status ?? ""),
              desc: String(e.description ?? "").slice(0, 120),
            })),
            error: info.error ? `${info.error}: ${info.message ?? ""}` : null,
          });
        } catch (err) {
          orders.push({
            shopName: channel.shopName,
            orderCode: o.orderCode,
            createdAt: o.createdAt,
            shippingStatus: o.shippingStatus,
            returnStatus: o.returnStatus,
            returnRequestedAt: o.returnRequestedAt,
            hasTrackingCode: !!o.trackingCode,
            failedDeliveredCount: null,
            orderLevelStatus: null,
            timeline: null,
            error: (err as Error).message,
          });
        }
      }
    }

    // ---- ĐỐI CHIẾU đơn ĐÃ CẢNH BÁO còn "pending" với sàn (thêm 26/08) ----
    // DB nói SHIPPING/chưa hoàn → hỏi lại get_tracking_info: nếu hành trình đã
    // có mốc RETURN*/CANCEL* (kiện quay đầu — order_status Shopee vẫn nằm
    // SHIPPED một thời gian dài nên vòng sync đơn KHÔNG thấy) hoặc DELIVERED
    // thì đó là ca "sàn đã báo mà hệ thống chưa cập nhật" — thứ ba thẻ số
    // "Cứu được/Mất đơn" đang thiếu.
    const pendingNotices = await prisma.deliveryFailNotice.findMany({
      where: {
        ownerId: req.ownerId!,
        order: {
          shippingStatus: ShippingStatus.SHIPPING,
          returnStatus: ReturnStatus.NONE,
        },
      },
      orderBy: { detectedAt: "desc" },
      take: 20,
      select: {
        detectedAt: true,
        order: {
          select: { orderCode: true, channelId: true, channel: { select: { shopName: true } } },
        },
      },
    });
    const noticeAudit: {
      orderCode: string;
      shopName: string;
      detectedAt: Date;
      orderLevelStatus: string | null;
      lastMilestone: { time: string; status: string; desc: string } | null;
      verdict: string;
    }[] = [];
    const tokenByChannel = new Map<string, { accessToken: string; shopId: string }>();
    for (const n of pendingNotices) {
      const channel = channels.find((c) => c.id === n.order.channelId);
      if (!channel) continue;
      try {
        let tok = tokenByChannel.get(channel.id);
        if (!tok) {
          tok = await getValidShopeeAccessToken(channel);
          tokenByChannel.set(channel.id, tok);
        }
        const info = await getTrackingInfo(tok.accessToken, tok.shopId, n.order.orderCode);
        const events = info.response?.tracking_info ?? [];
        const statuses = events.map((e) => String(e.logistics_status ?? "").toUpperCase());
        const last = events[events.length - 1];
        const verdict = statuses.some((s) => /^(RETURN|CANCEL)/.test(s))
          ? "SÀN ĐÃ BÁO HOÀN/HỦY — DB chưa cập nhật"
          : statuses.includes("DELIVERED")
            ? "SÀN BÁO ĐÃ GIAO — DB chưa cập nhật"
            : "Đang giao (khớp DB)";
        noticeAudit.push({
          orderCode: n.order.orderCode,
          shopName: n.order.channel.shopName,
          detectedAt: n.detectedAt,
          orderLevelStatus: info.response?.logistics_status ?? null,
          lastMilestone: last
            ? {
                time: last.update_time ? new Date(last.update_time * 1000).toISOString() : "",
                status: String(last.logistics_status ?? ""),
                desc: String(last.description ?? "").slice(0, 120),
              }
            : null,
          verdict,
        });
      } catch (err) {
        noticeAudit.push({
          orderCode: n.order.orderCode,
          shopName: n.order.channel.shopName,
          detectedAt: n.detectedAt,
          orderLevelStatus: null,
          lastMilestone: null,
          verdict: `Lỗi đọc hành trình: ${(err as Error).message}`,
        });
      }
    }

    // ---- Sức khỏe vòng quét hiện tại (đúng bộ lọc worker đang dùng) ----
    const channelIds = channels.map((c) => c.id);
    const scanWindow = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const [scanCandidates, shippingNoTracking, noticeTotal, cfgRow, tasksByKind, tasksDueNow] =
      await Promise.all([
        prisma.order.count({
          where: {
            channelId: { in: channelIds },
            shippingStatus: ShippingStatus.SHIPPING,
            trackingCode: { not: null },
            createdAt: { gte: scanWindow },
            deliveryFailNotice: null,
          },
        }),
        prisma.order.count({
          where: {
            channelId: { in: channelIds },
            shippingStatus: ShippingStatus.SHIPPING,
            trackingCode: null,
            createdAt: { gte: scanWindow },
          },
        }),
        prisma.deliveryFailNotice.count({ where: { ownerId: req.ownerId! } }),
        prisma.deliveryFailConfig.findUnique({ where: { ownerId: req.ownerId! } }),
        prisma.deliveryTrackingTask.groupBy({
          by: ["kind"],
          where: { channelId: { in: channelIds } },
          _count: { _all: true },
        }),
        prisma.deliveryTrackingTask.count({
          where: { channelId: { in: channelIds }, nextRunAt: { lte: new Date() } },
        }),
      ]);

    res.json({
      probedDays: days,
      shops: channels.map((c) => c.shopName),
      ordersProbed: orders.length,
      /** Phân bố "đơn hoàn/hủy có N mốc FAILED_DELIVERED" — nếu dồn hết ở 0-1
       *  thì ngưỡng 2 của worker không bao giờ chạm với hàng của shop này. */
      failCountDistribution: failCountDist,
      trackingStatusTally: statusTally,
      /** Đơn đã cảnh báo mà DB còn "pending" — sàn nói gì bây giờ? */
      noticeAudit,
      scanHealth: {
        scanCandidatesNow: scanCandidates,
        shippingMissingTrackingCode: shippingNoTracking,
        noticesEverCreated: noticeTotal,
        effectiveConfig: effectiveDeliveryFailConfig(cfgRow),
        /** Hàng đợi DeliveryTrackingTask (26/08): vé theo loại + vé đang đến hạn. */
        queue: {
          byKind: Object.fromEntries(tasksByKind.map((t) => [t.kind, t._count._all])),
          dueNow: tasksDueNow,
        },
      },
      orders,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
