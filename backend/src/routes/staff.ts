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

// ---------- Phân quyền chức năng theo gian hàng ----------

/**
 * Bốn chức năng có thể bật/tắt độc lập cho từng gian hàng của một SALES.
 * Khóa dùng trong JSON (finance/warehouse/ads/orders) ↔ cột DB (canFinance…).
 */
const PERMISSION_KEYS = ["finance", "warehouse", "ads", "orders"] as const;
type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Một dòng trong ma trận phân quyền: gian hàng + trạng thái 4 chức năng. */
interface ChannelPermissionInput {
  channelId: string;
  finance: boolean;
  warehouse: boolean;
  ads: boolean;
  orders: boolean;
}

/** Bản ghi StaffChannel (chọn 4 cột cờ) → object trả cho giao diện. */
type StaffChannelRow = {
  channelId: string;
  canFinance: boolean;
  canWarehouse: boolean;
  canAds: boolean;
  canOrders: boolean;
};

function rowToPermission(row: StaffChannelRow): ChannelPermissionInput {
  return {
    channelId: row.channelId,
    finance: row.canFinance,
    warehouse: row.canWarehouse,
    ads: row.canAds,
    orders: row.canOrders,
  };
}

const STAFF_CHANNEL_SELECT = {
  channelId: true,
  canFinance: true,
  canWarehouse: true,
  canAds: true,
  canOrders: true,
} as const;

const STAFF_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  createdAt: true,
  staffChannels: { select: STAFF_CHANNEL_SELECT },
} as const;

/**
 * Chỉ SALES mới bị giới hạn theo gian hàng. WAREHOUSE thấy đơn của mọi gian nên
 * danh sách phân quyền của họ luôn rỗng — trả về [] để giao diện không hiển thị
 * một ma trận vô nghĩa rồi khiến chủ shop tưởng kho đang bị chặn.
 */
function scopeOf(
  role: Role,
  rows: StaffChannelRow[]
): ChannelPermissionInput[] {
  return role === Role.SALES ? rows.map(rowToPermission) : [];
}

/** Định dạng chung của một nhân viên trả về cho giao diện. */
function serializeStaff(staff: {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: Date;
  staffChannels: StaffChannelRow[];
}) {
  const allowedChannels = scopeOf(staff.role, staff.staffChannels);
  return {
    id: staff.id,
    email: staff.email,
    fullName: staff.fullName,
    role: staff.role,
    createdAt: staff.createdAt,
    /** Mảng Object chi tiết: mỗi gian kèm 4 cờ chức năng bật/tắt độc lập. */
    allowedChannels,
    /** Danh sách id gian được phân công — tiện cho các chỗ chỉ cần biết phạm vi. */
    allowedChannelIds: allowedChannels.map((c) => c.channelId),
  };
}

/**
 * Chuẩn hóa & lọc danh sách phân quyền gửi lên: chỉ giữ những gian THẬT SỰ thuộc
 * shop này (chặn gán bừa id lạ) và ép các cờ về boolean.
 */
async function validChannelPermissions(
  ownerId: string,
  raw: unknown
): Promise<ChannelPermissionInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const byId = new Map<string, ChannelPermissionInput>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const channelId = (item as Record<string, unknown>).channelId;
    if (typeof channelId !== "string" || channelId === "") continue;
    const perm: ChannelPermissionInput = {
      channelId,
      finance: false,
      warehouse: false,
      ads: false,
      orders: false,
    };
    for (const key of PERMISSION_KEYS) {
      perm[key] = (item as Record<string, unknown>)[key] === true;
    }
    // Trùng channelId thì giữ bản sau — tránh nhân đôi khi giao diện lỡ gửi lặp.
    byId.set(channelId, perm);
  }
  if (byId.size === 0) return [];

  const rows = await prisma.channel.findMany({
    where: { userId: ownerId, id: { in: [...byId.keys()] } },
    select: { id: true },
  });
  return rows
    .map((c) => byId.get(c.id))
    .filter((p): p is ChannelPermissionInput => p !== undefined);
}

/** Dữ liệu tạo bản ghi StaffChannel từ một dòng phân quyền. */
function toStaffChannelCreate(perm: ChannelPermissionInput) {
  return {
    channelId: perm.channelId,
    canFinance: perm.finance,
    canWarehouse: perm.warehouse,
    canAds: perm.ads,
    canOrders: perm.orders,
  };
}

// GET /api/staff — danh sách nhân viên của shop + vai trò + phân quyền gian hàng
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const staff = await prisma.user.findMany({
      where: { ownerId: req.ownerId! },
      orderBy: { createdAt: "desc" },
      select: STAFF_SELECT,
    });

    res.json(staff.map(serializeStaff));
  } catch (err) {
    next(err);
  }
});

// POST /api/staff — tạo tài khoản nhân viên mới cho shop.
// Body: { email, password, fullName, role: SALES|WAREHOUSE, channels?: ChannelPermission[] }
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { email, password, fullName, role, channels } = req.body ?? {};

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
    const perms =
      role === Role.SALES
        ? await validChannelPermissions(req.ownerId!, channels)
        : [];

    const staff = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(password, 10),
        fullName: fullName.trim(),
        role,
        ownerId: req.ownerId!,
        staffChannels: { create: perms.map(toStaffChannelCreate) },
      },
      select: STAFF_SELECT,
    });

    res.status(201).json(serializeStaff(staff));
  } catch (err) {
    next(err);
  }
});

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
        select: STAFF_SELECT,
      });
    });

    res.json(serializeStaff(updated));
  } catch (err) {
    next(err);
  }
});

// PUT /api/staff/:id/channels — đặt lại phân quyền gian hàng của một SALES.
// Body: { channels: ChannelPermission[] } — mỗi gian kèm 4 cờ chức năng.
// Mảng rỗng = nhân viên đó chưa được gán gian nào (chưa thấy đơn nào).
router.put("/:id/channels", async (req: AuthRequest, res, next) => {
  try {
    const { channels } = req.body ?? {};
    if (channels !== undefined && !Array.isArray(channels)) {
      res.status(400).json({ error: "channels phải là mảng" });
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

    const perms = await validChannelPermissions(req.ownerId!, channels);

    // Xoá sạch rồi tạo lại: gọn hơn dò từng dòng để cập nhật/thêm/xoá, và số
    // gian của một shop luôn nhỏ nên không đáng lo về hiệu năng.
    const updated = await prisma.$transaction(async (tx) => {
      await tx.staffChannel.deleteMany({ where: { staffId: staff.id } });
      if (perms.length > 0) {
        await tx.staffChannel.createMany({
          data: perms.map((p) => ({ staffId: staff.id, ...toStaffChannelCreate(p) })),
        });
      }
      return tx.user.findUniqueOrThrow({
        where: { id: staff.id },
        select: STAFF_SELECT,
      });
    });

    res.json(serializeStaff(updated));
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
