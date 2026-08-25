// ============================================================
// CỨU ĐƠN GIAO THẤT BẠI — quét Shopee get_tracking_info theo nhịp GIỜ
//
// Vì sao phải polling: webhook Shopee không có sự kiện "giao thất bại từng
// lượt" (chỉ 4 push code), còn logistics_status cấp ĐƠN chỉ nhảy sang
// LOGISTICS_DELIVERY_FAILED khi đơn bị hủy hẳn — lúc đó đã muộn. Nguồn duy
// nhất bắt sớm là các mốc trong tracking_info[].
//
// ⚠️ BÀI HỌC PROBE PRODUCTION 25/08 (route /delivery-fail/probe, 24 đơn
// hoàn/hủy thật của ANO + DarkMan): Shopee VN KHÔNG dùng enum FAILED_DELIVERED
// của docs — lượt giao thất bại nằm trong DESCRIPTION tiếng Việt ("Giao hàng
// không thành công vì không thể liên hệ người nhận") dưới status chung chung
// PICKED_UP; enum thật gặp được: ORDER_CREATED / PICKED_UP / DELIVERED /
// PICKUP_PENDING / RETURN_INITIATED / RETURN_STARTED / RETURNED / CANCELED.
// Bản đầu (21/08) đếm enum docs nên 0 cảnh báo vĩnh viễn. Giờ đếm CẢ HAI:
// enum docs (phòng sàn đổi về chuẩn) + mẫu chữ trong description.
//
// Chạm ngưỡng 1 lượt → tạo DeliveryFailNotice (orderId unique = mỗi đơn cảnh
// báo đúng MỘT lần, không hỏi lại sàn) → chuông cho chủ shop chủ động gọi
// khách trước lượt giao cuối; autoChatEnabled thì nhắn thẳng khách qua cổng
// chat sẵn có. Sàn từ chối gửi (khách chặn, hết cửa sổ chat) = kết quả bình
// thường: ghi FAILED, KHÔNG tự retry — chủ shop nhắn tay, tránh spam.
//
// Tiết chế quota (1 call / 1 đơn): chỉ đơn SHIPPING có vận đơn ≤21 ngày, mỗi
// lượt tối đa 200 đơn/gian, mỗi đơn nghỉ 6 giờ giữa hai lần hỏi (in-memory,
// mất khi restart — vô hại, cùng khuôn backfill vận đơn).
// ============================================================

import type { Channel } from "@prisma/client";
import { DeliveryFailChatStatus, ReturnStatus, ShippingStatus } from "@prisma/client";
import { notify } from "../../notifications";
import { prisma } from "../../prisma";
import {
  getOrderBuyerUserId,
  getTrackingInfo,
  sendChatMessage,
  type ShopeeTrackingEvent,
} from "./client";
import { getValidShopeeAccessToken } from "./service";

/**
 * Số lượt giao thất bại từ mức này trở lên thì phát cảnh báo.
 *
 * Hạ 2 → 1 theo số liệu probe 25/08: trong các đơn hoàn thật, kiện SPX quay
 * đầu NGAY sau MỘT lượt thất bại (khách đổi địa chỉ / từ chối nhận — có đơn
 * "Trả hàng thành công" chỉ 28 phút sau lượt giao hỏng); chờ đủ 2 lượt là
 * không bao giờ kịp nói gì với khách. Lượt 1 vẫn đáng cảnh báo cả với đơn
 * được giao lại: "không liên hệ được người nhận" hôm nay thì gọi khách ngay
 * hôm nay, đừng phó mặc lượt giao lại ngày mai.
 */
export const DELIVERY_FAIL_THRESHOLD = 1;
/** Chỉ quét đơn tạo trong N ngày gần nhất — kiện cũ hơn đã an bài. */
const SCAN_WINDOW_DAYS = 21;
/** Trần số đơn hỏi get_tracking_info mỗi lượt quét của MỘT gian. */
const MAX_ORDERS_PER_SWEEP = 200;
/** Một đơn nghỉ tối thiểu chừng này giữa hai lần hỏi (shipper ~1 lượt/ngày). */
const ATTEMPT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Deep-link về tab Giao không thành công (Cấu hình kịch bản AI). */
export const DELIVERY_FAIL_TAB_HREF = "/operations-assistant/ai-rules?tab=delivery-fail";

/**
 * Template mặc định khi chủ shop chưa soạn (hoặc xoá trắng ô).
 * Biến: {ten_khach} {ma_don} {ten_san_pham}.
 */
export const DEFAULT_CHAT_TEMPLATE =
  "Bạn ơi, bên vận chuyển vừa báo giao hàng không thành công cho đơn {ma_don}. " +
  "Bạn vui lòng để ý điện thoại giúp shop ở lượt giao lại nhé, hoặc liên hệ " +
  "CSKH của sàn để khiếu nại nếu shipper cố tình không giao hàng ạ!";

/** orderId → lần hỏi tracking gần nhất (in-memory: mất khi restart, vô hại). */
const lastAttemptAt = new Map<string, number>();

// ---------- Phần THUẦN (không API, không DB) — có vitest ----------

/** Mốc TrackingLogisticsStatus đánh dấu MỘT lượt giao thất bại (enum DOCS —
 *  production VN chưa từng thấy phát ra, giữ lại phòng sàn đổi về chuẩn). */
const FAILED_EVENT_STATUSES = new Set(["FAILED_DELIVERED"]);

/**
 * Mẫu chữ "giao thất bại" trong description (nguồn THẬT trên production VN —
 * probe 25/08): "Giao hàng không thành công vì …" nằm dưới status PICKED_UP.
 * Bắt thêm biến thể "giao lại/phát hàng" + câu tiếng Anh phòng sàn đổi ngôn
 * ngữ theo cài đặt shop.
 */
const FAILED_DESC_PATTERN =
  /(giao|phát)\s*(hàng|lại)?\s*không\s*thành\s*công|delivery\s*(attempt\s*)?(failed|unsuccessful)/i;
/**
 * KHÔNG được đếm dù khớp mẫu trên:
 *   · "Lấy hàng không thành công" — thất bại khâu LẤY hàng ở shop, không phải
 *     lượt giao cho khách (gặp 10 lần trong probe).
 *   · "Đơn hàng sẽ được hoàn trả vì giao hàng không thành công" — thông báo
 *     TỔNG KẾT trên mốc RETURN_INITIATED, đếm vào là một lượt hóa hai.
 */
const FAILED_DESC_EXCLUDE = /lấy\s*hàng|hoàn\s*trả|pickup/i;
/** Mốc thuộc hành trình HOÀN/HỦY — không phải lượt giao, khỏi soi description. */
const NON_ATTEMPT_STATUS = /^(RETURN|CANCEL)/;

/** Đếm số lượt giao thất bại trong hành trình vận chuyển của đơn. */
export function countFailedDeliveries(events: ShopeeTrackingEvent[]): number {
  let n = 0;
  for (const e of events) {
    const status = String(e.logistics_status ?? "").toUpperCase();
    if (FAILED_EVENT_STATUSES.has(status)) {
      n++;
      continue;
    }
    if (NON_ATTEMPT_STATUS.test(status)) continue;
    const desc = String(e.description ?? "");
    if (FAILED_DESC_PATTERN.test(desc) && !FAILED_DESC_EXCLUDE.test(desc)) n++;
  }
  return n;
}

export interface ChatTemplateVars {
  customerName: string;
  orderCode: string;
  /** Tên các dòng hàng của đơn, theo thứ tự — rỗng nếu đơn không có dòng. */
  productNames: string[];
}

/** Điền biến vào template; template rỗng/toàn khoảng trắng → dùng mặc định. */
export function renderChatTemplate(template: string, vars: ChatTemplateVars): string {
  const tpl = template.trim() || DEFAULT_CHAT_TEMPLATE;
  const first = vars.productNames[0]?.trim() ?? "";
  const rest = vars.productNames.length - 1;
  const productLabel = first
    ? rest > 0
      ? `${first} và ${rest} sản phẩm khác`
      : first
    : "sản phẩm bạn đặt";
  return tpl
    .replaceAll("{ten_khach}", vars.customerName.trim() || "bạn")
    .replaceAll("{ma_don}", vars.orderCode)
    .replaceAll("{ten_san_pham}", productLabel);
}

/**
 * Lý do KHÔNG nhắn khách nữa (chatStatus SKIPPED) — null = nhắn được.
 * Đơn đã hủy hoặc đang trong luồng hoàn thì lời nhắn "để ý điện thoại nhận
 * hàng" không còn ý nghĩa, gửi chỉ làm khách rối.
 */
export function chatSkipReason(order: {
  shippingStatus: ShippingStatus;
  returnStatus: ReturnStatus;
}): string | null {
  if (order.shippingStatus === ShippingStatus.CANCELLED) return "Đơn đã hủy";
  if (order.returnStatus !== ReturnStatus.NONE) return "Đơn đang trong luồng hoàn";
  return null;
}

/**
 * KẾT QUẢ của một đơn từng bị cảnh báo — nguồn cho báo cáo "Kết quả cứu đơn"
 * (dải số trên tab + cột Kết quả nhật ký), dùng chung mọi sàn:
 *   · saved   = chốt GIAO THÀNH CÔNG và không hoàn — đơn được cứu.
 *   · lost    = đơn hủy hoặc rơi vào luồng hoàn — kiện quay đầu.
 *   · pending = vẫn đang trên đường (còn chờ lượt giao lại).
 * Lưu ý trung thực: "saved" không tách được phần shipper tự giao lại thành
 * công — coi là số THAM KHẢO, UI phải chú thích.
 */
export type DeliveryFailOutcome = "saved" | "lost" | "pending";

export function classifyDeliveryFailOutcome(order: {
  shippingStatus: ShippingStatus;
  returnStatus: ReturnStatus;
}): DeliveryFailOutcome {
  if (
    order.shippingStatus === ShippingStatus.CANCELLED ||
    order.returnStatus !== ReturnStatus.NONE
  ) {
    return "lost";
  }
  if (order.shippingStatus === ShippingStatus.DELIVERED) return "saved";
  return "pending";
}

/** Cấu hình HIỆU LỰC: chưa có dòng DB = cảnh báo BẬT, auto-chat TẮT. */
export interface EffectiveDeliveryFailConfig {
  alertEnabled: boolean;
  autoChatEnabled: boolean;
  /** Đã điền sẵn mặc định khi chủ shop để trống. */
  chatTemplate: string;
}

export function effectiveDeliveryFailConfig(
  row: { alertEnabled: boolean; autoChatEnabled: boolean; chatTemplate: string } | null
): EffectiveDeliveryFailConfig {
  return {
    alertEnabled: row?.alertEnabled ?? true,
    autoChatEnabled: row?.autoChatEnabled ?? false,
    chatTemplate: row?.chatTemplate.trim() || DEFAULT_CHAT_TEMPLATE,
  };
}

// ---------- Vòng quét (gọi từ order-auto-sync, nhịp giờ) ----------

export interface ScanDeliveryFailsResult {
  /** Số đơn đã hỏi get_tracking_info lượt này. */
  scanned: number;
  /** Số đơn MỚI chạm ngưỡng → tạo cảnh báo. */
  noticed: number;
  chatSent: number;
  chatFailed: number;
  chatSkipped: number;
}

/**
 * Quét một gian Shopee: đơn đang giao chưa có cảnh báo → đếm mốc thất bại →
 * chạm ngưỡng thì tạo notice + chuông + (tuỳ config) auto-chat. Idempotent
 * nhờ orderId unique; lỗi một đơn không chặn các đơn còn lại.
 */
export async function scanShopeeDeliveryFails(
  channel: Channel
): Promise<ScanDeliveryFailsResult> {
  const result: ScanDeliveryFailsResult = {
    scanned: 0,
    noticed: 0,
    chatSent: 0,
    chatFailed: 0,
    chatSkipped: 0,
  };

  const ownerId = channel.userId;
  const cfg = effectiveDeliveryFailConfig(
    await prisma.deliveryFailConfig.findUnique({ where: { ownerId } })
  );
  // Cả cảnh báo lẫn auto-chat đều tắt → khỏi đốt quota.
  if (!cfg.alertEnabled && !cfg.autoChatEnabled) return result;

  const candidates = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      shippingStatus: ShippingStatus.SHIPPING,
      trackingCode: { not: null },
      createdAt: { gte: new Date(Date.now() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
      deliveryFailNotice: null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderCode: true,
      customerName: true,
      shippingStatus: true,
      returnStatus: true,
      items: { select: { productName: true } },
    },
    // Lấy dư để trừ hao số đơn đang trong thời gian nghỉ giữa hai lần hỏi.
    take: MAX_ORDERS_PER_SWEEP * 3,
  });

  const now = Date.now();
  const due = candidates
    .filter((o) => now - (lastAttemptAt.get(o.id) ?? 0) > ATTEMPT_COOLDOWN_MS)
    .slice(0, MAX_ORDERS_PER_SWEEP);
  if (due.length === 0) return result;

  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

  for (const order of due) {
    lastAttemptAt.set(order.id, now);
    try {
      const info = await getTrackingInfo(accessToken, shopId, order.orderCode);
      result.scanned++;
      const fails = countFailedDeliveries(info.response?.tracking_info ?? []);
      if (fails < DELIVERY_FAIL_THRESHOLD) continue;

      // ---- Auto-chat (cổng chờ: mặc định TẮT, bật là nối cổng chat sẵn có) ----
      let chatStatus: DeliveryFailChatStatus = DeliveryFailChatStatus.NONE;
      let chatError: string | null = null;
      let sentMessage: string | null = null;
      let sentAt: Date | null = null;
      if (cfg.autoChatEnabled) {
        const skip = chatSkipReason(order);
        if (skip) {
          chatStatus = DeliveryFailChatStatus.SKIPPED;
          chatError = skip;
        } else {
          const message = renderChatTemplate(cfg.chatTemplate, {
            customerName: order.customerName,
            orderCode: order.orderCode,
            productNames: order.items.map((it) => it.productName),
          });
          try {
            const buyerId = await getOrderBuyerUserId(accessToken, shopId, order.orderCode);
            if (!buyerId) throw new Error("Sàn không trả buyer_user_id của đơn");
            await sendChatMessage({ accessToken, shopId, toId: buyerId, text: message });
            chatStatus = DeliveryFailChatStatus.SENT;
            sentMessage = message;
            sentAt = new Date();
          } catch (err) {
            // Khách chặn shop / hết cửa sổ chat / thiếu quyền sellerchat — kết
            // quả bình thường, ghi trần cho chủ shop biết mà nhắn tay.
            chatStatus = DeliveryFailChatStatus.FAILED;
            chatError = (err as Error).message;
          }
        }
      }

      await prisma.deliveryFailNotice.create({
        data: {
          ownerId,
          orderId: order.id,
          failCount: fails,
          chatStatus,
          chatError,
          sentMessage,
          sentAt,
        },
      });
      result.noticed++;
      if (chatStatus === DeliveryFailChatStatus.SENT) result.chatSent++;
      if (chatStatus === DeliveryFailChatStatus.FAILED) result.chatFailed++;
      if (chatStatus === DeliveryFailChatStatus.SKIPPED) result.chatSkipped++;

      // Chuông NGAY từng đơn (không đợi mở Dashboard) — cửa sổ hành động ngắn:
      // thường chỉ còn một lượt giao cuối trước khi kiện quay đầu.
      if (cfg.alertEnabled) {
        await notify(ownerId, {
          type: "delivery-fail",
          title: `Đơn ${order.orderCode} giao ${fails} lần không thành công`,
          body:
            `Gian ${channel.shopName} — khách ${order.customerName}. ` +
            (chatStatus === DeliveryFailChatStatus.SENT
              ? "Đã tự nhắn khách qua chat sàn; nên gọi thêm để chắc chắn."
              : "Chủ động liên hệ khách trước lượt giao cuối kẻo kiện quay đầu."),
          link: DELIVERY_FAIL_TAB_HREF,
        });
      }
    } catch (err) {
      // Lỗi một đơn (đơn tách kiện cần package_number, sàn chập chờn…) không
      // được chặn các đơn còn lại của lượt quét.
      console.warn(
        `[Delivery-fail] Chưa đọc được hành trình đơn ${order.orderCode}:`,
        (err as Error).message
      );
    }
  }

  return result;
}
