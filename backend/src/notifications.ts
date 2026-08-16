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
import { prisma } from "./prisma";
import type { AuthRequest } from "./auth";

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
}

/**
 * Phát một thông báo cho chủ shop: ghi DB + đẩy SSE. KHÔNG BAO GIỜ ném lỗi —
 * thông báo là tiện ích, không được làm vỡ nghiệp vụ đang gọi nó (đồng bộ
 * đơn hoàn, quét cảnh báo…).
 */
export async function notify(ownerId: string, input: NotifyInput): Promise<void> {
  try {
    // Sự kiện lặp (worker quét lại cùng điều kiện) không nên thành chuỗi
    // thông báo trùng — đã có một bản CHƯA ĐỌC y hệt gần đây thì thôi.
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
    if (dupe) return;

    const row = await prisma.notification.create({
      data: {
        ownerId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
    });

    const set = clients.get(ownerId);
    if (set && set.size > 0) {
      const payload = `data: ${JSON.stringify(row)}\n\n`;
      for (const res of set) {
        try {
          res.write(payload);
        } catch {
          set.delete(res);
        }
      }
    }
  } catch (err) {
    console.error("[notifications] notify lỗi:", (err as Error).message);
  }
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

/** Danh sách mới nhất + số chưa đọc — nuôi chuông và badge. */
notificationsRouter.get("/", async (req: AuthRequest, res) => {
  const ownerId = req.ownerId!;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.count({ where: { ownerId, readAt: null } }),
  ]);
  res.json({ items, unread });
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
      type: "system",
      title: String(req.body?.title ?? "Thông báo thử nghiệm"),
      body: String(req.body?.body ?? "Phát từ /dev-test để kiểm tra chuông + SSE."),
      link: typeof req.body?.link === "string" ? req.body.link : undefined,
    });
    res.json({ ok: true });
  });
}
