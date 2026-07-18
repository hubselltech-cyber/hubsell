import { Router } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { findMarketplaceProduct } from "../mockMarketplace";

const router = Router();

// GET /api/mappings — toàn bộ liên kết của user
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const mappings = await prisma.productMapping.findMany({
      where: { channel: { userId: req.ownerId! } },
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: { id: true, skuCode: true, productName: true } },
        channel: { select: { id: true, channelName: true } },
      },
    });
    res.json(mappings);
  } catch (err) {
    next(err);
  }
});

// POST /api/mappings — nối một SKU trên sàn vào một sản phẩm gốc.
// Nếu SKU sàn đó đã được nối trước đây → chuyển sang sản phẩm gốc mới (upsert).
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { productId, channelId, channelSku } = req.body ?? {};

    if (
      typeof productId !== "string" ||
      typeof channelId !== "string" ||
      typeof channelSku !== "string" ||
      !productId || !channelId || !channelSku
    ) {
      res.status(400).json({ error: "Thiếu productId / channelId / channelSku" });
      return;
    }

    // Cả kênh lẫn sản phẩm phải thuộc về user đang đăng nhập
    const [channel, product] = await Promise.all([
      prisma.channel.findFirst({ where: { id: channelId, userId: req.ownerId! } }),
      prisma.product.findFirst({ where: { id: productId, userId: req.ownerId! } }),
    ]);
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy kênh" });
      return;
    }
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm gốc" });
      return;
    }

    // SKU phải tồn tại trong danh mục của sàn (giả lập)
    const mp = findMarketplaceProduct(channel.channelName, channelSku);
    if (!mp) {
      res.status(404).json({ error: `SKU "${channelSku}" không có trên sàn ${channel.channelName}` });
      return;
    }

    const mapping = await prisma.productMapping.upsert({
      where: { channelId_channelSku: { channelId, channelSku } },
      create: {
        productId,
        channelId,
        channelSku,
        channelProductName: mp.name,
      },
      update: { productId, channelProductName: mp.name },
      include: {
        product: { select: { id: true, skuCode: true, productName: true } },
      },
    });

    res.status(201).json(mapping);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/mappings/:id — gỡ liên kết
router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    const mapping = await prisma.productMapping.findFirst({
      where: { id: req.params.id, channel: { userId: req.ownerId! } },
    });
    if (!mapping) {
      res.status(404).json({ error: "Không tìm thấy liên kết" });
      return;
    }
    await prisma.productMapping.delete({ where: { id: mapping.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
