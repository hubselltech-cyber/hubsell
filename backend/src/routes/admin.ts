import { Router } from "express";
import {
  ConsultLeadStatus,
  LedgerDirection,
  LedgerInvoiceStatus,
  LedgerSource,
  PlatformCareStatus,
  Prisma,
  WebhookJobStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  requirePlatformAdmin,
  requirePlatformPermission,
  type AuthRequest,
} from "../middleware/auth";
import { writeAuditLog } from "../services/platform-audit";
import {
  INVOICE_PATTERN_RE,
  INVOICE_SERIES_RE,
  TAX_CODE_RE,
  downloadInvoiceFiles,
  publishStandardInvoice,
  standardConfigMissing,
  testStandardConnection,
} from "../integrations/invoice/misa-einvoice";
import {
  buildHqInvoiceInput,
  hqStandardConfig,
  isHqVatMode,
  type HqVatMode,
} from "../integrations/invoice/issue-hq";
import { isPublishAllowed } from "../integrations/invoice/misa-safety";
import adminPlansRouter from "./admin-plans";

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

// GET /api/admin/overview — DASHBOARD ĐIỀU HÀNH (GĐ5): biểu đồ đăng ký theo
// tuần, phân bố trạng thái chăm sóc, tỷ lệ đang hoạt động / rời bỏ, gia hạn.
// Bổ trợ cho /stats (số đếm thô) — trang Tổng quan gọi cả hai.
router.get("/overview", requirePlatformPermission("hq.overview"), async (_req, res, next) => {
  try {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const d30 = new Date(now - 30 * DAY);
    // 12 tuần: neo tuần theo THỨ HAI để cột cuối là "tuần này" (đang chạy dở).
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const chartStart = new Date(monday.getTime() - 11 * 7 * DAY);

    const [totalOwners, newOwners30d, recentSignups, careGroups, activeChannels, renewAllAgg, renew30dAgg] =
      await Promise.all([
        prisma.user.count({ where: { ownerId: null } }),
        prisma.user.count({ where: { ownerId: null, createdAt: { gte: d30 } } }),
        prisma.user.findMany({
          where: { ownerId: null, createdAt: { gte: chartStart } },
          select: { createdAt: true },
        }),
        prisma.platformCustomerCare.groupBy({ by: ["status"], _count: { _all: true } }),
        // Shop "đang hoạt động" = có đơn phát sinh trong 30 ngày (distinct chủ shop).
        prisma.channel.findMany({
          where: { orders: { some: { createdAt: { gte: d30 } } } },
          select: { userId: true },
          distinct: ["userId"],
        }),
        prisma.walletTransaction.aggregate({
          where: { type: "PACKAGE_RENEWAL" },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.walletTransaction.aggregate({
          where: { type: "PACKAGE_RENEWAL", createdAt: { gte: d30 } },
          _sum: { amount: true },
          _count: true,
        }),
      ]);

    // Gom đăng ký theo 12 tuần — số chủ shop nhỏ nên bó trong JS cho gọn.
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const start = new Date(chartStart.getTime() + i * 7 * DAY);
      return { start, count: 0 };
    });
    for (const u of recentSignups) {
      const idx = Math.floor((u.createdAt.getTime() - chartStart.getTime()) / (7 * DAY));
      if (idx >= 0 && idx < 12) weeks[idx].count += 1;
    }

    // Khách chưa có hồ sơ care = NEW ngầm định.
    const careCount = new Map(careGroups.map((g) => [g.status, g._count._all]));
    const trackedTotal = careGroups.reduce((s, g) => s + g._count._all, 0);
    const careDistribution = (Object.values(PlatformCareStatus) as PlatformCareStatus[]).map(
      (status) => ({
        status,
        count:
          status === PlatformCareStatus.NEW
            ? (careCount.get(status) ?? 0) + Math.max(0, totalOwners - trackedTotal)
            : careCount.get(status) ?? 0,
      })
    );
    const churned = careCount.get(PlatformCareStatus.CHURNED) ?? 0;
    const pct = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

    res.json({
      totals: {
        owners: totalOwners,
        newOwners30d,
        active30d: activeChannels.length,
        activePct: pct(activeChannels.length, totalOwners),
        churnRisk: careCount.get(PlatformCareStatus.CHURN_RISK) ?? 0,
        churned,
        churnedPct: pct(churned, totalOwners),
      },
      signupsByWeek: weeks.map((w) => ({
        weekStart: w.start.toISOString(),
        label: `${String(w.start.getDate()).padStart(2, "0")}/${String(w.start.getMonth() + 1).padStart(2, "0")}`,
        count: w.count,
      })),
      careDistribution,
      // Gia hạn gói qua Ví Hubsell — KHUNG DEMO chờ thương mại hóa (amount âm
      // trong sổ ví → trả về số dương cho dễ đọc).
      renewals: {
        countTotal: renewAllAgg._count,
        amountTotal: Math.abs(toNumber(renewAllAgg._sum.amount)),
        count30d: renew30dAgg._count,
        amount30d: Math.abs(toNumber(renew30dAgg._sum.amount)),
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
    // Tìm nhanh theo tên / email / SĐT / username — thương mại hóa vài trăm
    // khách thì sale không thể lật trang tay tìm người.
    const q = String(req.query.q ?? "").trim();
    const where: Prisma.UserWhereInput = {
      ownerId: null,
      ...(careStatus
        ? careStatus === PlatformCareStatus.NEW
          ? { OR: [{ careProfile: null }, { careProfile: { status: careStatus } }] }
          : { careProfile: { status: careStatus } }
        : {}),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { fullName: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                  { username: { contains: q, mode: "insensitive" } },
                  // SĐT lưu E.164 (+84…) — khách gõ "0965" vẫn phải trúng.
                  { phone: { contains: q.replace(/^0/, "") } },
                ],
              },
            ],
          }
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
          // Gói hiện tại — kế toán "Ghi nhận thanh toán" bên /admin/plans là
          // cột này tự nhảy theo (Subscription là nguồn sự thật duy nhất).
          subscription: {
            select: {
              isTrial: true,
              currentPeriodEnd: true,
              plan: { select: { code: true, name: true } },
            },
          },
        },
      }),
    ]);

    // Tổng tiền ĐÃ THU của từng khách (mọi PackagePayment) — căn cứ tính hoa
    // hồng sale. MỘT groupBy cho cả trang, không N+1.
    const paidAgg = await prisma.packagePayment.groupBy({
      by: ["userId"],
      where: { userId: { in: users.map((u) => u.id) } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const paidByUser = new Map(
      paidAgg.map((p) => [
        p.userId,
        { total: Number(p._sum.amount ?? 0), count: p._count._all },
      ])
    );

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
        plan: u.subscription
          ? {
              code: u.subscription.plan.code,
              name: u.subscription.plan.name,
              isTrial: u.subscription.isTrial,
              currentPeriodEnd: u.subscription.currentPeriodEnd,
            }
          : null,
        paidTotal: paidByUser.get(u.id)?.total ?? 0,
        paidCount: paidByUser.get(u.id)?.count ?? 0,
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

// ============================================================
// LEAD TƯ VẤN từ landing (lá hq.customers — cùng khu làm việc của Sale).
// Gói khách CHỐT không nằm ở lead: nguồn sự thật là PackagePayment lúc kế
// toán "Ghi nhận thanh toán" trên /admin/plans. Ở đây chỉ MATCH lead ↔ tài
// khoản theo email/SĐT để sale thấy "lead này đã đăng ký, đang gói nào".
// ============================================================

// GET /api/admin/consult-leads?status=&page=&pageSize=
router.get(
  "/consult-leads",
  requirePlatformPermission("hq.customers"),
  async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
      const statusRaw = String(req.query.status ?? "");
      const status = (Object.values(ConsultLeadStatus) as string[]).includes(statusRaw)
        ? (statusRaw as ConsultLeadStatus)
        : undefined;
      const where = status ? { status } : {};

      const [total, newCount, leads] = await Promise.all([
        prisma.consultLead.count({ where }),
        prisma.consultLead.count({ where: { status: ConsultLeadStatus.NEW } }),
        prisma.consultLead.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { assignee: { select: { id: true, fullName: true } } },
        }),
      ]);

      // Match lead ↔ tài khoản đã đăng ký theo email HOẶC SĐT (lead.phone đã
      // chuẩn hóa E.164 lúc nhận nên so thẳng với User.phone được).
      const emails = [...new Set(leads.map((l) => l.email))];
      const phones = [...new Set(leads.map((l) => l.phone))];
      const accounts = leads.length
        ? await prisma.user.findMany({
            where: {
              ownerId: null,
              OR: [{ email: { in: emails } }, { phone: { in: phones } }],
            },
            select: {
              id: true,
              email: true,
              phone: true,
              fullName: true,
              createdAt: true,
              subscription: {
                select: {
                  isTrial: true,
                  status: true,
                  plan: { select: { code: true, name: true } },
                },
              },
            },
          })
        : [];
      const byEmail = new Map(accounts.map((u) => [u.email?.toLowerCase(), u]));
      const byPhone = new Map(accounts.filter((u) => u.phone).map((u) => [u.phone, u]));

      res.json({
        total,
        newCount,
        page,
        pageSize,
        leads: leads.map((l) => {
          const acc = byEmail.get(l.email.toLowerCase()) ?? byPhone.get(l.phone) ?? null;
          return {
            id: l.id,
            name: l.name,
            email: l.email,
            phone: l.phone,
            source: l.source,
            status: l.status,
            note: l.note,
            assignee: l.assignee,
            createdAt: l.createdAt,
            updatedAt: l.updatedAt,
            account: acc
              ? {
                  userId: acc.id,
                  fullName: acc.fullName,
                  registeredAt: acc.createdAt,
                  planCode: acc.subscription?.plan.code ?? null,
                  planName: acc.subscription?.plan.name ?? null,
                  isTrial: acc.subscription?.isTrial ?? false,
                }
              : null,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/admin/consult-leads/:id — { status?, assigneeId?, note? } (trường
// vắng mặt giữ nguyên; assigneeId null = bỏ phân công). Ghi PlatformAuditLog.
router.patch(
  "/consult-leads/:id",
  requirePlatformPermission("hq.customers"),
  async (req: AuthRequest, res, next) => {
    try {
      const { status, assigneeId, note } = req.body ?? {};

      const lead = await prisma.consultLead.findUnique({ where: { id: req.params.id } });
      if (!lead) {
        res.status(404).json({ error: "Không tìm thấy lead này" });
        return;
      }
      if (
        status !== undefined &&
        !(Object.values(ConsultLeadStatus) as string[]).includes(status)
      ) {
        res.status(400).json({ error: "Trạng thái lead không hợp lệ" });
        return;
      }
      if (note !== undefined && note !== null && typeof note !== "string") {
        res.status(400).json({ error: "Ghi chú không hợp lệ" });
        return;
      }
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
      const updated = await prisma.consultLead.update({
        where: { id: lead.id },
        data: {
          ...(status !== undefined ? { status: status as ConsultLeadStatus } : {}),
          ...(assigneeId !== undefined ? { assigneeId: assigneeId as string | null } : {}),
          ...(noteValue !== undefined ? { note: noteValue } : {}),
        },
        include: { assignee: { select: { id: true, fullName: true } } },
      });

      await writeAuditLog(req, {
        action: "lead.update",
        targetLabel: `${lead.name} (${lead.email})`,
        detail: {
          leadId: lead.id,
          ...(status !== undefined ? { status } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          ...(noteValue !== undefined ? { note: noteValue } : {}),
        },
      });

      res.json({ lead: updated });
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

      // Tên người duyệt — snapshot vào bút toán sổ quỹ tự sinh bên dưới.
      const actor = await prisma.user.findUnique({
        where: { id: req.userId! },
        select: { fullName: true },
      });

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
        const wr = await tx.withdrawalRequest.findUniqueOrThrow({
          where: { id: req.params.id },
          select: WITHDRAWAL_SELECT,
        });
        // SỔ QUỸ (GĐ5): duyệt chi trả = một khoản tiền RA — tự ghi bút toán,
        // kế toán không phải nhập tay. withdrawalRequestId unique nên lệnh
        // nào cũng chỉ có đúng một bút toán.
        await tx.platformLedgerEntry.create({
          data: {
            direction: LedgerDirection.OUT,
            source: LedgerSource.REFERRAL_PAYOUT,
            amount: wr.amount,
            note: `Chi trả hoa hồng giới thiệu — ${wr.bankName} · ${wr.bankAccountNumber}${noteValue ? ` (${noteValue})` : ""}`,
            customerId: wr.user.id,
            withdrawalRequestId: wr.id,
            createdById: req.userId!,
            createdByName: actor?.fullName ?? "(không rõ)",
          },
        });
        return wr;
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
// SỔ QUỸ NỘI BỘ (GĐ5 — lá hq.finance): mỗi dòng một khoản tiền vào/ra của
// CHÍNH công ty Hubsell. Chi hoa hồng TỰ SINH khi duyệt lệnh rút (ở trên);
// thu phí gói/khoản khác kế toán ghi tay chờ ngày có cổng thanh toán. Mỗi
// khoản THU mang nghĩa vụ hóa đơn (PENDING → ISSUED kèm số HĐ) — không bao
// giờ lọt khoản thu chưa xuất hóa đơn.
// ============================================================

const LEDGER_SELECT = {
  id: true,
  direction: true,
  source: true,
  amount: true,
  note: true,
  invoiceStatus: true,
  invoiceNo: true,
  einvoiceTransactionId: true,
  occurredAt: true,
  createdByName: true,
  withdrawalRequestId: true,
  packagePaymentId: true,
  customer: { select: { id: true, email: true, fullName: true } },
} as const;

/** Khoảng thời gian [đầu tháng, đầu tháng sau) từ chuỗi "YYYY-MM". */
function monthRange(raw: unknown): { month: string; start: Date; end: Date } {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : fallback;
  const [y, m] = month.split("-").map(Number);
  return { month, start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

// GET /api/admin/finance/ledger?month=YYYY-MM — sổ quỹ một tháng + tổng kết.
router.get(
  "/finance/ledger",
  requirePlatformPermission("hq.finance"),
  async (req, res, next) => {
    try {
      const { month, start, end } = monthRange(req.query.month);
      const entries = await prisma.platformLedgerEntry.findMany({
        where: { occurredAt: { gte: start, lt: end } },
        orderBy: { occurredAt: "desc" },
        select: LEDGER_SELECT,
      });
      let totalIn = 0;
      let totalOut = 0;
      let pendingInvoices = 0;
      for (const e of entries) {
        if (e.direction === LedgerDirection.IN) totalIn += toNumber(e.amount);
        else totalOut += toNumber(e.amount);
        if (e.invoiceStatus === LedgerInvoiceStatus.PENDING) pendingInvoices += 1;
      }
      res.json({
        month,
        totals: { in: totalIn, out: totalOut, net: totalIn - totalOut, pendingInvoices },
        entries: entries.map((e) => ({ ...e, amount: toNumber(e.amount) })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/admin/finance/ledger — GHI TAY một bút toán (phiếu thu/chi).
// Body: { direction, source, amount, note?, customerEmail?, occurredAt?,
//         invoiceStatus?, invoiceNo? }
// REFERRAL_PAYOUT không ghi tay được — nguồn đó chỉ tự sinh từ duyệt lệnh rút.
router.post(
  "/finance/ledger",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const { direction, source, amount, note, customerEmail, occurredAt, invoiceStatus, invoiceNo } =
        req.body ?? {};

      if (!(Object.values(LedgerDirection) as string[]).includes(direction)) {
        res.status(400).json({ error: "Chiều dòng tiền không hợp lệ (IN/OUT)" });
        return;
      }
      if (
        !(Object.values(LedgerSource) as string[]).includes(source) ||
        source === LedgerSource.REFERRAL_PAYOUT
      ) {
        res.status(400).json({ error: "Nguồn bút toán không hợp lệ" });
        return;
      }
      const value = Math.floor(Number(amount));
      if (!Number.isFinite(value) || value <= 0) {
        res.status(400).json({ error: "Số tiền phải là số dương" });
        return;
      }
      const when = occurredAt ? new Date(occurredAt) : new Date();
      if (Number.isNaN(when.getTime())) {
        res.status(400).json({ error: "Ngày phát sinh không hợp lệ" });
        return;
      }
      let customerId: string | null = null;
      if (typeof customerEmail === "string" && customerEmail.trim()) {
        const customer = await prisma.user.findFirst({
          where: { email: customerEmail.trim().toLowerCase(), ownerId: null },
          select: { id: true },
        });
        if (!customer) {
          res.status(400).json({ error: "Không tìm thấy chủ shop với email này" });
          return;
        }
        customerId = customer.id;
      }
      // Nghĩa vụ hóa đơn: khoản THU mặc định PENDING (phải xuất), khoản CHI = NONE.
      const invStatus = (Object.values(LedgerInvoiceStatus) as string[]).includes(invoiceStatus)
        ? (invoiceStatus as LedgerInvoiceStatus)
        : direction === LedgerDirection.IN
          ? LedgerInvoiceStatus.PENDING
          : LedgerInvoiceStatus.NONE;

      const actor = await prisma.user.findUnique({
        where: { id: req.userId! },
        select: { fullName: true },
      });
      const entry = await prisma.platformLedgerEntry.create({
        data: {
          direction: direction as LedgerDirection,
          source: source as LedgerSource,
          amount: value,
          note: typeof note === "string" && note.trim() ? note.trim() : null,
          customerId,
          occurredAt: when,
          invoiceStatus: invStatus,
          invoiceNo:
            typeof invoiceNo === "string" && invoiceNo.trim() ? invoiceNo.trim() : null,
          createdById: req.userId!,
          createdByName: actor?.fullName ?? "(không rõ)",
        },
        select: LEDGER_SELECT,
      });

      await writeAuditLog(req, {
        action: "ledger.create",
        targetUserId: customerId,
        detail: { direction, source, amount: value, note: entry.note, occurredAt: when.toISOString() },
      });
      res.status(201).json({ entry: { ...entry, amount: toNumber(entry.amount) } });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/admin/finance/ledger/:id — sửa bút toán. Bút toán TỰ SINH (từ
// lệnh rút) chỉ sửa được diễn giải; bút toán ghi tay sửa được mọi trường.
router.patch(
  "/finance/ledger/:id",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const { note, invoiceStatus, invoiceNo, occurredAt, amount } = req.body ?? {};
      const entry = await prisma.platformLedgerEntry.findUnique({
        where: { id: req.params.id },
        select: { id: true, withdrawalRequestId: true, packagePaymentId: true },
      });
      if (!entry) {
        res.status(404).json({ error: "Không tìm thấy bút toán" });
        return;
      }
      if (
        entry.withdrawalRequestId !== null &&
        (invoiceStatus !== undefined || invoiceNo !== undefined || occurredAt !== undefined || amount !== undefined)
      ) {
        res.status(400).json({
          error: "Bút toán tự sinh từ lệnh rút — chỉ sửa được diễn giải; nguồn sự thật là lệnh rút",
        });
        return;
      }
      // Bút toán thu phí gói tự sinh: số tiền/ngày theo chứng từ thanh toán,
      // nhưng kế toán VẪN phải đánh dấu hóa đơn đã xuất được (nghĩa vụ hóa đơn
      // nằm trên sổ) — nên chỉ khóa amount + occurredAt.
      if (entry.packagePaymentId !== null && (occurredAt !== undefined || amount !== undefined)) {
        res.status(400).json({
          error:
            "Bút toán tự sinh từ thanh toán gói — số tiền/ngày theo chứng từ thanh toán, chỉ sửa được diễn giải và hóa đơn",
        });
        return;
      }

      const patch: Prisma.PlatformLedgerEntryUpdateInput = {};
      if (note !== undefined) {
        if (note !== null && typeof note !== "string") {
          res.status(400).json({ error: "Diễn giải không hợp lệ" });
          return;
        }
        patch.note = note === null || note.trim() === "" ? null : note.trim();
      }
      if (invoiceStatus !== undefined) {
        if (!(Object.values(LedgerInvoiceStatus) as string[]).includes(invoiceStatus)) {
          res.status(400).json({ error: "Trạng thái hóa đơn không hợp lệ" });
          return;
        }
        patch.invoiceStatus = invoiceStatus as LedgerInvoiceStatus;
      }
      if (invoiceNo !== undefined) {
        patch.invoiceNo =
          typeof invoiceNo === "string" && invoiceNo.trim() ? invoiceNo.trim() : null;
      }
      if (occurredAt !== undefined) {
        const when = new Date(occurredAt);
        if (Number.isNaN(when.getTime())) {
          res.status(400).json({ error: "Ngày phát sinh không hợp lệ" });
          return;
        }
        patch.occurredAt = when;
      }
      if (amount !== undefined) {
        const value = Math.floor(Number(amount));
        if (!Number.isFinite(value) || value <= 0) {
          res.status(400).json({ error: "Số tiền phải là số dương" });
          return;
        }
        patch.amount = value;
      }

      const updated = await prisma.platformLedgerEntry.update({
        where: { id: entry.id },
        data: patch,
        select: LEDGER_SELECT,
      });
      await writeAuditLog(req, {
        action: "ledger.update",
        targetUserId: updated.customer?.id ?? null,
        detail: JSON.parse(JSON.stringify({ id: entry.id, ...req.body })),
      });
      res.json({ entry: { ...updated, amount: toNumber(updated.amount) } });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/admin/finance/ledger/:id — chỉ xoá được bút toán GHI TAY (nhập
// nhầm); bút toán tự sinh sống chết theo lệnh rút, không xoá lẻ.
router.delete(
  "/finance/ledger/:id",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const entry = await prisma.platformLedgerEntry.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          direction: true,
          source: true,
          amount: true,
          note: true,
          withdrawalRequestId: true,
          packagePaymentId: true,
        },
      });
      if (!entry) {
        res.status(404).json({ error: "Không tìm thấy bút toán" });
        return;
      }
      if (entry.withdrawalRequestId !== null) {
        res.status(400).json({ error: "Bút toán tự sinh từ lệnh rút — không xoá được" });
        return;
      }
      if (entry.packagePaymentId !== null) {
        res.status(400).json({ error: "Bút toán tự sinh từ thanh toán gói — không xoá được" });
        return;
      }
      await prisma.platformLedgerEntry.delete({ where: { id: entry.id } });
      await writeAuditLog(req, {
        action: "ledger.delete",
        detail: {
          direction: entry.direction,
          source: entry.source,
          amount: toNumber(entry.amount),
          note: entry.note,
        },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// CHECKLIST LỊCH THUẾ (tab Lịch thuế /admin/finance — lá hq.finance):
// đánh dấu từng mốc thủ tục thuế của CHÍNH công ty Hubsell là đã xử lý.
// Danh mục mốc là dữ liệu TĨNH phía frontend; backend chỉ giữ trạng thái
// theo itemKey để mọi người trong HQ cùng thấy (không lưu localStorage).
// ============================================================

const TAX_CHECK_KEY_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

// GET /api/admin/finance/tax-checklist — toàn bộ mốc đã đánh dấu.
router.get(
  "/finance/tax-checklist",
  requirePlatformPermission("hq.finance"),
  async (_req, res, next) => {
    try {
      const items = await prisma.platformTaxCheckItem.findMany({
        select: { itemKey: true, doneAt: true, doneByName: true },
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/admin/finance/tax-checklist/:itemKey — body { done: boolean }.
// done=true upsert (bấm lại không nhân đôi), done=false xoá dấu.
router.put(
  "/finance/tax-checklist/:itemKey",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const itemKey = req.params.itemKey;
      if (!TAX_CHECK_KEY_RE.test(itemKey)) {
        res.status(400).json({ error: "Mã mốc không hợp lệ" });
        return;
      }
      const done = req.body?.done === true;
      if (done) {
        const actor = await prisma.user.findUnique({
          where: { id: req.userId! },
          select: { fullName: true },
        });
        const item = await prisma.platformTaxCheckItem.upsert({
          where: { itemKey },
          create: {
            itemKey,
            doneById: req.userId!,
            doneByName: actor?.fullName ?? "(không rõ)",
          },
          update: {},
          select: { itemKey: true, doneAt: true, doneByName: true },
        });
        await writeAuditLog(req, {
          action: "taxcal.check",
          detail: { itemKey },
        });
        res.json({ item });
        return;
      }
      await prisma.platformTaxCheckItem.deleteMany({ where: { itemKey } });
      await writeAuditLog(req, {
        action: "taxcal.uncheck",
        detail: { itemKey },
      });
      res.json({ item: null });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// HĐĐT CỦA CHÍNH HUBSELL (tab Sổ quỹ HQ): cấu hình meInvoice công ty (singleton
// platform_invoice_config — CHỈ chủ nền tảng vì chứa mật khẩu) + xuất hóa đơn
// cho bút toán THU (hq.finance). Tầng client meInvoice tái dùng của tenant;
// chốt an toàn MISA_ALLOW_PUBLISH vẫn gác publish như mọi luồng khác.
// ============================================================

/** Bản ghi cấu hình duy nhất (tạo rỗng nếu chưa có). */
async function hqInvoiceConfigRow() {
  const row = await prisma.platformInvoiceConfig.findFirst();
  return row ?? prisma.platformInvoiceConfig.create({ data: {} });
}

/** Che trường mật — GET không bao giờ trả mật khẩu, chỉ báo đã lưu hay chưa. */
function maskHqInvoiceConfig(row: Awaited<ReturnType<typeof hqInvoiceConfigRow>>) {
  const { meinvoicePassword, esignSecretKey, esignPassword, ...rest } = row;
  return {
    ...rest,
    hasMeinvoicePassword: Boolean(meinvoicePassword),
    hasEsignSecretKey: Boolean(esignSecretKey),
    hasEsignPassword: Boolean(esignPassword),
  };
}

// GET /api/admin/finance/invoice-config — cấu hình (đã che mật khẩu) + trạng
// thái sẵn sàng. Mở cho hq.finance để dialog xuất HĐ biết thiếu gì; sửa/test
// vẫn chỉ chủ nền tảng.
router.get(
  "/finance/invoice-config",
  requirePlatformPermission("hq.finance"),
  async (_req, res, next) => {
    try {
      const row = await hqInvoiceConfigRow();
      res.json({
        config: maskHqInvoiceConfig(row),
        missing: standardConfigMissing(hqStandardConfig(row)),
        publishAllowed: isPublishAllowed(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/admin/finance/invoice-config — cập nhật. Trường mật khẩu chỉ ghi đè
// khi gửi chuỗi KHÔNG rỗng (form để trống = giữ giá trị cũ).
router.put(
  "/finance/invoice-config",
  requirePlatformAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const b = req.body ?? {};
      const text = (v: unknown) =>
        typeof v === "string" ? v.trim() || null : undefined;

      const taxCode = text(b.taxCode);
      if (taxCode && !TAX_CODE_RE.test(taxCode)) {
        res.status(400).json({ error: "MST không hợp lệ (10/12/13 số)" });
        return;
      }
      const invoicePattern = text(b.invoicePattern);
      if (invoicePattern && !INVOICE_PATTERN_RE.test(invoicePattern)) {
        res.status(400).json({ error: "Mẫu số không hợp lệ (1/2/5/6)" });
        return;
      }
      const invoiceSeries = text(b.invoiceSeries)?.toUpperCase();
      if (invoiceSeries && !INVOICE_SERIES_RE.test(invoiceSeries)) {
        res.status(400).json({ error: 'Ký hiệu không hợp lệ (7 ký tự, VD "1C26THB")' });
        return;
      }
      if (b.signMethod !== undefined && !["USB_TOKEN", "ESIGN_CLOUD"].includes(b.signMethod)) {
        res.status(400).json({ error: "signMethod không hợp lệ" });
        return;
      }
      if (b.vatMode !== undefined && !isHqVatMode(b.vatMode)) {
        res.status(400).json({ error: "vatMode không hợp lệ (KCT/0/5/8/10)" });
        return;
      }

      const row = await hqInvoiceConfigRow();
      const secret = (v: unknown) =>
        typeof v === "string" && v.trim() ? v.trim() : undefined;
      const updated = await prisma.platformInvoiceConfig.update({
        where: { id: row.id },
        data: {
          taxCode,
          companyName: text(b.companyName),
          companyAddress: text(b.companyAddress),
          invoicePattern,
          invoiceSeries,
          meinvoiceUsername: text(b.meinvoiceUsername),
          meinvoicePassword: secret(b.meinvoicePassword),
          signMethod: b.signMethod,
          esignClientId: text(b.esignClientId),
          esignSecretKey: secret(b.esignSecretKey),
          esignUsername: text(b.esignUsername),
          esignPassword: secret(b.esignPassword),
          certSerial: text(b.certSerial),
          vatMode: b.vatMode,
        },
      });
      await writeAuditLog(req, {
        action: "hq-invoice.config-update",
        detail: { taxCode: updated.taxCode, invoiceSeries: updated.invoiceSeries },
      });
      res.json({
        config: maskHqInvoiceConfig(updated),
        missing: standardConfigMissing(hqStandardConfig(updated)),
        publishAllowed: isPublishAllowed(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/admin/finance/invoice-config/test — thử lấy token meInvoice.
router.post(
  "/finance/invoice-config/test",
  requirePlatformAdmin,
  async (_req, res, next) => {
    try {
      const row = await hqInvoiceConfigRow();
      const result = await testStandardConnection(hqStandardConfig(row));
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(502).json({
        error: `Kết nối meInvoice thất bại: ${(err as Error).message}`,
      });
    }
  }
);

// POST /api/admin/finance/ledger/:id/issue-invoice — xuất HĐĐT cho bút toán
// THU. Body: { buyerName, buyerTaxCode?, buyerAddress?, buyerEmail?, itemName }.
// Số tiền hóa đơn = ĐÚNG amount của bút toán (không cho sửa lệch sổ).
router.post(
  "/finance/ledger/:id/issue-invoice",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const entry = await prisma.platformLedgerEntry.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          direction: true,
          amount: true,
          invoiceStatus: true,
          einvoiceTransactionId: true,
        },
      });
      if (!entry) {
        res.status(404).json({ error: "Không tìm thấy bút toán" });
        return;
      }
      if (entry.direction !== LedgerDirection.IN) {
        res.status(400).json({ error: "Chỉ xuất hóa đơn cho khoản THU" });
        return;
      }
      if (entry.invoiceStatus === LedgerInvoiceStatus.ISSUED) {
        res.status(400).json({ error: "Khoản thu này đã có hóa đơn" });
        return;
      }

      const buyerName =
        typeof req.body?.buyerName === "string" ? req.body.buyerName.trim() : "";
      const itemName =
        typeof req.body?.itemName === "string" ? req.body.itemName.trim() : "";
      if (!buyerName || !itemName) {
        res.status(400).json({ error: "Thiếu tên người mua hoặc nội dung dòng hóa đơn" });
        return;
      }
      const buyerTaxCode =
        typeof req.body?.buyerTaxCode === "string" ? req.body.buyerTaxCode.trim() : "";
      if (buyerTaxCode && !TAX_CODE_RE.test(buyerTaxCode)) {
        res.status(400).json({ error: "MST người mua không hợp lệ" });
        return;
      }

      const row = await hqInvoiceConfigRow();
      const cfg = hqStandardConfig(row);
      const missing = standardConfigMissing(cfg);
      if (missing.length > 0) {
        res.status(400).json({
          error: `Chưa cấu hình meInvoice của Hubsell — thiếu: ${missing.join(", ")}`,
        });
        return;
      }

      const input = buildHqInvoiceInput({
        refId: `HQLEDGER-${entry.id}`,
        buyerName,
        buyerTaxCode,
        buyerAddress:
          typeof req.body?.buyerAddress === "string" ? req.body.buyerAddress.trim() : "",
        buyerEmail:
          typeof req.body?.buyerEmail === "string" ? req.body.buyerEmail.trim() : "",
        itemName,
        amount: toNumber(entry.amount),
        vatMode: row.vatMode as HqVatMode,
      });

      let published;
      try {
        published = await publishStandardInvoice(input, cfg);
      } catch (err) {
        res.status(502).json({ error: (err as Error).message });
        return;
      }

      // meInvoice có thể cấp số trễ (webhook) — khi đó giữ PENDING kèm
      // TransactionID, kế toán tra trên meInvoice rồi điền số tay vào bút toán.
      const issued = Boolean(published.invoiceNo);
      const updated = await prisma.platformLedgerEntry.update({
        where: { id: entry.id },
        data: {
          einvoiceTransactionId: published.transactionId,
          ...(issued
            ? {
                invoiceStatus: LedgerInvoiceStatus.ISSUED,
                invoiceNo: published.invoiceNo,
              }
            : {}),
        },
        select: LEDGER_SELECT,
      });
      await writeAuditLog(req, {
        action: "hq-invoice.issue",
        detail: {
          ledgerEntryId: entry.id,
          buyerName,
          amount: toNumber(entry.amount),
          invoiceNo: published.invoiceNo,
          transactionId: published.transactionId,
        },
      });
      res.json({
        entry: { ...updated, amount: toNumber(updated.amount) },
        invoiceNo: published.invoiceNo,
        transactionId: published.transactionId,
        pendingNumber: !issued,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/admin/finance/ledger/:id/invoice-pdf — bản thể hiện PDF (đã ký).
router.get(
  "/finance/ledger/:id/invoice-pdf",
  requirePlatformPermission("hq.finance"),
  async (req, res, next) => {
    try {
      const entry = await prisma.platformLedgerEntry.findUnique({
        where: { id: req.params.id },
        select: { invoiceNo: true, einvoiceTransactionId: true },
      });
      if (!entry?.einvoiceTransactionId) {
        res.status(400).json({ error: "Bút toán chưa có hóa đơn xuất qua API" });
        return;
      }
      const row = await hqInvoiceConfigRow();
      const [file] = await downloadInvoiceFiles(
        [entry.einvoiceTransactionId],
        "Pdf",
        hqStandardConfig(row)
      );
      if (!file?.data || file.errorCode) {
        res.status(502).json({
          error: `meInvoice không trả được file (${file?.errorCode ?? "không có dữ liệu"}) — thử lại sau.`,
        });
        return;
      }
      res.json({
        fileName: `hoa-don-${entry.invoiceNo ?? entry.einvoiceTransactionId}.pdf`,
        base64: file.data,
      });
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

// ============================================================
// BÁO CÁO NHÀ ĐẦU TƯ (GĐ6) — CHỈ CHỦ NỀN TẢNG: các chỉ số nhà đầu tư SaaS
// soi khi thẩm định (traction / retention / hiệu quả tăng trưởng), tính TƯƠI
// từ dữ liệu thật mỗi lần gọi — không soạn tay trước buổi pitch. Số chưa có
// (MRR/ARPU) trả 0 kèm ghi chú "chờ thương mại hóa", tuyệt đối không vẽ.
// ============================================================

/** Khóa "YYYY-MM" và nhãn "MM/YY" của một mốc Date (theo giờ máy chủ). */
const monthKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabelOf = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;

// GET /api/admin/investor-report
router.get("/investor-report", requirePlatformAdmin, async (_req, res, next) => {
  try {
    const now = new Date();
    const monthStart = (back: number) =>
      new Date(now.getFullYear(), now.getMonth() - back, 1);
    const start12 = monthStart(11); // chuỗi 12 tháng cho đăng ký + GMV
    const start6 = monthStart(5); // 6 tháng cho cohort + sổ quỹ
    const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      signupRows,
      gmvRows,
      channelOwners,
      orderOwners,
      totalOwners,
      referredTotal,
      ledgerRows,
      orderUserMonths,
      cohortOwners,
      mau30d,
    ] = await Promise.all([
      prisma.$queryRaw<{ m: Date; count: bigint }[]>`
        SELECT date_trunc('month', "createdAt") AS m, COUNT(*)::bigint AS count
        FROM "User" WHERE "ownerId" IS NULL AND "createdAt" >= ${start12}
        GROUP BY 1`,
      prisma.$queryRaw<{ m: Date; gmv: Prisma.Decimal | null }[]>`
        SELECT date_trunc('month', o."createdAt") AS m, SUM(o."totalAmount") AS gmv
        FROM "Order" o WHERE o."createdAt" >= ${start12}
        GROUP BY 1`,
      // Funnel bậc 2: chủ shop đã kết nối ít nhất 1 gian hàng.
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "userId")::bigint AS count FROM "Channel"`,
      // Funnel bậc 3: chủ shop đã có đơn chạy qua hệ thống.
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT c."userId")::bigint AS count
        FROM "Order" o JOIN "Channel" c ON c.id = o."channelId"`,
      prisma.user.count({ where: { ownerId: null } }),
      prisma.user.count({ where: { referredById: { not: null } } }),
      prisma.$queryRaw<{ m: Date; direction: string; total: Prisma.Decimal | null }[]>`
        SELECT date_trunc('month', "occurredAt") AS m, "direction"::text AS direction,
               SUM(amount) AS total
        FROM "platform_ledger_entries" WHERE "occurredAt" >= ${start6}
        GROUP BY 1, 2`,
      // Cohort: chủ shop nào CÓ ĐƠN trong tháng nào (distinct, 6 tháng).
      prisma.$queryRaw<{ userId: string; m: Date }[]>`
        SELECT DISTINCT c."userId" AS "userId", date_trunc('month', o."createdAt") AS m
        FROM "Order" o JOIN "Channel" c ON c.id = o."channelId"
        WHERE o."createdAt" >= ${start6}`,
      prisma.user.findMany({
        where: { ownerId: null, createdAt: { gte: start6 } },
        select: { id: true, createdAt: true },
      }),
      // MAU đúng nghĩa (đăng nhập/hoạt động) — dữ liệu tích lũy từ 13/08/2026.
      prisma.user.count({ where: { ownerId: null, lastActiveAt: { gte: d30 } } }),
    ]);

    // ----- Chuỗi 12 tháng: đăng ký + GMV, kèm tăng trưởng MoM % -----
    const signupByKey = new Map(signupRows.map((r) => [monthKeyOf(r.m), Number(r.count)]));
    const gmvByKey = new Map(gmvRows.map((r) => [monthKeyOf(r.m), toNumber(r.gmv)]));
    const momPct = (cur: number, prev: number | null) =>
      prev !== null && prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;

    const months12 = Array.from({ length: 12 }, (_, i) => monthStart(11 - i));
    let prevSignup: number | null = null;
    let prevGmv: number | null = null;
    const signupsByMonth = months12.map((d) => {
      const count = signupByKey.get(monthKeyOf(d)) ?? 0;
      const row = { month: monthKeyOf(d), label: monthLabelOf(d), count, momPct: momPct(count, prevSignup) };
      prevSignup = count;
      return row;
    });
    const gmvByMonth = months12.map((d) => {
      const gmv = gmvByKey.get(monthKeyOf(d)) ?? 0;
      const row = { month: monthKeyOf(d), label: monthLabelOf(d), gmv, momPct: momPct(gmv, prevGmv) };
      prevGmv = gmv;
      return row;
    });

    // ----- Retention cohort 6 tháng: % cohort còn CÓ ĐƠN sau k tháng -----
    const activeMonths = new Map<string, Set<string>>();
    for (const r of orderUserMonths) {
      const key = monthKeyOf(r.m);
      if (!activeMonths.has(r.userId)) activeMonths.set(r.userId, new Set());
      activeMonths.get(r.userId)!.add(key);
    }
    const months6 = Array.from({ length: 6 }, (_, i) => monthStart(5 - i));
    const cohorts = months6.map((cohortMonth, idx) => {
      const members = cohortOwners.filter(
        (o) => monthKeyOf(o.createdAt) === monthKeyOf(cohortMonth)
      );
      const maxOffset = months6.length - 1 - idx; // chỉ tính tới tháng hiện tại
      const activePct = Array.from({ length: maxOffset + 1 }, (_, k) => {
        if (members.length === 0) return null;
        const target = monthKeyOf(months6[idx + k]);
        const active = members.filter((m) => activeMonths.get(m.id)?.has(target)).length;
        return Math.round((active / members.length) * 1000) / 10;
      });
      return {
        month: monthKeyOf(cohortMonth),
        label: monthLabelOf(cohortMonth),
        size: members.length,
        activePct,
      };
    });

    // ----- Sổ quỹ 6 tháng: thu/chi + burn trung bình các tháng có phát sinh -----
    const ledgerByKey = new Map<string, { in: number; out: number }>();
    for (const r of ledgerRows) {
      const key = monthKeyOf(r.m);
      const cur = ledgerByKey.get(key) ?? { in: 0, out: 0 };
      if (r.direction === "IN") cur.in += toNumber(r.total);
      else cur.out += toNumber(r.total);
      ledgerByKey.set(key, cur);
    }
    const burnByMonth = months6.map((d) => {
      const v = ledgerByKey.get(monthKeyOf(d)) ?? { in: 0, out: 0 };
      return { month: monthKeyOf(d), label: monthLabelOf(d), in: v.in, out: v.out };
    });
    const activeBurnMonths = burnByMonth.filter((m) => m.in > 0 || m.out > 0);
    const avgMonthlyBurn =
      activeBurnMonths.length > 0
        ? Math.round(activeBurnMonths.reduce((s, m) => s + m.out, 0) / activeBurnMonths.length)
        : 0;

    const connectedChannel = Number(channelOwners[0]?.count ?? 0);
    const hasOrder = Number(orderOwners[0]?.count ?? 0);
    const pct = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

    res.json({
      generatedAt: now.toISOString(),
      signupsByMonth,
      gmvByMonth,
      funnel: {
        registered: totalOwners,
        connectedChannel,
        connectedPct: pct(connectedChannel, totalOwners),
        hasOrder,
        hasOrderPct: pct(hasOrder, totalOwners),
      },
      retention: cohorts,
      viral: {
        totalReferred: referredTotal,
        pctOfSignups: pct(referredTotal, totalOwners),
      },
      burn: { byMonth: burnByMonth, avgMonthlyBurn },
      activity: {
        mau30d,
        // MAU chỉ đáng tin sau khi cột lastActiveAt tích lũy đủ 30 ngày.
        trackedSince: "2026-08-13",
      },
      revenue: { mrr: 0, arpu: 0, note: "MRR/ARPU tính tự động ở GĐ sau — xem tạm Doanh thu gói tại /admin/plans" },
    });
  } catch (err) {
    next(err);
  }
});

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

// Gói dịch vụ & thuê bao (GĐ1 thương mại hóa) — router con cùng cửa /api/admin.
router.use(adminPlansRouter);

export default router;
