// ============================================================
// CỨU ĐƠN GIAO THẤT BẠI — NHÁNH TIKTOK (16/09/2026)
//
// Cùng khuôn hàng đợi vé DeliveryTrackingTask của Shopee (26/08, anh Trung
// chốt chịu tải thương mại): mỗi đơn đang giao có MỘT vé bền (DETECT dò lượt
// giao hỏng → OUTCOME chốt cứu/mất), worker mỗi nhịp 10' dọn vé → phát vé →
// nhặt vé đến hạn theo TRẦN call/gian → hỏi tracking → cảnh báo/chốt/hẹn lại.
//
// Nguồn: GET /fulfillment/202309/orders/{order_id}/tracking — mốc vận chuyển
// gồm description (tiếng Việt/Anh theo cài đặt shop) + update_time_millis (+
// tracking_event_type ở một số phiên bản). Không có enum "giao thất bại" chính
// thức → đếm bằng MẪU CHỮ như Shopee VN thật ("Giao hàng không thành công"),
// đối chiếu lại bằng log hình dạng ở lượt chạy đầu.
//
// Auto-chat: Hubsell chưa nối API chat TikTok → autoChatEnabled thì ghi SKIPPED
// kèm lý do (cùng cách Lazada), chuông vẫn phát ngay từng đơn.
// ============================================================

import type { Channel } from "@prisma/client";
import {
  DeliveryFailChatStatus,
  DeliveryFailOutcome as DbDeliveryFailOutcome,
  DeliveryTrackingTaskKind,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";
import { notify } from "../../services/notifications";
import { prisma } from "../../lib/prisma";
import {
  DELIVERY_FAIL_TAB_HREF,
  DELIVERY_FAIL_THRESHOLD,
  DETECT_ACTIVE_INTERVAL_MS,
  DETECT_IDLE_INTERVAL_MS,
  MAX_TASK_ERROR_STREAK,
  MAX_TRACKING_CALLS_PER_SWEEP,
  OUTCOME_INTERVAL_MS,
  SCAN_WINDOW_DAYS,
  TASK_ERROR_BACKOFF_MS,
  TASK_MAX_ORDER_AGE_DAYS,
  effectiveDeliveryFailConfig,
  type DeliveryFailOutcome,
  type DeliveryTrackingQueueResult,
} from "../shopee/delivery-fail";
import { getOrderTracking, type TikTokTrackingEvent } from "./client";
import { getValidAccessToken } from "./service";

/** Lý do SKIPPED khi chủ shop bật auto-chat — TikTok chưa nối chat. */
export const TIKTOK_CHAT_SKIP_REASON = "Hubsell chưa nối API chat TikTok Shop — chủ shop nhắn tay";

/** Hành trình không có mốc mới quá lâu thì coi là đứng im — hỏi thưa lại. */
const DETECT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

// ---------- Phần THUẦN (không API, không DB) — có vitest ----------

const FAILED_DESC_PATTERN =
  /(giao|phát)\s*(hàng|lại)?\s*không\s*thành\s*công|delivery\s*(attempt\s*)?(failed|unsuccessful)|failed\s*delivery|unable\s*to\s*deliver/i;
const FAILED_DESC_EXCLUDE = /lấy\s*hàng|hoàn\s*trả|trả\s*về|pickup|return/i;
const FAILED_EVENT_TYPES = /FAIL/i;
const LOST_PATTERN =
  /return|hoàn|trả\s*(hàng|về|lại)|quay\s*(đầu|về)|cancel|hủy|huỷ/i;
const SAVED_PATTERN = /delivered|đã\s*giao|giao\s*(hàng\s*)?thành\s*công|giao\s*xong/i;
const SAVED_EXCLUDE = /không\s*thành\s*công|unsuccessful|failed|attempt/i;
const IN_DELIVERY_PATTERN =
  /out\s*for\s*delivery|đang\s*giao|picked\s*up|đã\s*lấy\s*hàng|in\s*transit|đang\s*vận\s*chuyển|delivering/i;

/** Payload thật 16/09: {action_code, description, update_time_millis} — ghép cả action_code. */
function descOf(e: TikTokTrackingEvent): string {
  return `${e.description ?? ""} ${e.tracking_event_type ?? ""} ${e.action_code ?? ""}`.trim();
}

/** Đếm số lượt giao thất bại trong hành trình vận chuyển của đơn TikTok. */
export function countTiktokFailedDeliveries(events: TikTokTrackingEvent[]): number {
  let n = 0;
  for (const e of events) {
    const type = `${e.tracking_event_type ?? ""} ${e.action_code ?? ""}`.trim();
    const desc = String(e.description ?? "");
    if (FAILED_EVENT_TYPES.test(type) && !FAILED_DESC_EXCLUDE.test(type)) {
      n++;
      continue;
    }
    if (FAILED_DESC_PATTERN.test(desc) && !FAILED_DESC_EXCLUDE.test(desc)) n++;
  }
  return n;
}

/**
 * Chốt kết quả từ hành trình: LOST xét TRƯỚC (kiện quay đầu/hoàn/hủy — mốc
 * RETURN nằm sau DELIVERED khi khách trả hàng), rồi SAVED (đã giao), còn lại
 * pending. Mốc "giao không thành công" KHÔNG tính là đã giao.
 */
export function classifyTiktokOutcomeFromTracking(events: TikTokTrackingEvent[]): DeliveryFailOutcome {
  const texts = events.map(descOf);
  if (texts.some((t) => LOST_PATTERN.test(t) && !/không\s*thành\s*công/i.test(t))) return "lost";
  if (texts.some((t) => SAVED_PATTERN.test(t) && !SAVED_EXCLUDE.test(t))) return "saved";
  return "pending";
}

/** Nhịp hỏi lại vé DETECT: 20' khi kiện đang đi giao và còn nhúc nhích ≤48h, 2h khi không. */
export function nextTiktokDetectDelayMs(events: TikTokTrackingEvent[], nowMs: number): number {
  const inDelivery = events.some((e) => IN_DELIVERY_PATTERN.test(descOf(e)));
  if (!inDelivery) return DETECT_IDLE_INTERVAL_MS;
  let latestMs = 0;
  for (const e of events) {
    const t = Number(e.update_time_millis ?? 0);
    if (t > latestMs) latestMs = t;
  }
  if (latestMs > 0 && nowMs - latestMs > DETECT_STALE_AFTER_MS) return DETECT_IDLE_INTERVAL_MS;
  return DETECT_ACTIVE_INTERVAL_MS;
}

// ---------- HÀNG ĐỢI (gọi từ order-auto-sync, MỖI nhịp 10 phút) ----------

let shapeLogged = false;

export async function processTiktokDeliveryTracking(
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
    recounted: 0,
  };

  const ownerId = channel.userId;
  const cfg = effectiveDeliveryFailConfig(
    await prisma.deliveryFailConfig.findUnique({ where: { ownerId } })
  );
  if (!cfg.alertEnabled && !cfg.autoChatEnabled) return result;

  const nowDate = new Date();

  // (1) Chốt rẻ theo trạng thái Order (0 call API).
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

  // (2) Dọn vé hết nghĩa vụ.
  const cleaned = await prisma.deliveryTrackingTask.deleteMany({
    where: {
      channelId: channel.id,
      OR: [
        {
          kind: DeliveryTrackingTaskKind.DETECT,
          order: {
            OR: [
              { shippingStatus: { not: ShippingStatus.SHIPPING } },
              { deliveryFailNotice: { isNot: null } },
            ],
          },
        },
        {
          kind: DeliveryTrackingTaskKind.OUTCOME,
          order: {
            deliveryFailNotice: { is: { outcome: { not: DbDeliveryFailOutcome.PENDING } } },
          },
        },
        { kind: DeliveryTrackingTaskKind.OUTCOME, order: { deliveryFailNotice: null } },
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

  // (3) Phát vé mới.
  const newcomers = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      shippingStatus: ShippingStatus.SHIPPING,
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

  // (4) Nhặt vé đến hạn — trần call cứng mỗi gian mỗi nhịp.
  const due = await prisma.deliveryTrackingTask.findMany({
    where: { channelId: channel.id, nextRunAt: { lte: new Date() } },
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
          deliveryFailNotice: { select: { id: true, failCount: true } },
        },
      },
    },
  });
  if (due.length === 0) return result;

  const auth = await getValidAccessToken(channel);

  const settleNotice = async (
    noticeId: string,
    outcome: Exclude<DeliveryFailOutcome, "pending">,
    note: string
  ) => {
    await prisma.deliveryFailNotice.update({
      where: { id: noticeId },
      data: {
        outcome: outcome === "saved" ? DbDeliveryFailOutcome.SAVED : DbDeliveryFailOutcome.LOST,
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
      const events = await getOrderTracking({ ...auth, orderId: order.orderCode });
      result.ran++;
      if (!shapeLogged && events[0] && process.env.TIKTOK_SHAPE_LOG !== "0") {
        shapeLogged = true;
        console.log(
          `[TikTok] Hình dạng tracking (orders/{id}/tracking): keys=[${Object.keys(events[0]).join(",")}] types=${JSON.stringify([...new Set(events.map((e) => e.tracking_event_type).filter(Boolean))].slice(0, 12))}`
        );
      }
      const trackedOutcome = classifyTiktokOutcomeFromTracking(events);
      const lastDesc = events[events.length - 1]?.description ?? "?";

      if (task.kind === DeliveryTrackingTaskKind.OUTCOME) {
        const notice = order.deliveryFailNotice;
        if (notice) {
          const failsNow = countTiktokFailedDeliveries(events);
          if (failsNow > notice.failCount) {
            await prisma.deliveryFailNotice.update({
              where: { id: notice.id },
              data: { failCount: failsNow },
            });
            result.recounted++;
          }
        }
        if (!notice?.id || trackedOutcome !== "pending") {
          if (notice?.id && trackedOutcome !== "pending") {
            await settleNotice(notice.id, trackedOutcome, `Sàn báo: ${lastDesc}`);
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

      // Vé DETECT
      if (trackedOutcome === "saved") {
        await prisma.deliveryTrackingTask.delete({ where: { id: task.id } });
        continue;
      }
      const fails = countTiktokFailedDeliveries(events);
      if (fails < DELIVERY_FAIL_THRESHOLD) {
        if (trackedOutcome === "lost") {
          await prisma.deliveryTrackingTask.delete({ where: { id: task.id } });
        } else {
          await prisma.deliveryTrackingTask.update({
            where: { id: task.id },
            data: {
              nextRunAt: new Date(Date.now() + nextTiktokDetectDelayMs(events, Date.now())),
              lastRunAt: new Date(),
              attempts: 0,
            },
          });
        }
        continue;
      }

      const chatStatus = cfg.autoChatEnabled
        ? DeliveryFailChatStatus.SKIPPED
        : DeliveryFailChatStatus.NONE;
      await prisma.deliveryFailNotice.create({
        data: {
          ownerId,
          orderId: order.id,
          failCount: fails,
          chatStatus,
          chatError: cfg.autoChatEnabled ? TIKTOK_CHAT_SKIP_REASON : null,
          ...(trackedOutcome === "lost"
            ? {
                outcome: DbDeliveryFailOutcome.LOST,
                outcomeAt: new Date(),
                outcomeNote: `Sàn báo: ${lastDesc}`.slice(0, 200),
              }
            : {}),
        },
      });
      result.noticed++;
      if (trackedOutcome === "lost") result.lost++;
      if (chatStatus === DeliveryFailChatStatus.SKIPPED) result.chatSkipped++;

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

      if (cfg.alertEnabled) {
        await notify(ownerId, {
          type: "delivery-fail",
          title: `Đơn ${order.orderCode} giao ${fails} lần không thành công`,
          body:
            `Gian ${channel.shopName} — khách ${order.customerName}. ` +
            "Chủ động liên hệ khách trước lượt giao cuối kẻo kiện quay đầu.",
          link: DELIVERY_FAIL_TAB_HREF,
        });
      }
    } catch (err) {
      const streak = task.attempts + 1;
      console.warn(
        `[Delivery-fail] Vé TikTok đơn ${order.orderCode} lỗi lần ${streak}:`,
        (err as Error).message
      );
      try {
        if (streak >= MAX_TASK_ERROR_STREAK) {
          await prisma.deliveryTrackingTask.delete({ where: { id: task.id } });
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
        // vé biến mất giữa chừng — nhịp sau tự cân bằng
      }
    }
  }

  return result;
}
