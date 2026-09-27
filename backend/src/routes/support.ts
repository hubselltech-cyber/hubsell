// ============================================================
// YÊU CẦU HỖ TRỢ — phía KHÁCH đã đăng nhập (anh Trung 27/09/2026).
//
// Vì sao: khách SaaS rất ít khi chịu gửi yêu cầu hỗ trợ, nên form phải cực
// ngắn — MỘT ô nội dung + Gửi. Tên/email/SĐT/gian/gói đã có trong tài khoản,
// hệ thống tự đính kèm; chỉ hỏi thêm SĐT khi tài khoản chưa có số.
// Gửi xong: email báo mọi platform admin (cùng máy gửi với yêu cầu mua gói),
// HQ xử lý ở tab "Yêu cầu hỗ trợ" (/admin/customers), khách xem trạng thái +
// câu trả lời ngay trong hộp đã gửi.
//
//   POST /api/support-requests        { content, phoneNumber?, country? }
//   GET  /api/support-requests/mine   danh sách của SHOP (chủ + nhân viên cùng thấy)
// ============================================================

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { formatE164 } from "../lib/phone";
import { isMailerConfigured, sendMail } from "../lib/mailer";
import { type AuthRequest } from "../middleware/auth";

const router = Router();

const FRONTEND_BASE_URL = process.env.APP_FRONTEND_URL ?? "http://localhost:3000";
const CONTENT_MAX = 2000;
/** Chống spam nhẹ: mỗi shop tối đa 5 yêu cầu đang mở (NEW/IN_PROGRESS). */
const OPEN_MAX = 5;

const PUBLIC_SELECT = {
  id: true,
  requesterName: true,
  content: true,
  status: true,
  reply: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function notifyHqSupportRequest(input: {
  requestId: string;
  customerName: string;
  customerEmail: string | null;
  requesterName: string;
  phone: string | null;
  content: string;
}): Promise<void> {
  try {
    if (!isMailerConfigured()) return;
    const admins = await prisma.user.findMany({
      where: { isPlatformAdmin: true, email: { not: null } },
      select: { email: true },
    });
    if (admins.length === 0) return;
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const subject = `[Hubsell] Yêu cầu hỗ trợ mới: ${input.customerName}`;
    const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">Yêu cầu hỗ trợ mới</h2>
      <p style="color:#444;margin:4px 0"><b>Shop:</b> ${escape(input.customerName)} (${escape(input.customerEmail ?? "—")})</p>
      <p style="color:#444;margin:4px 0"><b>Người gửi:</b> ${escape(input.requesterName)}</p>
      <p style="color:#444;margin:4px 0"><b>SĐT:</b> ${escape(input.phone ?? "chưa có — trả lời qua email")}</p>
      <div style="white-space:pre-wrap;border-left:3px solid #ddd;padding:8px 12px;margin:12px 0;color:#222">${escape(input.content)}</div>
      <p style="text-align:center;margin:24px 0">
        <a href="${FRONTEND_BASE_URL}/admin/customers?tab=support"
           style="background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">
          Mở tab Yêu cầu hỗ trợ
        </a>
      </p>
    </div>`;
    await Promise.allSettled(admins.map((a) => sendMail({ to: a.email!, subject, html })));
  } catch (err) {
    console.error("[support] Báo HQ yêu cầu hỗ trợ lỗi:", (err as Error).message);
  }
}

/**
 * Báo KHÁCH (email chủ shop) khi HQ trả lời hoặc đóng yêu cầu — anh Trung
 * 27/09: khách gửi xong mà không ai báo lại là nghĩ bị bỏ rơi, lần sau không
 * gửi nữa. Gọi từ admin.ts sau PATCH; lỗi gửi mail không chạm response.
 */
export async function notifyCustomerSupportUpdate(input: {
  customerEmail: string | null;
  customerName: string;
  content: string;
  reply: string | null;
  done: boolean;
}): Promise<void> {
  try {
    if (!input.customerEmail || !isMailerConfigured()) return;
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const subject = input.done
      ? "[Hubsell] Yêu cầu hỗ trợ của bạn đã được xử lý xong"
      : "[Hubsell] Hubsell đã trả lời yêu cầu hỗ trợ của bạn";
    const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">${input.done ? "Đã xử lý xong" : "Hubsell đã trả lời"}</h2>
      <p style="color:#444;margin:4px 0">Chào ${escape(input.customerName)},</p>
      <p style="color:#666;margin:12px 0 4px;font-size:13px">Yêu cầu của bạn:</p>
      <div style="white-space:pre-wrap;border-left:3px solid #ddd;padding:8px 12px;color:#444">${escape(input.content)}</div>
      ${
        input.reply
          ? `<p style="color:#666;margin:12px 0 4px;font-size:13px">Trả lời từ Hubsell:</p>
      <div style="white-space:pre-wrap;border-left:3px solid #10b981;padding:8px 12px;color:#222">${escape(input.reply)}</div>`
          : ""
      }
      <p style="text-align:center;margin:24px 0">
        <a href="${FRONTEND_BASE_URL}/guide"
           style="background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">
          Mở Hubsell
        </a>
      </p>
      <p style="color:#888;font-size:13px">Vẫn chưa ổn? Bấm avatar góc phải → Gửi yêu cầu hỗ trợ để gửi tiếp.</p>
    </div>`;
    await sendMail({ to: input.customerEmail, subject, html });
  } catch (err) {
    console.error("[support] Báo khách trả lời lỗi:", (err as Error).message);
  }
}

// POST /api/support-requests — khách gửi yêu cầu. Chủ shop lẫn nhân viên đều
// gửi được (nhân viên kho vướng quét mã cũng cần hỏi); gom về shop (ownerId).
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { content, phoneNumber, country } = req.body ?? {};
    const text = typeof content === "string" ? content.trim() : "";
    if (text.length < 5) {
      res.status(400).json({ error: "Vui lòng mô tả ngắn điều bạn cần hỗ trợ" });
      return;
    }
    if (text.length > CONTENT_MAX) {
      res.status(400).json({ error: `Nội dung tối đa ${CONTENT_MAX} ký tự` });
      return;
    }

    const [requester, owner] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId! },
        select: { fullName: true, phone: true, country: true, ownerId: true },
      }),
      prisma.user.findUnique({
        where: { id: req.ownerId! },
        select: { id: true, fullName: true, email: true, phone: true, country: true },
      }),
    ]);
    if (!requester || !owner) {
      res.status(404).json({ error: "Không tìm thấy tài khoản" });
      return;
    }

    // SĐT: ưu tiên số khách vừa gõ (chỉ hỏi khi tài khoản chưa có) → lưu luôn
    // vào tài khoản chủ shop nếu đang trống, để lần sau khỏi hỏi lại.
    let phone: string | null = owner.phone ?? requester.phone ?? null;
    if (typeof phoneNumber === "string" && phoneNumber.trim() !== "") {
      const parsed = formatE164(
        typeof country === "string" && country ? country : owner.country,
        phoneNumber
      );
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      phone = parsed.value!;
      if (!owner.phone && requester.ownerId === null) {
        await prisma.user.update({ where: { id: owner.id }, data: { phone } });
      }
    }

    const openCount = await prisma.supportRequest.count({
      where: { userId: owner.id, status: { in: ["NEW", "IN_PROGRESS"] } },
    });
    if (openCount >= OPEN_MAX) {
      res.status(429).json({
        error: "Bạn đang có nhiều yêu cầu chờ xử lý — Hubsell sẽ liên hệ sớm, vui lòng đợi.",
      });
      return;
    }

    const created = await prisma.supportRequest.create({
      data: {
        userId: owner.id,
        requesterName: requester.fullName,
        content: text,
        phone,
      },
      select: PUBLIC_SELECT,
    });

    void notifyHqSupportRequest({
      requestId: created.id,
      customerName: owner.fullName || "Khách Hubsell",
      customerEmail: owner.email,
      requesterName: requester.fullName,
      phone,
      content: text,
    });

    res.status(201).json({ request: created, phoneSaved: phone });
  } catch (err) {
    next(err);
  }
});

// "Trả lời mới" = đã có reply hoặc DONE, và HQ sửa SAU lần khách xem. So sánh
// hai cột trong JS (danh sách mỗi shop chỉ vài dòng) — khỏi phụ thuộc field
// reference của Prisma.
async function countUnread(ownerId: string): Promise<number> {
  const rows = await prisma.supportRequest.findMany({
    where: { userId: ownerId, OR: [{ reply: { not: null } }, { status: "DONE" }] },
    select: { updatedAt: true, customerSeenAt: true },
  });
  return rows.filter((r) => !r.customerSeenAt || r.updatedAt > r.customerSeenAt).length;
}

// GET /api/support-requests/mine — yêu cầu của SHOP, mới nhất trước, tối đa 20.
// Mở hộp = đã xem → đóng dấu customerSeenAt, chấm đỏ trên avatar tắt.
router.get("/mine", async (req: AuthRequest, res, next) => {
  try {
    const requests = await prisma.supportRequest.findMany({
      where: { userId: req.ownerId! },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: PUBLIC_SELECT,
    });
    await prisma.supportRequest.updateMany({
      where: { userId: req.ownerId! },
      data: { customerSeenAt: new Date() },
    });
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// GET /api/support-requests/mine/unread-count — số yêu cầu có trả lời mới
// (nuôi chấm đỏ trên avatar; shell hỏi 5' một lần, rất nhẹ).
router.get("/mine/unread-count", async (req: AuthRequest, res, next) => {
  try {
    res.json({ count: await countUnread(req.ownerId!) });
  } catch (err) {
    next(err);
  }
});

export default router;
