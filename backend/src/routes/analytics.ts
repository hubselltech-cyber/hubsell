import { Router } from "express";
import { prisma } from "../prisma";
import { canSeeFinancials, type AuthRequest } from "../auth";
import { parseDateRange } from "../date-range";
import { channelScope, hasChannelFilter } from "../channel-filter";
import { FEE_SELECT, orderPlatformFee } from "../order-fee";

const router = Router();

// Đổi Date → chuỗi "yyyy-mm-dd" theo giờ máy chủ
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// GET /api/analytics — Báo cáo kinh doanh. ADMIN và SALES vào được, WAREHOUSE thì không.
// Lọc theo ?from=&to=&channelId= — channelId là GIAN HÀNG cụ thể, không phải sàn.
// Các chỉ số tính trên đơn có trạng thái DELIVERED (Đã giao):
//   - Tổng Doanh thu  = tổng totalAmount                    (ADMIN + SALES)
//   - Tổng Giá vốn    = Σ (số lượng đã bán × costPrice)      (chỉ ADMIN)
//     (dựa vào InventoryLog trừ kho gắn với đơn — đơn cũ không có log thì giá vốn = 0)
//   - Lợi nhuận gộp   = Doanh thu − Giá vốn                  (chỉ ADMIN)
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    // Bộ lọc khoảng thời gian (?from=&to=) — undefined nghĩa là xem toàn bộ
    const range = parseDateRange(req.query);
    const scope = channelScope(req);
    const filteredByChannel = hasChannelFilter(req);
    const seesFinancials = canSeeFinancials(req.userRole);

    // 1) Toàn bộ đơn ĐÃ GIAO trong phạm vi đang xem
    const delivered = await prisma.order.findMany({
      where: {
        channel: scope,
        shippingStatus: "DELIVERED",
        createdAt: range,
      },
      select: {
        id: true,
        totalAmount: true,
        createdAt: true,
        ...FEE_SELECT,
      },
    });

    const totalRevenue = delivered.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0
    );

    /*
     * PHÍ SÀN — khoản sàn giữ lại trên mỗi đơn.
     * Trước đây trang Tổng quan bỏ qua hẳn khoản này, nên Lợi nhuận thuần ở đây
     * cao hơn thực tế và lệch hẳn với trang Báo cáo dòng tiền. Nay dùng chung
     * đúng một công thức với bên đó (src/order-fee.ts).
     */
    const totalPlatformFee = seesFinancials
      ? delivered.reduce((sum, o) => sum + orderPlatformFee(o).fee, 0)
      : 0;

    // 2) Giá vốn: các log TRỪ kho thuộc những đơn đã giao.
    // Người không được xem tài chính thì bỏ hẳn truy vấn này — vừa khỏi tốn công
    // vừa chắc chắn không có đường nào rò con số ra ngoài.
    const deliveredIds = delivered.map((o) => o.id);
    const deductionLogs = seesFinancials && deliveredIds.length
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

    // 2b) Chi phí hoạt động: tổng + phân bổ theo loại
    const expenses = seesFinancials
      ? await prisma.operatingExpense.findMany({
          where: { userId: ownerId, expenseDate: range },
          select: { category: true, amount: true, expenseDate: true },
        })
      : [];
    const totalOperatingExpense = expenses.reduce(
      (sum, e) => sum + Number(e.amount),
      0
    );
    const expenseByCategoryMap = new Map<string, number>();
    for (const e of expenses) {
      expenseByCategoryMap.set(
        e.category,
        (expenseByCategoryMap.get(e.category) ?? 0) + Number(e.amount)
      );
    }
    const expensesByCategory = Array.from(expenseByCategoryMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    // Lợi nhuận thuần = Lợi nhuận gộp − Phí sàn − Chi phí hoạt động
    const netProfit = grossProfit - totalPlatformFee - totalOperatingExpense;

    // 3) Doanh thu theo ngày (kể cả ngày không có đơn để đường biểu đồ liền mạch)
    //    Khung thời gian bám đúng bộ lọc người dùng chọn; không lọc thì lấy 14
    //    ngày gần nhất. Trần 90 điểm để khoảng dài (cả năm) không làm vỡ trục X.
    const MAX_POINTS = 90;
    const revenueMap = new Map<string, number>();
    const dayOfOrder = new Map<string, string>(); // orderId → "yyyy-mm-dd"
    for (const o of delivered) {
      const key = toDateKey(o.createdAt);
      dayOfOrder.set(o.id, key);
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + Number(o.totalAmount));
    }

    /*
     * CHI PHÍ THEO NGÀY = giá vốn hàng bán trong ngày + chi phí vận hành ghi
     * nhận trong ngày. Cùng công thức với chuỗi ở Báo cáo dòng tiền để hai biểu
     * đồ không kể hai câu chuyện khác nhau.
     */
    const costMap = new Map<string, number>();
    const addCost = (key: string, amount: number) =>
      costMap.set(key, (costMap.get(key) ?? 0) + amount);

    for (const log of deductionLogs) {
      const key = log.orderId ? dayOfOrder.get(log.orderId) : undefined;
      if (!key) continue;
      addCost(key, Math.abs(log.changeQuantity) * Number(log.product.costPrice));
    }
    for (const e of expenses) {
      addCost(toDateKey(e.expenseDate), Number(e.amount));
    }

    const chartEnd = range ? new Date(range.lte) : new Date();
    chartEnd.setHours(0, 0, 0, 0);
    let chartStart: Date;
    if (range) {
      chartStart = new Date(range.gte);
      chartStart.setHours(0, 0, 0, 0);
    } else {
      chartStart = new Date(chartEnd);
      chartStart.setDate(chartEnd.getDate() - 13);
    }
    const spanDays =
      Math.round((chartEnd.getTime() - chartStart.getTime()) / 86_400_000) + 1;
    if (spanDays > MAX_POINTS) {
      chartStart = new Date(chartEnd);
      chartStart.setDate(chartEnd.getDate() - (MAX_POINTS - 1));
    }

    const revenueByDay: {
      date: string;
      label: string;
      revenue: number;
      cost: number;
    }[] = [];
    for (
      const d = new Date(chartStart);
      d <= chartEnd;
      d.setDate(d.getDate() + 1)
    ) {
      const key = toDateKey(d);
      revenueByDay.push({
        date: key,
        label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        revenue: revenueMap.get(key) ?? 0,
        cost: costMap.get(key) ?? 0,
      });
    }

    // 4) Đóng góp của TỪNG GIAN HÀNG (không tính đơn đã hủy).
    //    Gom theo channelId chứ không theo tên sàn: hai gian cùng nằm trên
    //    Shopee phải là hai dòng riêng thì chủ shop mới biết gian nào đang gánh
    //    doanh thu, gian nào đang lỗ.
    const byChannel = await prisma.order.groupBy({
      by: ["channelId"],
      _count: { _all: true },
      _sum: { totalAmount: true },
      where: {
        channel: scope,
        shippingStatus: { not: "CANCELLED" },
        createdAt: range,
      },
    });
    const channels = await prisma.channel.findMany({
      where: { userId: ownerId },
      select: { id: true, channelName: true, shopName: true },
    });
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const ordersByChannel = byChannel
      .map((g) => {
        const c = channelById.get(g.channelId);
        return {
          channelId: g.channelId,
          channelName: c?.channelName ?? "KHÁC",
          shopName: c?.shopName ?? "Gian hàng đã xoá",
          count: g._count._all,
          revenue: Number(g._sum.totalAmount ?? 0),
        };
      })
      .sort((a, b) => b.count - a.count);

    // SALES được xem doanh thu và sản lượng của gian mình phụ trách, nhưng
    // KHÔNG được biết giá vốn, lợi nhuận hay chi phí vận hành của shop. Cắt các
    // trường đó ngay ở đây thay vì chỉ ẩn trên giao diện — ẩn ở giao diện thì mở
    // tab Network là đọc được nguyên số liệu.
    if (!seesFinancials) {
      res.json({
        deliveredOrderCount: delivered.length,
        totalRevenue,
        // Bỏ trường cost khỏi từng điểm — SALES chỉ được thấy đường doanh thu
        revenueByDay: revenueByDay.map(({ date, label, revenue }) => ({
          date,
          label,
          revenue,
        })),
        ordersByChannel,
        financialsHidden: true,
      });
      return;
    }

    res.json({
      deliveredOrderCount: delivered.length,
      totalRevenue,
      totalCost,
      totalPlatformFee,
      grossProfit,
      totalOperatingExpense,
      netProfit,
      expensesByCategory,
      revenueByDay,
      ordersByChannel,
      financialsHidden: false,
      // Chi phí vận hành (mặt bằng, lương, marketing…) ghi ở cấp TOÀN SHOP, không
      // gắn với gian hàng nào. Khi đang lọc một gian, con số này vẫn là của cả
      // shop nên Lợi nhuận thuần không phải lãi riêng của gian đó — frontend
      // dựa vào cờ này để cảnh báo, tránh chủ shop đọc nhầm.
      operatingExpenseIsShopWide: filteredByChannel,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
