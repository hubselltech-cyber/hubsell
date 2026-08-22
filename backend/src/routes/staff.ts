import { Router } from "express";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { sanitizePermissions } from "../permission-registry";
import { sanitizeHqPermissions } from "../platform-permission-registry";
import { writeAuditLog } from "../platform-audit";
import {
  assertStaffSlot,
  invalidatePlanState,
  respondPlanLimit,
} from "../plan-enforcement";
import { ensureOwnerUsername, USERNAME_REGEX } from "../username";

/**
 * QUẢN LÝ NHÂN VIÊN (chỉ chủ shop — mount gác adminOnly ở app.ts).
 *
 * Mô hình 10/08 (thay hệ SALES/WAREHOUSE + 4 cờ StaffChannel cũ):
 *  - Tài khoản nhân viên KHÔNG cần email: đăng nhập "<username chủ>/<staffUsername>"
 *    (vd "darkman/kho01"), mật khẩu do chủ shop cấp/reset.
 *  - Quyền TÍNH NĂNG = User.permissions (mảng khóa lá của permission-registry).
 *  - Phạm vi GIAN HÀNG = StaffChannel (gian nào được thấy dữ liệu).
 *  - Mọi nhân viên mang role SALES ("nhân viên" — requireAuth bó phạm vi gian
 *    theo StaffChannel); enum WAREHOUSE giữ lại nhưng không cấp mới.
 * Nhân viên kiểu CŨ (tạo bằng email) đã XÓA HẲN trong migration 10/08 theo chốt
 * của chủ shop — đó chỉ là tài khoản test; email của nhân viên từ nay luôn null.
 */

const router = Router();

/**
 * Chọn bộ lọc quyền theo LOẠI CHỦ TÀI KHOẢN: chủ nền tảng (isPlatformAdmin —
 * tài khoản điều hành Hubsell) cấp lá hq.* của cây HQ; chủ shop thường cấp lá
 * cây shop. req.isPlatformAdmin luôn là cờ của CHÍNH người gọi — /api/staff
 * gác adminOnly nên người gọi chắc chắn là chủ, không phải nhân viên.
 */
function permissionSanitizer(req: AuthRequest) {
  return req.isPlatformAdmin ? sanitizeHqPermissions : sanitizePermissions;
}

const STAFF_SELECT = {
  id: true,
  email: true,
  staffUsername: true,
  fullName: true,
  role: true,
  createdAt: true,
  permissions: true,
  staffChannels: { select: { channelId: true } },
} as const;

type StaffRow = {
  id: string;
  email: string | null;
  staffUsername: string | null;
  fullName: string;
  role: Role;
  createdAt: Date;
  permissions: string[];
  staffChannels: { channelId: string }[];
};

/** Định dạng chung của một nhân viên trả về cho giao diện. */
function serializeStaff(staff: StaffRow, ownerUsername: string | null) {
  return {
    id: staff.id,
    fullName: staff.fullName,
    /** Email chỉ còn ở nhân viên CŨ (tạo trước 10/08) — null với tài khoản mới. */
    email: staff.email,
    staffUsername: staff.staffUsername,
    /** Chuỗi gõ vào ô đăng nhập: "chủ/nhânviên"; null = nhân viên cũ dùng email. */
    loginName:
      staff.staffUsername && ownerUsername
        ? `${ownerUsername}/${staff.staffUsername}`
        : null,
    role: staff.role,
    createdAt: staff.createdAt,
    permissions: staff.permissions,
    allowedChannelIds: staff.staffChannels.map((c) => c.channelId),
  };
}

/** Lọc danh sách gian gửi lên: chỉ giữ gian THẬT SỰ thuộc shop này. */
async function validChannelIds(ownerId: string, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const wanted = new Set(raw.filter((v): v is string => typeof v === "string" && v !== ""));
  if (wanted.size === 0) return [];
  const rows = await prisma.channel.findMany({
    where: { userId: ownerId, id: { in: [...wanted] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function ownerUsernameOf(req: AuthRequest): Promise<string | null> {
  const owner = await prisma.user.findUnique({
    where: { id: req.ownerId! },
    select: { username: true },
  });
  return owner?.username ?? null;
}

// GET /api/staff — danh sách nhân viên + quyền + phạm vi gian hàng.
// Kèm ownerUsername để giao diện dựng tiền tố "chủ/" trong modal tạo tài khoản.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const [staff, ownerUsername] = await Promise.all([
      prisma.user.findMany({
        where: { ownerId: req.ownerId! },
        orderBy: { createdAt: "desc" },
        select: STAFF_SELECT,
      }),
      ownerUsernameOf(req),
    ]);
    res.json({
      ownerUsername,
      staff: staff.map((s) => serializeStaff(s, ownerUsername)),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/staff — tạo tài khoản nhân viên "chủ/nhânviên" (KHÔNG cần email).
// Body: { staffUsername, password, fullName, permissions?: string[], channelIds?: string[] }
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { staffUsername, password, fullName, permissions, channelIds } =
      req.body ?? {};

    const uname =
      typeof staffUsername === "string" ? staffUsername.trim().toLowerCase() : "";
    if (!USERNAME_REGEX.test(uname)) {
      res.status(400).json({
        error:
          "Tên đăng nhập nhân viên: 3-30 ký tự, chỉ gồm chữ thường/số/dấu chấm/gạch dưới",
      });
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

    const clash = await prisma.user.findUnique({
      where: {
        ownerId_staffUsername: { ownerId: req.ownerId!, staffUsername: uname },
      },
      select: { id: true },
    });
    if (clash) {
      res
        .status(409)
        .json({ error: `Shop đã có nhân viên tên đăng nhập "${uname}"` });
      return;
    }

    // Trần nhân viên của gói: chỉ chặn TẠO MỚI — nhân viên đang có không bị
    // đụng khi hạ gói (grandfather), sửa/xóa vẫn tự do.
    await assertStaffSlot(req.ownerId!);

    // Chủ shop cũ chưa đặt username (đăng nhập email thuần) → tự sinh và lưu
    // luôn, vì username chủ là NỬA TRÁI của định dạng đăng nhập nhân viên.
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: req.ownerId! },
      select: { id: true, email: true, username: true },
    });
    const ownerUsername = await ensureOwnerUsername(owner);

    const perms = permissionSanitizer(req)(permissions);
    const channels = await validChannelIds(req.ownerId!, channelIds);

    const staff = await prisma.user.create({
      data: {
        email: null,
        staffUsername: uname,
        passwordHash: await bcrypt.hash(password, 10),
        fullName: fullName.trim(),
        role: Role.SALES, // "nhân viên" — phạm vi gian bó theo StaffChannel
        ownerId: req.ownerId!,
        permissions: perms,
        staffChannels: { create: channels.map((channelId) => ({ channelId })) },
      },
      select: STAFF_SELECT,
    });

    // Nhật ký thao tác — CHỈ khu điều hành Hubsell (thao tác nhân sự của chủ
    // shop thường không thuộc phạm vi giám sát nền tảng).
    if (req.isPlatformAdmin) {
      await writeAuditLog(req, {
        action: "staff.create",
        targetUserId: staff.id,
        targetLabel: `${staff.fullName} (${ownerUsername}/${uname})`,
        detail: { permissions: perms },
      });
    }

    invalidatePlanState(req.ownerId!);
    res.status(201).json(serializeStaff(staff, ownerUsername));
  } catch (err) {
    if (respondPlanLimit(res, err)) return;
    next(err);
  }
});

// PATCH /api/staff/:id — cập nhật nhân viên: họ tên / cây quyền / phạm vi gian.
// Body: { fullName?, permissions?: string[], channelIds?: string[] } — trường
// nào vắng mặt thì giữ nguyên (permissions/channelIds gửi mảng RỖNG = thu hồi hết).
router.patch("/:id", async (req: AuthRequest, res, next) => {
  try {
    const { fullName, permissions, channelIds } = req.body ?? {};

    const staff = await prisma.user.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
      select: { id: true },
    });
    if (!staff) {
      res.status(404).json({ error: "Không tìm thấy nhân viên" });
      return;
    }

    if (fullName !== undefined && (typeof fullName !== "string" || fullName.trim().length < 2)) {
      res.status(400).json({ error: "Họ tên không hợp lệ" });
      return;
    }
    if (permissions !== undefined && !Array.isArray(permissions)) {
      res.status(400).json({ error: "permissions phải là mảng khóa quyền" });
      return;
    }
    if (channelIds !== undefined && !Array.isArray(channelIds)) {
      res.status(400).json({ error: "channelIds phải là mảng id gian hàng" });
      return;
    }

    const channels =
      channelIds !== undefined
        ? await validChannelIds(req.ownerId!, channelIds)
        : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      if (channels !== undefined) {
        // Xoá sạch rồi tạo lại: gọn hơn dò từng dòng, số gian một shop luôn nhỏ.
        await tx.staffChannel.deleteMany({ where: { staffId: staff.id } });
        if (channels.length > 0) {
          await tx.staffChannel.createMany({
            data: channels.map((channelId) => ({ staffId: staff.id, channelId })),
          });
        }
      }
      return tx.user.update({
        where: { id: staff.id },
        data: {
          ...(fullName !== undefined ? { fullName: fullName.trim() } : {}),
          ...(permissions !== undefined
            ? { permissions: permissionSanitizer(req)(permissions) }
            : {}),
        },
        select: STAFF_SELECT,
      });
    });

    if (req.isPlatformAdmin) {
      await writeAuditLog(req, {
        action: "staff.update",
        targetUserId: updated.id,
        targetLabel: `${updated.fullName}${updated.staffUsername ? ` (${updated.staffUsername})` : ""}`,
        detail: {
          ...(fullName !== undefined ? { fullName: fullName.trim() } : {}),
          ...(permissions !== undefined ? { permissions: updated.permissions } : {}),
        },
      });
    }

    res.json(serializeStaff(updated, await ownerUsernameOf(req)));
  } catch (err) {
    next(err);
  }
});

// POST /api/staff/:id/reset-password — chủ shop cấp lại mật khẩu cho nhân viên
// (nhân viên "chủ/nhânviên" không có email nên không đi được luồng quên mật khẩu).
router.post("/:id/reset-password", async (req: AuthRequest, res, next) => {
  try {
    const { password } = req.body ?? {};
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" });
      return;
    }
    const staff = await prisma.user.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
      select: { id: true, fullName: true, staffUsername: true },
    });
    if (!staff) {
      res.status(404).json({ error: "Không tìm thấy nhân viên" });
      return;
    }
    await prisma.user.update({
      where: { id: staff.id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });

    if (req.isPlatformAdmin) {
      await writeAuditLog(req, {
        action: "staff.reset-password",
        targetUserId: staff.id,
        targetLabel: `${staff.fullName}${staff.staffUsername ? ` (${staff.staffUsername})` : ""}`,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/staff/:id — xoá tài khoản nhân viên
router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    const staff = await prisma.user.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId! },
      select: { id: true, fullName: true, staffUsername: true },
    });
    if (!staff) {
      res.status(404).json({ error: "Không tìm thấy nhân viên" });
      return;
    }
    await prisma.user.delete({ where: { id: staff.id } });
    invalidatePlanState(req.ownerId!); // trống một slot nhân viên ngay lập tức

    // Ghi log SAU khi xoá, actorId là người xoá (target đã mất — chỉ còn nhãn).
    if (req.isPlatformAdmin) {
      await writeAuditLog(req, {
        action: "staff.delete",
        targetLabel: `${staff.fullName}${staff.staffUsername ? ` (${staff.staffUsername})` : ""}`,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
