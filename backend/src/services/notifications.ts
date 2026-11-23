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
// NHÂN VIÊN (23/11/2026): danh sách chuông, số chưa đọc, đánh dấu đã đọc và tin
// đẩy về máy mở theo quyền + gian được giao — luật ở notification-access.ts.
// Luồng SSE của web và các đường cài đặt / gửi thử vẫn chỉ chủ shop.
// ============================================================

import type { Response } from "express";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { Role, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin, type AuthRequest } from "../middleware/auth";
import { cleanChannelIds, staffNotificationScope, staffNotificationWhere } from "./notification-access";
import {
  NOTIFICATION_GROUPS,
  categoryOf,
  isCategoryMuted,
  sanitizeMuted,
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
  /**
   * Các gian thông báo này nói tới (đơn của gian nào, chiến dịch của gian nào). Bỏ
   * trống = chuyện của cả shop. Nhân viên chỉ nhận thông báo của gian được giao
   * (notification-access.ts) nên nơi phát BIẾT gian thì phải điền.
   */
  channelIds?: readonly (string | null | undefined)[];
}

// ─────────────────── NHÓM ĐÃ TẮT (cache 60 s mỗi chủ shop) ───────────────────
// Worker gọi notify() hàng trăm lần một lượt quét → không hỏi DB mỗi lần.
// Tiến trình web đổi ưu tiên thì tự xóa cache của mình; worker thấy sau ≤ 60 s.
// 20 s: khách gạt tắt trên app thì worker (tiến trình khác) im sau tối đa 20 s —
// 60 s từng để lọt một đợt đơn mới ngay sau khi tắt (anh Trung 23/10 tối).
const PREF_TTL_MS = 20_000;
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
  return isCategoryMuted(await getMutedCategories(ownerId), category);
}

/** Cho nơi gom đợt (đơn mới) hỏi trước khi làm việc nặng / cộng dồn. */
export async function isNotificationTypeMuted(ownerId: string, type: string): Promise<boolean> {
  return isMuted(ownerId, categoryOf(type));
}

/**
 * Phát một thông báo cho chủ shop (và nhân viên được thấy nó): ghi DB + đẩy SSE (web) + push (app).
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
    const channelIds = cleanChannelIds(input.channelIds);

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
        category,
        channelIds,
      },
    });

    pushToClients(row);
    if (input.push !== false) {
      void sendPushToOwner(
        ownerId,
        {
          title: input.title,
          body: input.body,
          data: { notificationId: row.id, type: input.type, category, link: input.link ?? null },
        },
        { category, channelIds }
      );
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
 * mở bản ghi mới. `patch.channelIds` = danh sách gian SAU khi cộng dồn (thay cả
 * danh sách); bỏ trống thì giữ danh sách cũ.
 */
export async function amendNotification(
  ownerId: string,
  id: string,
  patch: { title: string; body?: string; channelIds?: readonly (string | null | undefined)[] },
  push?: { title: string; body?: string; data?: Record<string, unknown> }
): Promise<boolean> {
  try {
    const cur = await prisma.notification.findFirst({
      where: { id, ownerId },
      select: { id: true, readAt: true, type: true },
    });
    if (!cur || cur.readAt) return false;
    // Khách vừa tắt nhóm → đợt cộng dồn cũng im (trước đây lọt qua đường này).
    if (await isMuted(ownerId, categoryOf(cur.type))) return false;
    const row = await prisma.notification.update({
      where: { id },
      data: {
        title: patch.title,
        body: patch.body ?? null,
        ...(patch.channelIds ? { channelIds: cleanChannelIds(patch.channelIds) } : {}),
      },
    });
    pushToClients(row);
    if (push) {
      const category = categoryOf(row.type);
      void sendPushToOwner(
        ownerId,
        {
          title: push.title,
          body: push.body,
          data: { notificationId: row.id, type: row.type, category, link: row.link, ...(push.data ?? {}) },
        },
        { category, channelIds: row.channelIds }
      );
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
 * PHẠM VI ĐỌC của người đang gọi (mount ở app.ts chỉ còn requireAuth từ 23/11/2026):
 *  - chủ shop: mọi thông báo của shop;
 *  - nhân viên: đúng các mục khớp quyền + gian được giao (notification-access.ts);
 *  - nhân viên không có quyền nào ứng với một mục thông báo: null — không có chuông.
 * Quyền và gian đọc tươi mỗi request (requireAuth) nên chủ shop đổi là có hiệu lực ngay.
 */
async function readScopeOf(req: AuthRequest): Promise<Prisma.NotificationWhereInput | null> {
  const ownerId = req.ownerId!;
  if (req.userRole === Role.ADMIN) return { ownerId };
  const channels = await prisma.channel.findMany({ where: { userId: ownerId }, select: { id: true } });
  const scope = staffNotificationScope(
    req.permissions ?? [],
    req.allowedChannelIds ?? [],
    channels.map((c) => c.id)
  );
  if (scope.categories.length === 0) return null;
  return { ownerId, ...staffNotificationWhere(scope) };
}

/**
 * Danh sách mới nhất + số chưa đọc — nuôi chuông và badge. App cuộn tiếp bằng
 * ?before=<createdAt ISO của dòng cuối> (trang 30 dòng). Mỗi dòng kèm `category`
 * để app vẽ icon theo nhóm. Nhân viên chỉ nhận phần trong phạm vi của mình;
 * không có phạm vi thì danh sách rỗng (không 403 — app khỏi phải rẽ nhánh lỗi).
 */
notificationsRouter.get("/", async (req: AuthRequest, res) => {
  const scope = await readScopeOf(req);
  if (!scope) {
    res.json({ items: [], unread: 0, hasMore: false });
    return;
  }
  const beforeRaw = typeof req.query.before === "string" ? new Date(req.query.before) : null;
  const before = beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : null;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { ...scope, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.count({ where: { ...scope, readAt: null } }),
  ]);
  res.json({
    items: items.map((n) => ({ ...n, category: categoryOf(n.type) })),
    unread,
    hasMore: items.length === 30,
  });
});

// ─────────────────────── ƯU TIÊN THEO NHÓM (app Cài đặt) ───────────────────────

/**
 * Cây nhóm cha → mục con + danh sách khóa đã tắt (khóa nhóm hoặc khóa mục).
 * Bật / tắt nhóm là cài đặt của CHỦ SHOP — nhân viên theo cài đặt đó, không có bản riêng.
 */
notificationsRouter.get("/preferences", requireAdmin, async (req: AuthRequest, res) => {
  const muted = await getMutedCategories(req.ownerId!);
  res.json({ groups: NOTIFICATION_GROUPS, muted: [...muted] });
});

/** Ghi đè toàn bộ danh sách đã tắt: body { muted: string[] } — khóa nhóm và/hoặc khóa mục. */
notificationsRouter.put("/preferences", requireAdmin, async (req: AuthRequest, res) => {
  const ownerId = req.ownerId!;
  const raw: unknown = req.body?.muted;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "Thiếu danh sách đã tắt (muted)" });
    return;
  }
  const muted = sanitizeMuted(raw);
  await prisma.notificationPreference.upsert({
    where: { ownerId },
    create: { ownerId, mutedCategories: muted },
    update: { mutedCategories: muted },
  });
  invalidateMutedCache(ownerId);
  res.json({ groups: NOTIFICATION_GROUPS, muted });
});

// ─────────────────────── THIẾT BỊ NHẬN PUSH (app mobile) ───────────────────────

/**
 * App đăng ký / làm mới token sau khi đăng nhập. body { token, platform, appVersion?, deviceName? }
 * Chủ shop lẫn nhân viên đều đăng ký được; máy nhân viên chỉ nhận tin của thông báo
 * họ được thấy (push.ts lọc lúc gửi).
 */
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

/**
 * Gửi một tin đẩy THỬ tới mọi máy đang bật của chính chủ shop (nút "Gửi thử một
 * thông báo" ở Cài đặt thông báo trên app, 23/10/2026) — chỉ push, không ghi
 * chuông. Trả số máy đã nhận để app báo "Đã gửi tới N máy" / "Chưa có máy nào".
 */
notificationsRouter.post("/test-push", requireAdmin, async (req: AuthRequest, res) => {
  const sent = await sendPushToOwner(req.ownerId!, {
    title: "Thử thông báo đẩy",
    body: "Hubsell gửi được tin về máy này. Đơn mới, khách xin hủy, hàng hoàn… sẽ báo như vậy.",
    data: { type: "system", category: "system_other", link: null },
  });
  res.json({ sent });
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

/**
 * Đánh dấu ĐÃ ĐỌC — mặc định toàn bộ; truyền ids để đánh dấu lẻ. "Đã đọc" dùng chung
 * cả shop; nhân viên chỉ đánh dấu được những dòng trong phạm vi của mình (bấm "đọc
 * hết" không xóa chấm đỏ của các thông báo chỉ chủ shop thấy).
 */
notificationsRouter.post("/read", async (req: AuthRequest, res) => {
  const scope = await readScopeOf(req);
  if (!scope) {
    res.json({ marked: 0 });
    return;
  }
  const ids: unknown = req.body?.ids;
  const where: Prisma.NotificationWhereInput =
    Array.isArray(ids) && ids.length > 0
      ? { ...scope, id: { in: ids.map(String) }, readAt: null }
      : { ...scope, readAt: null };
  const updated = await prisma.notification.updateMany({
    where,
    data: { readAt: new Date() },
  });
  res.json({ marked: updated.count });
});

// Route DEV-ONLY để test chuông + SSE không cần chờ sự kiện thật (đơn hoàn,
// cảnh báo điều hành). Không tồn tại trên production.
if (process.env.NODE_ENV !== "production") {
  notificationsRouter.post("/dev-test", requireAdmin, async (req: AuthRequest, res) => {
    await notify(req.ownerId!, {
      // channelIds tùy chọn để thử phạm vi gian của nhân viên.
      channelIds: Array.isArray(req.body?.channelIds) ? req.body.channelIds.map(String) : undefined,
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
