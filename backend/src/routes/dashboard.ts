import { Router } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

const router = Router();

// GET /api/dashboard/summary
// Số liệu tổng quan — chỉ tính dữ liệu của user đang đăng nhập.
router.get("/summary", async (req: AuthRequest, res, next) => {
  try {
    const userId = req.ownerId!;

    const [productCount, orderCount, channelCount, revenueAgg, recentOrders] =
      await Promise.all([
        prisma.product.count({ where: { userId } }),
        prisma.order.count({ where: { channel: { userId } } }),
        prisma.channel.count({ where: { userId } }),
        prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { paymentStatus: "PAID", channel: { userId } },
        }),
        prisma.order.findMany({
          where: { channel: { userId } },
          take: 5,
          orderBy: { createdAt: "desc" },
          include: { channel: { select: { channelName: true, shopName: true } } },
        }),
      ]);

    res.json({
      productCount,
      orderCount,
      channelCount,
      totalRevenue: revenueAgg._sum.totalAmount ?? 0,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        customerName: o.customerName,
        totalAmount: o.totalAmount,
        paymentStatus: o.paymentStatus,
        shippingStatus: o.shippingStatus,
        channelName: o.channel.channelName,
        shopName: o.channel.shopName,
        createdAt: o.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
