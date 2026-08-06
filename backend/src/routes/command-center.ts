import { Router } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { scanOpsAlerts } from "../ops-alerts";

/**
 * TRUNG TÂM ĐIỀU HÀNH (Command Center) — lưu trạng thái người dùng thao tác.
 *
 * Cảnh báo gốc vẫn sinh ở frontend (mock/quét realtime); backend CHỈ lưu những
 * thay đổi để không mất khi F5: cảnh báo nào đã xử lý, tin thảo luận mới, sự
 * kiện nhật ký mới. Mọi thứ gắn theo `req.ownerId` — mỗi shop một không gian.
 */

const router = Router();

const VALID_TAGS = ["inventory", "finance", "channel", "ads"];
const VALID_ROLES = ["ADMIN", "KHO", "KE_TOAN", "MARKETING"];
const VALID_BODY_KINDS = ["text", "table", "image"];

// Trần kích thước một tin (JSON đã chuỗi hoá). Ảnh base64 tối đa ~2MB ⇒ ~2.8MB.
const MAX_BODY_CHARS = 3_000_000;

function normRole(value: unknown): string {
  return typeof value === "string" && VALID_ROLES.includes(value) ? value : "ADMIN";
}

/** Kiểm tra tối thiểu một ChatBody hợp lệ (đủ để không lưu rác vào DB). */
function isValidBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const kind = (body as Record<string, unknown>).kind;
  if (typeof kind !== "string" || !VALID_BODY_KINDS.includes(kind)) return false;
  if (kind === "text") return typeof (body as { text?: unknown }).text === "string";
  if (kind === "table") return Array.isArray((body as { rows?: unknown }).rows);
  if (kind === "image") {
    const b = body as { dataUrl?: unknown; name?: unknown };
    return typeof b.dataUrl === "string" && typeof b.name === "string";
  }
  return false;
}

function serializeActivity(a: {
  id: string;
  tag: string;
  message: string;
  createdAt: Date;
}) {
  return { id: a.id, tag: a.tag, message: a.message, at: a.createdAt.toISOString() };
}

function serializeChat(m: {
  id: string;
  alertId: string;
  author: string;
  role: string;
  body: string;
  createdAt: Date;
}) {
  let body: unknown;
  try {
    body = JSON.parse(m.body);
  } catch {
    // Dữ liệu hỏng (không nên xảy ra) → trả về text an toàn thay vì làm vỡ trang.
    body = { kind: "text", text: "" };
  }
  return {
    id: m.id,
    alertId: m.alertId,
    author: m.author,
    role: m.role,
    body,
    at: m.createdAt.toISOString(),
  };
}

/**
 * Ghi một dòng nhật ký nếu client gửi kèm. Dùng chung cho cả /resolve và /chat
 * để hai thao tác này để lại dấu vết trong nhật ký một cách nhất quán.
 */
async function maybeLogActivity(
  ownerId: string,
  activity: unknown
): Promise<ReturnType<typeof serializeActivity> | null> {
  if (!activity || typeof activity !== "object") return null;
  const { tag, message } = activity as { tag?: unknown; message?: unknown };
  if (typeof tag !== "string" || !VALID_TAGS.includes(tag)) return null;
  if (typeof message !== "string" || message.trim() === "") return null;
  const row = await prisma.opsActivity.create({
    data: { ownerId, tag, message: message.trim() },
  });
  return serializeActivity(row);
}

/** Một cảnh báo THẬT (bảng OpsAlert) trả về frontend — payload đã parse. */
function serializeOpsAlert(a: {
  id: string;
  type: string;
  tag: string;
  severity: string;
  title: string;
  summary: string;
  payload: string | null;
  createdAt: Date;
}) {
  let payload: unknown = null;
  if (a.payload) {
    try {
      payload = JSON.parse(a.payload);
    } catch {
      payload = null; // payload hỏng → frontend fallback nút xác nhận thường
    }
  }
  return {
    id: a.id,
    type: a.type,
    tag: a.tag,
    severity: a.severity,
    title: a.title,
    summary: a.summary,
    payload,
    createdAt: a.createdAt.toISOString(),
  };
}

// GET /api/command-center/state — toàn bộ trạng thái đã lưu của shop.
router.get("/state", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;

    // Quét cảnh báo thật trước khi đọc (throttle 10'/shop, nuốt lỗi nội bộ).
    await scanOpsAlerts(ownerId);

    const [resolved, chat, activities, opsAlerts, visit] = await Promise.all([
      prisma.opsResolvedAlert.findMany({
        where: { ownerId },
        select: { alertId: true },
      }),
      prisma.opsChatMessage.findMany({
        where: { ownerId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.opsActivity.findMany({
        where: { ownerId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.opsAlert.findMany({
        where: { ownerId, status: "OPEN" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.opsCenterVisit.findUnique({ where: { ownerId } }),
    ]);

    res.json({
      resolvedAlertIds: resolved.map((r) => r.alertId),
      chat: chat.map(serializeChat),
      activities: activities.map(serializeActivity),
      opsAlerts: opsAlerts.map(serializeOpsAlert),
      // Mốc lần xem TRƯỚC — frontend gắn nhãn "Mới" cho cảnh báo sau mốc này,
      // rồi tự gọi POST /seen để dời mốc cho lần sau.
      lastSeenAt: visit?.lastSeenAt.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/command-center/seen — ghi nhận "vừa xem Trung tâm điều hành".
router.post("/seen", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const now = new Date();
    await prisma.opsCenterVisit.upsert({
      where: { ownerId },
      create: { ownerId, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
    res.json({ ok: true, lastSeenAt: now.toISOString() });
  } catch (err) {
    next(err);
  }
});

// POST /api/command-center/alerts/:id/resolve — chủ shop tick "Đã xử lý" một
// cảnh báo THẬT. Một chiều: ẩn cho tới khi điều kiện hết hẳn rồi tái phát.
// Body: { activity?: {tag,message} } — dòng nhật ký kèm theo (nếu có).
router.post("/alerts/:id/resolve", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const updated = await prisma.opsAlert.updateMany({
      where: { id: req.params.id, ownerId, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (updated.count === 0) {
      res.status(404).json({ error: "Không tìm thấy cảnh báo đang mở" });
      return;
    }
    const loggedActivity = await maybeLogActivity(ownerId, req.body?.activity);
    res.json({ ok: true, activity: loggedActivity });
  } catch (err) {
    next(err);
  }
});

// POST /api/command-center/resolve — đánh dấu (hoặc bỏ đánh dấu) một cảnh báo
// "Đã xử lý". Body: { alertId, resolved: boolean, byRole?, activity?: {tag,message} }
router.post("/resolve", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const { alertId, resolved, byRole, activity } = req.body ?? {};

    if (typeof alertId !== "string" || alertId.trim() === "") {
      res.status(400).json({ error: "Thiếu alertId" });
      return;
    }
    if (typeof resolved !== "boolean") {
      res.status(400).json({ error: "resolved phải là true/false" });
      return;
    }

    if (resolved) {
      // Upsert để tick lại nhiều lần không lỗi trùng khoá.
      await prisma.opsResolvedAlert.upsert({
        where: { ownerId_alertId: { ownerId, alertId } },
        create: { ownerId, alertId, byRole: normRole(byRole) },
        update: { byRole: normRole(byRole), resolvedAt: new Date() },
      });
    } else {
      await prisma.opsResolvedAlert.deleteMany({ where: { ownerId, alertId } });
    }

    const loggedActivity = resolved
      ? await maybeLogActivity(ownerId, activity)
      : null;

    res.json({ ok: true, resolved, activity: loggedActivity });
  } catch (err) {
    next(err);
  }
});

// POST /api/command-center/chat — thêm một tin thảo luận cho một cảnh báo.
// Body: { alertId, role, body: ChatBody, author?, activity?: {tag,message} }
router.post("/chat", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const { alertId, role, body, author, activity } = req.body ?? {};

    if (typeof alertId !== "string" || alertId.trim() === "") {
      res.status(400).json({ error: "Thiếu alertId" });
      return;
    }
    if (!isValidBody(body)) {
      res.status(400).json({ error: "Nội dung tin nhắn không hợp lệ" });
      return;
    }

    const bodyJson = JSON.stringify(body);
    if (bodyJson.length > MAX_BODY_CHARS) {
      res.status(413).json({ error: "Nội dung tin nhắn quá lớn" });
      return;
    }

    const message = await prisma.opsChatMessage.create({
      data: {
        ownerId,
        alertId,
        author: typeof author === "string" && author.trim() ? author.trim() : "Bạn",
        role: normRole(role),
        body: bodyJson,
      },
    });

    const loggedActivity = await maybeLogActivity(ownerId, activity);

    res.status(201).json({
      message: serializeChat(message),
      activity: loggedActivity,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
