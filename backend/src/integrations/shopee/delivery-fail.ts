// ============================================================
// CỨU ĐƠN GIAO THẤT BẠI — quét Shopee get_tracking_info theo nhịp 10 PHÚT
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
// KIẾN TRÚC HÀNG ĐỢI (26/08, anh Trung chốt làm ngay trước thương mại hóa —
// cùng khuôn StockPushJob của đồng bộ tồn kho): mỗi đơn cần theo dõi có MỘT
// vé DeliveryTrackingTask bền trong DB (DETECT = dò lượt giao hỏng, OUTCOME =
// chốt kết quả cứu/mất). Worker mỗi nhịp 10' chỉ: (1) dọn vé hết nghĩa vụ,
// (2) phát vé cho đơn mới đủ điều kiện, (3) nhặt vé ĐẾN HẠN theo trần
// call/gian. Lượng gọi API sàn vì thế bị CHẶN TRÊN tuyệt đối dù có triệu đơn
// — quá tải thì vé xếp hàng chờ nhịp sau chứ không dồn call; nhịp hỏi lại co
// giãn theo pha giao (đang đi giao 20' — real-time đúng chỗ cần; chưa tới pha
// giao/hành trình đứng im thì 2h — không đốt quota chỗ không cần); restart
// không mất trạng thái (trước đây 2 Map in-memory).
// ============================================================

import type { Channel } from "@prisma/client";
import {
  DeliveryFailChatStatus,
  DeliveryFailOutcome as DbDeliveryFailOutcome,
  DeliveryTrackingTaskKind,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";
import { notify } from "../../notifications";
import { prisma } from "../../prisma";
import {
  getOrderBuyerUserId,
  getTrackingInfo,
  sendChatMessage,
  sendChatOrderMessage,
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
/** Chỉ phát vé cho đơn tạo trong N ngày gần nhất — kiện cũ hơn đã an bài. */
const SCAN_WINDOW_DAYS = 21;
/** Vé của đơn quá N ngày (kể cả OUTCOME chưa chốt được) → bỏ, khỏi theo mãi. */
const TASK_MAX_ORDER_AGE_DAYS = 45;
/**
 * TRẦN call get_tracking_info mỗi nhịp 10' của MỘT gian — chốt chặn quota khi
 * thương mại hóa: gian đông đơn đến đâu cũng chỉ tốn tối đa 6 × trần call/giờ
 * (hiện 360/giờ/gian), vé dư xếp hàng chờ nhịp sau theo nextRunAt cũ nhất
 * trước (không đơn nào bị bỏ đói).
 */
const MAX_TRACKING_CALLS_PER_SWEEP = 60;
/**
 * Nhịp hỏi lại theo PHA GIAO (26/08, anh Trung chốt "phải real-time — chậm là
 * bị hoàn ngay"; probe 25/08 có kiện quay đầu chỉ 28 PHÚT sau lượt giao hỏng):
 * đơn ĐANG trong pha giao (đã có mốc PICKED_UP, hành trình còn nhúc nhích
 * ≤48h) hỏi mỗi 20' → phát hiện trong ~20-30'; đơn chưa tới pha giao hoặc
 * hành trình đứng im lâu (kẹt kho trung chuyển...) thì 2h — lượt giao hỏng
 * không thể xuất hiện ở pha đó, hỏi dày chỉ đốt quota.
 */
export const DETECT_ACTIVE_INTERVAL_MS = 20 * 60 * 1000;
export const DETECT_IDLE_INTERVAL_MS = 2 * 60 * 60 * 1000;
/** Hành trình không có mốc mới quá lâu thì coi là đứng im — hỏi thưa lại. */
const DETECT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
/** Nhịp chốt kết quả đơn đã cảnh báo — không cần real-time (chuông đã reo). */
const OUTCOME_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Vé lỗi (sàn chập chờn, đơn tách kiện...) nghỉ 1h rồi thử lại. */
const TASK_ERROR_BACKOFF_MS = 60 * 60 * 1000;
/** Lỗi liên tiếp quá N lần → bỏ vé (đơn tách kiện cần package_number là lỗi
 *  vĩnh viễn — thử mãi chỉ đốt quota; đơn thường lỗi mạng sẽ reset khi qua). */
const MAX_TASK_ERROR_STREAK = 8;

/** Deep-link về tab Giao không thành công (Cấu hình kịch bản AI). */
export const DELIVERY_FAIL_TAB_HREF = "/operations-assistant/ai-rules?tab=delivery-fail";

/**
 * Template mặc định khi chủ shop chưa soạn (hoặc xoá trắng ô).
 * Biến: {ten_khach} {ma_don} {ten_san_pham}.
 */
// "2 lần" là CHỦ Ý của anh Trung (chốt 25/08, sau khi hạ ngưỡng cảnh báo về
// 1 lượt): giữ câu chữ gấp gáp để khách để ý điện thoại — đừng "sửa cho khớp
// ngưỡng" lần nữa.
export const DEFAULT_CHAT_TEMPLATE =
  "Bạn ơi, bên vận chuyển báo giao 2 lần không thành công cho đơn {ma_don}. " +
  "Bạn vui lòng để ý điện thoại giúp shop nhé, hoặc liên hệ CSKH của sàn để " +
  "khiếu nại nếu shipper cố tình không giao hàng ạ!";

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

/**
 * Chốt kết quả từ HÀNH TRÌNH VẬN CHUYỂN (nguồn sự thật sớm nhất — probe 26/08):
 * đơn giao xong Shopee để order_status TO_CONFIRM_RECEIVE (mình map SHIPPING)
 * nhiều ngày, kiện quay đầu thì order_status đứng im ở SHIPPED — chỉ tracking
 * mới nói thật. LOST xét TRƯỚC saved: đơn giao xong rồi khách trả thì mốc
 * RETURN* nằm SAU mốc DELIVERED, phải ra lost.
 */
export function classifyOutcomeFromTracking(
  orderLevelStatus: string | null | undefined,
  events: ShopeeTrackingEvent[]
): DeliveryFailOutcome {
  const statuses = events.map((e) => String(e.logistics_status ?? "").toUpperCase());
  const top = String(orderLevelStatus ?? "").toUpperCase();
  if (statuses.some((s) => NON_ATTEMPT_STATUS.test(s)) || /RETURN|CANCEL/.test(top)) {
    return "lost";
  }
  if (statuses.includes("DELIVERED") || top === "LOGISTICS_DELIVERY_DONE") return "saved";
  return "pending";
}

/**
 * Kết quả HIỂN THỊ = trạng thái Order (nếu đã chốt hủy/hoàn/DELIVERED — luôn
 * thắng, kể cả khi notice đã lưu SAVED mà khách trả hàng sau đó) ⊕ kết quả
 * worker chốt từ tracking (khi Order còn mù vì TO_CONFIRM_RECEIVE/SHIPPED).
 */
export function mergeDeliveryFailOutcome(
  dbOutcome: DeliveryFailOutcome,
  stored: DbDeliveryFailOutcome
): DeliveryFailOutcome {
  if (dbOutcome !== "pending") return dbOutcome;
  if (stored === DbDeliveryFailOutcome.SAVED) return "saved";
  if (stored === DbDeliveryFailOutcome.LOST) return "lost";
  return "pending";
}

/**
 * Bao lâu nữa mới hỏi lại tracking của một vé DETECT — co giãn theo pha giao:
 * 20' khi kiện ĐANG đi giao (có mốc PICKED_UP và hành trình còn nhúc nhích
 * trong 48h), 2h khi chưa tới pha giao (mới tạo đơn, chờ lấy hàng) hoặc hành
 * trình đứng im lâu. Lượt giao thất bại chỉ có thể xuất hiện ở pha đang giao
 * — dồn quota vào đúng đó là cách giữ real-time mà không phình số call.
 */
export function nextDetectDelayMs(events: ShopeeTrackingEvent[], nowMs: number): number {
  const inDelivery = events.some(
    (e) => String(e.logistics_status ?? "").toUpperCase() === "PICKED_UP"
  );
  if (!inDelivery) return DETECT_IDLE_INTERVAL_MS;
  let latestMs = 0;
  for (const e of events) {
    const t = Number(e.update_time ?? 0) * 1000;
    if (t > latestMs) latestMs = t;
  }
  if (latestMs > 0 && nowMs - latestMs > DETECT_STALE_AFTER_MS) {
    return DETECT_IDLE_INTERVAL_MS;
  }
  return DETECT_ACTIVE_INTERVAL_MS;
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

// ---------- HÀNG ĐỢI hỏi tracking (gọi từ order-auto-sync, MỖI nhịp 10 phút) ----------

export interface DeliveryTrackingQueueResult {
  /** Vé mới phát lượt này (đơn mới vào diện theo dõi + notice mồ côi vé). */
  enqueued: number;
  /** Vé dọn đi (đơn đã an bài / rời cửa sổ theo dõi). */
  cleaned: number;
  /** Số call get_tracking_info đã tốn lượt này (≤ MAX_TRACKING_CALLS_PER_SWEEP). */
  ran: number;
  /** Số đơn MỚI chạm ngưỡng → tạo cảnh báo. */
  noticed: number;
  chatSent: number;
  chatFailed: number;
  chatSkipped: number;
  /** Kết quả chốt được lượt này (gồm cả chốt RẺ theo trạng thái đơn, 0 call). */
  saved: number;
  lost: number;
}

/**
 * Một nhịp hàng đợi của MỘT gian: chốt rẻ theo Order → dọn vé → phát vé mới →
 * nhặt vé ĐẾN HẠN theo trần call → hỏi tracking → cảnh báo / chốt kết quả /
 * hẹn lại theo pha giao. Idempotent toàn tuyến (orderId unique ở cả vé lẫn
 * notice, createMany skipDuplicates); lỗi một vé không chặn vé còn lại.
 */
export async function processShopeeDeliveryTracking(
  channel: Channel
): Promise<DeliveryTrackingQueueResult> {
  const result: DeliveryTrackingQueueResult = {
    enqueued: 0,
    cleaned: 0,
    ran: 0,
    noticed: 0,
    chatSent: 0,
    chatFailed: 0,
    chatSkipped: 0,
    saved: 0,
    lost: 0,
  };

  const ownerId = channel.userId;
  const cfg = effectiveDeliveryFailConfig(
    await prisma.deliveryFailConfig.findUnique({ where: { ownerId } })
  );
  // Cả cảnh báo lẫn auto-chat đều tắt → vé nằm im, không đốt quota.
  if (!cfg.alertEnabled && !cfg.autoChatEnabled) return result;

  const nowDate = new Date();

  // ---- (1) CHỐT RẺ theo trạng thái Order (0 call API): sync đơn / Returns
  // API đã biết trước (hủy, dính luồng hoàn, DELIVERED) thì lấy luôn —
  // set-based updateMany, triệu notice cũng chỉ tốn 2 query có index.
  const [lostByOrder, savedByOrder] = await prisma.$transaction([
    prisma.deliveryFailNotice.updateMany({
      where: {
        outcome: DbDeliveryFailOutcome.PENDING,
        order: {
          channelId: channel.id,
          OR: [
            { shippingStatus: ShippingStatus.CANCELLED },
            { returnStatus: { not: ReturnStatus.NONE } },
          ],
        },
      },
      data: {
        outcome: DbDeliveryFailOutcome.LOST,
        outcomeAt: nowDate,
        outcomeNote: "Theo trạng thái đơn trong hệ thống",
      },
    }),
    prisma.deliveryFailNotice.updateMany({
      where: {
        outcome: DbDeliveryFailOutcome.PENDING,
        order: {
          channelId: channel.id,
          shippingStatus: ShippingStatus.DELIVERED,
          returnStatus: ReturnStatus.NONE,
        },
      },
      data: {
        outcome: DbDeliveryFailOutcome.SAVED,
        outcomeAt: nowDate,
        outcomeNote: "Theo trạng thái đơn trong hệ thống",
      },
    }),
  ]);
  result.lost += lostByOrder.count;
  result.saved += savedByOrder.count;

  // ---- (2) DỌN vé hết nghĩa vụ (0 call API) ----
  const cleaned = await prisma.deliveryTrackingTask.deleteMany({
    where: {
      channelId: channel.id,
      OR: [
        // Vé dò mà đơn đã rời SHIPPING (an bài — không có notice thì chẳng còn
        // gì để ghi) hoặc đã có cảnh báo bằng lối khác (đua vé cũ).
        {
          kind: DeliveryTrackingTaskKind.DETECT,
          order: {
            OR: [
              { shippingStatus: { not: ShippingStatus.SHIPPING } },
              { deliveryFailNotice: { isNot: null } },
            ],
          },
        },
        // Vé chốt kết quả mà notice đã chốt (kể cả vừa chốt rẻ ở bước 1).
        {
          kind: DeliveryTrackingTaskKind.OUTCOME,
          order: {
            deliveryFailNotice: { is: { outcome: { not: DbDeliveryFailOutcome.PENDING } } },
          },
        },
        // Vé chốt kết quả mồ côi (notice bị xoá).
        { kind: DeliveryTrackingTaskKind.OUTCOME, order: { deliveryFailNotice: null } },
        // Đơn quá cũ — thôi theo, khỏi nuôi vé mãi mãi.
        {
          order: {
            createdAt: {
              lt: new Date(nowDate.getTime() - TASK_MAX_ORDER_AGE_DAYS * 24 * 60 * 60 * 1000),
            },
          },
        },
      ],
    },
  });
  result.cleaned = cleaned.count;

  // ---- (3) PHÁT VÉ mới (0 call API) ----
  const newcomers = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      shippingStatus: ShippingStatus.SHIPPING,
      trackingCode: { not: null },
      createdAt: { gte: new Date(nowDate.getTime() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
      deliveryFailNotice: null,
      deliveryTrackingTask: null,
    },
    select: { id: true },
    take: 2000,
  });
  if (newcomers.length > 0) {
    const created = await prisma.deliveryTrackingTask.createMany({
      data: newcomers.map((o) => ({
        channelId: channel.id,
        orderId: o.id,
        kind: DeliveryTrackingTaskKind.DETECT,
      })),
      skipDuplicates: true,
    });
    result.enqueued += created.count;
  }
  // Notice còn PENDING mà không có vé (đơn nâng cấp từ bản trước hàng đợi,
  // hoặc vé lỗi dai bị bỏ) → phát vé OUTCOME để còn chốt được kết quả.
  const orphanNotices = await prisma.deliveryFailNotice.findMany({
    where: {
      outcome: DbDeliveryFailOutcome.PENDING,
      order: { channelId: channel.id, deliveryTrackingTask: null },
    },
    select: { orderId: true },
    take: 2000,
  });
  if (orphanNotices.length > 0) {
    const created = await prisma.deliveryTrackingTask.createMany({
      data: orphanNotices.map((n) => ({
        channelId: channel.id,
        orderId: n.orderId,
        kind: DeliveryTrackingTaskKind.OUTCOME,
      })),
      skipDuplicates: true,
    });
    result.enqueued += created.count;
  }

  // ---- (4) NHẶT vé đến hạn — trần call cứng mỗi gian mỗi nhịp ----
  const due = await prisma.deliveryTrackingTask.findMany({
    where: { channelId: channel.id, nextRunAt: { lte: nowDate } },
    // Vé trễ hạn lâu nhất trước — quá tải thì cả hàng lùi dần, không ai bị bỏ đói.
    orderBy: { nextRunAt: "asc" },
    take: MAX_TRACKING_CALLS_PER_SWEEP,
    select: {
      id: true,
      kind: true,
      attempts: true,
      order: {
        select: {
          id: true,
          orderCode: true,
          customerName: true,
          shippingStatus: true,
          returnStatus: true,
          items: { select: { productName: true } },
          deliveryFailNotice: { select: { id: true } },
        },
      },
    },
  });
  if (due.length === 0) return result;

  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

  const settleNotice = async (
    noticeId: string,
    outcome: Exclude<DeliveryFailOutcome, "pending">,
    note: string
  ) => {
    await prisma.deliveryFailNotice.update({
      where: { id: noticeId },
      data: {
        outcome:
          outcome === "saved" ? DbDeliveryFailOutcome.SAVED : DbDeliveryFailOutcome.LOST,
        outcomeAt: new Date(),
        outcomeNote: note.slice(0, 200),
      },
    });
    if (outcome === "saved") result.saved++;
    else result.lost++;
  };

  for (const task of due) {
    const order = task.order;
    try {
      const info = await getTrackingInfo(accessToken, shopId, order.orderCode);
      result.ran++;
      const events = info.response?.tracking_info ?? [];
      const trackedOutcome = classifyOutcomeFromTracking(
        info.response?.logistics_status,
        events
      );

      // ---- Vé OUTCOME: chỉ chốt kết quả ----
      if (task.kind === DeliveryTrackingTaskKind.OUTCOME) {
        const noticeId = order.deliveryFailNotice?.id;
        if (!noticeId || trackedOutcome !== "pending") {
          if (noticeId && trackedOutcome !== "pending") {
            await settleNotice(
              noticeId,
              trackedOutcome,
              `Sàn báo ${info.response?.logistics_status ?? "?"}`
            );
          }
          await prisma.deliveryTrackingTask.delete({ where: { id: task.id } });
        } else {
          await prisma.deliveryTrackingTask.update({
            where: { id: task.id },
            data: {
              nextRunAt: new Date(Date.now() + OUTCOME_INTERVAL_MS),
              lastRunAt: new Date(),
              attempts: 0,
            },
          });
        }
        continue;
      }

      // ---- Vé DETECT: dò lượt giao thất bại ----
      if (trackedOutcome === "saved") {
        // Giao xong mà chưa từng có lượt hỏng — hết việc, khỏi cảnh báo.
        await prisma.deliveryTrackingTask.delete({ where: { id: task.id } });
        continue;
      }
      const fails = countFailedDeliveries(events);
      if (fails < DELIVERY_FAIL_THRESHOLD) {
        if (trackedOutcome === "lost") {
          // Quay đầu KHÔNG qua lượt giao hỏng (hủy giữa đường...) — không phải
          // việc của cảnh báo giao thất bại; sync đơn sẽ tự ghi nhận trạng thái.
          await prisma.deliveryTrackingTask.delete({ where: { id: task.id } });
        } else {
          await prisma.deliveryTrackingTask.update({
            where: { id: task.id },
            data: {
              nextRunAt: new Date(Date.now() + nextDetectDelayMs(events, Date.now())),
              lastRunAt: new Date(),
              attempts: 0,
            },
          });
        }
        continue;
      }

      // ---- Auto-chat (cổng chờ: mặc định TẮT, bật là nối cổng chat sẵn có) ----
      let chatStatus: DeliveryFailChatStatus = DeliveryFailChatStatus.NONE;
      let chatError: string | null = null;
      let sentMessage: string | null = null;
      let sentAt: Date | null = null;
      if (cfg.autoChatEnabled) {
        // Tracking đã báo quay đầu thì khỏi nhắn "để ý điện thoại nhận hàng".
        const skip =
          trackedOutcome === "lost" ? "Kiện đã quay đầu" : chatSkipReason(order);
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
            // Thẻ đơn TRƯỚC, text SAU (bài học production 25/08): khách chưa
            // từng chat với shop thì tin text trần bị chặn
            // first_chat_without_order_info — tin đầu phải đính kèm đơn. Thẻ
            // đơn lỗi vẫn thử text (hội thoại có sẵn thì text tự đi lọt).
            await sendChatOrderMessage({
              accessToken,
              shopId,
              toId: buyerId,
              orderSn: order.orderCode,
            }).catch(() => {});
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
          // Tracking đã nói kiện quay đầu → chốt LOST ngay từ lúc sinh notice.
          ...(trackedOutcome === "lost"
            ? {
                outcome: DbDeliveryFailOutcome.LOST,
                outcomeAt: new Date(),
                outcomeNote: `Sàn báo ${info.response?.logistics_status ?? "?"}`.slice(0, 200),
              }
            : {}),
        },
      });
      result.noticed++;
      if (trackedOutcome === "lost") result.lost++;
      if (chatStatus === DeliveryFailChatStatus.SENT) result.chatSent++;
      if (chatStatus === DeliveryFailChatStatus.FAILED) result.chatFailed++;
      if (chatStatus === DeliveryFailChatStatus.SKIPPED) result.chatSkipped++;

      // Vé chuyển vai: LOST thì hết việc; còn lại thành vé OUTCOME chờ chốt
      // cứu được / mất đơn (6h/lần).
      if (trackedOutcome === "lost") {
        await prisma.deliveryTrackingTask.delete({ where: { id: task.id } });
      } else {
        await prisma.deliveryTrackingTask.update({
          where: { id: task.id },
          data: {
            kind: DeliveryTrackingTaskKind.OUTCOME,
            nextRunAt: new Date(Date.now() + OUTCOME_INTERVAL_MS),
            lastRunAt: new Date(),
            attempts: 0,
          },
        });
      }

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
      // Lỗi một vé (đơn tách kiện cần package_number, sàn chập chờn…) không
      // được chặn các vé còn lại: nghỉ 1h thử lại, lỗi dai quá trần thì bỏ vé
      // (đơn tách kiện là lỗi vĩnh viễn — nuôi vé chỉ đốt quota).
      const streak = task.attempts + 1;
      console.warn(
        `[Delivery-fail] Vé đơn ${order.orderCode} lỗi lần ${streak}:`,
        (err as Error).message
      );
      try {
        if (streak >= MAX_TASK_ERROR_STREAK) {
          await prisma.deliveryTrackingTask.delete({ where: { id: task.id } });
          console.warn(
            `[Delivery-fail] Bỏ vé đơn ${order.orderCode} sau ${streak} lần lỗi liên tiếp`
          );
        } else {
          await prisma.deliveryTrackingTask.update({
            where: { id: task.id },
            data: {
              attempts: streak,
              nextRunAt: new Date(Date.now() + TASK_ERROR_BACKOFF_MS),
              lastRunAt: new Date(),
            },
          });
        }
      } catch {
        // Vé biến mất giữa chừng (dọn đua) — kệ, nhịp sau tự cân bằng lại.
      }
    }
  }

  return result;
}
