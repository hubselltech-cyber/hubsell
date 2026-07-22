import { Router } from "express";
import crypto from "crypto";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAdmin, type AuthRequest } from "../auth";
import {
  CHANNEL_LABEL,
  PLATFORM_FEE_RATE,
  TOKEN_PREFIX,
} from "../mockMarketplace";

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
      include: { _count: { select: { orders: true, channelProducts: true } } },
    });

    // Số sản phẩm sàn ĐÃ KHỚP mã SKU về kho gốc (productId != null) — khác với
    // tổng channelProducts (gồm cả sản phẩm sàn chưa liên kết).
    const matched = await prisma.channelProduct.groupBy({
      by: ["channelId"],
      where: {
        productId: { not: null },
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
      },
      _count: { _all: true },
    });
    const matchedByChannel = new Map(
      matched.map((m) => [m.channelId, m._count._all])
    );

    const isAdmin = req.userRole === "ADMIN";
    res.json(
      channels.map((c) => ({
        ...c,
        apiToken: isAdmin ? c.apiToken : null,
        matchedProductCount: matchedByChannel.get(c.id) ?? 0,
      }))
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
    const { channelName, shopName } = req.body ?? {};
    if (!CONNECTABLE.includes(channelName)) {
      res.status(400).json({
        error: "Kênh không hợp lệ. Chọn một trong: SHOPEE, LAZADA, TIKTOK, OFFLINE",
      });
      return;
    }
    const name = channelName as ChannelName;

    // Tên gian hàng là thứ phân biệt hai shop trên cùng một sàn. Không có tên
    // thì lấy tên sàn làm mặc định (trường hợp shop chỉ có một gian).
    const finalShopName =
      typeof shopName === "string" && shopName.trim()
        ? shopName.trim()
        : CHANNEL_LABEL[name];
    if (finalShopName.length > 60) {
      res.status(400).json({ error: "Tên gian hàng tối đa 60 ký tự" });
      return;
    }

    // MỘT SÀN CÓ THỂ CÓ NHIỀU GIAN HÀNG — chỉ chặn khi TRÙNG TÊN trong cùng
    // sàn, vì lúc đó chủ shop không phân biệt được hai gian trên giao diện.
    const existing = await prisma.channel.findFirst({
      where: {
        userId: req.ownerId!,
        channelName: name,
        shopName: finalShopName,
      },
    });

    const apiToken = `${TOKEN_PREFIX[name]}_${crypto.randomBytes(20).toString("hex")}`;

    if (existing) {
      if (existing.status === "ACTIVE") {
        res.status(409).json({
          error: `Đã có gian hàng "${finalShopName}" trên ${CHANNEL_LABEL[name]}. Đặt tên khác để kết nối thêm gian.`,
        });
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
        shopName: finalShopName,
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

/**
 * PATCH /api/channels/:id — sửa thông tin một gian hàng.
 * Body: { shopName?: string, feeRate?: number }
 *
 * feeRate nhận dạng THẬP PHÂN (0.12 = 12%), không phải phần trăm. Mỗi gian
 * hàng thương lượng được mức phí khác nhau nên để chỉnh riêng từng gian.
 */
router.patch("/:id", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { shopName, feeRate } = req.body ?? {};

    const channel = await prisma.channel.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng" });
      return;
    }

    const data: { shopName?: string; feeRate?: number } = {};

    if (shopName !== undefined) {
      if (typeof shopName !== "string" || !shopName.trim()) {
        res.status(400).json({ error: "Tên gian hàng không được để trống" });
        return;
      }
      const name = shopName.trim();
      if (name.length > 60) {
        res.status(400).json({ error: "Tên gian hàng tối đa 60 ký tự" });
        return;
      }
      // Trùng tên trong cùng sàn thì không phân biệt được trên giao diện.
      // Loại chính nó ra để đổi tên thành chính nó vẫn hợp lệ.
      const duplicated = await prisma.channel.findFirst({
        where: {
          userId: req.ownerId!,
          channelName: channel.channelName,
          shopName: name,
          id: { not: channel.id },
        },
        select: { id: true },
      });
      if (duplicated) {
        res.status(409).json({
          error: `Đã có gian hàng tên "${name}" trên ${CHANNEL_LABEL[channel.channelName]}`,
        });
        return;
      }
      data.shopName = name;
    }

    if (feeRate !== undefined) {
      const rate = typeof feeRate === "string" ? Number(feeRate) : feeRate;
      if (typeof rate !== "number" || Number.isNaN(rate) || rate < 0 || rate > 1) {
        res.status(400).json({
          error: "Phí sàn phải nằm trong khoảng 0% đến 100%",
        });
        return;
      }
      data.feeRate = rate;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "Không có thông tin nào để cập nhật" });
      return;
    }

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data,
      include: { _count: { select: { orders: true, channelProducts: true } } },
    });
    res.json(updated);
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


export default router;
