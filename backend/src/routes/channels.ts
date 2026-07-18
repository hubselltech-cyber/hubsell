import { Router } from "express";
import crypto from "crypto";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAdmin, type AuthRequest } from "../auth";
import { MOCK_CATALOG, PLATFORM_FEE_RATE, TOKEN_PREFIX } from "../mockMarketplace";

const router = Router();

const CONNECTABLE: ChannelName[] = [
  ChannelName.SHOPEE,
  ChannelName.LAZADA,
  ChannelName.TIKTOK,
  ChannelName.OFFLINE,
];

// GET /api/channels — kênh bán của shop (kèm số đơn + số sản phẩm đã liên kết).
// Staff cũng được xem (cần cho bộ lọc đơn hàng) nhưng KHÔNG thấy apiToken.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const channels = await prisma.channel.findMany({
      where: {
        userId: req.ownerId!,
        // Nhân viên bị giới hạn kênh chỉ thấy các kênh được gán
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { orders: true, mappings: true } } },
    });
    const isAdmin = req.userRole === "ADMIN";
    res.json(
      channels.map((c) => ({ ...c, apiToken: isAdmin ? c.apiToken : null }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/channels — kết nối một gian hàng ảo (giả lập OAuth với sàn).
// Ở bản thật: bước này sẽ chuyển hướng người dùng sang trang uỷ quyền của
// Shopee/TikTok rồi nhận access token. Ở đây ta sinh token giả lập ngay.
router.post("/", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { channelName } = req.body ?? {};
    if (!CONNECTABLE.includes(channelName)) {
      res.status(400).json({
        error: "Kênh không hợp lệ. Chọn một trong: SHOPEE, LAZADA, TIKTOK, OFFLINE",
      });
      return;
    }
    const name = channelName as ChannelName;

    // Mỗi user chỉ kết nối 1 gian hàng cho mỗi sàn (bản đầu tiên)
    const existing = await prisma.channel.findFirst({
      where: { userId: req.ownerId!, channelName: name },
    });

    const apiToken = `${TOKEN_PREFIX[name]}_${crypto.randomBytes(20).toString("hex")}`;

    if (existing) {
      if (existing.status === "ACTIVE") {
        res.status(409).json({ error: `Bạn đã kết nối ${name} rồi` });
        return;
      }
      // Đã từng ngắt kết nối → kết nối lại với token mới
      const reconnected = await prisma.channel.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", apiToken, feeRate: PLATFORM_FEE_RATE[name] },
      });
      res.json(reconnected);
      return;
    }

    const channel = await prisma.channel.create({
      data: {
        userId: req.ownerId!,
        channelName: name,
        apiToken,
        status: "ACTIVE",
        feeRate: PLATFORM_FEE_RATE[name], // % phí sàn mặc định để tạm tính
      },
    });
    res.status(201).json(channel);
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:id/disconnect — ngắt kết nối gian hàng
router.post("/:id/disconnect", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy kênh" });
      return;
    }
    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { status: "DISCONNECTED" },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:id/products — danh mục sản phẩm trên sàn (giả lập),
// kèm thông tin đã liên kết với sản phẩm gốc nào trong kho.
router.get("/:id/products", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy kênh" });
      return;
    }

    const catalog = MOCK_CATALOG[channel.channelName];
    const mappings = await prisma.productMapping.findMany({
      where: { channelId: channel.id },
      include: {
        product: {
          select: { id: true, skuCode: true, productName: true, quantityInStock: true },
        },
      },
    });
    const bySku = new Map(mappings.map((m) => [m.channelSku, m]));

    res.json({
      channel: {
        id: channel.id,
        channelName: channel.channelName,
        status: channel.status,
      },
      items: catalog.map((p) => {
        const m = bySku.get(p.channelSku);
        return {
          channelSku: p.channelSku,
          name: p.name,
          price: p.price,
          mapping: m
            ? {
                id: m.id,
                productId: m.product.id,
                productSku: m.product.skuCode,
                productName: m.product.productName,
                quantityInStock: m.product.quantityInStock,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
