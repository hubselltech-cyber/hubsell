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
