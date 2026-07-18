import { Router } from "express";
import { InventoryLogType, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { mockSettlement } from "../mockMarketplace";

const router = Router();

const VALID_STATUSES = ["PENDING", "SHIPPING", "DELIVERED", "CANCELLED"] as const;
type ShippingStatus = (typeof VALID_STATUSES)[number];

// GET /api/orders?page=1&pageSize=20&shippingStatus=PENDING&channelId=...
// Danh sách đơn hàng gom về từ TẤT CẢ các kênh, có bộ lọc + phân trang.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const shippingStatus =
      typeof req.query.shippingStatus === "string" ? req.query.shippingStatus : "";
    const channelId =
      typeof req.query.channelId === "string" ? req.query.channelId : "";

    // Phân quyền multi-store: nhân viên bị giới hạn kênh thì chỉ thấy đơn của kênh được gán.
    // Nếu lọc theo 1 kênh cụ thể mà kênh đó không nằm trong phạm vi → không trả gì.
    const channelWhere: Prisma.ChannelWhereInput = { userId: req.ownerId! };
    if (req.allowedChannelIds) {
      const allowed = req.allowedChannelIds;
      channelWhere.id = channelId
        ? { in: allowed.filter((id) => id === channelId) }
        : { in: allowed };
    } else if (channelId) {
      channelWhere.id = channelId;
    }

    const where: Prisma.OrderWhereInput = {
      channel: channelWhere,
      ...(shippingStatus ? { shippingStatus } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { channel: { select: { channelName: true } } },
      }),
    ]);

    res.json({ items, total, page, pageSize, pageCount: Math.ceil(total / pageSize) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/orders/:id/status — chuyển trạng thái vận chuyển của đơn.
// Đặc biệt: chuyển sang CANCELLED (Đã hủy) sẽ TỰ ĐỘNG CỘNG HOÀN LẠI tồn kho
// cho các sản phẩm gốc mà đơn này từng trừ, và ghi log hệ thống — trong 1 transaction.
router.patch("/:id/status", async (req: AuthRequest, res, next) => {
  try {
    const { shippingStatus } = req.body ?? {};
    if (!VALID_STATUSES.includes(shippingStatus)) {
      res.status(400).json({
        error: `Trạng thái không hợp lệ. Chọn một trong: ${VALID_STATUSES.join(", ")}`,
      });
      return;
    }
    const newStatus = shippingStatus as ShippingStatus;

    const order = await prisma.order.findFirst({
      where: { id: req.params.id, channel: { userId: req.ownerId! } },
      include: { channel: { select: { channelName: true } } },
    });
    if (!order) {
      res.status(404).json({ error: "Không tìm thấy đơn hàng" });
      return;
    }
    // Nhân viên bị giới hạn kênh không được xử lý đơn của kênh ngoài phạm vi
    if (req.allowedChannelIds && !req.allowedChannelIds.includes(order.channelId)) {
      res.status(403).json({ error: "Bạn không có quyền xử lý đơn của kênh này" });
      return;
    }
    if (order.shippingStatus === "CANCELLED") {
      res.status(409).json({ error: "Đơn đã hủy — không thể đổi trạng thái nữa" });
      return;
    }
    if (order.shippingStatus === newStatus) {
      res.status(400).json({ error: "Đơn đang ở trạng thái này rồi" });
      return;
    }

    // Trường hợp thường: chỉ đổi trạng thái
    if (newStatus !== "CANCELLED") {
      // GĐ2 — QUYẾT TOÁN: đơn chuyển sang "Đã giao" ⇒ bóc tách số liệu tài chính
      // THỰC TẾ do sàn trả về (phí cố định, phí dịch vụ, phí thanh toán, trợ giá)
      // và ghi đè số tạm tính. Báo cáo dòng tiền dùng số này.
      let settlementData: Prisma.OrderUpdateInput = {};
      if (newStatus === "DELIVERED" && !order.isSettled) {
        const s = mockSettlement(
          order.channel.channelName,
          Number(order.totalAmount),
          order.orderCode
        );
        settlementData = {
          isSettled: true,
          settledAt: new Date(),
          fixedFee: s.fixedFee,
          serviceFee: s.serviceFee,
          paymentFee: s.paymentFee,
          affiliateFee: s.affiliateFee,
          sellerVoucher: s.sellerVoucher,
          shippingFeeDiff: s.shippingFeeDiff,
          platformSubsidy: s.platformSubsidy,
          actualPayout: s.actualPayout,
        };
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { shippingStatus: newStatus, ...settlementData },
        include: { channel: { select: { channelName: true } } },
      });
      res.json({ order: updated, restored: [] });
      return;
    }

    // Trường hợp HỦY ĐƠN: hoàn kho trong 1 transaction
    const result = await prisma.$transaction(async (tx) => {
      // Tìm các log TRỪ kho gắn với đơn này (changeQuantity < 0)
      const deductions = await tx.inventoryLog.findMany({
        where: { orderId: order.id, changeQuantity: { lt: 0 } },
        include: { product: { select: { id: true, productName: true } } },
      });

      const restored: {
        productName: string;
        restoredQuantity: number;
        newQuantity: number;
      }[] = [];

      for (const log of deductions) {
        const qty = Math.abs(log.changeQuantity);
        const updatedProduct = await tx.product.update({
          where: { id: log.productId },
          data: { quantityInStock: { increment: qty } },
        });
        await tx.inventoryLog.create({
          data: {
            productId: log.productId,
            changeQuantity: qty,
            type: InventoryLogType.SYNC,
            reason: `Hoàn kho tự động do hủy đơn ${order.orderCode}`,
            orderId: order.id,
          },
        });
        restored.push({
          productName: log.product.productName,
          restoredQuantity: qty,
          newQuantity: updatedProduct.quantityInStock,
        });
      }

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { shippingStatus: "CANCELLED" },
        include: { channel: { select: { channelName: true } } },
      });

      return { order: updatedOrder, restored };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
