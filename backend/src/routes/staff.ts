import { Router } from "express";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Chủ shop không thể tự tạo thêm chủ shop từ trang Nhân viên
const ASSIGNABLE_ROLES: Role[] = [Role.SALES, Role.WAREHOUSE];

function isAssignableRole(value: unknown): value is Role {
  return ASSIGNABLE_ROLES.includes(value as Role);
}

/**
 * Chỉ SALES mới bị giới hạn theo gian hàng. WAREHOUSE thấy đơn của mọi gian nên
 * danh sách gán kênh của họ luôn rỗng — trả về [] để giao diện không hiển thị
 * một danh sách vô nghĩa rồi khiến chủ shop tưởng kho đang bị chặn.
 */
function scopeOf(role: Role, channelIds: string[]): string[] {
  return role === Role.SALES ? channelIds : [];
}

// GET /api/staff — danh sách nhân viên của shop + vai trò + phạm vi gian hàng
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const staff = await prisma.user.findMany({
      where: { ownerId: req.ownerId! },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        staffChannels: { select: { channelId: true } },
      },
    });

    res.json(
      staff.map((s) => ({
        id: s.id,
        email: s.email,
        fullName: s.fullName,
        role: s.role,
        createdAt: s.createdAt,
        allowedChannelIds: scopeOf(
          s.role,
          s.staffChannels.map((c) => c.channelId)
        ),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/staff — tạo tài khoản nhân viên mới cho shop.
// Body: { email, password, fullName, role: SALES|WAREHOUSE, channelIds?: string[] }
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { email, password, fullName, role, channelIds } = req.body ?? {};

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
    if (!isAssignableRole(role)) {
      res.status(400).json({
        error: "Vai trò phải là SALES (nhân viên vận hành) hoặc WAREHOUSE (nhân viên kho)",
      });
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

    // Gán gian hàng ngay lúc tạo để tài khoản SALES không có khoảng thời gian
    // "đã tạo nhưng chưa thấy gì" khiến chủ shop tưởng hệ thống hỏng.
    const validIds =
      role === Role.SALES ? await validChannelIds(req.ownerId!, channelIds) : [];

    const staff = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(password, 10),
        fullName: fullName.trim(),
        role,
        ownerId: req.ownerId!,
        staffChannels: { create: validIds.map((channelId) => ({ channelId })) },
      },
    });

    res.status(201).json({
      id: staff.id,
      email: staff.email,
      fullName: staff.fullName,
      role: staff.role,
      createdAt: staff.createdAt,
      allowedChannelIds: validIds,
    });
  } catch (err) {
    next(err);
  }
});

/** Lọc lấy những gian hàng thật sự thuộc shop này — chặn gán bừa id lạ. */
async function validChannelIds(
  ownerId: string,
  channelIds: unknown
): Promise<string[]> {
  if (!Array.isArray(channelIds) || channelIds.length === 0) return [];
  const ids = channelIds.filter((c): c is string => typeof c === "string");
  if (ids.length === 0) return [];
  const rows = await prisma.channel.findMany({
    where: { userId: ownerId, id: { in: ids } },
    select: { id: true },
  });
  return rows.map((c) => c.id);
}

// PATCH /api/staff/:id — đổi vai trò của nhân viên.
// Body: { role: SALES|WAREHOUSE }
router.patch("/:id", async (req: AuthRequest, res, next) => {
  try {
    const { role } = req.body ?? {};
    if (!isAssignableRole(role)) {
      res.status(400).json({
        error: "Vai trò phải là SALES (nhân viên vận hành) hoặc WAREHOUSE (nhân viên kho)",
      });
      return;
    }

    const staff = await prisma.user.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
    });
    if (!staff) {
      res.status(404).json({ error: "Không tìm thấy nhân viên" });
      return;
    }

    // Chuyển sang WAREHOUSE thì xoá luôn phân công gian hàng: kho vốn thấy mọi
    // gian, để lại bản ghi cũ sẽ hồi sinh sai phạm vi nếu sau này đổi về SALES.
    const updated = await prisma.$transaction(async (tx) => {
      if (role === Role.WAREHOUSE) {
        await tx.staffChannel.deleteMany({ where: { staffId: staff.id } });
      }
      return tx.user.update({
        where: { id: staff.id },
        data: { role },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          createdAt: true,
          staffChannels: { select: { channelId: true } },
        },
      });
    });

    res.json({
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      role: updated.role,
      createdAt: updated.createdAt,
      allowedChannelIds: scopeOf(
        updated.role,
        updated.staffChannels.map((c) => c.channelId)
      ),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/staff/:id/channels — đặt lại danh sách gian hàng một SALES phụ trách.
// Body: { channelIds: string[] }. Mảng rỗng = nhân viên đó chưa thấy đơn nào.
router.put("/:id/channels", async (req: AuthRequest, res, next) => {
  try {
    const { channelIds } = req.body ?? {};
    if (!Array.isArray(channelIds) || channelIds.some((c) => typeof c !== "string")) {
      res.status(400).json({ error: "channelIds phải là mảng chuỗi" });
      return;
    }

    const staff = await prisma.user.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
    });
    if (!staff) {
      res.status(404).json({ error: "Không tìm thấy nhân viên" });
      return;
    }
    if (staff.role !== Role.SALES) {
      res.status(400).json({
        error:
          "Chỉ nhân viên vận hành (SALES) mới phân công theo gian hàng. Nhân viên kho vốn xử lý đơn của mọi gian.",
      });
      return;
    }

    const validIds = await validChannelIds(req.ownerId!, channelIds);

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

// PUT /api/staff/by-channel/:channelId — phân quyền NGƯỢC từ phía gian hàng:
// chọn những SALES nào được phụ trách gian này. Body: { staffIds: string[] }
router.put("/by-channel/:channelId", async (req: AuthRequest, res, next) => {
  try {
    const { staffIds } = req.body ?? {};
    if (!Array.isArray(staffIds) || staffIds.some((s) => typeof s !== "string")) {
      res.status(400).json({ error: "staffIds phải là mảng chuỗi" });
      return;
    }

    const channel = await prisma.channel.findFirst({
      where: { id: req.params.channelId, userId: req.ownerId! },
      select: { id: true },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng" });
      return;
    }

    // Chỉ nhận SALES thuộc chính shop này
    const validStaff = await prisma.user.findMany({
      where: { ownerId: req.ownerId!, role: Role.SALES, id: { in: staffIds } },
      select: { id: true },
    });
    const validIds = validStaff.map((s) => s.id);

    // Ghi đè quyền của gian này, KHÔNG đụng tới các gian khác của cùng nhân viên
    await prisma.$transaction([
      prisma.staffChannel.deleteMany({ where: { channelId: channel.id } }),
      prisma.staffChannel.createMany({
        data: validIds.map((staffId) => ({ staffId, channelId: channel.id })),
      }),
    ]);

    res.json({ channelId: channel.id, staffIds: validIds });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/staff/:id — xoá tài khoản nhân viên
router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    const staff = await prisma.user.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
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
