import { Router } from "express";
import { prisma } from "../lib/prisma";

// ============================================================
// API CÔNG KHAI cho LANDING hubsell.tech (/api/public) — KHÔNG JWT.
// Hiện chỉ có 1 cửa: nhận lead "Đăng ký tư vấn" (Tên + Email + SĐT) từ form
// Enterprise / dock nổi. Landing gọi qua route handler phía Vercel (server →
// server) nên không dính CORS; vẫn phòng thủ như endpoint mở ra internet:
// rate-limit theo IP + honeypot + dedupe 24h theo email/SĐT.
// ============================================================
const router = Router();

// Rate-limit in-memory: tối đa 10 lead/IP/giờ — đủ cho người thật, chặn script
// xối xả. Restart mất bộ đếm là chấp nhận được (chỉ là lớp chống phá rẻ tiền).
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 10;
const hits = new Map<string, { count: number; windowStart: number }>();

function overLimit(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.windowStart > RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  h.count += 1;
  return h.count > RATE_MAX;
  // Map chỉ phình theo số IP gửi form trong 1h — không cần dọn định kỳ.
}

/** SĐT Việt Nam người dùng gõ tay ("0965 863 292") → dạng E.164 khớp cột
 *  User.phone ("+84965863292") để HQ match lead với tài khoản đã đăng ký. */
export function normalizeVnPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+84${digits.slice(1)}`;
  return null;
}

// POST /api/public/consult-lead — { name, email, phone, source?, website? }
// `website` là HONEYPOT (input ẩn trên form): bot điền vào thì giả vờ thành
// công và bỏ qua, người thật không bao giờ thấy ô này.
router.post("/consult-lead", async (req, res, next) => {
  try {
    const ip = String(req.headers["x-forwarded-for"] ?? req.ip ?? "?")
      .split(",")[0]
      .trim();
    if (overLimit(ip)) {
      res.status(429).json({ error: "Bạn gửi quá nhanh, vui lòng thử lại sau ít phút." });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.website === "string" && body.website.trim() !== "") {
      res.json({ ok: true }); // honeypot dính bẫy — nuốt lặng lẽ
      return;
    }

    const name = String(body.name ?? "").trim().slice(0, 120);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 160);
    const phoneRaw = String(body.phone ?? "").trim().slice(0, 30);
    const source =
      body.source === "pricing-enterprise" ? "pricing-enterprise" : "floating-consult";

    if (name.length < 2) {
      res.status(400).json({ error: "Vui lòng nhập tên của bạn." });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      res.status(400).json({ error: "Email chưa đúng định dạng." });
      return;
    }
    const phone = normalizeVnPhone(phoneRaw);
    if (!phone) {
      res.status(400).json({ error: "Số điện thoại chưa đúng (VD: 0965 863 292)." });
      return;
    }

    // Dedupe: cùng email/SĐT gửi lại trong 24h (bấm đúp, F5 gửi lại…) thì cập
    // nhật lead cũ thay vì đẻ dòng mới — sale không phải gọi trùng một người.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await prisma.consultLead.findFirst({
      where: {
        createdAt: { gte: dayAgo },
        OR: [{ email }, { phone }],
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      await prisma.consultLead.update({
        where: { id: existing.id },
        data: { name, email, phone, source },
      });
    } else {
      await prisma.consultLead.create({
        data: { name, email, phone, source },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
