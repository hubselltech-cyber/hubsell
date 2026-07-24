import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { requireAuth, signToken, type AuthRequest } from "../auth";
import {
  handleShopeeCallback,
  verifyOauthState,
} from "../integrations/shopee/service";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Nơi FE hiển thị kết quả sau khi Shopee redirect về (callback là route BE).
const FRONTEND_BASE_URL = process.env.APP_FRONTEND_URL ?? "https://localhost:3000";

// POST /api/auth/register — Đăng ký tài khoản mới
router.post("/register", async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body ?? {};

    // Kiểm tra dữ liệu đầu vào
    if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: "Email không hợp lệ" });
      return;
    }
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Mật khẩu phải có ít nhất 6 ký tự" });
      return;
    }
    if (typeof fullName !== "string" || fullName.trim().length < 2) {
      res.status(400).json({ error: "Vui lòng nhập họ tên" });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      res.status(409).json({ error: "Email này đã được đăng ký" });
      return;
    }

    // Mã hoá mật khẩu bằng bcrypt (10 vòng salt)
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        fullName: fullName.trim(),
        role: "ADMIN",
      },
    });

    res.status(201).json({
      token: signToken(user.id),
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login — Đăng nhập
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Thiếu email hoặc mật khẩu" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    // So sánh mật khẩu với hash đã lưu.
    // Dùng cùng một thông báo lỗi để không lộ email nào tồn tại.
    const valid = user && (await bcrypt.compare(password, user.passwordHash));
    if (!valid) {
      res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
      return;
    }

    res.json({
      token: signToken(user.id),
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — Lấy thông tin người đang đăng nhập.
// Kèm hasChannels: shop đã kết nối gian hàng nào chưa (cho Onboarding overlay).
router.get("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [user, channelCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.userId! },
        select: { id: true, email: true, fullName: true, role: true, createdAt: true },
      }),
      prisma.channel.count({ where: { userId: req.ownerId! } }),
    ]);
    if (!user) {
      res.status(401).json({ error: "Tài khoản không tồn tại" });
      return;
    }
    res.json({ user, hasChannels: channelCount > 0 });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/auth/shopee/callback — SHOPEE REDIRECT VỀ ĐÂY SAU KHI UỶ QUYỀN
//
// Endpoint CÔNG KHAI: Shopee mở bằng trình duyệt kèm ?code=&shop_id=&state=.
// Danh tính chủ shop nằm trong `state` (JWT đã ký lúc sinh URL), không dùng JWT
// đăng nhập. Xử lý xong thì redirect trình duyệt về trang Kênh bán của FE.
// ============================================================
router.get("/shopee/callback", async (req, res) => {
  const done = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    res.redirect(`${FRONTEND_BASE_URL}/channels?${qs}`);
  };

  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const shopId = typeof req.query.shop_id === "string" ? req.query.shop_id : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code || !shopId) {
      done({ shopee: "error", msg: "Thiếu code hoặc shop_id từ Shopee" });
      return;
    }
    const ownerId = state ? verifyOauthState(state) : null;
    if (!ownerId) {
      done({ shopee: "error", msg: "Phiên uỷ quyền hết hạn hoặc không hợp lệ" });
      return;
    }

    const saved = await handleShopeeCallback(ownerId, code, shopId);
    done({ shopee: "connected", shop: saved.shopName });
  } catch (err) {
    done({ shopee: "error", msg: (err as Error).message });
  }
});

export default router;
