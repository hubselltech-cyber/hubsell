// ============================================================
// THÔNG BÁO ĐẨY VỀ ĐIỆN THOẠI — Expo Push Service (app mobile, 23/10/2026)
//
// App đăng ký ExponentPushToken khi đăng nhập (POST /api/notifications/devices).
// notify() sau khi ghi chuông gọi sendPushToOwner(): tìm thiết bị của CHỦ SHOP
// — và từ 23/11/2026 cả máy của NHÂN VIÊN được phép thấy thông báo đó (theo quyền
// + gian được giao, luật ở notification-access.ts) — rồi POST một lượt tới
// exp.host (≤ 100 tin / request). Gửi là tiện ích — không bao giờ ném lỗi ra
// nghiệp vụ, không chờ biên nhận.
//
// Vì sao Expo Push chứ không FCM / APNs trực tiếp: một API cho cả hai nền
// tảng, app Expo không cần cấu hình Firebase SDK trong mã; Expo tự chuyển
// tiếp. Token hỏng (gỡ app) → sàn trả DeviceNotRegistered → tắt thiết bị.
// ============================================================

import { prisma } from "../lib/prisma";
import {
  CATEGORY_PERMISSIONS,
  staffCanSeeNotification,
  staffNotificationScope,
} from "./notification-access";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Trần một request của Expo. */
const BATCH = 100;
/** Tiêu đề / nội dung dài hơn là bị hệ điều hành cắt — cắt chủ động cho gọn. */
const TITLE_MAX = 70;
const BODY_MAX = 180;

export interface PushMessage {
  title: string;
  body?: string | null;
  /** Dữ liệu app dùng để điều hướng khi bấm (link, type, notificationId). */
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export function trimForPush(text: string | null | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Token Expo hợp lệ: ExponentPushToken[xxx] hoặc ExpoPushToken[xxx]. */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/.test(token);
}

/** Thông báo đang đẩy thuộc mục nào, nói tới gian nào — để chọn máy nhân viên được nhận. */
export interface PushAudience {
  category: string | null;
  channelIds: readonly string[];
}

interface DeviceRow {
  id: string;
  token: string;
  userId: string;
}

/**
 * Trong các máy đang bật của shop, giữ máy chủ shop + máy của nhân viên ĐƯỢC THẤY
 * thông báo này. Mục chỉ-chủ-shop hoặc shop không có máy nhân viên nào thì không
 * tốn thêm câu hỏi DB.
 */
async function devicesAllowed(ownerId: string, devices: DeviceRow[], audience: PushAudience): Promise<DeviceRow[]> {
  const ownerDevices = devices.filter((d) => d.userId === ownerId);
  const staffDevices = devices.filter((d) => d.userId !== ownerId);
  if (staffDevices.length === 0) return ownerDevices;
  const need = audience.category
    ? (CATEGORY_PERMISSIONS as Record<string, readonly string[] | null | undefined>)[audience.category]
    : null;
  if (!need) return ownerDevices;

  const staffIds = [...new Set(staffDevices.map((d) => d.userId))];
  const [staff, channels] = await Promise.all([
    prisma.user.findMany({
      // ownerId khớp shop + chưa xóa: máy còn token của nhân viên đã nghỉ thì không gửi.
      where: { id: { in: staffIds }, ownerId, deletedAt: null },
      select: { id: true, permissions: true, staffChannels: { select: { channelId: true } } },
    }),
    prisma.channel.findMany({ where: { userId: ownerId }, select: { id: true } }),
  ]);
  const ownerChannelIds = channels.map((c) => c.id);
  const allowed = new Set<string>();
  for (const u of staff) {
    const scope = staffNotificationScope(
      u.permissions,
      u.staffChannels.map((c) => c.channelId),
      ownerChannelIds
    );
    if (staffCanSeeNotification(scope, audience)) allowed.add(u.id);
  }
  return [...ownerDevices, ...staffDevices.filter((d) => allowed.has(d.userId))];
}

/**
 * Đẩy một tin tới mọi thiết bị đang bật của chủ shop. Trả số tin đã gửi
 * (0 khi không có thiết bị / lỗi mạng) — để worker log, không ai chờ nó.
 * Có `audience` (tin đi kèm một thông báo chuông) thì gửi thêm máy của nhân viên
 * được thấy thông báo đó; không có (tin thử) thì chỉ máy của chính chủ shop.
 */
export async function sendPushToOwner(
  ownerId: string,
  msg: PushMessage,
  audience?: PushAudience
): Promise<number> {
  try {
    const all: DeviceRow[] = await prisma.pushDevice.findMany({
      where: audience ? { ownerId, enabled: true } : { ownerId, userId: ownerId, enabled: true },
      select: { id: true, token: true, userId: true },
    });
    const devices = audience ? await devicesAllowed(ownerId, all, audience) : all;
    if (devices.length === 0) return 0;

    const title = trimForPush(msg.title, TITLE_MAX) ?? "Hubsell";
    const body = trimForPush(msg.body, BODY_MAX);
    let sent = 0;
    for (let i = 0; i < devices.length; i += BATCH) {
      const chunk = devices.slice(i, i + BATCH);
      const messages = chunk.map((d) => ({
        to: d.token,
        title,
        body,
        data: msg.data ?? {},
        sound: "default",
        priority: "high",
        channelId: "default",
      }));
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      // Tùy chọn: bật "Enhanced push security" trên expo.dev thì cần token này.
      if (process.env.EXPO_PUSH_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`;
      }
      const res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) });
      if (!res.ok) {
        console.error(`[push] exp.host trả ${res.status}`);
        continue;
      }
      const json = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
      const tickets = json?.data ?? [];
      const dead: string[] = [];
      tickets.forEach((t, idx) => {
        if (t.status === "ok") {
          sent++;
          return;
        }
        if (t.details?.error === "DeviceNotRegistered" && chunk[idx]) dead.push(chunk[idx].id);
        else console.warn(`[push] vé lỗi: ${t.details?.error ?? t.message ?? "?"}`);
      });
      if (dead.length > 0) {
        await prisma.pushDevice.updateMany({ where: { id: { in: dead } }, data: { enabled: false } });
      }
    }
    return sent;
  } catch (err) {
    console.error("[push] gửi lỗi:", (err as Error).message);
    return 0;
  }
}
