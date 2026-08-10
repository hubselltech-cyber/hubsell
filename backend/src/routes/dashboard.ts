import { Router } from "express";
import { prisma } from "../prisma";
import { canSeeFinancials, type AuthRequest } from "../auth";
import { channelScope } from "../channel-filter";

const router = Router();

// GET /api/dashboard/summary
// Số liệu tổng quan. SALES chỉ thấy phần thuộc gian hàng mình phụ trách.
router.get("/summary", async (req: AuthRequest, res, next) => {
  try {
    const userId = req.ownerId!;
    const scope = channelScope(req);

    const [productCount, orderCount, channelCount, revenueAgg, recentOrders] =
      await Promise.all([
        prisma.product.count({ where: { userId } }),
        prisma.order.count({ where: { channel: scope } }),
        // Đếm đúng số gian trong tầm nhìn của người đang xem: SALES phụ trách 1
        // gian mà thẻ báo "5 kênh bán" thì con số đó chẳng nói lên điều gì về
        // công việc của họ. channelScope() vốn đã là điều kiện lọc của bảng
        // Channel nên dùng lại được nguyên vẹn.
        prisma.channel.count({ where: scope }),
        prisma.order.aggregate({
          _sum: { totalAmount: true },
          where: { paymentStatus: "PAID", channel: scope },
        }),
        prisma.order.findMany({
          where: { channel: scope },
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
      financialsHidden: !canSeeFinancials(req),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
