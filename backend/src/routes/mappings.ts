import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

const router = Router();

/**
 * TẦNG 2 — SẢN PHẨM SÀN & LIÊN KẾT VỀ KHO GỐC
 *
 * Nguồn dữ liệu là bảng đệm `ChannelProduct`: danh mục thô kéo từ từng gian
 * hàng về, KHÔNG phải sản phẩm kho. `productId = null` là chưa liên kết.
 *
 * Nhiều dòng ở đây trỏ chung một `productId` chính là cách 3 gian hàng khác
 * tên map về một mã gốc: đơn từ shop nào đổ về cũng trừ đúng kho đó.
 */

/** Đưa dữ liệu ra ngoài kèm thông tin gian hàng và sản phẩm gốc đã nối. */
const INCLUDE = {
  channel: { select: { id: true, channelName: true, shopName: true } },
  product: {
    select: { id: true, skuCode: true, productName: true, quantityInStock: true },
  },
} as const;

/**
 * GET /api/mappings — danh sách sản phẩm sàn ở tầng đệm.
 * Query: channelId, linked=yes|no, search, page, pageSize
 */
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const channelId =
      typeof req.query.channelId === "string" ? req.query.channelId : "";
    const linked = typeof req.query.linked === "string" ? req.query.linked : "";
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const scope: Prisma.ChannelProductWhereInput = {
      channel: {
        userId: req.ownerId!,
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
      },
      ...(channelId ? { channelId } : {}),
      ...(search
        ? {
            OR: [
              { channelSku: { contains: search, mode: "insensitive" as const } },
              { productName: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const where: Prisma.ChannelProductWhereInput = {
      ...scope,
      ...(linked === "yes"
        ? { productId: { not: null } }
        : linked === "no"
          ? { productId: null }
          : {}),
    };

    const [total, items, linkedCount, unlinkedCount] = await Promise.all([
      prisma.channelProduct.count({ where }),
      prisma.channelProduct.findMany({
        where,
        // Chưa liên kết lên đầu — đó là việc đang cần làm
        orderBy: [
          { productId: { sort: "asc", nulls: "first" } },
          { channelSku: "asc" },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: INCLUDE,
      }),
      // Đếm trên `scope` (KHÔNG kèm điều kiện linked) để hai thẻ lọc luôn có
      // số, kể cả khi đang đứng ở một bên.
      prisma.channelProduct.count({ where: { ...scope, productId: { not: null } } }),
      prisma.channelProduct.count({ where: { ...scope, productId: null } }),
    ]);

    res.json({
      items,
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      counts: {
        all: linkedCount + unlinkedCount,
        linked: linkedCount,
        unlinked: unlinkedCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mappings/link — nối MỘT HOẶC NHIỀU sản phẩm sàn về một SKU gốc.
 * Body: { channelProductIds: string[], productId: string }
 *
 * Nhận mảng vì đây là thao tác chính: 3 gian hàng khác tên cùng bán một mẫu
 * thì tích cả 3 rồi nối một lần, thay vì mở từng dòng chọn lại.
 */
router.post("/link", async (req: AuthRequest, res, next) => {
  try {
    const { channelProductIds, productId } = req.body ?? {};
    if (!Array.isArray(channelProductIds) || channelProductIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn sản phẩm sàn nào" });
      return;
    }
    if (channelProductIds.length > 200) {
      res.status(400).json({ error: "Tối đa 200 sản phẩm mỗi lần liên kết" });
      return;
    }
    if (typeof productId !== "string" || !productId) {
      res.status(400).json({ error: "Chưa chọn sản phẩm gốc để nối về" });
      return;
    }

    // Sản phẩm gốc phải thuộc chính shop này
    const product = await prisma.product.findFirst({
      where: { id: productId, userId: req.ownerId! },
      select: { id: true, skuCode: true, productName: true },
    });
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm gốc" });
      return;
    }

    const result = await prisma.channelProduct.updateMany({
      where: {
        id: { in: channelProductIds },
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
      },
      data: { productId: product.id },
    });

    res.json({ linked: result.count, product });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mappings/unlink — gỡ liên kết, đưa về lại trạng thái chưa nối.
 * Body: { channelProductIds: string[] }
 *
 * Chỉ đặt productId = null chứ KHÔNG xoá dòng: sản phẩm vẫn đang bán trên sàn,
 * xoá đi thì lần đồng bộ sau lại kéo về, mà lịch sử liên kết thì mất.
 */
router.post("/unlink", async (req: AuthRequest, res, next) => {
  try {
    const { channelProductIds } = req.body ?? {};
    if (!Array.isArray(channelProductIds) || channelProductIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn sản phẩm sàn nào" });
      return;
    }

    const result = await prisma.channelProduct.updateMany({
      where: {
        id: { in: channelProductIds },
        channel: {
          userId: req.ownerId!,
          ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
        },
      },
      data: { productId: null },
    });

    res.json({ unlinked: result.count });
  } catch (err) {
    next(err);
  }
});

export default router;
