import { Router } from "express";
import { PlatformCareStatus, Prisma, WebhookJobStatus } from "@prisma/client";
import { prisma } from "../prisma";
import {
  requirePlatformAdmin,
  requirePlatformPermission,
  type AuthRequest,
} from "../auth";
import { writeAuditLog } from "../platform-audit";

// ============================================================
// QUẢN TRỊ NỀN TẢNG (/api/admin) — chủ nền tảng (cờ isPlatformAdmin) và nhân
// viên ĐIỀU HÀNH HUBSELL (cây quyền hq.* — platform-permission-registry.ts).
// Cửa mount ở app.ts đã chặn "có lá hq.* bất kỳ"; từng route dưới đây siết
// đúng lá của mình (Sale thấy khách hàng nhưng không thấy nhật ký webhook).
//
// Khác mọi router còn lại: dữ liệu ở đây KHÔNG bó theo ownerId — đây là góc
// nhìn của chủ nền tảng Hubsell trên TOÀN BỘ hệ thống (mọi shop đăng ký).
// Vì vậy tuyệt đối không thêm endpoint ghi/sửa dữ liệu shop ở đây; chỉ đọc
// số liệu vận hành: người dùng đăng ký, gian hàng đã nối, nhật ký webhook.
// (Endpoint GHI tương lai phải gác requirePlatformAdmin — chỉ chủ nền tảng.)
// ============================================================
const router = Router();

// GET /api/admin/stats — số liệu tổng quan toàn nền tảng.
router.get("/stats", requirePlatformPermission("hq.overview"), async (_req, res, next) => {
  try {
    const now = Date.now();
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [
      totalOwners,
      totalStaff,
      newOwners7d,
      newOwners30d,
      channelsByPlatform,
      totalOrders,
      orders24h,
      shopeeWebhookByStatus,
      misaWebhookByStatus,
    ] = await Promise.all([
      // Chủ shop = tài khoản gốc (ownerId null); nhân viên tính riêng.
      prisma.user.count({ where: { ownerId: null } }),
      prisma.user.count({ where: { ownerId: { not: null } } }),
      prisma.user.count({ where: { ownerId: null, createdAt: { gte: d7 } } }),
      prisma.user.count({ where: { ownerId: null, createdAt: { gte: d30 } } }),
      prisma.channel.groupBy({
        by: ["channelName"],
        _count: { _all: true },
      }),
      prisma.order.count(),
      prisma.order.count({
        where: { createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
      }),
      prisma.shopeeWebhookLog.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.misaWebhookLog.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    res.json({
      users: {
        totalOwners,
        totalStaff,
        newOwners7d,
        newOwners30d,
      },
      channelsByPlatform: channelsByPlatform.map((c) => ({
        platform: c.channelName,
        count: c._count._all,
      })),
      orders: { total: totalOrders, last24h: orders24h },
      webhooks: {
        shopee: shopeeWebhookByStatus.map((s) => ({
          status: s.status,
          count: s._count._all,
        })),
        misa: misaWebhookByStatus.map((s) => ({
          status: s.status,
          count: s._count._all,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users?page=1&pageSize=20&careStatus=NEW — danh sách CHỦ SHOP
// đã đăng ký (mới nhất trước), kèm số nhân viên / gian hàng / đơn của từng shop
// + hồ sơ CHĂM SÓC (CRM nội bộ GĐ2) + đơn gần nhất (tín hiệu còn hoạt động).
// KHÔNG trả passwordHash hay bất kỳ trường bí mật nào.
router.get("/users", requirePlatformPermission("hq.customers"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    // Lọc theo trạng thái chăm sóc. Khách CHƯA có hồ sơ care = NEW ngầm định
    // (hồ sơ tạo lười) — lọc NEW phải gom cả nhóm chưa có hồ sơ.
    const careRaw = String(req.query.careStatus ?? "");
    const careStatus = (Object.values(PlatformCareStatus) as string[]).includes(careRaw)
      ? (careRaw as PlatformCareStatus)
      : undefined;
    const where: Prisma.UserWhereInput = {
      ownerId: null,
      ...(careStatus
        ? careStatus === PlatformCareStatus.NEW
          ? { OR: [{ careProfile: null }, { careProfile: { status: careStatus } }] }
          : { careProfile: { status: careStatus } }
        : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          username: true,
          fullName: true,
          country: true,
          phone: true,
          createdAt: true,
          // googleId là dữ liệu liên kết OAuth — chỉ trả CÓ/KHÔNG, không trả giá trị.
          googleId: true,
          _count: {
            select: { staff: true, channels: true, products: true },
          },
          careProfile: {
            select: {
              status: true,
              note: true,
              updatedAt: true,
              assignee: { select: { id: true, fullName: true } },
            },
          },
        },
      }),
    ]);

    // Đơn không gắn thẳng user mà qua Channel → đếm bằng MỘT groupBy theo
    // channelId rồi cộng dồn về từng shop, thay vì N+1 truy vấn con.
    const channels = await prisma.channel.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      select: { id: true, userId: true },
    });
    const channelOwner = new Map(channels.map((c) => [c.id, c.userId]));
    const orderCounts = await prisma.order.groupBy({
      by: ["channelId"],
      where: { channelId: { in: channels.map((c) => c.id) } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const ordersByUser = new Map<string, number>();
    const lastOrderByUser = new Map<string, Date>();
    for (const o of orderCounts) {
      const ownerId = channelOwner.get(o.channelId);
      if (!ownerId) continue;
      ordersByUser.set(
        ownerId,
        (ordersByUser.get(ownerId) ?? 0) + o._count._all
      );
      const last = o._max.createdAt;
      if (last && (lastOrderByUser.get(ownerId) ?? new Date(0)) < last) {
        lastOrderByUser.set(ownerId, last);
      }
    }

    res.json({
      total,
      page,
      pageSize,
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        fullName: u.fullName,
        country: u.country,
        phone: u.phone,
        createdAt: u.createdAt,
        hasGoogle: u.googleId !== null,
        staffCount: u._count.staff,
        channelCount: u._count.channels,
        productCount: u._count.products,
        orderCount: ordersByUser.get(u.id) ?? 0,
        lastOrderAt: lastOrderByUser.get(u.id) ?? null,
        care: u.careProfile,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/hq-staff — danh sách nhân viên điều hành (để chọn "người phụ
// trách" trong hộp thoại chăm sóc). Trả cả CHỦ nền tảng để tự nhận việc được.
router.get("/hq-staff", requirePlatformPermission("hq.customers"), async (req: AuthRequest, res, next) => {
  try {
    const members = await prisma.user.findMany({
      where: { OR: [{ id: req.ownerId! }, { ownerId: req.ownerId! }] },
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true, staffUsername: true },
    });
    res.json({
      members: members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        staffUsername: m.staffUsername,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/customers/:userId/care — cập nhật hồ sơ chăm sóc một chủ
// shop: { status?, assigneeId?, note? } (trường vắng mặt giữ nguyên; assigneeId
// null = bỏ phân công; note chuỗi rỗng = xoá ghi chú). Ghi PlatformAuditLog.
router.patch(
  "/customers/:userId/care",
  requirePlatformPermission("hq.customers"),
  async (req: AuthRequest, res, next) => {
    try {
      const { status, assigneeId, note } = req.body ?? {};

      const customer = await prisma.user.findFirst({
        where: { id: req.params.userId, ownerId: null },
        select: { id: true, email: true, fullName: true },
      });
      if (!customer) {
        res.status(404).json({ error: "Không tìm thấy chủ shop này" });
        return;
      }

      if (
        status !== undefined &&
        !(Object.values(PlatformCareStatus) as string[]).includes(status)
      ) {
        res.status(400).json({ error: "Trạng thái chăm sóc không hợp lệ" });
        return;
      }
      if (note !== undefined && note !== null && typeof note !== "string") {
        res.status(400).json({ error: "Ghi chú không hợp lệ" });
        return;
      }
      // Người phụ trách phải là thành viên khu điều hành (chủ nền tảng hoặc
      // nhân viên của chủ nền tảng) — không cho gán bừa id ngoài hệ.
      if (assigneeId !== undefined && assigneeId !== null) {
        const assignee = await prisma.user.findFirst({
          where: {
            id: String(assigneeId),
            OR: [{ id: req.ownerId! }, { ownerId: req.ownerId! }],
          },
          select: { id: true },
        });
        if (!assignee) {
          res.status(400).json({ error: "Người phụ trách không thuộc đội điều hành" });
          return;
        }
      }

      const noteValue =
        note === undefined ? undefined : note === null || note.trim() === "" ? null : note.trim();
      const patch = {
        ...(status !== undefined ? { status: status as PlatformCareStatus } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId as string | null } : {}),
        ...(noteValue !== undefined ? { note: noteValue } : {}),
        updatedById: req.userId!,
      };

      const care = await prisma.platformCustomerCare.upsert({
        where: { userId: customer.id },
        create: { userId: customer.id, ...patch },
        update: patch,
        select: {
          status: true,
          note: true,
          updatedAt: true,
          assignee: { select: { id: true, fullName: true } },
        },
      });

      await writeAuditLog(req, {
        action: "care.update",
        targetUserId: customer.id,
        targetLabel: `${customer.fullName} (${customer.email ?? customer.id})`,
        detail: {
          ...(status !== undefined ? { status } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          ...(noteValue !== undefined ? { note: noteValue } : {}),
        },
      });

      res.json({ care });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/admin/webhook-logs?source=shopee|misa&status=&page=&pageSize=
// Nhật ký webhook toàn hệ thống (mới nhất trước). Lazada xử lý trực tiếp
// không ghi bảng log nên chưa có ở đây. Không trả payload (nặng) — chỉ metadata
// đủ để tra soát; cần soi payload thì tra DB theo id.
router.get("/webhook-logs", requirePlatformPermission("hq.webhooks"), async (req, res, next) => {
  try {
    const source = req.query.source === "misa" ? "misa" : "shopee";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const statusRaw = String(req.query.status ?? "");
    const status = (Object.values(WebhookJobStatus) as string[]).includes(
      statusRaw
    )
      ? (statusRaw as WebhookJobStatus)
      : undefined;

    if (source === "misa") {
      const where = status ? { status } : {};
      const [total, logs] = await Promise.all([
        prisma.misaWebhookLog.count({ where }),
        prisma.misaWebhookLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            eventType: true,
            invoiceNo: true,
            orderCode: true,
            status: true,
            attempts: true,
            lastError: true,
            processedAt: true,
            createdAt: true,
          },
        }),
      ]);
      res.json({ source, total, page, pageSize, logs });
      return;
    }

    const where = status ? { status } : {};
    const [total, logs] = await Promise.all([
      prisma.shopeeWebhookLog.count({ where }),
      prisma.shopeeWebhookLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          eventCode: true,
          shopId: true,
          orderSn: true,
          status: true,
          attempts: true,
          lastError: true,
          processedAt: true,
          createdAt: true,
        },
      }),
    ]);
    res.json({ source, total, page, pageSize, logs });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// KẾ TOÁN NỘI BỘ (GĐ3 — lá hq.finance): Ví Hubsell toàn hệ thống + duyệt lệnh
// rút tiền hoa hồng giới thiệu (trả nợ ghi chú "duyệt là việc của platform
// admin" trong routes/referral.ts). Doanh thu gói cước chưa thương mại hóa —
// FE tự chú thích, không trả số giả từ đây.
// ============================================================

const toNumber = (d: Prisma.Decimal | null | undefined) => (d ? Number(d) : 0);

const WITHDRAWAL_SELECT = {
  id: true,
  amount: true,
  bankName: true,
  bankAccountNumber: true,
  bankAccountName: true,
  status: true,
  reviewNote: true,
  processedAt: true,
  createdAt: true,
  user: { select: { id: true, email: true, fullName: true } },
} as const;

// GET /api/admin/finance — số liệu ví + lệnh rút chờ duyệt + lịch sử đã xử lý.
router.get("/finance", requirePlatformPermission("hq.finance"), async (_req, res, next) => {
  try {
    const [balanceAgg, commissionAgg, paidAgg, pendingAgg, pending, processed] =
      await Promise.all([
        // Tổng số dư mọi Ví Hubsell = khoản nền tảng ĐANG NỢ người dùng.
        prisma.hubsellWallet.aggregate({ _sum: { balance: true } }),
        prisma.walletTransaction.aggregate({
          where: { type: "COMMISSION", status: { not: "REJECTED" } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.withdrawalRequest.aggregate({
          where: { status: "APPROVED" },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.withdrawalRequest.aggregate({
          where: { status: "PENDING" },
          _sum: { amount: true },
          _count: true,
        }),
        // Lệnh chờ duyệt: CŨ NHẤT trước — đến trước duyệt trước.
        prisma.withdrawalRequest.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          select: WITHDRAWAL_SELECT,
        }),
        prisma.withdrawalRequest.findMany({
          where: { status: { not: "PENDING" } },
          orderBy: { processedAt: "desc" },
          take: 20,
          select: WITHDRAWAL_SELECT,
        }),
      ]);

    res.json({
      wallet: {
        totalBalance: toNumber(balanceAgg._sum.balance),
        totalCommission: toNumber(commissionAgg._sum.amount),
        commissionCount: commissionAgg._count,
        totalPaidOut: toNumber(paidAgg._sum.amount),
        paidOutCount: paidAgg._count,
        pendingAmount: toNumber(pendingAgg._sum.amount),
        pendingCount: pendingAgg._count,
      },
      pendingWithdrawals: pending.map((w) => ({ ...w, amount: toNumber(w.amount) })),
      processedWithdrawals: processed.map((w) => ({ ...w, amount: toNumber(w.amount) })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/withdrawals/:id/approve — xác nhận ĐÃ CHUYỂN KHOẢN cho lệnh
// rút (tiền đã bị trừ ví ngay lúc đặt lệnh — duyệt chỉ chốt sổ, không đụng số
// dư). Body: { reviewNote? } — thường là mã giao dịch chuyển khoản.
router.post(
  "/withdrawals/:id/approve",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const { reviewNote } = req.body ?? {};
      const noteValue =
        typeof reviewNote === "string" && reviewNote.trim() ? reviewNote.trim() : null;

      const result = await prisma.$transaction(async (tx) => {
        // updateMany có điều kiện status=PENDING: hai kế toán bấm duyệt cùng
        // lúc thì người sau tự trượt, không duyệt đúp.
        const updated = await tx.withdrawalRequest.updateMany({
          where: { id: req.params.id, status: "PENDING" },
          data: { status: "APPROVED", reviewNote: noteValue, processedAt: new Date() },
        });
        if (updated.count !== 1) return null;
        await tx.walletTransaction.updateMany({
          where: { withdrawalRequestId: req.params.id, type: "WITHDRAWAL" },
          data: { status: "COMPLETED" },
        });
        return tx.withdrawalRequest.findUniqueOrThrow({
          where: { id: req.params.id },
          select: WITHDRAWAL_SELECT,
        });
      });
      if (!result) {
        res.status(409).json({ error: "Lệnh rút không tồn tại hoặc đã được xử lý" });
        return;
      }

      await writeAuditLog(req, {
        action: "withdrawal.approve",
        targetUserId: result.user.id,
        targetLabel: `${result.user.fullName} (${result.user.email ?? result.user.id})`,
        detail: {
          amount: toNumber(result.amount),
          bank: `${result.bankName} — ${result.bankAccountNumber}`,
          reviewNote: noteValue,
        },
      });
      res.json({ withdrawal: { ...result, amount: toNumber(result.amount) } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/admin/withdrawals/:id/reject — từ chối lệnh rút, HOÀN TIỀN vào ví
// bằng giao dịch ADJUSTMENT (đúng thiết kế sổ cái append-only của referral).
// Body: { reviewNote } — LÝ DO BẮT BUỘC, hiển thị cho người dùng.
router.post(
  "/withdrawals/:id/reject",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const { reviewNote } = req.body ?? {};
      if (typeof reviewNote !== "string" || !reviewNote.trim()) {
        res.status(400).json({ error: "Vui lòng nhập lý do từ chối" });
        return;
      }
      const reason = reviewNote.trim();

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.withdrawalRequest.updateMany({
          where: { id: req.params.id, status: "PENDING" },
          data: { status: "REJECTED", reviewNote: reason, processedAt: new Date() },
        });
        if (updated.count !== 1) return null;

        const wr = await tx.withdrawalRequest.findUniqueOrThrow({
          where: { id: req.params.id },
          select: WITHDRAWAL_SELECT,
        });
        await tx.walletTransaction.updateMany({
          where: { withdrawalRequestId: wr.id, type: "WITHDRAWAL" },
          data: { status: "REJECTED" },
        });
        // Hoàn tiền: cộng lại balance + bản ghi ADJUSTMENT dương đối ứng.
        await tx.hubsellWallet.update({
          where: { userId: wr.user.id },
          data: { balance: { increment: wr.amount } },
        });
        await tx.walletTransaction.create({
          data: {
            userId: wr.user.id,
            type: "ADJUSTMENT",
            amount: wr.amount,
            status: "COMPLETED",
            withdrawalRequestId: wr.id,
            note: `Hoàn tiền lệnh rút bị từ chối — ${reason}`,
          },
        });
        return wr;
      });
      if (!result) {
        res.status(409).json({ error: "Lệnh rút không tồn tại hoặc đã được xử lý" });
        return;
      }

      await writeAuditLog(req, {
        action: "withdrawal.reject",
        targetUserId: result.user.id,
        targetLabel: `${result.user.fullName} (${result.user.email ?? result.user.id})`,
        detail: { amount: toNumber(result.amount), reviewNote: reason },
      });
      res.json({ withdrawal: { ...result, amount: toNumber(result.amount) } });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// MARKETING & GIỚI THIỆU (GĐ4 — lá hq.marketing): hiệu quả chương trình
// "Kiếm Tiền Cùng Hubsell" trên toàn hệ thống — dữ liệu THẬT từ ReferralTree
// (User.referredById) + sổ cái hoa hồng.
// ============================================================

// GET /api/admin/marketing — tổng quan + top người giới thiệu.
router.get("/marketing", requirePlatformPermission("hq.marketing"), async (_req, res, next) => {
  try {
    const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalReferred, referred30d, groups, commissionByUser] = await Promise.all([
      prisma.user.count({ where: { referredById: { not: null } } }),
      prisma.user.count({
        where: { referredById: { not: null }, createdAt: { gte: d30 } },
      }),
      prisma.user.groupBy({
        by: ["referredById"],
        where: { referredById: { not: null } },
        _count: { _all: true },
      }),
      prisma.walletTransaction.groupBy({
        by: ["userId"],
        where: { type: "COMMISSION", status: { not: "REJECTED" } },
        _sum: { amount: true },
      }),
    ]);

    const commissionMap = new Map(
      commissionByUser.map((c) => [c.userId, toNumber(c._sum.amount)])
    );
    // Số nhóm = số người từng giới thiệu được ai đó — nhỏ, sort JS cho gọn.
    const top = groups
      .map((g) => ({ userId: g.referredById!, referredCount: g._count._all }))
      .sort((a, b) => b.referredCount - a.referredCount)
      .slice(0, 10);
    const referrers = await prisma.user.findMany({
      where: { id: { in: top.map((t) => t.userId) } },
      select: { id: true, fullName: true, email: true, referralCode: true },
    });
    const referrerById = new Map(referrers.map((r) => [r.id, r]));

    res.json({
      totalReferred,
      referred30d,
      activeReferrers: groups.length,
      topReferrers: top.map((t) => {
        const u = referrerById.get(t.userId);
        return {
          userId: t.userId,
          fullName: u?.fullName ?? "(đã xoá)",
          email: u?.email ?? null,
          referralCode: u?.referralCode ?? null,
          referredCount: t.referredCount,
          totalCommission: commissionMap.get(t.userId) ?? 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// NHẬT KÝ THAO TÁC (GĐ4) — CHỈ CHỦ NỀN TẢNG (requirePlatformAdmin, không có
// lá nào cấp được cho nhân viên): giám sát chính đội điều hành thì người bị
// giám sát không được tự xem/soát sổ.
// ============================================================

// GET /api/admin/audit-logs?page=&pageSize=
router.get("/audit-logs", requirePlatformAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const [total, logs] = await Promise.all([
      prisma.platformAuditLog.count(),
      prisma.platformAuditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          actorName: true,
          action: true,
          targetLabel: true,
          detail: true,
          createdAt: true,
        },
      }),
    ]);
    res.json({ total, page, pageSize, logs });
  } catch (err) {
    next(err);
  }
});

export default router;
