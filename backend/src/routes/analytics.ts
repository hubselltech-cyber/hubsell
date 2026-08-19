import { Router } from "express";
import { ReturnStatus, ShippingStatus, TransactionDirection } from "@prisma/client";
import { prisma } from "../prisma";
import { canSeeFinancials, type AuthRequest } from "../auth";
import {
  businessDayStart,
  dateKeyLabel,
  parseDateRange,
  toBusinessDateKey,
} from "../date-range";
import { channelScope, hasChannelFilter } from "../channel-filter";
// NGUỒN SỐ GỐC dùng chung (SSOT): mọi con số tiền của Tổng quan là SUM các
// trường computePnlRow — không tự tính totalAmount/InventoryLog riêng nữa
// (Lazada: totalAmount là giá GỐC chưa trừ voucher, InventoryLog không có vì
// sync không trừ kho → hai nguồn cũ đều cho số sai với Lazada).
import { computePnlRow, fetchPnlOrders } from "./finance";

const router = Router();

// Đơn HOÀN/TRẢ đang xử lý — nhận diện qua trục returnStatus (ĐỘC LẬP với
// shippingStatus). Đây là các đơn bị LOẠI khỏi ô trạng thái giao (DELIVERED…) và
// khỏi doanh thu, chỉ đếm ở ô "Hoàn/Trả". Nhờ vậy phễu là một phân hoạch loại
// trừ nhau: Σ(ô trạng thái) + Hoàn/Trả = tổng đơn (hết cảnh đếm trùng).
// RECEIVED (đã quét nhận, chưa nhập kho) vẫn là hoàn CHƯA xử lý xong — chỉ khi
// nhập kho (RECEIVED_INTACT) hoặc chốt khiếu nại thì đơn mới rời nhóm này.
const RETURNING_IN = {
  in: [ReturnStatus.AWAITING, ReturnStatus.RECEIVED, ReturnStatus.DAMAGED],
};
const RETURNING_SET = new Set<ReturnStatus>(RETURNING_IN.in);

// Bucket theo NGÀY GIỜ VN — toBusinessDateKey/businessDayStart/dateKeyLabel
// import từ date-range.ts (ghim UTC+7, không lệ thuộc giờ máy chủ Render=UTC).

/**
 * Đếm số đơn (MỌI trạng thái) theo NGÀY GIỜ VN trong [gte, lte]. Chỉ kéo cột
 * createdAt, cửa sổ luôn bị chặn ≤ 90 ngày bởi nơi gọi nên không lo phình.
 */
async function countOrdersByDay(
  scope: ReturnType<typeof channelScope>,
  gte: Date,
  lte: Date
): Promise<Map<string, number>> {
  const rows = await prisma.order.findMany({
    where: { channel: scope, createdAt: { gte, lte } },
    select: { createdAt: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = toBusinessDateKey(r.createdAt);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
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
//   - Doanh thu       = Σ revenueGross (Giá trị đơn hàng)      (ADMIN + SALES)
//   - Sàn khấu trừ    = Σ (revenueGross − platformRevenue)      (chỉ ADMIN)
//   - Giá vốn         = Σ costSnapshot (cùng orderCost SSOT)    (chỉ ADMIN)
//   - Lợi nhuận thuần = Doanh thu − Giá vốn − Sàn khấu trừ − Chi phí vận hành
//     (= Σ profitAfterTax − chi phí vận hành — khớp Báo cáo dòng tiền)
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    // Bộ lọc khoảng thời gian (?from=&to=) — undefined nghĩa là xem toàn bộ
    const range = parseDateRange(req.query);
    const scope = channelScope(req);
    const filteredByChannel = hasChannelFilter(req);
    const seesFinancials = canSeeFinancials(req);

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
    // NGUỒN SỐ: computePnlRow — cùng tập đơn + cùng công thức với Lãi/Lỗ
    // Thực Hiện và Báo cáo dòng tiền.
    const activeRows = (await fetchPnlOrders(scope, range))
      .map(computePnlRow)
      .filter(
        (r) =>
          r.shippingStatus !== ShippingStatus.CANCELLED &&
          !RETURNING_SET.has(r.returnStatus)
      );

    // Doanh thu GMV phát sinh = Σ "Giá trị đơn hàng" (doanh thu gốc) — khớp
    // thẻ "Tổng giá trị sản phẩm" của Báo cáo dòng tiền cùng kỳ lọc.
    const totalRevenue = activeRows.reduce((sum, r) => sum + r.revenueGross, 0);

    /*
     * SÀN KHẤU TRỪ — TOÀN BỘ khoản sàn giữ lại trên mỗi đơn = Giá trị đơn −
     * "Tổng tiền" sàn báo (phí + thuế + voucher/xu + chênh lệch VC + nạp ví −
     * trợ giá; đơn chưa quyết toán chỉ gồm voucher đã biết — không ước %).
     * Nhờ vậy chuỗi trừ dọc của Tổng quan khớp thác nước Báo cáo dòng tiền.
     */
    const totalPlatformFee = seesFinancials
      ? activeRows.reduce((sum, r) => sum + (r.revenueGross - r.platformRevenue), 0)
      : 0;

    // Bóc riêng THUẾ SÀN (TNCN + VAT thu hộ) khỏi con số khấu trừ gộp — donut
    // Cơ cấu Chi phí cần tách "Phí dịch vụ sàn" và "Thuế sàn" thành 2 khoản
    // theo chuẩn P&L. Phí dịch vụ = totalPlatformFee − totalPlatformTax.
    const totalPlatformTax = seesFinancials
      ? activeRows.reduce((sum, r) => sum + r.platformTax, 0)
      : 0;

    /*
     * BÓC TÁCH SÀN KHẤU TRỪ theo ĐÚNG các dòng của thẻ "Tổng giá trị sản phẩm"
     * bên Báo cáo dòng tiền (/api/finance/analytics) — cùng bucket, cùng nhãn,
     * cùng nguồn computePnlRow. "Khác" = phần dư totalPlatformFee chưa rơi vào
     * bucket nào (lệch đối soát/khoản sàn chưa bóc cột, đã cấn trợ giá sàn) để
     * Σ các mảnh donut = đúng totalPlatformFee, không rơi rớt đồng nào.
     */
    const sumRows = (pick: (r: (typeof activeRows)[number]) => number) =>
      seesFinancials ? activeRows.reduce((s, r) => s + pick(r), 0) : 0;
    const feeService = sumRows(
      (r) => r.feeFixedPayment + r.feeService + r.feeSellerProtection
    );
    const feeAffiliate = sumRows((r) => r.feeAffiliate);
    const feeVoucher = sumRows((r) => r.sellerVoucher);
    const feeShippingDiff = sumRows((r) => r.shippingFeeDiff);
    const feeAdWallet = sumRows((r) => r.adWalletTopup);
    const feeSubsidy = sumRows((r) => r.platformSubsidy);
    // TIỀN HOÀN TRẢ KHÁCH của đơn còn tính doanh thu (hoàn tiền 100%/1 phần
    // khách giữ hàng, trả 1 vài SKU) — engine hoàn tiền đã trừ khoản này khỏi
    // platformRevenue nên nó NẰM TRONG totalPlatformFee; tách bucket riêng để
    // donut không nhét nhầm vào "Khấu trừ khác của sàn" (sai bản chất).
    const feeRefund = sumRows((r) => r.refundedAmount);
    const feeOther =
      totalPlatformFee -
      (feeService +
        feeAffiliate +
        totalPlatformTax +
        feeVoucher +
        feeShippingDiff +
        feeAdWallet +
        feeRefund -
        feeSubsidy);
    const platformFeeBreakdown = {
      service: feeService, // phí cố định + thanh toán + dịch vụ + PiShip
      affiliate: feeAffiliate,
      tax: totalPlatformTax,
      voucher: feeVoucher,
      shippingDiff: feeShippingDiff,
      adWallet: feeAdWallet,
      refund: feeRefund, // tiền hoàn trả khách (đơn hoàn còn tính doanh thu)
      other: feeOther, // đã cấn trợ giá sàn (subsidy làm giảm khấu trừ)
    };

    // 2) Giá vốn = Σ costSnapshot (OrderItem.costPriceAtSale, fallback log trừ
    // kho) — cùng công thức orderCost với mọi báo cáo tài chính. Người không
    // được xem tài chính giữ 0 để không rò số.
    const totalCost = seesFinancials
      ? activeRows.reduce((sum, r) => sum + r.costSnapshot, 0)
      : 0;

    const grossProfit = totalRevenue - totalCost;

    // 2b) Chi phí hoạt động: tổng + phân bổ theo loại
    const expenses = seesFinancials
      ? await prisma.operatingExpense.findMany({
          // CHỈ khoản CHI mới là chi phí; khoản THU vận hành không tính vào đây.
          where: { userId: ownerId, direction: TransactionDirection.EXPENSE, expenseDate: range },
          select: { category: true, type: true, amount: true, expenseDate: true },
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

    // Chi phí vận hành NGOÀI quảng cáo, tách BIẾN ĐỔI / CỐ ĐỊNH theo cờ type —
    // ADS đứng riêng một khoản trên donut nên loại khỏi cả hai nhóm này.
    // Σ(ads + variable + fixed) = totalOperatingExpense, không rơi rớt đồng nào.
    let operatingVariableExpense = 0;
    let operatingFixedExpense = 0;
    for (const e of expenses) {
      if (e.category === "ADS") continue;
      if (e.type === "FIXED") operatingFixedExpense += Number(e.amount);
      else operatingVariableExpense += Number(e.amount);
    }

    // Lợi nhuận thuần = Lợi nhuận gộp − Phí sàn − Chi phí hoạt động
    const netProfit = grossProfit - totalPlatformFee - totalOperatingExpense;

    // 3) Doanh thu theo ngày (kể cả ngày không có đơn để đường biểu đồ liền mạch)
    //    Khung thời gian bám đúng bộ lọc người dùng chọn; không lọc thì lấy 14
    //    ngày gần nhất. Trần 90 điểm để khoảng dài (cả năm) không làm vỡ trục X.
    const MAX_POINTS = 90;
    const revenueMap = new Map<string, number>();
    for (const r of activeRows) {
      const key = toBusinessDateKey(r.createdAt);
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + r.revenueGross);
    }

    /*
     * CHI PHÍ THEO NGÀY = giá vốn + SÀN KHẤU TRỪ của đơn phát sinh trong ngày
     * + chi phí vận hành ghi nhận trong ngày. Đủ cả ba khoản để Σ cột chi phí
     * khớp đúng thẻ "Tổng Chi phí" và sơ đồ Bóc tách dòng tiền — thiếu phí sàn
     * thì ngày chưa liên kết SKU cột chi phí về 0 dù sàn vẫn đang khấu trừ.
     */
    const costMap = new Map<string, number>();
    const addCost = (key: string, amount: number) =>
      costMap.set(key, (costMap.get(key) ?? 0) + amount);

    if (seesFinancials) {
      for (const r of activeRows) {
        const dayCost = r.costSnapshot + (r.revenueGross - r.platformRevenue);
        if (dayCost) addCost(toBusinessDateKey(r.createdAt), dayCost);
      }
    }
    for (const e of expenses) {
      addCost(toBusinessDateKey(e.expenseDate), Number(e.amount));
    }

    // Mốc đầu/cuối trục ngày đều là 00:00 GIỜ VN (businessDayStart) — không
    // dùng setHours theo giờ máy chủ.
    const DAY_MS = 86_400_000;
    const chartEnd = businessDayStart(range ? range.lte : new Date());
    let chartStart = range
      ? businessDayStart(range.gte)
      : new Date(chartEnd.getTime() - 13 * DAY_MS);
    const spanDays =
      Math.round((chartEnd.getTime() - chartStart.getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_POINTS) {
      chartStart = new Date(chartEnd.getTime() - (MAX_POINTS - 1) * DAY_MS);
    }

    // SỐ ĐƠN THEO NGÀY — đếm MỌI trạng thái (kể cả hủy) cho khớp thẻ "Đơn hàng"
    // (orderCount bên dưới cũng đếm mọi trạng thái). Chỉ kéo createdAt trong
    // đúng khung trục X (≤ 90 ngày) nên nhẹ, không phụ thuộc "xem toàn bộ".
    const ordersMap = await countOrdersByDay(
      scope,
      chartStart,
      new Date(chartEnd.getTime() + DAY_MS - 1)
    );

    const revenueByDay: {
      date: string;
      label: string;
      revenue: number;
      orders: number;
      cost: number;
    }[] = [];
    for (let t = chartStart.getTime(); t <= chartEnd.getTime(); t += DAY_MS) {
      const key = toBusinessDateKey(new Date(t));
      revenueByDay.push({
        date: key,
        label: dateKeyLabel(key),
        revenue: revenueMap.get(key) ?? 0,
        orders: ordersMap.get(key) ?? 0,
        cost: costMap.get(key) ?? 0,
      });
    }

    /*
     * 3a) TREND 14 NGÀY cho sparkline chìm dưới 4 thẻ KPI — luôn là 14 ngày
     * liền trước tính đến NGÀY CUỐI kỳ lọc, để xem "Hôm nay" (1 điểm) thẻ vẫn
     * có đường sóng. Kỳ lọc đã ≥ 14 ngày thì cắt đuôi revenueByDay (cùng
     * bucket, cùng computePnlRow → số y hệt); ngắn hơn thì chạy MỘT truy vấn
     * RIÊNG trên cửa sổ 14 ngày — tuyệt đối không đụng tập activeRows nên mọi
     * tổng số phía trên giữ nguyên 100%.
     */
    const TREND_DAYS = 14;
    type TrendPoint = {
      date: string;
      label: string;
      revenue: number;
      orders: number;
      cost: number;
    };
    let trend: TrendPoint[];
    if (revenueByDay.length >= TREND_DAYS) {
      trend = revenueByDay.slice(-TREND_DAYS);
    } else {
      const trendStart = new Date(
        chartEnd.getTime() - (TREND_DAYS - 1) * DAY_MS
      );
      const trendRange = {
        gte: trendStart,
        lte: new Date(chartEnd.getTime() + DAY_MS - 1),
      };
      const [trendRows, trendExpenses, trendOrders] = await Promise.all([
        fetchPnlOrders(scope, trendRange),
        seesFinancials
          ? prisma.operatingExpense.findMany({
              where: {
                userId: ownerId,
                direction: TransactionDirection.EXPENSE,
                expenseDate: trendRange,
              },
              select: { amount: true, expenseDate: true },
            })
          : Promise.resolve([]),
        countOrdersByDay(scope, trendRange.gte, trendRange.lte),
      ]);
      const tRevenue = new Map<string, number>();
      const tCost = new Map<string, number>();
      const bump = (m: Map<string, number>, k: string, v: number) =>
        m.set(k, (m.get(k) ?? 0) + v);
      for (const r of trendRows.map(computePnlRow)) {
        if (
          r.shippingStatus === ShippingStatus.CANCELLED ||
          RETURNING_SET.has(r.returnStatus)
        )
          continue;
        const key = toBusinessDateKey(r.createdAt);
        bump(tRevenue, key, r.revenueGross);
        if (seesFinancials) {
          // Cùng công thức chi phí/ngày với costMap phía trên
          bump(tCost, key, r.costSnapshot + (r.revenueGross - r.platformRevenue));
        }
      }
      for (const e of trendExpenses) {
        bump(tCost, toBusinessDateKey(e.expenseDate), Number(e.amount));
      }
      trend = [];
      for (let t = trendStart.getTime(); t <= chartEnd.getTime(); t += DAY_MS) {
        const key = toBusinessDateKey(new Date(t));
        trend.push({
          date: key,
          label: dateKeyLabel(key),
          revenue: tRevenue.get(key) ?? 0,
          orders: trendOrders.get(key) ?? 0,
          cost: tCost.get(key) ?? 0,
        });
      }
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
          // Cùng công thức doanh thu với kỳ hiện tại (Σ revenueGross qua
          // computePnlRow) — so sánh mới cùng thước đo, hết lệch giả.
          const [prevRows, cnt] = await Promise.all([
            fetchPnlOrders(scope, prevRange),
            prisma.order.count({
              where: { channel: scope, createdAt: prevRange },
            }),
          ]);
          const prevRevenue = prevRows
            .map(computePnlRow)
            .filter(
              (r) =>
                r.shippingStatus !== ShippingStatus.CANCELLED &&
                !RETURNING_SET.has(r.returnStatus)
            )
            .reduce((s, r) => s + r.revenueGross, 0);
          return { totalRevenue: prevRevenue, orderCount: cnt };
        })()
      : null;

    // 4) Đóng góp của TỪNG GIAN HÀNG (không tính đơn đã hủy).
    //    Gom theo channelId chứ không theo tên sàn: hai gian cùng nằm trên
    //    Shopee phải là hai dòng riêng thì chủ shop mới biết gian nào đang gánh
    //    doanh thu, gian nào đang lỗ. Gom từ activeRows (SSOT) — cùng công
    //    thức doanh thu với ô tổng phía trên, không groupBy totalAmount riêng.
    const byChannelAgg = new Map<string, { count: number; revenue: number }>();
    for (const r of activeRows) {
      const b = byChannelAgg.get(r.channelId) ?? { count: 0, revenue: 0 };
      b.count += 1;
      b.revenue += r.revenueGross;
      byChannelAgg.set(r.channelId, b);
    }
    const channels = await prisma.channel.findMany({
      where: { userId: ownerId },
      select: { id: true, channelName: true, shopName: true },
    });
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const ordersByChannel = [...byChannelAgg.entries()]
      .map(([channelId, g]) => {
        const c = channelById.get(channelId);
        return {
          channelId,
          channelName: c?.channelName ?? "KHÁC",
          shopName: c?.shopName ?? "Gian hàng đã xoá",
          count: g.count,
          revenue: g.revenue,
        };
      })
      .sort((a, b) => b.count - a.count);

    // SALES được xem doanh thu và sản lượng của gian mình phụ trách, nhưng
    // KHÔNG được biết giá vốn, lợi nhuận hay chi phí vận hành của shop. Cắt các
    // trường đó ngay ở đây thay vì chỉ ẩn trên giao diện — ẩn ở giao diện thì mở
    // tab Network là đọc được nguyên số liệu.
    if (!seesFinancials) {
      res.json({
        activeOrderCount: activeRows.length,
        totalRevenue,
        // Bỏ trường cost khỏi từng điểm — SALES chỉ được thấy đường doanh thu
        revenueByDay: revenueByDay.map(({ date, label, revenue, orders }) => ({
          date,
          label,
          revenue,
          orders,
        })),
        trend: trend.map(({ date, label, revenue, orders }) => ({
          date,
          label,
          revenue,
          orders,
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
      activeOrderCount: activeRows.length,
      totalRevenue,
      totalCost,
      totalPlatformFee,
      totalPlatformTax,
      platformFeeBreakdown,
      grossProfit,
      totalOperatingExpense,
      operatingVariableExpense,
      operatingFixedExpense,
      netProfit,
      expensesByCategory,
      revenueByDay,
      trend,
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
