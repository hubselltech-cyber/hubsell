import { Router } from "express";
import { Prisma, InventoryLogType } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

const router = Router();

// Kiểm tra một giá trị có phải số tiền hợp lệ (>= 0) không
function parseMoney(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || Number.isNaN(n) || n < 0) return null;
  return n;
}

// GET /api/products?page=1&pageSize=10&search=...
// Danh sách sản phẩm của user đang đăng nhập, có phân trang + tìm theo SKU/Tên.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    const where: Prisma.ProductWhereInput = {
      userId: req.ownerId!,
      ...(search
        ? {
            OR: [
              { skuCode: { contains: search, mode: "insensitive" } },
              { productName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({ items, total, page, pageSize, pageCount: Math.ceil(total / pageSize) });
  } catch (err) {
    next(err);
  }
});

// POST /api/products — Thêm sản phẩm mới kèm số lượng kho ban đầu.
// Tạo sản phẩm + ghi log nhập kho trong CÙNG một transaction.
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { skuCode, productName, costPrice, sellingPrice, initialQuantity } =
      req.body ?? {};

    if (typeof skuCode !== "string" || skuCode.trim().length === 0) {
      res.status(400).json({ error: "Vui lòng nhập mã SKU" });
      return;
    }
    if (typeof productName !== "string" || productName.trim().length === 0) {
      res.status(400).json({ error: "Vui lòng nhập tên sản phẩm" });
      return;
    }
    const cost = parseMoney(costPrice);
    const selling = parseMoney(sellingPrice);
    if (cost === null || selling === null) {
      res.status(400).json({ error: "Giá vốn / giá bán phải là số không âm" });
      return;
    }
    const initQty = Number(initialQuantity ?? 0);
    if (!Number.isInteger(initQty) || initQty < 0) {
      res.status(400).json({ error: "Số lượng kho ban đầu phải là số nguyên không âm" });
      return;
    }

    const sku = skuCode.trim().toUpperCase();

    // SKU không được trùng trong phạm vi user
    const existed = await prisma.product.findUnique({
      where: { userId_skuCode: { userId: req.ownerId!, skuCode: sku } },
    });
    if (existed) {
      res.status(409).json({ error: `Mã SKU "${sku}" đã tồn tại` });
      return;
    }

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          userId: req.ownerId!,
          skuCode: sku,
          productName: productName.trim(),
          costPrice: cost,
          sellingPrice: selling,
          quantityInStock: initQty,
        },
      });

      if (initQty > 0) {
        await tx.inventoryLog.create({
          data: {
            productId: created.id,
            changeQuantity: initQty,
            type: InventoryLogType.IMPORT,
            reason: "Nhập kho ban đầu khi tạo sản phẩm",
          },
        });
      }

      return created;
    });

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/products/:id — Cập nhật thông tin sản phẩm (không chỉnh tồn kho ở đây)
router.patch("/:id", async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findFirst({
      where: { id, userId: req.ownerId! },
    });
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm" });
      return;
    }

    const { skuCode, productName, costPrice, sellingPrice } = req.body ?? {};
    const data: Prisma.ProductUpdateInput = {};

    if (skuCode !== undefined) {
      if (typeof skuCode !== "string" || skuCode.trim().length === 0) {
        res.status(400).json({ error: "Mã SKU không hợp lệ" });
        return;
      }
      const sku = skuCode.trim().toUpperCase();
      if (sku !== product.skuCode) {
        const dup = await prisma.product.findUnique({
          where: { userId_skuCode: { userId: req.ownerId!, skuCode: sku } },
        });
        if (dup) {
          res.status(409).json({ error: `Mã SKU "${sku}" đã tồn tại` });
          return;
        }
      }
      data.skuCode = sku;
    }
    if (productName !== undefined) {
      if (typeof productName !== "string" || productName.trim().length === 0) {
        res.status(400).json({ error: "Tên sản phẩm không hợp lệ" });
        return;
      }
      data.productName = productName.trim();
    }
    if (costPrice !== undefined) {
      const cost = parseMoney(costPrice);
      if (cost === null) {
        res.status(400).json({ error: "Giá vốn phải là số không âm" });
        return;
      }
      data.costPrice = cost;
    }
    if (sellingPrice !== undefined) {
      const selling = parseMoney(sellingPrice);
      if (selling === null) {
        res.status(400).json({ error: "Giá bán phải là số không âm" });
        return;
      }
      data.sellingPrice = selling;
    }

    const updated = await prisma.product.update({ where: { id }, data });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
