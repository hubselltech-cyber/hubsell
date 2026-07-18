import { Router } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";

const router = Router();

// Đổi Date → chuỗi "yyyy-mm-dd" theo giờ máy chủ
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// GET /api/analytics — Báo cáo tài chính (CHỈ ADMIN).
// Các chỉ số tính trên đơn có trạng thái DELIVERED (Đã giao):
//   - Tổng Doanh thu  = tổng totalAmount
//   - Tổng Giá vốn    = Σ (số lượng đã bán × costPrice sản phẩm gốc)
//     (dựa vào InventoryLog trừ kho gắn với đơn — đơn cũ không có log thì giá vốn = 0)
//   - Lợi nhuận gộp   = Doanh thu − Giá vốn
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;

    // 1) Toàn bộ đơn ĐÃ GIAO của shop
    const delivered = await prisma.order.findMany({
      where: { channel: { userId: ownerId }, shippingStatus: "DELIVERED" },
      select: { id: true, totalAmount: true, createdAt: true },
    });

    const totalRevenue = delivered.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0
    );

    // 2) Giá vốn: các log TRỪ kho thuộc những đơn đã giao
    const deliveredIds = delivered.map((o) => o.id);
    const deductionLogs = deliveredIds.length
      ? await prisma.inventoryLog.findMany({
          where: { orderId: { in: deliveredIds }, changeQuantity: { lt: 0 } },
          include: { product: { select: { costPrice: true } } },
        })
      : [];

    const totalCost = deductionLogs.reduce(
      (sum, log) =>
        sum + Math.abs(log.changeQuantity) * Number(log.product.costPrice),
      0
    );

    const grossProfit = totalRevenue - totalCost;

    // 3) Doanh thu theo ngày — 14 ngày gần nhất (kể cả ngày không có đơn)
    const days = 14;
    const today = new Date();
    const revenueMap = new Map<string, number>();
    for (const o of delivered) {
      const key = toDateKey(o.createdAt);
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + Number(o.totalAmount));
    }
    const revenueByDay: { date: string; label: string; revenue: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = toDateKey(d);
      revenueByDay.push({
        date: key,
        label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        revenue: revenueMap.get(key) ?? 0,
      });
    }

    // 4) Tỷ lệ đóng góp đơn hàng giữa các kênh (không tính đơn đã hủy)
    const byChannel = await prisma.order.groupBy({
      by: ["channelId"],
      _count: { _all: true },
      where: {
        channel: { userId: ownerId },
        shippingStatus: { not: "CANCELLED" },
      },
    });
    const channels = await prisma.channel.findMany({
      where: { userId: ownerId },
      select: { id: true, channelName: true },
    });
    const channelNameById = new Map(channels.map((c) => [c.id, c.channelName]));
    const ordersByChannel = byChannel
      .map((g) => ({
        channelName: channelNameById.get(g.channelId) ?? "KHÁC",
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      deliveredOrderCount: delivered.length,
      totalRevenue,
      totalCost,
      grossProfit,
      revenueByDay,
      ordersByChannel,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
