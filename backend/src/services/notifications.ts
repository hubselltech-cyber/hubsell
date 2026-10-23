// ============================================================
// THÔNG BÁO TRONG APP + SSE — chuông trên header (Tầng 3 kế hoạch UI)
//
// notify(ownerId, ...) là CỬA DUY NHẤT để phát thông báo: ghi bản ghi
// Notification vào DB (chuông đọc lại được kể cả khi offline lúc sự kiện nổ)
// RỒI đẩy ngay xuống mọi trình duyệt của chủ shop đang mở qua SSE.
//
// Vì sao SSE mà không phải WebSocket: luồng này CHỈ MỘT CHIỀU server → client,
// SSE chạy trên HTTP thường (Render/proxy không cần cấu hình thêm), EventSource
// phía trình duyệt TỰ RECONNECT khi rớt mạng — đúng nhu cầu, rẻ hơn hẳn.
//
// Hub giữ kết nối TRONG BỘ NHỚ theo ownerId — backend đang chạy 1 instance
// (Render hubsell-backend-sg); nếu sau này scale ngang thì thay hub bằng
// Redis pub/sub, chữ ký notify() giữ nguyên.
//
// GĐ1 chỉ CHỦ SHOP nhận thông báo (nhiều loại là dữ liệu tài chính); mở cho
// nhân viên theo cây quyền để sau.
// ============================================================

import type { Response } from "express";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import {
  NOTIFICATION_CATEGORIES,
  categoryOf,
  isLockedCategory,
  isNotificationCategory,
  type NotificationCategoryKey,
} from "./notification-categories";
import { isExpoPushToken, sendPushToOwner } from "./push";

// Cùng secret với auth.ts (stream không đi qua requireAuth được — xem dưới)
const JWT_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";

/** Trình duyệt đang mở của từng chủ shop — một người có thể mở nhiều tab. */
const clients = new Map<string, Set<Response>>();

/** Nhịp giữ ấm kết nối — dòng comment SSE để proxy không cắt vì im lặng lâu. */
const HEARTBEAT_MS = 30_000;

/** Chống dội: cùng (owner, type, title) chưa đọc trong cửa sổ này thì thôi. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** false = không khử trùng 24 h (đơn mới gom đợt: mỗi đợt là một bản ghi). */
  dedupe?: boolean;
  /** false = chỉ ghi chuông, không đẩy về điện thoại. */
  push?: boolean;
}

// ─────────────────── NHÓM ĐÃ TẮT (cache 60 s mỗi chủ shop) ───────────────────
// Worker gọi notify() hàng trăm lần một lượt quét → không hỏi DB mỗi lần.
// Tiến trình web đổi ưu tiên thì tự xóa cache của mình; worker thấy sau ≤ 60 s.
const PREF_TTL_MS = 60_000;
const prefCache = new Map<string, { muted: Set<string>; at: number }>();

export async function getMutedCategories(ownerId: string): Promise<Set<string>> {
  const hit = prefCache.get(ownerId);
  if (hit && Date.now() - hit.at < PREF_TTL_MS) return hit.muted;
  const row = await prisma.notificationPreference.findUnique({
    where: { ownerId },
    select: { mutedCategories: true },
  });
  const muted = new Set(row?.mutedCategories ?? []);
  prefCache.set(ownerId, { muted, at: Date.now() });
  return muted;
}

export function invalidateMutedCache(ownerId: string): void {
  prefCache.delete(ownerId);
}

async function isMuted(ownerId: string, category: NotificationCategoryKey): Promise<boolean> {
  if (isLockedCategory(category)) return false;
  return (await getMutedCategories(ownerId)).has(category);
}

/**
 * Phát một thông báo cho chủ shop: ghi DB + đẩy SSE (web) + push (app).
 * KHÔNG BAO GIỜ ném lỗi — thông báo là tiện ích, không được làm vỡ nghiệp vụ
 * đang gọi nó (đồng bộ đơn hoàn, quét cảnh báo…). Trả id bản ghi để nơi gọi
 * cộng dồn về sau (đơn mới), null khi bỏ qua / lỗi.
 */
export async function notify(ownerId: string, input: NotifyInput): Promise<{ id: string } | null> {
  try {
    // Khách đã tắt nhóm này (app → Cài đặt → Thông báo) thì không ghi gì cả —
    // chuông web lẫn push app cùng im, đúng ý "tắt là thôi".
    const category = categoryOf(input.type);
    if (await isMuted(ownerId, category)) return null;

    // Sự kiện lặp (worker quét lại cùng điều kiện) không nên thành chuỗi
    // thông báo trùng — đã có một bản CHƯA ĐỌC y hệt gần đây thì thôi.
    if (input.dedupe !== false) {
      const dupe = await prisma.notification.findFirst({
        where: {
          ownerId,
          type: input.type,
          title: input.title,
          readAt: null,
          createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (dupe) return null;
    }

    const row = await prisma.notification.create({
      data: {
        ownerId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
    });

    pushToClients(row);
    if (input.push !== false) {
      void sendPushToOwner(ownerId, {
        title: input.title,
        body: input.body,
        data: { notificationId: row.id, type: input.type, category, link: input.link ?? null },
      });
    }
    return { id: row.id };
  } catch (err) {
    console.error("[notifications] notify lỗi:", (err as Error).message);
    return null;
  }
}

/**
 * Sửa nội dung một bản ghi CHƯA ĐỌC (đơn mới cộng dồn trong 15 phút) và đẩy
 * push với phần tăng thêm. Trả false khi bản ghi đã đọc / không còn — nơi gọi
 * mở bản ghi mới.
 */
export async function amendNotification(
  ownerId: string,
  id: string,
  patch: { title: string; body?: string },
  push?: { title: string; body?: string; data?: Record<string, unknown> }
): Promise<boolean> {
  try {
    const cur = await prisma.notification.findFirst({
      where: { id, ownerId },
      select: { id: true, readAt: true },
    });
    if (!cur || cur.readAt) return false;
    const row = await prisma.notification.update({
      where: { id },
      data: { title: patch.title, body: patch.body ?? null },
    });
    pushToClients(row);
    if (push) {
      void sendPushToOwner(ownerId, {
        title: push.title,
        body: push.body,
        data: { notificationId: row.id, type: row.type, category: categoryOf(row.type), link: row.link, ...(push.data ?? {}) },
      });
    }
    return true;
  } catch (err) {
    console.error("[notifications] amend lỗi:", (err as Error).message);
    return false;
  }
}

/** Đẩy một bản ghi tới mọi tab đang mở của chủ shop (không có tab → bỏ qua). */
function pushToClients(row: { id: string; ownerId: string }): void {
  const set = clients.get(row.ownerId);
  if (!set || set.size === 0) return;
  pushedRecently.set(row.id, Date.now());
  const payload = `data: ${JSON.stringify(row)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

// ─────────────────────────── CẦU SSE LIÊN TIẾN TRÌNH ───────────────────────────
//
// 12/09/2026 — worker nền có thể chạy ở TIẾN TRÌNH KHÁC (HUBSELL_ROLE=worker):
// notify() bên đó ghi DB nhưng không thấy `clients` của web. Cầu này chạy ở
// tiến trình web: theo nhịp, hỏi DB thông báo MỚI của đúng những chủ shop
// đang mở SSE (không quét cả bảng) rồi đẩy xuống. Tab đóng hết = không query.
// Chi phí tỉ lệ với số trình duyệt đang mở, không phải số shop.
//
// Vai "all" (web + worker chung tiến trình): notify() đã đẩy thẳng và ghi id
// vào pushedRecently → cầu bỏ qua, không đẩy đôi.

/** Nhịp hỏi DB của cầu (ms). Chuông vẫn poll REST 60s nên đây chỉ là "gần real-time". */
const SSE_BRIDGE_TICK_MS = 10_000;
/** id đã đẩy trực tiếp gần đây (chống đẩy đôi ở vai all) — dọn sau 2 phút. */
const pushedRecently = new Map<string, number>();
const PUSHED_TTL_MS = 2 * 60 * 1000;

let bridgeStarted = false;

/** Khởi động cầu SSE (gọi 1 lần ở index.ts, vai web/all). Timer unref. */
export function startNotificationSseBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  // Mốc "đã xem tới đâu": chỉ đẩy thông báo tạo SAU lúc cầu khởi động.
  let since = new Date();
  let ticking = false;

  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      try {
        const now = Date.now();
        for (const [id, at] of pushedRecently) {
          if (now - at > PUSHED_TTL_MS) pushedRecently.delete(id);
        }
        const owners = [...clients.keys()];
        if (owners.length === 0) {
          since = new Date();
          return;
        }
        const rows = await prisma.notification.findMany({
          where: { ownerId: { in: owners }, createdAt: { gt: since } },
          orderBy: { createdAt: "asc" },
          take: 200,
        });
        for (const row of rows) {
          if (row.createdAt > since) since = row.createdAt;
          if (pushedRecently.has(row.id)) continue;
          pushToClients(row);
        }
      } catch (err) {
        console.error("[notifications] cầu SSE lỗi:", (err as Error).message);
      } finally {
        ticking = false;
      }
    })();
  }, SSE_BRIDGE_TICK_MS).unref();
}

// ─────────────────────────── SSE STREAM ───────────────────────────

/**
 * GET /api/notifications/stream?token=…
 *
 * EventSource của trình duyệt KHÔNG gắn được header Authorization nên token đi
 * qua query param — vẫn là JWT thật, verify y như requireAuth. Đường dẫn này
 * chỉ mở stream một chiều, không đọc/ghi được dữ liệu nào khác.
 */
export async function notificationStream(req: AuthRequest, res: Response) {
  try {
    const token = String(req.query.token ?? "");
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: String(payload.sub ?? "") },
      select: { id: true, role: true, ownerId: true },
    });
    if (!user || user.role !== Role.ADMIN) {
      res.status(401).end();
      return;
    }
    const ownerId = user.ownerId ?? user.id;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Nginx/proxy hay buffer response — tắt để sự kiện xuống ngay
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    let set = clients.get(ownerId);
    if (!set) {
      set = new Set();
      clients.set(ownerId, set);
    }
    set.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        // đóng ở dưới qua sự kiện close
      }
    }, HEARTBEAT_MS);

    req.on("close", () => {
      clearInterval(heartbeat);
      set!.delete(res);
      if (set!.size === 0) clients.delete(ownerId);
    });
  } catch {
    res.status(401).end();
  }
}

// ─────────────────────────── REST ───────────────────────────

export const notificationsRouter = Router();

/**
 * Danh sách mới nhất + số chưa đọc — nuôi chuông và badge. App cuộn tiếp bằng
 * ?before=<createdAt ISO của dòng cuối> (trang 30 dòng). Mỗi dòng kèm `category`
 * để app vẽ icon theo nhóm.
 */
notificationsRouter.get("/", async (req: AuthRequest, res) => {
  const ownerId = req.ownerId!;
  const beforeRaw = typeof req.query.before === "string" ? new Date(req.query.before) : null;
  const before = beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : null;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { ownerId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.count({ where: { ownerId, readAt: null } }),
  ]);
  res.json({
    items: items.map((n) => ({ ...n, category: categoryOf(n.type) })),
    unread,
    hasMore: items.length === 30,
  });
});

// ─────────────────────── ƯU TIÊN THEO NHÓM (app Cài đặt) ───────────────────────

/** Danh sách nhóm + nhóm đã tắt của chủ shop. */
notificationsRouter.get("/preferences", async (req: AuthRequest, res) => {
  const muted = await getMutedCategories(req.ownerId!);
  res.json({ categories: NOTIFICATION_CATEGORIES, muted: [...muted] });
});

/** Ghi đè toàn bộ danh sách nhóm đã tắt: body { muted: string[] }. */
notificationsRouter.put("/preferences", async (req: AuthRequest, res) => {
  const ownerId = req.ownerId!;
  const raw: unknown = req.body?.muted;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "Thiếu danh sách nhóm đã tắt (muted)" });
    return;
  }
  const muted = [...new Set(raw.map(String))].filter(
    (k) => isNotificationCategory(k) && !isLockedCategory(k)
  );
  await prisma.notificationPreference.upsert({
    where: { ownerId },
    create: { ownerId, mutedCategories: muted },
    update: { mutedCategories: muted },
  });
  invalidateMutedCache(ownerId);
  res.json({ categories: NOTIFICATION_CATEGORIES, muted });
});

// ─────────────────────── THIẾT BỊ NHẬN PUSH (app mobile) ───────────────────────

/** App đăng ký / làm mới token sau khi đăng nhập. body { token, platform, appVersion?, deviceName? } */
notificationsRouter.post("/devices", async (req: AuthRequest, res) => {
  const { token, platform, appVersion, deviceName } = req.body ?? {};
  if (!isExpoPushToken(token)) {
    res.status(400).json({ error: "Token thiết bị không hợp lệ" });
    return;
  }
  const plat = platform === "ios" || platform === "android" ? platform : "unknown";
  const data = {
    userId: req.userId!,
    ownerId: req.ownerId!,
    platform: plat,
    appVersion: typeof appVersion === "string" ? appVersion.slice(0, 32) : null,
    deviceName: typeof deviceName === "string" ? deviceName.slice(0, 80) : null,
    enabled: true,
    lastSeenAt: new Date(),
  };
  await prisma.pushDevice.upsert({ where: { token }, create: { token, ...data }, update: data });
  res.json({ ok: true });
});

/** Đăng xuất / tắt push trên máy này: body { token }. */
notificationsRouter.delete("/devices", async (req: AuthRequest, res) => {
  const token = req.body?.token;
  if (!isExpoPushToken(token)) {
    res.status(400).json({ error: "Token thiết bị không hợp lệ" });
    return;
  }
  const r = await prisma.pushDevice.deleteMany({ where: { token, userId: req.userId! } });
  res.json({ removed: r.count });
});

/** Đánh dấu ĐÃ ĐỌC — mặc định toàn bộ; truyền ids để đánh dấu lẻ. */
notificationsRouter.post("/read", async (req: AuthRequest, res) => {
  const ownerId = req.ownerId!;
  const ids: unknown = req.body?.ids;
  const where =
    Array.isArray(ids) && ids.length > 0
      ? { ownerId, id: { in: ids.map(String) }, readAt: null }
      : { ownerId, readAt: null };
  const updated = await prisma.notification.updateMany({
    where,
    data: { readAt: new Date() },
  });
  res.json({ marked: updated.count });
});

// Route DEV-ONLY để test chuông + SSE không cần chờ sự kiện thật (đơn hoàn,
// cảnh báo điều hành). Không tồn tại trên production.
if (process.env.NODE_ENV !== "production") {
  notificationsRouter.post("/dev-test", async (req: AuthRequest, res) => {
    await notify(req.ownerId!, {
      // type tùy chọn để thử icon / nhóm trên app (order_express, cancel_request, ops-alert:stockout…)
      type: typeof req.body?.type === "string" && req.body.type ? req.body.type : "system",
      dedupe: false,
      title: String(req.body?.title ?? "Thông báo thử nghiệm"),
      body: String(req.body?.body ?? "Phát từ /dev-test để kiểm tra chuông + SSE."),
      link: typeof req.body?.link === "string" ? req.body.link : undefined,
    });
    res.json({ ok: true });
  });
}
