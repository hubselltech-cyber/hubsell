import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { requireAdmin, requireAuth, signToken, type AuthRequest } from "../auth";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// POST /api/auth/staff — CHỦ SHOP tạo tài khoản NHÂN VIÊN (role STAFF).
// Nhân viên dùng chung dữ liệu (kho, đơn hàng) của shop.
router.post(
  "/staff",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { email, password, fullName } = req.body ?? {};

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

      const staff = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: await bcrypt.hash(password, 10),
          fullName: fullName.trim(),
          role: "STAFF",
          ownerId: req.ownerId!, // thuộc về shop của admin đang đăng nhập
        },
      });

      res.status(201).json({
        user: {
          id: staff.id,
          email: staff.email,
          fullName: staff.fullName,
          role: staff.role,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

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

export default router;
