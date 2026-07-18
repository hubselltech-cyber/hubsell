import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/staff — danh sách nhân viên của shop + phạm vi kênh được gán
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const staff = await prisma.user.findMany({
      where: { ownerId: req.ownerId! },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        staffChannels: { select: { channelId: true } },
      },
    });

    res.json(
      staff.map((s) => ({
        id: s.id,
        email: s.email,
        fullName: s.fullName,
        createdAt: s.createdAt,
        // Danh sách kênh được phép. Rỗng = xem tất cả kênh.
        allowedChannelIds: s.staffChannels.map((c) => c.channelId),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/staff — tạo tài khoản nhân viên mới cho shop
router.post("/", async (req: AuthRequest, res, next) => {
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
        ownerId: req.ownerId!,
      },
    });

    res.status(201).json({
      id: staff.id,
      email: staff.email,
      fullName: staff.fullName,
      createdAt: staff.createdAt,
      allowedChannelIds: [],
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/staff/:id/channels — đặt lại danh sách kênh nhân viên được phép xử lý.
// Body: { channelIds: string[] }. Mảng rỗng = cho xem tất cả kênh.
router.put("/:id/channels", async (req: AuthRequest, res, next) => {
  try {
    const { channelIds } = req.body ?? {};
    if (!Array.isArray(channelIds) || channelIds.some((c) => typeof c !== "string")) {
      res.status(400).json({ error: "channelIds phải là mảng chuỗi" });
      return;
    }

    // Nhân viên phải thuộc shop của admin đang đăng nhập
    const staff = await prisma.user.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId!, role: "STAFF" },
    });
    if (!staff) {
      res.status(404).json({ error: "Không tìm thấy nhân viên" });
      return;
    }

    // Các kênh được gán phải là kênh của shop
    const validChannels = await prisma.channel.findMany({
      where: { userId: req.ownerId!, id: { in: channelIds } },
      select: { id: true },
    });
    const validIds = validChannels.map((c) => c.id);

    // Ghi lại toàn bộ phân quyền (xoá cũ, thêm mới) trong transaction
    await prisma.$transaction([
      prisma.staffChannel.deleteMany({ where: { staffId: staff.id } }),
      prisma.staffChannel.createMany({
        data: validIds.map((channelId) => ({ staffId: staff.id, channelId })),
      }),
    ]);

    res.json({ id: staff.id, allowedChannelIds: validIds });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/staff/:id — xoá tài khoản nhân viên
router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    const staff = await prisma.user.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId!, role: "STAFF" },
    });
    if (!staff) {
      res.status(404).json({ error: "Không tìm thấy nhân viên" });
      return;
    }
    await prisma.user.delete({ where: { id: staff.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
