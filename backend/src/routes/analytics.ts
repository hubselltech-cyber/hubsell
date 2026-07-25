import { Router } from "express";
import { ReturnStatus, TransactionDirection } from "@prisma/client";
import { prisma } from "../prisma";
import { canSeeFinancials, type AuthRequest } from "../auth";
import { parseDateRange } from "../date-range";
import { channelScope, hasChannelFilter } from "../channel-filter";
import { FEE_SELECT, orderPlatformFee } from "../order-fee";

const router = Router();

// Đơn HOÀN/TRẢ đang xử lý — nhận diện qua trục returnStatus (ĐỘC LẬP với
// shippingStatus). Đây là các đơn bị LOẠI khỏi ô trạng thái giao (DELIVERED…) và
// khỏi doanh thu, chỉ đếm ở ô "Hoàn/Trả". Nhờ vậy phễu là một phân hoạch loại
// trừ nhau: Σ(ô trạng thái) + Hoàn/Trả = tổng đơn (hết cảnh đếm trùng).
const RETURNING_IN = { in: [ReturnStatus.AWAITING, ReturnStatus.DAMAGED] };

// Đổi Date → chuỗi "yyyy-mm-dd" theo giờ máy chủ
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// GET /api/analytics — Báo cáo kinh doanh REALTIME cho trang Tổng quan.
// ADMIN và SALES vào được, WAREHOUSE thì không.
// Lọc theo ?from=&to=&channelId= — channelId là GIAN HÀNG cụ thể, không phải sàn.
//
// HỆ QUY CHIẾU: đơn PHÁT SINH trong kỳ, trừ đơn HỦY (GMV dự kiến).
// Chọn vậy thay vì chỉ đơn Đã giao vì đây là màn hình điều hành trong ngày:
// vừa có đơn mới mà Doanh thu vẫn báo 0 thì chủ shop tưởng hệ thống hỏng.
// Mọi chỉ số (doanh thu, giá vốn, phí sàn, lợi nhuận) cùng một hệ quy chiếu
// để sơ đồ bóc tách trừ dọc ra đúng con số lợi nhuận — số liệu QUYẾT TOÁN
// theo đơn Đã giao đã có trang Báo cáo dòng tiền lo.
//   - Doanh thu       = Σ totalAmount đơn không hủy          (ADMIN + SALES)
//   - Giá vốn         = Σ (số lượng đã trừ kho × costPrice)   (chỉ ADMIN)
//     (dựa vào InventoryLog trừ kho gắn với đơn — đơn cũ không có log thì giá vốn = 0)
//   - Lợi nhuận dự kiến = Doanh thu − Giá vốn − Phí sàn − Chi phí vận hành (chỉ ADMIN)
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    // Bộ lọc khoảng thời gian (?from=&to=) — undefined nghĩa là xem toàn bộ
    const range = parseDateRange(req.query);
    const scope = channelScope(req);
    const filteredByChannel = hasChannelFilter(req);
    const seesFinancials = canSeeFinancials(req.userRole);

    /*
     * KỲ TRƯỚC LIỀN KỀ — để tính mức tăng/giảm.
     * Cùng độ dài, nằm ngay sát phía trước: xem "Hôm nay" thì đối chiếu với
     * "Hôm qua", xem "7 ngày" thì đối chiếu với 7 ngày trước đó.
     * Không lọc ngày thì không có gì để so sánh.
     */
    const prevRange = range
      ? (() => {
          const span = range.lte.getTime() - range.gte.getTime() + 1;
          return {
            gte: new Date(range.gte.getTime() - span),
            lte: new Date(range.lte.getTime() - span),
          };
        })()
      : undefined;

    // 1) Toàn bộ đơn PHÁT SINH trong kỳ, TRỪ đơn hủy VÀ đơn đang hoàn/trả.
    // Đơn hoàn không được coi là bán thành công → không tính vào doanh thu/giá
    // vốn/chuỗi ngày (thống nhất với ô "Hoàn/Trả" ở phễu bên dưới).
    const activeOrders = await prisma.order.findMany({
      where: {
        channel: scope,
        shippingStatus: { not: "CANCELLED" },
        NOT: { returnStatus: RETURNING_IN },
        createdAt: range,
      },
      select: {
        id: true,
        totalAmount: true,
        createdAt: true,
        ...FEE_SELECT,
      },
    });

    const totalRevenue = activeOrders.reduce(
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
      ? activeOrders.reduce((sum, o) => sum + orderPlatformFee(o).fee, 0)
      : 0;

    // 2) Giá vốn: các log TRỪ kho thuộc những đơn đang tính.
    // Người không được xem tài chính thì bỏ hẳn truy vấn này — vừa khỏi tốn công
    // vừa chắc chắn không có đường nào rò con số ra ngoài.
    const activeIds = activeOrders.map((o) => o.id);
    const deductionLogs = seesFinancials && activeIds.length
      ? await prisma.inventoryLog.findMany({
          where: { orderId: { in: activeIds }, changeQuantity: { lt: 0 } },
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
          // CHỈ khoản CHI mới là chi phí; khoản THU vận hành không tính vào đây.
          where: { userId: ownerId, direction: TransactionDirection.EXPENSE, expenseDate: range },
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
    for (const o of activeOrders) {
      const key = toDateKey(o.createdAt);
      dayOfOrder.set(o.id, key);
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + Number(o.totalAmount));
    }

    /*
     * CHI PHÍ THEO NGÀY = giá vốn các đơn phát sinh trong ngày + chi phí vận
     * hành ghi nhận trong ngày — cùng hệ quy chiếu GMV với chuỗi doanh thu
     * ngay phía trên để hai cột trong biểu đồ so được với nhau.
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

    /*
     * 3b) PHỄU VẬN HÀNH — đếm đơn theo từng trạng thái trong kỳ.
     * Đây là số liệu ĐƠN HÀNG (không phải tài chính) nên SALES cũng xem được,
     * tất nhiên vẫn bó trong các gian họ phụ trách.
     */
    const [statusGroups, returningCount] = await Promise.all([
      prisma.order.groupBy({
        by: ["shippingStatus"],
        _count: { _all: true },
        // LOẠI đơn đang hoàn khỏi các ô trạng thái giao: một đơn "vừa DELIVERED
        // vừa đang hoàn" chỉ được tính ở ô Hoàn/Trả, không đếm cả hai (hết trùng).
        where: { channel: scope, createdAt: range, NOT: { returnStatus: RETURNING_IN } },
      }),
      prisma.order.count({
        where: {
          channel: scope,
          createdAt: range,
          // Chỉ đếm hàng hoàn CHƯA xử lý xong (đang chờ nhận / chờ khiếu nại).
          // Đếm mọi đơn từng hoàn sẽ báo động cả những vụ đã giải quyết từ lâu.
          returnStatus: RETURNING_IN,
        },
      }),
    ]);
    const pipeline: Record<string, number> = {
      PENDING: 0,
      PROCESSED: 0,
      SHIPPING: 0,
      DELIVERED: 0,
      CANCELLED: 0,
      RETURNING: returningCount,
    };
    // Tổng đơn = Σ(ô trạng thái, đã loại đơn hoàn) + ô Hoàn/Trả. Bằng đúng tổng
    // phễu hiển thị và bằng số đơn thực tế trong kỳ — hết cảnh 3 con số lệch nhau.
    let orderCount = returningCount;
    for (const g of statusGroups) {
      pipeline[g.shippingStatus] = g._count._all;
      orderCount += g._count._all;
    }

    /*
     * 3c) SỐ LIỆU KỲ TRƯỚC để tính delta. Chỉ cần doanh thu và số đơn — hai chỉ
     * số duy nhất có nhãn tăng/giảm trên giao diện, nên không kéo thừa dữ liệu.
     */
    const previous = prevRange
      ? await (async () => {
          const [rev, cnt] = await Promise.all([
            prisma.order.aggregate({
              _sum: { totalAmount: true },
              where: {
                channel: scope,
                shippingStatus: { not: "CANCELLED" },
                NOT: { returnStatus: RETURNING_IN },
                createdAt: prevRange,
              },
            }),
            prisma.order.count({
              where: { channel: scope, createdAt: prevRange },
            }),
          ]);
          return {
            totalRevenue: Number(rev._sum.totalAmount ?? 0),
            orderCount: cnt,
          };
        })()
      : null;

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
        NOT: { returnStatus: RETURNING_IN },
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
        activeOrderCount: activeOrders.length,
        totalRevenue,
        // Bỏ trường cost khỏi từng điểm — SALES chỉ được thấy đường doanh thu
        revenueByDay: revenueByDay.map(({ date, label, revenue }) => ({
          date,
          label,
          revenue,
        })),
        ordersByChannel,
        orderCount,
        pipeline,
        previous,
        financialsHidden: true,
      });
      return;
    }

    res.json({
      activeOrderCount: activeOrders.length,
      totalRevenue,
      totalCost,
      totalPlatformFee,
      grossProfit,
      totalOperatingExpense,
      netProfit,
      expensesByCategory,
      revenueByDay,
      ordersByChannel,
      orderCount,
      pipeline,
      previous,
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
