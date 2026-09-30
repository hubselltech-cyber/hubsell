import { Router } from "express";
import { TransactionDirection } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { canSeeFinancials, type AuthRequest } from "../middleware/auth";
import {
  businessDayStart,
  dateKeyLabel,
  parseDateRange,
  toBusinessDateKey,
  type DateRangeFilter,
} from "../lib/date-range";
import { channelScope, hasChannelFilter, type ChannelScope } from "../lib/channel-filter";
// NGUỒN SỐ GỐC dùng chung (SSOT): mọi con số tiền của Tổng quan là SUM các
// trường computePnlRow — không tự tính totalAmount/InventoryLog riêng nữa
// (Lazada: totalAmount là giá GỐC chưa trừ voucher, InventoryLog không có vì
// sync không trừ kho → hai nguồn cũ đều cho số sai với Lazada).
// Từ 30/09/2026 các SUM đó đọc từ SỔ CÁI ĐƠN (kết quả computePnlRow đã ghi
// xuống database — docs/SO-CAI-DON.md); fetchPnlRows chỉ còn là đường cũ sau
// công tắc OVERVIEW_SOURCE=orders.
import { fetchPnlRows } from "./finance";
import { platformAdsSpend } from "../services/ads-spend";
import { RETURNING_STATUSES } from "../lib/finance-definitions";
import {
  gmvMaxRowsOf,
  overviewTotalsFromLedger,
  overviewTotalsFromRows,
  type OverviewTotals,
} from "../lib/overview-totals";
import { resolveReportSource, type ReportSource } from "../lib/report-source";
import {
  ensureLedgerFresh,
  ledgerOverviewBreakdown,
  ledgerSummary,
} from "../services/order-ledger";

const router = Router();

// Đơn HOÀN/TRẢ đang xử lý — nhận diện qua trục returnStatus (ĐỘC LẬP với
// shippingStatus). Đây là các đơn bị LOẠI khỏi ô trạng thái giao (DELIVERED…) và
// khỏi doanh thu, chỉ đếm ở ô "Hoàn/Trả". Nhờ vậy phễu là một phân hoạch loại
// trừ nhau: Σ(ô trạng thái) + Hoàn/Trả = tổng đơn (hết cảnh đếm trùng).
// RECEIVED (đã quét nhận, chưa nhập kho) vẫn là hoàn CHƯA xử lý xong — chỉ khi
// nhập kho (RECEIVED_INTACT) hoặc chốt khiếu nại thì đơn mới rời nhóm này.
// Định nghĩa nằm ở lib/finance-definitions.ts — dùng chung với Báo cáo dòng tiền.
const RETURNING_IN = { in: RETURNING_STATUSES };

// Bucket theo NGÀY GIỜ VN — toBusinessDateKey/businessDayStart/dateKeyLabel
// import từ date-range.ts (ghim UTC+7, không lệ thuộc giờ máy chủ Render=UTC).

/**
 * Bộ tổng ĐƠN TÍNH DOANH THU của một phạm vi (lib/overview-totals.ts) theo nguồn:
 *   - "ledger" (mặc định từ 30/09/2026): SUM + GROUP BY trong database trên sổ
 *     cái đơn — RAM không kéo đơn, không có phanh 20.000. `fresh` = tính nốt
 *     dòng bẩn của khoảng đó trước (tối đa 500 đơn), còn dư → ledgerPending.
 *   - "orders" (đường cũ, giữ 1 tuần sau công tắc OVERVIEW_SOURCE=orders):
 *     fetchPnlRows kéo đơn theo trang, cộng bằng JS, có phanh (truncated).
 * `byDaySince`: chuỗi ngày chỉ cần từ mốc này (trục biểu đồ); `summaryOnly`:
 * chỉ cần tổng (kỳ trước) — bỏ hai bảng bóc.
 */
export async function loadOverviewTotals(
  source: ReportSource,
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  opts: {
    byDaySince?: string;
    summaryOnly?: boolean;
    fresh?: { range: DateRangeFilter | undefined };
  } = {}
): Promise<{ totals: OverviewTotals; truncated: boolean; ledgerPending: number }> {
  if (source === "orders") {
    const { rows, truncated } = await fetchPnlRows(scope, range, { lean: true });
    return { totals: overviewTotalsFromRows(rows), truncated, ledgerPending: 0 };
  }
  let ledgerPending = 0;
  if (opts.fresh) {
    const fresh = await ensureLedgerFresh(scope, opts.fresh.range, { maxInline: 500 });
    ledgerPending = fresh.dirty + fresh.staleVersion;
  }
  const [summary, breakdown] = await Promise.all([
    ledgerSummary(scope, range),
    opts.summaryOnly
      ? Promise.resolve({ byChannelId: new Map(), byDay: new Map() })
      : ledgerOverviewBreakdown(scope, range, { byDaySince: opts.byDaySince }),
  ]);
  return { totals: overviewTotalsFromLedger(summary, breakdown), truncated: false, ledgerPending };
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
    // Nguồn số: sổ cái đơn (mặc định) hay đường cũ kéo đơn (?source=orders /
    // OVERVIEW_SOURCE=orders) — hai đường cho cùng kết quả.
    const source = resolveReportSource(req.query.source, process.env.OVERVIEW_SOURCE);
    /** Người không được xem tài chính giữ 0 để không rò số. */
    const fin = (v: number) => (seesFinancials ? v : 0);

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

    // KHUNG TRỤC NGÀY của biểu đồ — tính trước để chỉ xin chuỗi ngày trong
    // đúng khung đó. Bám bộ lọc người dùng chọn; không lọc thì lấy 14 ngày gần
    // nhất. Trần 90 điểm để khoảng dài (cả năm) không làm vỡ trục X. Mốc
    // đầu/cuối đều là 00:00 GIỜ VN (businessDayStart) — không dùng setHours
    // theo giờ máy chủ.
    const MAX_POINTS = 90;
    const TREND_DAYS = 14;
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
    const trendStart = new Date(chartEnd.getTime() - (TREND_DAYS - 1) * DAY_MS);

    // 1) Toàn bộ đơn PHÁT SINH trong kỳ, TRỪ đơn hủy VÀ đơn đang hoàn/trả.
    // Đơn hoàn không được coi là bán thành công → không tính vào doanh thu/giá
    // vốn/chuỗi ngày (thống nhất với ô "Hoàn/Trả" ở phễu bên dưới).
    // NGUỒN SỐ: computePnlRow — cùng tập đơn + cùng công thức với Lãi/Lỗ
    // Thực Hiện và Báo cáo dòng tiền. Sổ cái: làm tươi một lần cho cả khoảng
    // mà trang này đọc (kỳ trước + cửa sổ trend + kỳ hiện tại).
    const freshRange = range
      ? {
          gte: new Date(Math.min(prevRange!.gte.getTime(), trendStart.getTime())),
          lte: range.lte,
        }
      : undefined;
    const { totals, truncated, ledgerPending } = await loadOverviewTotals(source, scope, range, {
      byDaySince: toBusinessDateKey(chartStart),
      fresh: { range: freshRange },
    });
    const active = totals.active;

    // Doanh thu GMV phát sinh = Σ "Giá trị đơn hàng" (doanh thu gốc) — khớp
    // thẻ "Tổng giá trị sản phẩm" của Báo cáo dòng tiền cùng kỳ lọc.
    const totalRevenue = active.revenueGross;

    // Số MÓN bán ra = Σ quantity các dòng hàng trên CÙNG rổ đơn phát sinh —
    // dòng phụ cạnh số đơn ở thẻ Đơn hàng (anh Trung 20/09). Đếm theo dòng sàn
    // ghi: combo = 1 món, quà tặng 0đ vẫn đếm; đơn cũ chưa có OrderItem góp 0.
    const itemQuantity = active.totalQuantity;

    /*
     * SÀN KHẤU TRỪ — TOÀN BỘ khoản sàn giữ lại trên mỗi đơn = Giá trị đơn −
     * "Tổng tiền" sàn báo (phí + thuế + voucher/xu + chênh lệch VC + nạp ví −
     * trợ giá; đơn chưa quyết toán chỉ gồm voucher đã biết — không ước %).
     * Nhờ vậy chuỗi trừ dọc của Tổng quan khớp thác nước Báo cáo dòng tiền.
     */
    const totalPlatformFee = fin(active.platformDeduction);

    // Bóc riêng THUẾ SÀN (TNCN + VAT thu hộ) khỏi con số khấu trừ gộp — donut
    // Cơ cấu Chi phí cần tách "Phí dịch vụ sàn" và "Thuế sàn" thành 2 khoản
    // theo chuẩn P&L. Phí dịch vụ = totalPlatformFee − totalPlatformTax.
    const totalPlatformTax = fin(active.platformTax);

    /*
     * BÓC TÁCH SÀN KHẤU TRỪ theo ĐÚNG các dòng của thẻ "Tổng giá trị sản phẩm"
     * bên Báo cáo dòng tiền (/api/finance/analytics) — cùng bucket, cùng nhãn,
     * cùng nguồn computePnlRow. "Khác" = phần dư totalPlatformFee chưa rơi vào
     * bucket nào (lệch đối soát/khoản sàn chưa bóc cột, đã cấn trợ giá sàn) để
     * Σ các mảnh donut = đúng totalPlatformFee, không rơi rớt đồng nào.
     */
    const feeService = fin(
      active.feeFixedPayment + active.feeService + active.feeSellerProtection
    );
    const feeAffiliate = fin(active.feeAffiliate);
    const feeVoucher = fin(active.sellerVoucher);
    const feeShippingDiff = fin(active.shippingFeeDiff);
    const feeAdWallet = fin(active.adWalletTopup);
    const feeSubsidy = fin(active.platformSubsidy);
    // TIỀN HOÀN TRẢ KHÁCH của đơn còn tính doanh thu (hoàn tiền 100%/1 phần
    // khách giữ hàng, trả 1 vài SKU) — engine hoàn tiền đã trừ khoản này khỏi
    // platformRevenue nên nó NẰM TRONG totalPlatformFee; tách bucket riêng để
    // donut không nhét nhầm vào "Khấu trừ khác của sàn" (sai bản chất).
    const feeRefund = fin(active.refundedAmount);
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
    const totalCost = fin(active.costSnapshot);

    const grossProfit = totalRevenue - totalCost;

    // 2b) Chi phí hoạt động: tổng + phân bổ theo loại
    const expenses = seesFinancials
      ? await prisma.operatingExpense.findMany({
          // CHỈ khoản CHI mới là chi phí; khoản THU vận hành không tính vào đây.
          where: { userId: ownerId, direction: TransactionDirection.EXPENSE, expenseDate: range },
          select: { category: true, type: true, amount: true, expenseDate: true },
        })
      : [];
    // QUẢNG CÁO SÀN tự đồng bộ (bảng AdSpend) — cùng hàm, cùng luật "sàn đã trừ
    // trong đơn thì chỉ tham chiếu" với Báo cáo dòng tiền. Trước 30/09/2026 Tổng
    // quan KHÔNG trừ khoản này nên lợi nhuận cao hơn Báo cáo dòng tiền đúng bằng
    // tiền quảng cáo sàn (tháng 8 tài khoản demo lệch 617.858 ₫). Gộp vào nhóm
    // ADS của chi phí hoạt động để thác nước, donut và thẻ Tổng Chi phí cùng đổi.
    const platformAds = seesFinancials
      ? await platformAdsSpend(scope, range, gmvMaxRowsOf(totals))
      : null;
    const platformAdsTotal = platformAds?.total ?? 0;

    const totalOperatingExpense =
      expenses.reduce((sum, e) => sum + Number(e.amount), 0) + platformAdsTotal;
    const expenseByCategoryMap = new Map<string, number>();
    if (platformAdsTotal > 0) expenseByCategoryMap.set("ADS", platformAdsTotal);
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

    // ĐƠN CHƯA CÓ GIÁ VỐN không tính vào lợi nhuận (anh Trung chốt 30/09/2026),
    // vẫn nằm trong doanh thu / phí sàn. Thác nước thêm một bậc để vẫn đóng.
    const missingCost = seesFinancials
      ? { orderCount: active.missingCostCount, excludedProfit: active.missingCostExcludedProfit }
      : { orderCount: 0, excludedProfit: 0 };

    // Lợi nhuận thuần = Lợi nhuận gộp − Phí sàn − Chi phí hoạt động − phần lợi
    // nhuận của đơn chưa có giá vốn
    const netProfit =
      grossProfit - totalPlatformFee - totalOperatingExpense - missingCost.excludedProfit;

    // 3) Doanh thu theo ngày (kể cả ngày không có đơn để đường biểu đồ liền mạch)
    //    trên khung trục ngày đã tính ở đầu hàm.
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
      for (const [day, d] of totals.byDay) {
        const dayCost = d.costSnapshot + d.platformDeduction;
        if (dayCost) addCost(day, dayCost);
      }
    }
    for (const [day, amount] of platformAds?.byDay ?? []) addCost(day, amount);
    for (const e of expenses) {
      addCost(toBusinessDateKey(e.expenseDate), Number(e.amount));
    }

    // SỐ ĐƠN THEO NGÀY — rổ ĐƠN PHÁT SINH (loại hủy & hoàn/trả — CÙNG rổ với
    // doanh thu, anh Trung 26/08: thẻ Đơn hàng 20 mà caption "tính trên 19 đơn"
    // là tự mâu thuẫn trong một khối); tổng MỌI trạng thái đã có phễu vận hành lo.
    const revenueByDay: {
      date: string;
      label: string;
      revenue: number;
      orders: number;
      cost: number;
    }[] = [];
    for (let t = chartStart.getTime(); t <= chartEnd.getTime(); t += DAY_MS) {
      const key = toBusinessDateKey(new Date(t));
      const d = totals.byDay.get(key);
      revenueByDay.push({
        date: key,
        label: dateKeyLabel(key),
        revenue: d?.revenueGross ?? 0,
        orders: d?.count ?? 0,
        cost: costMap.get(key) ?? 0,
      });
    }

    /*
     * 3a) TREND 14 NGÀY cho sparkline chìm dưới 4 thẻ KPI — luôn là 14 ngày
     * liền trước tính đến NGÀY CUỐI kỳ lọc, để xem "Hôm nay" (1 điểm) thẻ vẫn
     * có đường sóng. Kỳ lọc đã ≥ 14 ngày thì cắt đuôi revenueByDay (cùng
     * bucket, cùng computePnlRow → số y hệt); ngắn hơn thì chạy MỘT lượt đọc
     * RIÊNG trên cửa sổ 14 ngày — tuyệt đối không đụng bộ tổng của kỳ nên mọi
     * tổng số phía trên giữ nguyên 100%.
     */
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
      const trendRange = {
        gte: trendStart,
        lte: new Date(chartEnd.getTime() + DAY_MS - 1),
      };
      const [{ totals: trendTotals }, trendExpenses] = await Promise.all([
        loadOverviewTotals(source, scope, trendRange, {
          byDaySince: toBusinessDateKey(trendStart),
        }),
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
      ]);
      const tCost = new Map<string, number>();
      const bump = (m: Map<string, number>, k: string, v: number) =>
        m.set(k, (m.get(k) ?? 0) + v);
      if (seesFinancials) {
        const trendAds = await platformAdsSpend(scope, trendRange, gmvMaxRowsOf(trendTotals));
        for (const [day, amount] of trendAds.byDay) bump(tCost, day, amount);
        // Cùng công thức chi phí/ngày với costMap phía trên
        for (const [day, d] of trendTotals.byDay) bump(tCost, day, d.costSnapshot + d.platformDeduction);
      }
      for (const e of trendExpenses) {
        bump(tCost, toBusinessDateKey(e.expenseDate), Number(e.amount));
      }
      trend = [];
      for (let t = trendStart.getTime(); t <= chartEnd.getTime(); t += DAY_MS) {
        const key = toBusinessDateKey(new Date(t));
        const d = trendTotals.byDay.get(key);
        trend.push({
          date: key,
          label: dateKeyLabel(key),
          revenue: d?.revenueGross ?? 0,
          orders: d?.count ?? 0,
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
          const [{ totals: prev }, cnt] = await Promise.all([
            loadOverviewTotals(source, scope, prevRange, { summaryOnly: true }),
            prisma.order.count({
              where: { channel: scope, createdAt: prevRange },
            }),
          ]);
          // activeOrderCount = rổ đơn phát sinh (khớp thẻ Đơn hàng); orderCount
          // mọi trạng thái giữ lại cho ai cần so tổng phễu.
          return {
            totalRevenue: prev.active.revenueGross,
            orderCount: cnt,
            activeOrderCount: prev.active.count,
          };
        })()
      : null;

    // 4) Đóng góp của TỪNG GIAN HÀNG (không tính đơn đã hủy).
    //    Gom theo channelId chứ không theo tên sàn: hai gian cùng nằm trên
    //    Shopee phải là hai dòng riêng thì chủ shop mới biết gian nào đang gánh
    //    doanh thu, gian nào đang lỗ. Gom từ CÙNG bộ tổng (SSOT) — cùng công
    //    thức doanh thu với ô tổng phía trên, không groupBy totalAmount riêng.
    const channels = await prisma.channel.findMany({
      where: { userId: ownerId },
      select: { id: true, channelName: true, shopName: true },
    });
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const ordersByChannel = [...totals.byChannelId.entries()]
      .map(([channelId, g]) => {
        const c = channelById.get(channelId);
        return {
          channelId,
          channelName: c?.channelName ?? "KHÁC",
          shopName: c?.shopName ?? "Gian hàng đã xoá",
          count: g.count,
          revenue: g.revenueGross,
        };
      })
      .sort((a, b) => b.count - a.count);

    // SALES được xem doanh thu và sản lượng của gian mình phụ trách, nhưng
    // KHÔNG được biết giá vốn, lợi nhuận hay chi phí vận hành của shop. Cắt các
    // trường đó ngay ở đây thay vì chỉ ẩn trên giao diện — ẩn ở giao diện thì mở
    // tab Network là đọc được nguyên số liệu.
    if (!seesFinancials) {
      res.json({
        source,
        ledgerPending,
        activeOrderCount: active.count,
        itemQuantity,
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
      truncated, // chỉ đường cũ: kỳ vượt 20.000 đơn — số là cận dưới
      source, // "ledger" | "orders"
      ledgerPending, // đơn trong khoảng trang đọc còn chờ sổ cái tính lại (0 khi đọc đường cũ)
      activeOrderCount: active.count,
      itemQuantity,
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
      // Phần quảng cáo sàn tự đồng bộ ĐÃ nằm trong totalOperatingExpense + nhóm ADS.
      platformAdsSpend: platformAdsTotal,
      missingCost, // đơn chưa có giá vốn — bị loại khỏi lợi nhuận, UI ghi rõ số đơn
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
