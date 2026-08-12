import { Router } from "express";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { requirePlatformPermission } from "../auth";

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

// GET /api/admin/users?page=1&pageSize=20 — danh sách CHỦ SHOP đã đăng ký
// (mới nhất trước), kèm số nhân viên / gian hàng / đơn của từng shop.
// KHÔNG trả passwordHash hay bất kỳ trường bí mật nào.
router.get("/users", requirePlatformPermission("hq.customers"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    const [total, users] = await Promise.all([
      prisma.user.count({ where: { ownerId: null } }),
      prisma.user.findMany({
        where: { ownerId: null },
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
    });
    const ordersByUser = new Map<string, number>();
    for (const o of orderCounts) {
      const ownerId = channelOwner.get(o.channelId);
      if (!ownerId) continue;
      ordersByUser.set(
        ownerId,
        (ordersByUser.get(ownerId) ?? 0) + o._count._all
      );
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
      })),
    });
  } catch (err) {
    next(err);
  }
});

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

export default router;
