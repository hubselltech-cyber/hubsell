import { Router } from "express";
import { InventoryLogType } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

const router = Router();

// POST /api/inventory/adjust — Điều chỉnh xuất/nhập kho thủ công.
// Dùng DATABASE TRANSACTION: cập nhật tồn kho + ghi InventoryLog phải cùng
// thành công hoặc cùng thất bại, để số liệu không bao giờ lệch nhau.
router.post("/adjust", async (req: AuthRequest, res, next) => {
  try {
    const { productId, type, quantity, reason } = req.body ?? {};

    if (typeof productId !== "string" || productId.length === 0) {
      res.status(400).json({ error: "Thiếu mã sản phẩm" });
      return;
    }
    if (type !== "IMPORT" && type !== "EXPORT") {
      res.status(400).json({ error: "Loại điều chỉnh phải là IMPORT (nhập) hoặc EXPORT (xuất)" });
      return;
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      res.status(400).json({ error: "Số lượng phải là số nguyên dương" });
      return;
    }
    if (reason !== undefined && typeof reason !== "string") {
      res.status(400).json({ error: "Lý do không hợp lệ" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Khoá dòng sản phẩm để tránh 2 người điều chỉnh cùng lúc gây sai số
      const rows = await tx.$queryRaw<
        { id: string; quantityInStock: number }[]
      >`SELECT "id", "quantityInStock" FROM "Product" WHERE "id" = ${productId} AND "userId" = ${req.ownerId!} FOR UPDATE`;

      const product = rows[0];
      if (!product) {
        throw Object.assign(new Error("Không tìm thấy sản phẩm"), { statusCode: 404 });
      }

      const delta = type === "IMPORT" ? qty : -qty;
      const newQuantity = product.quantityInStock + delta;

      if (newQuantity < 0) {
        throw Object.assign(
          new Error(
            `Không đủ hàng để xuất: tồn kho hiện tại ${product.quantityInStock}, muốn xuất ${qty}`
          ),
          { statusCode: 400 }
        );
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: { quantityInStock: newQuantity },
      });

      const log = await tx.inventoryLog.create({
        data: {
          productId,
          changeQuantity: delta,
          type: type === "IMPORT" ? InventoryLogType.IMPORT : InventoryLogType.EXPORT,
          reason: reason?.trim() || (type === "IMPORT" ? "Nhập kho thủ công" : "Xuất kho thủ công"),
        },
      });

      return { product: updated, log };
    });

    res.json(result);
  } catch (err) {
    // Lỗi nghiệp vụ có statusCode riêng (404 / 400)
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    next(err);
  }
});

// GET /api/inventory/logs?productId=... — Lịch sử xuất nhập kho của một sản phẩm
router.get("/logs", async (req: AuthRequest, res, next) => {
  try {
    const productId = typeof req.query.productId === "string" ? req.query.productId : "";
    if (!productId) {
      res.status(400).json({ error: "Thiếu mã sản phẩm" });
      return;
    }

    // Chỉ xem được log sản phẩm của chính mình
    const product = await prisma.product.findFirst({
      where: { id: productId, userId: req.ownerId! },
      select: { id: true },
    });
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm" });
      return;
    }

    const logs = await prisma.inventoryLog.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;
