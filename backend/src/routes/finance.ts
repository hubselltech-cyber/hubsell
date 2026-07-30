import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import {
  ChannelName,
  ExpenseType,
  Prisma,
  ShippingDisputeStatus,
  ShippingStatus,
  TransactionDirection,
  WithdrawalSource,
} from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { syncChannelProducts } from "../marketplace/product-sync";
import { parseDateRange, type DateRangeFilter } from "../date-range";
import {
  channelScope,
  hasChannelFilter,
  type ChannelScope,
} from "../channel-filter";
import { FEE_SELECT, orderPlatformFee } from "../order-fee";
import {
  additionalTaxOn,
  getShopTaxConfig,
  PLATFORM_TAX_RATE,
  platformTaxOn,
} from "../tax-config";

const router = Router();

// Nhận file Excel vào bộ nhớ (không lưu ra đĩa), giới hạn 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Chỉ chấp nhận file Excel (.xlsx hoặc .xls)"));
    }
  },
});

// ============================================================
// MODULE TÀI CHÍNH CHUYÊN SÂU (Hubsell Finance)
// - GET  /orders-analysis : quét đơn Đã giao, tìm ĐƠN HÀNG LỖ
// - GET  /analytics       : doanh thu / lãi gộp / lãi thuần + chuỗi ngày
// (Thu/chi vận hành CRUD nằm ở routes/expenses.ts.)
// Giá vốn của đơn ưu tiên lấy từ OrderItem.costPriceAtSale (snapshot lúc bán);
// đơn cũ chưa có OrderItem thì fallback qua InventoryLog × giá vốn hiện tại.
// ============================================================

// Kiểu đơn đã kèm dữ liệu tính giá vốn
type DeliveredOrder = Prisma.OrderGetPayload<{
  include: {
    channel: { select: { channelName: true; shopName: true } };
    items: true;
    inventoryLogs: {
      include: { product: { select: { costPrice: true } } };
    };
  };
}>;

// Tính giá vốn (COGS) của một đơn + phát hiện SKU chưa cấu hình giá vốn
function orderCost(order: DeliveredOrder): {
  cost: number;
  missingCostPrice: boolean;
} {
  if (order.items.length > 0) {
    // Chuẩn: dùng snapshot giá vốn tại thời điểm bán
    const cost = order.items.reduce(
      (sum, it) => sum + it.quantity * Number(it.costPriceAtSale),
      0
    );
    // Có dòng nào giá vốn = 0 nghĩa là SKU đó chưa được nhập giá vốn
    const missingCostPrice = order.items.some(
      (it) => Number(it.costPriceAtSale) <= 0
    );
    return { cost, missingCostPrice };
  }

  // Fallback cho đơn cũ (trước khi có OrderItem): log trừ kho × giá vốn hiện tại
  const deductions = order.inventoryLogs.filter((l) => l.changeQuantity < 0);
  const cost = deductions.reduce(
    (sum, log) =>
      sum + Math.abs(log.changeQuantity) * Number(log.product?.costPrice ?? 0),
    0
  );
  const missingCostPrice =
    deductions.length === 0 ||
    deductions.some((l) => Number(l.product?.costPrice ?? 0) <= 0);
  return { cost, missingCostPrice };
}

// Doanh thu gốc (tổng tiền hàng) của một đơn — NGUỒN CÔNG THỨC DUY NHẤT, dùng
// chung cho /realized-pnl và /analytics để hai màn hình ước thuế sàn trên cùng
// một cơ sở. Ưu tiên tổng dòng sản phẩm; đơn cũ chưa có OrderItem thì suy từ
// totalAmount (đã trừ voucher shop) cộng ngược sellerVoucher.
function orderGrossRevenue(order: {
  items: { quantity: number; price: Prisma.Decimal }[];
  totalAmount: Prisma.Decimal;
  sellerVoucher: Prisma.Decimal;
}): number {
  if (order.items.length > 0) {
    return order.items.reduce((s, it) => s + it.quantity * Number(it.price), 0);
  }
  return Number(order.totalAmount) + Number(order.sellerVoucher);
}

// Tỷ lệ % của một khoản so với tổng (làm tròn 2 chữ số, tránh chia cho 0)
function pct(amount: number, total: number): number {
  if (!total) return 0;
  return Math.round((amount / total) * 10000) / 100;
}

// Lấy đơn Đã giao trong phạm vi kênh đang xem, kèm dữ liệu giá vốn
function fetchDeliveredOrders(scope: ChannelScope, range?: DateRangeFilter) {
  return prisma.order.findMany({
    where: {
      channel: scope,
      shippingStatus: "DELIVERED",
      createdAt: range,
    },
    orderBy: { createdAt: "desc" },
    include: {
      channel: { select: { channelName: true, shopName: true } },
      items: true,
      inventoryLogs: {
        where: { changeQuantity: { lt: 0 } },
        include: { product: { select: { costPrice: true } } },
      },
    },
  });
}

// Đổi Date → "yyyy-mm-dd"
function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// GET /api/finance/orders-analysis — quét đơn Đã giao.
// Lợi nhuận đơn = Doanh thu − Phí sàn − Tổng giá vốn. ≤ 0 ⇒ ĐƠN LỖ.
// Đơn chứa SKU chưa cấu hình giá vốn ⇒ kèm warning để chủ shop đi nhập giá vốn.
router.get("/orders-analysis", async (req: AuthRequest, res, next) => {
  try {
    const delivered = await fetchDeliveredOrders(
      channelScope(req),
      parseDateRange(req.query)
    );

    const analyzed = delivered.map((o) => {
      const revenue = Number(o.totalAmount);
      const { fee: platformFee, isSettled } = orderPlatformFee(o);
      const { cost, missingCostPrice } = orderCost(o);
      const profit = revenue - platformFee - cost;
      const isLoss = profit <= 0;

      // BÓC TÁCH LÝ DO LỖ:
      // - COST: bán dưới giá vốn (lỗ ngay từ khâu nhập hàng/định giá)
      // - FEE : bán trên giá vốn nhưng phí sàn ăn hết lãi
      let lossReason: "COST" | "FEE" | null = null;
      if (isLoss && !missingCostPrice) {
        lossReason = revenue < cost ? "COST" : "FEE";
      }

      return {
        id: o.id,
        orderCode: o.orderCode,
        customerName: o.customerName,
        channelName: o.channel.channelName,
        shopName: o.channel.shopName,
        createdAt: o.createdAt,
        revenue,
        platformFee,
        isSettled, // phí đã là số quyết toán hay còn tạm tính
        cost,
        profit, // âm hoặc 0 = lỗ
        isLoss,
        lossReason,
        ...(missingCostPrice ? { warning: "Chưa nhập giá vốn" } : {}),
      };
    });

    // Trả về đơn LỖ và cả đơn THIẾU GIÁ VỐN (số liệu chưa đáng tin, cần đối soát)
    const orders = analyzed
      .filter((o) => o.isLoss || o.warning)
      .sort((a, b) => a.profit - b.profit); // lỗ nặng nhất lên đầu

    res.json({
      analyzedCount: delivered.length,
      lossCount: analyzed.filter((o) => o.isLoss).length,
      warningCount: analyzed.filter((o) => o.warning).length,
      orders,
      // Giữ tên cũ để tương thích ngược
      lossOrders: orders.filter((o) => o.isLoss),
    });
  } catch (err) {
    next(err);
  }
});

/** Nhãn trạng thái đơn ở bộ lọc → giá trị shippingStatus. Thiếu = "tất cả". */
const RECON_STATUS: Record<string, ShippingStatus> = {
  delivered: ShippingStatus.DELIVERED,
  shipping: ShippingStatus.SHIPPING,
  cancelled: ShippingStatus.CANCELLED,
};

// ============================================================
// LÃI/LỖ THỰC HIỆN — CHI TIẾT TỪNG ĐƠN THEO SÀN (Shopee / TikTok / Lazada)
// Trả về "detail row" GIÀU trường (superset) kèm dòng sản phẩm; frontend tách
// theo từng sàn để render đúng cột đặc thù. Có phân trang + tóm tắt theo sàn.
//
// Quy ước: các trường phí bóc riêng để hai bảng tự chọn cột. Đơn ĐÃ QUYẾT TOÁN
// dùng phí thực tế (chính xác); chưa quyết toán gộp phí tạm tính vào feeFixedPayment.
// netRevenue = doanh thu sau khi trừ toàn bộ phí sàn; profit = netRevenue − giá vốn.
// ============================================================

const PNL_PAGE_SIZES = [20, 50, 100];

// GET /api/finance/realized-pnl — bảng lãi/lỗ thực hiện chi tiết theo sàn
router.get("/realized-pnl", async (req: AuthRequest, res, next) => {
  try {
    const statusKey =
      typeof req.query.status === "string"
        ? req.query.status.toLowerCase()
        : "";
    const shippingStatus = RECON_STATUS[statusKey]; // undefined = tất cả

    const rawSize = Number(req.query.pageSize);
    const pageSize = PNL_PAGE_SIZES.includes(rawSize) ? rawSize : 20;
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);

    // Cấu hình thuế (trang "Thuế bổ sung") — tính thuế sàn từng đơn + thuế
    // bổ sung của kỳ, cùng công thức với /analytics và /api/tax/report.
    const taxCfg = await getShopTaxConfig(req.ownerId!);

    const orders = await prisma.order.findMany({
      where: {
        channel: channelScope(req),
        createdAt: parseDateRange(req.query),
        ...(shippingStatus ? { shippingStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        channel: { select: { channelName: true, shopName: true } },
        items: true,
        inventoryLogs: {
          where: { changeQuantity: { lt: 0 } },
          include: { product: { select: { costPrice: true } } },
        },
        // Sao kê quyết toán chi tiết Lazada — bảng tab Lazada đọc số thật từ đây.
        lazadaSettlement: true,
      },
      take: 2000, // trần an toàn — báo cáo theo khoảng ngày thường nằm dưới mức này
    });

    const allRows = orders.map((o) => {
      const { cost, missingCostPrice } = orderCost(o);
      const revenueGross = orderGrossRevenue(o);

      // Gộp phí theo bucket cột. Chưa quyết toán → dồn phí tạm tính vào cột
      // "cố định + thanh toán", các bucket còn lại để 0 (chưa có số thực).
      const feeFixedPayment = o.isSettled
        ? Number(o.fixedFee) + Number(o.paymentFee)
        : Number(o.platformFee);
      const feeService = o.isSettled ? Number(o.serviceFee) : 0;
      const feeAffiliate = o.isSettled ? Number(o.affiliateFee) : 0;
      const sellerVoucher = Number(o.sellerVoucher);
      const platformSubsidy = Number(o.platformSubsidy);
      const shippingFeeDiff = Number(o.shippingFeeDiff);

      const netRevenue =
        revenueGross -
        sellerVoucher -
        feeFixedPayment -
        feeService -
        feeAffiliate -
        shippingFeeDiff +
        platformSubsidy;
      const profit = netRevenue - cost;

      // Thuế sàn TMĐT của đơn: quyết toán rồi dùng số THẬT sàn đã trích
      // (taxWithheld); chưa thì ước tính % cấu hình trên doanh thu gốc.
      const platformTax = o.isSettled
        ? Number(o.taxWithheld)
        : platformTaxOn(revenueGross);
      const profitAfterTax = profit - platformTax;

      return {
        id: o.id,
        orderCode: o.orderCode,
        shippingStatus: o.shippingStatus,
        isSettled: o.isSettled,
        channelName: o.channel.channelName,
        shopName: o.channel.shopName,
        createdAt: o.createdAt,
        shippedAt: o.packedAt, // mốc bàn giao ĐVVC (gần nhất với "ngày gửi ĐVVC")
        customerName: o.customerName,
        carrier: o.carrier,
        items: o.items.map((it) => ({
          sku: it.channelSku,
          name: it.productName,
          variation: "", // OrderItem chưa tách trường phân loại — giữ chỗ
          quantity: it.quantity,
          price: Number(it.price),
          costPriceAtSale: Number(it.costPriceAtSale),
        })),
        // Doanh thu & trợ giá
        revenueGross,
        sellerVoucher,
        platformSubsidy,
        // Vận chuyển
        shippingFeeQuoted: Number(o.shippingFeeQuoted),
        shippingFeeActual: Number(o.shippingFeeActual),
        shippingFeeDiff,
        shipSubsidyPlatform: Number(o.shipSubsidyPlatform),
        shipSubsidyShop: Number(o.shipSubsidyShop),
        // Phí sàn theo bucket
        feeFixedPayment,
        feeService,
        feeAffiliate,
        // Khấu trừ lúc giải ngân — bóc tách hiển thị, đã nằm trong actualPayout
        adWalletTopup: Number(o.adWalletTopup),
        taxWithheld: Number(o.taxWithheld),
        // Hiệu quả
        costSnapshot: cost,
        netRevenue,
        actualPayout: Number(o.actualPayout),
        profit,
        // Thuế sàn TMĐT (thực khi đã quyết toán / ước tính khi chưa) + lãi sau thuế
        platformTax,
        profitAfterTax,
        missingCostPrice,
        // SAO KÊ CHI TIẾT LAZADA — số CÓ DẤU NGUYÊN BẢN từ Finance API (null
        // với đơn sàn khác / đơn Lazada chưa đối soát). Tab Lazada dùng 100%
        // số thật này, không dùng bucket gộp phía trên.
        lazada: o.lazadaSettlement
          ? Object.fromEntries(
              (
                [
                  "itemRevenue", "shipFee", "shipFeeCustomer",
                  "shipDiscountPlatform", "shipDiscountSeller", "shipFeeReturn",
                  "shipFeeAdjustment", "feeFixed", "feeOrderProcessing",
                  "feePayment", "feeCommission",
                  "feeShipSeller", "shipSubsidySeller", "feeFreeshipMax",
                  "feeCashbackMax", "feeSponsoredDiscovery", "feeLazadaBonus",
                  "bonusLzdCofund", "feeBuyerReview", "feeLazpick",
                  "feeCampaign", "feeAffiliate", "feeInfrastructure",
                  "feeOther", "subsidyOther", "sellerVoucher",
                  "vatFee", "incomeTaxFee", "actualPayout",
                ] as const
              ).map((k) => [k, Number(o.lazadaSettlement![k])])
            )
          : null,
      };
    });

    // Bộ lọc nhanh "Lợi nhuận âm": chỉ giữ đơn LỖ (profit < 0). Áp trước khi
    // phân trang & tóm tắt để số liệu khớp đúng những gì bảng đang hiển thị.
    const lossOnly =
      req.query.lossOnly === "true" || req.query.lossOnly === "1";
    const filtered = lossOnly
      ? allRows.filter((r) => r.profit < 0)
      : allRows;

    // Tóm tắt theo sàn (trên TOÀN BỘ đơn khớp lọc, không chỉ trang hiện tại)
    const byPlatform: Record<string, { count: number; profit: number }> = {};
    for (const r of filtered) {
      const b = (byPlatform[r.channelName] ??= { count: 0, profit: 0 });
      b.count += 1;
      b.profit += r.profit;
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const rows = filtered.slice(start, start + pageSize);

    // Tổng thuế của kỳ (trên toàn bộ đơn khớp lọc, không chỉ trang hiện tại).
    // Khác /analytics: profit ở đây CHƯA trừ thuế sàn nào cả (kể cả đơn đã
    // quyết toán) nên trừ đủ platformTax thực + ước tính, không sợ trùng.
    const totalProfit = filtered.reduce((s, r) => s + r.profit, 0);
    const totalGrossRevenue = filtered.reduce((s, r) => s + r.revenueGross, 0);
    const totalPlatformTax = filtered.reduce((s, r) => s + r.platformTax, 0);
    const additionalTax = additionalTaxOn(
      { grossRevenue: totalGrossRevenue, profit: totalProfit },
      taxCfg
    );

    res.json({
      rows,
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        count: total,
        settledCount: filtered.filter((r) => r.isSettled).length,
        totalNetRevenue: filtered.reduce((s, r) => s + r.netRevenue, 0),
        totalProfit,
        totalPlatformTax,
        additionalTax,
        totalProfitAfterTax: totalProfit - totalPlatformTax - additionalTax,
        taxSettings: {
          calculationBase: taxCfg.calculationBase,
          platformTaxPercent: PLATFORM_TAX_RATE * 100,
          customTaxPercent: taxCfg.customTaxRate * 100,
        },
        byPlatform,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PHÂN BỔ DÒNG TIỀN THEO GIAN HÀNG (Cash Flow allocation)
// Mỗi gian hàng liên kết = một dòng; bóc dòng tiền theo trạng thái vòng đời:
//   - inTransit    : đơn đang giao/chuẩn bị hoặc đang hoàn (tiền đi đường)
//   - pendingSettle: đơn đã giao NHƯNG sàn chưa quyết toán (chờ về ví)
//   - settled      : đơn đã quyết toán → tiền trong ví sàn (số thực nhận)
//   - withdrawn    : tiền đã rút ví về ngân hàng — CHƯA có tính năng theo dõi
//     lệnh rút nên GIỮ CHỖ 0đ (sẽ cắm số khi có module rút/đối soát ngân hàng).
// Liệt kê theo DANH SÁCH CHANNEL (kể cả gian chưa phát sinh đơn) để kết nối
// thêm gian là bảng tự có thêm dòng, không hardcode.
// ============================================================

// GET /api/finance/cash-flow — phân bổ dòng tiền theo từng gian hàng
router.get("/cash-flow", async (req: AuthRequest, res, next) => {
  try {
    const scope = channelScope(req);
    const [channels, orders, withdrawals, opTxns] = await Promise.all([
      prisma.channel.findMany({
        where: scope,
        orderBy: [{ channelName: "asc" }, { shopName: "asc" }],
        select: { id: true, channelName: true, shopName: true },
      }),
      prisma.order.findMany({
        where: { channel: scope },
        select: {
          channelId: true,
          totalAmount: true,
          shippingStatus: true,
          returnStatus: true,
          actualPayout: true,
          ...FEE_SELECT,
        },
      }),
      // Tổng tiền ĐÃ RÚT khỏi ví sàn về ngân hàng (thành công), gom theo gian.
      prisma.walletWithdrawal.groupBy({
        by: ["channelId"],
        _sum: { amount: true },
        where: { channel: scope, status: "SUCCESS" },
      }),
      // THU/CHI VẬN HÀNH gắn nguồn tiền — gom theo (gian, túi tiền, chiều) để
      // cộng/trừ vào đúng cột Ví sàn/Ngân hàng của từng gian.
      prisma.operatingExpense.groupBy({
        by: ["fundChannelId", "fundSource", "direction"],
        _sum: { amount: true },
        where: { fundChannel: scope, fundSource: { not: null } },
      }),
    ]);

    interface Bucket {
      channelId: string;
      channelName: ChannelName;
      shopName: string;
      inTransit: number;
      pendingSettle: number;
      settled: number;
      withdrawn: number;
    }
    const byChannel = new Map<string, Bucket>(
      channels.map((c) => [
        c.id,
        {
          channelId: c.id,
          channelName: c.channelName,
          shopName: c.shopName,
          inTransit: 0,
          pendingSettle: 0,
          settled: 0,
          withdrawn: 0, // giữ chỗ — chưa theo dõi lệnh rút ví
        },
      ])
    );

    // Ưu tiên theo VỊ TRÍ THỰC của dòng tiền (ground truth cho quản trị tiền):
    //   1) Đã quyết toán → tiền ĐÃ nằm trong ví (dù đơn có đang hoàn thì tiền
    //      vẫn đang ở ví cho tới khi hoàn tiền) → "đã đối soát".
    //   2) Đã giao nhưng chưa quyết toán → "chờ đối soát".
    //   3) Còn lại (đang giao/chuẩn bị, hoặc đang hoàn mà CHƯA quyết toán) →
    //      tiền vẫn đang đi đường/chưa chắc → "đang đi đường".
    for (const o of orders) {
      const row = byChannel.get(o.channelId);
      if (!row) continue;
      if (o.shippingStatus === ShippingStatus.CANCELLED) continue; // hủy → bỏ

      const { fee } = orderPlatformFee(o);
      const net = Number(o.totalAmount) - fee; // dòng tiền dự kiến của đơn

      if (o.shippingStatus === ShippingStatus.DELIVERED && o.isSettled) {
        const payout = Number(o.actualPayout);
        row.settled += payout > 0 ? payout : net; // tiền đã về ví
      } else if (o.shippingStatus === ShippingStatus.DELIVERED) {
        row.pendingSettle += net; // đã giao, chờ sàn quyết toán
      } else {
        // đang giao / chuẩn bị, hoặc đang hoàn (chưa quyết toán)
        row.inTransit += net;
      }
    }

    // RÚT VÍ: chuyển tiền từ "đã đối soát" (Ví sàn) sang "đã thu về" (Ngân hàng).
    // CỐ Ý cho phép Ví sàn ÂM: nếu số đã rút > tiền đã quyết toán thì đó là tín
    // hiệu lệch pha dữ liệu (sàn chưa đồng bộ hết, hoặc kế toán nhập lố) — để lộ
    // số âm giúp chủ shop đối soát ngay, không che bằng cách kẹp về 0.
    for (const w of withdrawals) {
      const row = byChannel.get(w.channelId);
      if (!row) continue;
      const amount = Number(w._sum.amount ?? 0);
      row.settled -= amount; // rời khỏi ví sàn
      row.withdrawn += amount; // về ngân hàng
    }

    // THU/CHI VẬN HÀNH gắn nguồn tiền: THU (+) / CHI (−) vào đúng cột của gian.
    //  - PLATFORM_WALLET → cột Ví sàn (settled)
    //  - BANK_ACCOUNT    → cột Ngân hàng (withdrawn)
    // Cho phép âm như luồng rút ví — số âm là tín hiệu cần đối soát.
    for (const t of opTxns) {
      if (!t.fundChannelId) continue;
      const row = byChannel.get(t.fundChannelId);
      if (!row) continue;
      const amt = Number(t._sum.amount ?? 0);
      const signed = t.direction === "INCOME" ? amt : -amt;
      if (t.fundSource === "PLATFORM_WALLET") row.settled += signed;
      else if (t.fundSource === "BANK_ACCOUNT") row.withdrawn += signed;
    }

    // Giữ ĐÚNG thứ tự channel để bảng ổn định; kèm tổng dòng tiền dự kiến/gian.
    // total KHÔNG đổi khi rút ví (tiền chỉ chuyển cột) — vẫn là tổng dòng tiền.
    const rows = channels.map((c) => {
      const b = byChannel.get(c.id)!;
      return {
        ...b,
        total: b.inTransit + b.pendingSettle + b.settled + b.withdrawn,
      };
    });

    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// RÚT VÍ SÀN → NGÂN HÀNG (WalletWithdrawal)
// Ghi nhận tiền rời ví sàn về bank. Hai nguồn: SYNC (đọc API ví sàn) và MANUAL
// (kế toán tự xác nhận). Các endpoint dưới đây phục vụ luồng NHẬP TAY + tra cứu;
// luồng SYNC nằm ở integrations/shopee/wallet.ts.
// ============================================================

// GET /api/finance/withdrawals?channelId= — liệt kê lệnh rút (mới nhất trước)
router.get("/withdrawals", async (req: AuthRequest, res, next) => {
  try {
    const channelId =
      typeof req.query.channelId === "string" && req.query.channelId
        ? req.query.channelId
        : undefined;
    const rows = await prisma.walletWithdrawal.findMany({
      where: {
        channel: { userId: req.ownerId!, ...(channelId ? { id: channelId } : {}) },
      },
      orderBy: { transactionTime: "desc" },
      include: { channel: { select: { channelName: true, shopName: true } } },
      take: 200,
    });
    res.json({
      items: rows.map((w) => ({
        id: w.id,
        channelId: w.channelId,
        channelName: w.channel.channelName,
        shopName: w.channel.shopName,
        amount: Number(w.amount),
        status: w.status,
        source: w.source,
        externalTxnId: w.externalTxnId,
        transactionTime: w.transactionTime,
        note: w.note,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/finance/withdrawals — KẾ TOÁN xác nhận đã rút ví thủ công.
// Body: { channelId, amount, transactionTime?, note? }
router.post("/withdrawals", async (req: AuthRequest, res, next) => {
  try {
    const { channelId, amount, transactionTime, note } = req.body ?? {};

    if (typeof channelId !== "string" || !channelId) {
      res.status(400).json({ error: "Thiếu gian hàng (channelId)" });
      return;
    }
    // Gian hàng phải thuộc chủ shop đang đăng nhập — chặn ghi chéo shop.
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, userId: req.ownerId! },
      select: { id: true },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng" });
      return;
    }

    const amt = typeof amount === "string" ? Number(amount) : amount;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt <= 0) {
      res.status(400).json({ error: "Số tiền rút phải là số dương" });
      return;
    }

    let when = new Date();
    if (transactionTime !== undefined && transactionTime !== "") {
      const d = new Date(transactionTime);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Thời điểm rút không hợp lệ" });
        return;
      }
      when = d;
    }

    const created = await prisma.walletWithdrawal.create({
      data: {
        channelId,
        amount: amt,
        status: "SUCCESS",
        source: WithdrawalSource.MANUAL,
        transactionTime: when,
        note: typeof note === "string" && note.trim() ? note.trim() : null,
      },
    });
    res.status(201).json({ id: created.id, amount: Number(created.amount) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/finance/withdrawals/:id — xoá một lệnh rút NHẬP TAY (sửa sai).
// Chỉ cho xoá bản ghi MANUAL; bản ghi SYNC là ảnh chụp từ sàn, không tự ý xoá.
router.delete("/withdrawals/:id", async (req: AuthRequest, res, next) => {
  try {
    const w = await prisma.walletWithdrawal.findFirst({
      where: { id: req.params.id, channel: { userId: req.ownerId! } },
      select: { id: true, source: true },
    });
    if (!w) {
      res.status(404).json({ error: "Không tìm thấy lệnh rút" });
      return;
    }
    if (w.source !== WithdrawalSource.MANUAL) {
      res.status(400).json({
        error: "Chỉ xoá được lệnh rút nhập tay; bản ghi đồng bộ từ sàn không xoá.",
      });
      return;
    }
    await prisma.walletWithdrawal.delete({ where: { id: w.id } });
    res.json({ id: w.id, deleted: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/finance/expenses — danh sách chi phí vận hành
router.get("/expenses", async (req: AuthRequest, res, next) => {
  try {
    const expenses = await prisma.operatingExpense.findMany({
      where: {
        userId: req.ownerId!,
        direction: TransactionDirection.EXPENSE,
        expenseDate: parseDateRange(req.query),
      },
      orderBy: { expenseDate: "desc" },
    });
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

// GET /api/finance/sku-products?channel=all|shopee|tiktok|lazada|offline
// Danh sách SKU (đã đồng bộ từ sàn) để chủ shop nhập giá vốn.
// Lọc theo SÀN chứ không theo gian hàng: giá vốn là thuộc tính của sản phẩm gốc
// trong kho, một SKU bán ở hai gian vẫn chung một giá nhập.
// - Sàn cụ thể  → các SKU sàn đã liên kết của mọi gian trên sàn đó
// - offline     → sản phẩm kho chưa liên kết sàn nào (bán tại quầy)
// - all         → cả hai
router.get("/sku-products", async (req: AuthRequest, res, next) => {
  try {
    const raw = typeof req.query.channel === "string" ? req.query.channel : "all";
    const channel = raw.toLowerCase();

    const rows: {
      skuId: string; // id dùng để cập nhật giá vốn (mapping id hoặc product id)
      productId: string; // "" nếu SKU sàn chưa liên kết kho gốc
      sku: string;
      productName: string;
      variantName: string | null; // phân loại (màu/size) — tên hiển thị trên sàn
      channelName: ChannelName;
      shopName: string; // gian hàng cụ thể — phân biệt 2 shop cùng một sàn
      imageUrl: string | null;
      sellingPrice: string;
      costPrice: string;
      /** false = SKU sàn chưa nối kho gốc — giá vốn lưu ở cấp SKU sàn. */
      linked: boolean;
    }[] = [];

    // 1) SKU trên sàn — CẢ đã lẫn CHƯA liên kết kho gốc.
    // Đã liên kết: giá vốn đọc từ sản phẩm gốc (nguồn chân lý). Chưa liên kết:
    // giá vốn đọc từ chính dòng SKU sàn (ChannelProduct.costPrice) — dành cho
    // khách không muốn quản tồn kho tập trung nhưng vẫn cần giá vốn để tính lãi.
    if (channel !== "offline") {
      const channelProducts = await prisma.channelProduct.findMany({
        where: {
          channel: {
            userId: req.ownerId!,
            ...(channel !== "all" && CHANNEL_BY_KEY[channel]
              ? { channelName: CHANNEL_BY_KEY[channel] }
              : { channelName: { not: ChannelName.OFFLINE } }),
          },
        },
        include: {
          product: true,
          channel: { select: { channelName: true, shopName: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      for (const cp of channelProducts) {
        const linked = Boolean(cp.productId && cp.product);
        rows.push({
          skuId: cp.id,
          productId: cp.productId ?? "",
          sku: cp.channelSku,
          productName: linked ? cp.product!.productName : cp.productName,
          variantName: cp.variantName ?? cp.productName,
          channelName: cp.channel.channelName,
          shopName: cp.channel.shopName,
          imageUrl: linked ? (cp.product!.imageUrl ?? cp.imageUrl) : cp.imageUrl,
          sellingPrice: String(linked ? cp.product!.sellingPrice : cp.price),
          costPrice: String((linked ? cp.product!.costPrice : cp.costPrice) ?? 0),
          linked,
        });
      }
    }

    // 2) Sản phẩm kho chưa liên kết sàn nào → coi là hàng bán Offline
    if (channel === "offline" || channel === "all") {
      const unmapped = await prisma.product.findMany({
        where: { userId: req.ownerId!, channelProducts: { none: {} } },
        orderBy: { createdAt: "desc" },
      });
      for (const p of unmapped) {
        rows.push({
          skuId: p.id,
          productId: p.id,
          sku: p.skuCode,
          productName: p.productName,
          variantName: null,
          channelName: ChannelName.OFFLINE,
          shopName: "Kho nội bộ",
          imageUrl: p.imageUrl,
          sellingPrice: String(p.sellingPrice),
          costPrice: String(p.costPrice),
          linked: true, // sản phẩm kho gốc — giá vốn nằm ngay trên nó
        });
      }
    }

    res.json({
      channel,
      total: rows.length,
      missingCostCount: rows.filter((r) => Number(r.costPrice) <= 0).length,
      items: rows,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// BÁO CÁO LỜI/LỖ THEO SẢN PHẨM (SKU P&L)
//
// Nguyên tắc phân bổ:
//  - Doanh thu & giá vốn: lấy trực tiếp từ OrderItem (đã snapshot giá vốn lúc bán)
//  - Phí sàn & phí ship của đơn: PHÂN BỔ cho từng SKU theo TỶ TRỌNG doanh thu
//    của dòng hàng đó trong đơn (đơn nhiều SKU thì chia theo tỷ lệ)
//  - Chi phí VARIABLE có appliedSku: cộng thẳng vào đúng SKU đó
//  - Chi phí FIXED: KHÔNG phân bổ vào SKU (trừ vào tổng lợi nhuận toàn shop)
//
// Phạm vi: đơn ĐÃ GIAO có dữ liệu dòng hàng (OrderItem).
// ============================================================
router.get("/sku-pnl", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const range = parseDateRange(req.query);

    const [orders, variableExpenses] = await Promise.all([
      prisma.order.findMany({
        where: {
          channel: channelScope(req),
          shippingStatus: "DELIVERED",
          items: { some: {} }, // chỉ đơn có chi tiết dòng hàng
          createdAt: range,
        },
        include: {
          items: { include: { product: { select: { skuCode: true, imageUrl: true } } } },
        },
      }),
      prisma.operatingExpense.findMany({
        where: {
          userId: ownerId,
          direction: TransactionDirection.EXPENSE,
          type: ExpenseType.VARIABLE,
          appliedSku: { not: null },
          expenseDate: range,
        },
        select: { appliedSku: true, amount: true },
      }),
    ]);

    interface SkuRow {
      sku: string;
      productName: string;
      imageUrl: string | null;
      quantitySold: number;
      revenue: number;
      cogs: number;
      allocatedFee: number; // phí sàn + phí ship phân bổ
      marketingCost: number; // chi phí biến đổi gắn riêng SKU
    }
    const bySku = new Map<string, SkuRow>();

    for (const order of orders) {
      const { fee: orderFee } = orderPlatformFee(order);

      // Tổng doanh thu các dòng hàng trong đơn → dùng làm mẫu số phân bổ phí
      const orderLineRevenue = order.items.reduce(
        (s, it) => s + Number(it.price) * it.quantity,
        0
      );

      for (const item of order.items) {
        const sku = item.product?.skuCode ?? item.channelSku;
        const lineRevenue = Number(item.price) * item.quantity;
        const lineCogs = Number(item.costPriceAtSale) * item.quantity;
        // Phân bổ phí theo tỷ trọng doanh thu dòng hàng
        const share = orderLineRevenue > 0 ? lineRevenue / orderLineRevenue : 0;

        const row = bySku.get(sku) ?? {
          sku,
          productName: item.productName,
          imageUrl: item.product?.imageUrl ?? null,
          quantitySold: 0,
          revenue: 0,
          cogs: 0,
          allocatedFee: 0,
          marketingCost: 0,
        };
        row.quantitySold += item.quantity;
        row.revenue += lineRevenue;
        row.cogs += lineCogs;
        row.allocatedFee += orderFee * share;
        if (!row.imageUrl && item.product?.imageUrl) row.imageUrl = item.product.imageUrl;
        bySku.set(sku, row);
      }
    }

    // Cộng chi phí biến đổi (Ads/KOC) vào đúng SKU được gắn
    for (const e of variableExpenses) {
      const sku = (e.appliedSku ?? "").toUpperCase();
      if (!sku) continue;
      const row = bySku.get(sku);
      if (row) {
        row.marketingCost += Number(e.amount);
      } else {
        // SKU chưa phát sinh đơn nào nhưng đã tốn tiền quảng cáo → vẫn hiện để thấy đang lỗ
        bySku.set(sku, {
          sku,
          productName: sku,
          imageUrl: null,
          quantitySold: 0,
          revenue: 0,
          cogs: 0,
          allocatedFee: 0,
          marketingCost: Number(e.amount),
        });
      }
    }

    const items = Array.from(bySku.values())
      .map((r) => {
        const allocatedFee = Math.round(r.allocatedFee);
        const profit = r.revenue - r.cogs - allocatedFee - r.marketingCost;

        // ===== PHÂN TÍCH ĐIỂM HÒA VỐN (Break-Even Analysis) =====
        // Chỉ tính khi SKU đã cấu hình giá vốn (> 0) và đã bán được hàng,
        // vì mọi chỉ số đều quy về "trên một sản phẩm".
        const canAnalyze = r.cogs > 0 && r.quantitySold > 0 && r.revenue > 0;

        // Lợi nhuận gộp GỐC — trước khi trừ chi phí marketing
        const grossBeforeMarketing = r.revenue - r.cogs - allocatedFee;

        const breakEven = canAnalyze
          ? (() => {
              const unitCogs = r.cogs / r.quantitySold; // giá vốn / sp
              const unitFee = allocatedFee / r.quantitySold; // phí sàn+ship / sp
              const avgSellingPrice = r.revenue / r.quantitySold;
              // 1. Giá bán hòa vốn: bán dưới mức này là chắc chắn âm tiền túi
              const floorPrice = Math.round(unitCogs + unitFee);
              // 2. Mức giảm giá tối đa còn hòa vốn (% trên giá bán hiện tại)
              const maxDiscountPercent = pct(grossBeforeMarketing, r.revenue);
              // 3. Trần chi phí quảng cáo cho mỗi đơn (Target CPA)
              const targetCpa = Math.round(grossBeforeMarketing / r.quantitySold);
              // Chi phí marketing THỰC TẾ đang tiêu cho mỗi đơn
              const actualCpa = Math.round(r.marketingCost / r.quantitySold);
              return {
                unitCogs: Math.round(unitCogs),
                unitFee: Math.round(unitFee),
                avgSellingPrice: Math.round(avgSellingPrice),
                floorPrice,
                maxDiscountPercent,
                targetCpa,
                actualCpa,
                // Đang đốt tiền quảng cáo vượt ngưỡng cho phép ⇒ cần tắt/tối ưu ngay
                isOverspending: r.marketingCost > 0 && actualCpa > targetCpa,
              };
            })()
          : null;

        // BÓC TÁCH LÝ DO LỖ — hai loại lỗ này cần hai cách chữa khác hẳn nhau:
        //   ADS  : bản thân mặt hàng vẫn có lãi, tiền quảng cáo ăn hết phần lãi đó
        //          → tắt/tối ưu chiến dịch là hết lỗ, không phải đụng vào giá.
        //   COST : lỗ ngay từ trước khi tiêu một đồng quảng cáo nào
        //          → phải sửa giá nhập hoặc giá bán, tắt Ads cũng vẫn lỗ.
        // Mã chưa nhập giá vốn thì chưa kết luận được, để null.
        const missingCost = r.quantitySold > 0 && r.cogs <= 0;
        let lossReason: "ADS" | "COST" | null = null;
        if (profit <= 0 && !missingCost) {
          lossReason = grossBeforeMarketing > 0 ? "ADS" : "COST";
        }

        return {
          sku: r.sku,
          productName: r.productName,
          imageUrl: r.imageUrl,
          quantitySold: r.quantitySold,
          revenue: r.revenue,
          cogs: r.cogs,
          allocatedFee,
          marketingCost: r.marketingCost,
          grossBeforeMarketing,
          profit,
          // Biên lợi nhuận trên doanh thu của chính SKU đó
          margin: pct(profit, r.revenue),
          // Đã bán nhưng giá vốn = 0 ⇒ số liệu lời/lỗ chưa đáng tin
          missingCost,
          lossReason,
          breakEven,
        };
      })
      // "Gà đẻ trứng vàng" lên đầu, mã gánh lỗ xuống cuối
      .sort((a, b) => b.profit - a.profit);

    // Chi phí cố định KHÔNG phân bổ vào SKU — trừ vào tổng lợi nhuận toàn shop
    const fixedTotal = await prisma.operatingExpense.aggregate({
      where: { userId: ownerId, direction: TransactionDirection.EXPENSE, type: ExpenseType.FIXED },
      _sum: { amount: true },
    });
    const fixedExpense = Number(fixedTotal._sum.amount ?? 0);
    const skuProfitTotal = items.reduce((s, r) => s + r.profit, 0);

    res.json({
      items,
      summary: {
        skuCount: items.length,
        skuProfitTotal, // tổng lợi nhuận cộng dồn từ các SKU
        fixedExpense, // chi phí cố định toàn shop
        shopProfit: skuProfitTotal - fixedExpense, // lợi nhuận cuối cùng
        // Số SKU đang chi quảng cáo vượt ngưỡng an toàn ⇒ cần xử lý ngay
        overspendingCount: items.filter((i) => i.breakEven?.isOverspending).length,
        // Số liệu cho các tab lọc nhanh trên giao diện. Tính ở đây để tab đếm
        // đúng toàn bộ tập dữ liệu, không phụ thuộc trang đang hiển thị.
        urgentCount: items.filter(
          (i) => i.lossReason !== null || i.breakEven?.isOverspending
        ).length,
        missingCostCount: items.filter((i) => i.missingCost).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// ĐỐI SOÁT & KHIẾU NẠI CHÊNH LỆCH PHÍ VẬN CHUYỂN
// Gom các đơn bị sàn trừ phí ship cao hơn mức đã báo, để chủ shop
// xuất danh sách gửi khiếu nại đòi lại tiền.
// LƯU Ý QUY ƯỚC: DB lưu shippingFeeDiff DƯƠNG = số tiền bị trừ thêm.
// API trả `discrepancy` ÂM (góc nhìn shop bị mất tiền) cho khớp giao diện.
// ============================================================

const DISPUTE_STATUSES: ShippingDisputeStatus[] = [
  ShippingDisputeStatus.CHO_KHIEU_NAI,
  ShippingDisputeStatus.DANG_KHIEU_NAI,
  ShippingDisputeStatus.DA_DOI_SOAT,
];

const CHANNEL_BY_KEY: Record<string, ChannelName> = {
  shopee: ChannelName.SHOPEE,
  tiktok: ChannelName.TIKTOK,
  lazada: ChannelName.LAZADA,
  offline: ChannelName.OFFLINE,
};

// GET /api/finance/shipping-discrepancies?page&pageSize&channel&status
router.get("/shipping-discrepancies", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const statusKey =
      typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";

    const where: Prisma.OrderWhereInput = {
      channel: channelScope(req),
      shippingFeeDiff: { gt: 0 }, // chỉ đơn bị trừ thêm
      createdAt: parseDateRange(req.query),
      ...(DISPUTE_STATUSES.includes(statusKey as ShippingDisputeStatus)
        ? { shippingDisputeStatus: statusKey as ShippingDisputeStatus }
        : {}),
    };

    const [total, rows, allMatching] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: [{ settledAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { channel: { select: { channelName: true, shopName: true } } },
      }),
      // Toàn bộ đơn khớp bộ lọc (không phân trang) để tính tổng tiền cần đòi
      prisma.order.findMany({
        where,
        select: { shippingFeeDiff: true, shippingDisputeStatus: true },
      }),
    ]);

    const totalDiscrepancy = allMatching.reduce(
      (s, o) => s + Number(o.shippingFeeDiff),
      0
    );
    const pendingCount = allMatching.filter(
      (o) => o.shippingDisputeStatus === ShippingDisputeStatus.CHO_KHIEU_NAI
    ).length;

    res.json({
      summary: {
        totalOrders: total, // tổng số đơn lệch (theo bộ lọc)
        totalDiscrepancy: -totalDiscrepancy, // ÂM: số tiền cần đòi lại
        pendingCount, // số đơn chưa gửi khiếu nại
      },
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      items: rows.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        channelName: o.channel.channelName,
        shopName: o.channel.shopName,
        settledAt: o.settledAt,
        createdAt: o.createdAt,
        shippingFeeQuoted: Number(o.shippingFeeQuoted), // phí sàn báo
        shippingFeeActual: Number(o.shippingFeeActual), // phí thực tế bị trừ
        discrepancy: -Number(o.shippingFeeDiff), // ÂM = shop bị mất tiền
        status: o.shippingDisputeStatus,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/finance/shipping-discrepancies/:id/status — đổi trạng thái khiếu nại
router.patch(
  "/shipping-discrepancies/:id/status",
  async (req: AuthRequest, res, next) => {
    try {
      const { status } = req.body ?? {};
      if (!DISPUTE_STATUSES.includes(status)) {
        res.status(400).json({
          error: `Trạng thái không hợp lệ. Chọn: ${DISPUTE_STATUSES.join(", ")}`,
        });
        return;
      }

      const order = await prisma.order.findFirst({
        where: { id: req.params.id, channel: { userId: req.ownerId! } },
      });
      if (!order) {
        res.status(404).json({ error: "Không tìm thấy đơn hàng" });
        return;
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { shippingDisputeStatus: status as ShippingDisputeStatus },
      });

      res.json({
        id: updated.id,
        orderCode: updated.orderCode,
        status: updated.shippingDisputeStatus,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/finance/sync-products — QUÉT SẢN PHẨM TỪ CÁC SÀN ĐÃ KẾT NỐI.
// Với mỗi gian ACTIVE, gọi marketplace/product-sync (Adapter Pattern): registry
// chọn adapter (Shopee API thật nếu có refresh_token, còn lại mock), adapter kéo
// + chuẩn hoá, tầng kho upsert vào bảng đệm ChannelProduct.
// LƯU Ý: KHÔNG bao giờ ghi đè giá vốn (costPrice) hay productId (liên kết người dùng).
router.post("/sync-products", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    // Đồng bộ riêng một gian hàng, hoặc bỏ trống để quét tất cả
    const onlyChannelId =
      typeof req.body?.channelId === "string" ? req.body.channelId : "";

    const channels = await prisma.channel.findMany({
      where: {
        userId: ownerId,
        status: "ACTIVE",
        channelName: { not: ChannelName.OFFLINE },
        ...(onlyChannelId ? { id: onlyChannelId } : {}),
      },
    });

    if (channels.length === 0) {
      res.status(409).json({
        error:
          "Chưa có gian hàng online nào đang hoạt động. Hãy kết nối Shopee/TikTok/Lazada trước.",
      });
      return;
    }

    let created = 0;
    let updated = 0;
    const perChannel: {
      channelId: string;
      channelName: ChannelName;
      shopName: string;
      scanned: number;
      created: number;
      /** Lỗi của RIÊNG gian này (token hết hạn, sàn chập chờn...) — có giá trị
       *  là gian đó quét hỏng, các gian khác vẫn chạy bình thường. */
      error?: string;
    }[] = [];

    for (const channel of channels) {
      // ADAPTER PATTERN: route KHÔNG biết gian này là Shopee thật hay mock —
      // registry chọn adapter, marketplace/product-sync lo phần kho (upsert bảng
      // đệm, giữ nguyên productId/giá vốn, delist SKU cũ). Thêm sàn = thêm adapter.
      //
      // MỖI GIAN MỘT try/catch: một gian hỏng (token hết hạn, API sàn lỗi)
      // KHÔNG được kéo sập cả lượt quét thành 500 — trả lỗi đích danh từng
      // gian để chủ shop biết sửa đúng chỗ.
      try {
        const r = await syncChannelProducts(channel);
        created += r.created;
        updated += r.updated;
        perChannel.push({
          channelId: channel.id,
          channelName: channel.channelName,
          shopName: channel.shopName,
          scanned: r.scanned,
          created: r.created,
        });
      } catch (err) {
        console.error(
          `[Sync Products] Gian "${channel.shopName}" (${channel.channelName}) lỗi:`,
          err
        );
        perChannel.push({
          channelId: channel.id,
          channelName: channel.channelName,
          shopName: channel.shopName,
          scanned: 0,
          created: 0,
          error: (err as Error).message,
        });
      }
    }

    res.json({ created, updated, perChannel });
  } catch (err) {
    next(err);
  }
});

/**
 * Đặt giá vốn cho các sản phẩm gốc, ĐỒNG THỜI vá lại các dòng hàng đã bán mà
 * lúc bán chưa biết giá vốn.
 *
 * OrderItem.costPriceAtSale là ảnh chụp giá vốn tại thời điểm bán — cố ý đóng
 * băng để giá nhập đổi về sau không làm sai lệch báo cáo cũ. Nhưng giá trị 0
 * KHÔNG phải một ảnh chụp hợp lệ, nó nghĩa là "lúc đó chưa ai nhập giá vốn".
 * Để nguyên thì mã đó mãi mãi bị đánh dấu "chưa nhập giá vốn" trong P&L dù chủ
 * shop vừa nhập xong, và lãi/lỗ của nó vẫn sai.
 *
 * Nên chỉ vá đúng những dòng đang là 0. Dòng đã có số thật thì tuyệt đối không
 * đụng vào — đó mới là lịch sử cần giữ.
 */
async function applyCostPrice(
  productIds: string[],
  cost: number,
  ownerId: string
): Promise<{ products: number; backfilledOrderLines: number }> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.updateMany({
      where: { id: { in: productIds }, userId: ownerId },
      data: { costPrice: cost },
    });

    const backfilled = await tx.orderItem.updateMany({
      where: {
        productId: { in: productIds },
        costPriceAtSale: 0,
        order: { channel: { userId: ownerId } },
      },
      data: { costPriceAtSale: cost },
    });

    return { products: updated.count, backfilledOrderLines: backfilled.count };
  });
}

// PATCH /api/finance/update-cost — cập nhật giá vốn cho một SKU.
// Body: { sku_id, cost_price } — sku_id là id ChannelProduct hoặc id Product.
// Hoặc:  { sku_code, cost_price } — dùng cho popup nhập nhanh ở bảng SKU P&L,
// nơi mỗi dòng chỉ có mã SKU (chuỗi) chứ không mang theo id sản phẩm gốc.
router.patch("/update-cost", async (req: AuthRequest, res, next) => {
  try {
    const skuId = req.body?.sku_id ?? req.body?.skuId ?? req.body?.variant_id;
    const rawCost = req.body?.cost_price ?? req.body?.costPrice;
    const skuCodeRaw = req.body?.sku_code ?? req.body?.skuCode;
    const skuCode =
      typeof skuCodeRaw === "string" ? skuCodeRaw.trim().toUpperCase() : "";

    if ((typeof skuId !== "string" || !skuId) && !skuCode) {
      res.status(400).json({ error: "Thiếu sku_id hoặc sku_code" });
      return;
    }
    const cost = typeof rawCost === "string" ? Number(rawCost) : rawCost;
    if (typeof cost !== "number" || Number.isNaN(cost) || cost < 0) {
      res.status(400).json({ error: "Giá vốn phải là số không âm" });
      return;
    }

    // Tìm sản phẩm gốc: theo mã SKU nếu có, không thì thử id mapping rồi id sản phẩm.
    // SKU sàn CHƯA liên kết kho không có sản phẩm gốc → giá vốn lưu ngay trên
    // dòng ChannelProduct (đường unlinkedCpIds bên dưới).
    let productId: string | null = null;
    let unlinkedCpIds: string[] = [];
    if (skuCode) {
      const product = await prisma.product.findUnique({
        where: { userId_skuCode: { userId: req.ownerId!, skuCode } },
        select: { id: true },
      });
      productId = product?.id ?? null;
      if (!productId) {
        // Mã chỉ tồn tại trên sàn (popup SKU P&L với hàng chưa nối kho):
        // áp cho MỌI dòng sàn chưa liên kết trùng mã đó của shop này.
        const cps = await prisma.channelProduct.findMany({
          where: {
            productId: null,
            channelSku: { equals: skuCode, mode: "insensitive" },
            channel: { userId: req.ownerId! },
          },
          select: { id: true },
        });
        unlinkedCpIds = cps.map((c) => c.id);
      }
    } else {
      const channelProduct = await prisma.channelProduct.findFirst({
        where: { id: skuId, channel: { userId: req.ownerId! } },
        select: { id: true, productId: true },
      });
      if (channelProduct?.productId) {
        productId = channelProduct.productId;
      } else if (channelProduct) {
        unlinkedCpIds = [channelProduct.id];
      } else {
        const product = await prisma.product.findFirst({
          where: { id: skuId, userId: req.ownerId! },
          select: { id: true },
        });
        productId = product?.id ?? null;
      }
    }

    if (!productId && unlinkedCpIds.length === 0) {
      res.status(404).json({
        error: skuCode
          ? `Không tìm thấy mã SKU "${skuCode}" trong kho lẫn trên sàn.`
          : "Không tìm thấy SKU / sản phẩm",
      });
      return;
    }

    if (productId) {
      const { backfilledOrderLines } = await applyCostPrice(
        [productId],
        cost,
        req.ownerId!
      );
      const updated = await prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { id: true, productName: true, costPrice: true },
      });

      res.json({
        skuId,
        productId: updated.id,
        productName: updated.productName,
        costPrice: String(updated.costPrice),
        // Số dòng hàng đã bán được vá lại giá vốn — để giao diện nói rõ với chủ
        // shop rằng báo cáo của các đơn cũ vừa được tính lại.
        backfilledOrderLines,
      });
      return;
    }

    // SKU sàn chưa liên kết kho: lưu trên ChannelProduct + vá đơn cũ theo channelSku.
    const { backfilledOrderLines, sample } = await applyChannelCostPrice(
      unlinkedCpIds,
      cost,
      req.ownerId!
    );
    res.json({
      skuId,
      productId: "",
      productName: sample?.productName ?? "",
      costPrice: String(cost),
      backfilledOrderLines,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Đặt giá vốn cho các SKU SÀN CHƯA LIÊN KẾT KHO, đồng thời vá lại dòng hàng đã
 * bán của đúng (gian, mã SKU) đó mà lúc bán chưa có giá vốn (snapshot = 0).
 *
 * Song song với applyCostPrice của sản phẩm gốc: cùng nguyên tắc "0 không phải
 * ảnh chụp hợp lệ" — chỉ vá dòng đang 0, dòng có số thật là lịch sử, không đụng.
 */
async function applyChannelCostPrice(
  channelProductIds: string[],
  cost: number,
  ownerId: string
): Promise<{
  updated: number;
  backfilledOrderLines: number;
  sample: { productName: string } | null;
}> {
  const cps = await prisma.channelProduct.findMany({
    where: {
      id: { in: channelProductIds },
      productId: null,
      channel: { userId: ownerId },
    },
    select: { id: true, channelId: true, channelSku: true, productName: true },
  });
  if (cps.length === 0) return { updated: 0, backfilledOrderLines: 0, sample: null };

  return prisma.$transaction(async (tx) => {
    await tx.channelProduct.updateMany({
      where: { id: { in: cps.map((c) => c.id) } },
      data: { costPrice: cost },
    });

    let backfilled = 0;
    for (const cp of cps) {
      const r = await tx.orderItem.updateMany({
        where: {
          channelSku: cp.channelSku,
          costPriceAtSale: 0,
          productId: null, // dòng đã nối kho thì giá vốn theo sản phẩm gốc
          order: { channelId: cp.channelId },
        },
        data: { costPriceAtSale: cost },
      });
      backfilled += r.count;
    }

    return {
      updated: cps.length,
      backfilledOrderLines: backfilled,
      sample: { productName: cps[0].productName },
    };
  });
}

/**
 * Đổi danh sách sku_id (id ChannelProduct HOẶC id Product) thành danh sách
 * productId thật, đã lọc theo chủ sở hữu. Giá vốn lưu trên Product nên nhiều
 * sku_id có thể quy về cùng một productId — trả về Set để không update trùng.
 */
async function resolveProductIds(
  skuIds: string[],
  ownerId: string
): Promise<Set<string>> {
  const [channelProducts, products] = await Promise.all([
    prisma.channelProduct.findMany({
      where: {
        id: { in: skuIds },
        productId: { not: null },
        channel: { userId: ownerId },
      },
      select: { productId: true },
    }),
    prisma.product.findMany({
      where: { id: { in: skuIds }, userId: ownerId },
      select: { id: true },
    }),
  ]);
  return new Set([
    ...channelProducts.map((cp) => cp.productId!),
    ...products.map((p) => p.id),
  ]);
}

// PATCH /api/finance/update-cost-bulk — áp một giá vốn cho NHIỀU SKU cùng lúc.
// Dùng cho nút "Áp dụng cho tất cả phân loại" (size M/L/XL của cùng một mẫu).
// Body: { sku_ids: string[], cost_price: number }
router.patch("/update-cost-bulk", async (req: AuthRequest, res, next) => {
  try {
    const skuIds = req.body?.sku_ids ?? req.body?.skuIds;
    const rawCost = req.body?.cost_price ?? req.body?.costPrice;

    if (!Array.isArray(skuIds) || skuIds.length === 0) {
      res.status(400).json({ error: "Thiếu danh sách sku_ids" });
      return;
    }
    if (!skuIds.every((s) => typeof s === "string" && s)) {
      res.status(400).json({ error: "sku_ids phải là mảng chuỗi" });
      return;
    }
    // Chặn payload khổng lồ làm treo transaction
    if (skuIds.length > 500) {
      res.status(400).json({ error: "Tối đa 500 SKU mỗi lần áp dụng" });
      return;
    }
    const cost = typeof rawCost === "string" ? Number(rawCost) : rawCost;
    if (typeof cost !== "number" || Number.isNaN(cost) || cost < 0) {
      res.status(400).json({ error: "Giá vốn phải là số không âm" });
      return;
    }

    const productIds = await resolveProductIds(skuIds, req.ownerId!);
    // Phần còn lại có thể là SKU sàn CHƯA liên kết kho — giá vốn ở cấp mapping.
    const unlinkedCps = await prisma.channelProduct.findMany({
      where: {
        id: { in: skuIds },
        productId: null,
        channel: { userId: req.ownerId! },
      },
      select: { id: true },
    });
    if (productIds.size === 0 && unlinkedCps.length === 0) {
      res.status(404).json({ error: "Không tìm thấy SKU / sản phẩm nào" });
      return;
    }

    let backfilledOrderLines = 0;
    if (productIds.size > 0) {
      // Cùng một transaction: hoặc đổi hết, hoặc không đổi gì
      const r = await applyCostPrice([...productIds], cost, req.ownerId!);
      backfilledOrderLines += r.backfilledOrderLines;
    }
    let updatedUnlinked = 0;
    if (unlinkedCps.length > 0) {
      const r = await applyChannelCostPrice(
        unlinkedCps.map((c) => c.id),
        cost,
        req.ownerId!
      );
      updatedUnlinked = r.updated;
      backfilledOrderLines += r.backfilledOrderLines;
    }

    res.json({
      updated: productIds.size + updatedUnlinked,
      costPrice: String(cost),
      backfilledOrderLines,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/finance/cost-prices/import — nhập giá vốn hàng loạt từ Excel.
// Cột chuẩn: [Mã SKU, Giá vốn]. Khớp theo Product.skuCode hoặc
// ChannelProduct.channelSku. SKU không tìm thấy → báo lỗi theo dòng, không chặn
// các dòng hợp lệ còn lại.
router.post(
  "/cost-prices/import",
  upload.single("file"),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Chưa chọn file Excel để tải lên" });
        return;
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        res.status(400).json({ error: "File Excel không có sheet nào" });
        return;
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[sheetName],
        { defval: "" }
      );
      if (rows.length === 0) {
        res.status(400).json({ error: "File Excel không có dòng dữ liệu nào" });
        return;
      }

      const ownerId = req.ownerId!;
      const errors: { row: number; message: string }[] = [];
      // sku (đã chuẩn hoá) → giá vốn. Dòng sau ghi đè dòng trước nếu trùng SKU.
      const wanted = new Map<string, { cost: number; row: number }>();

      rows.forEach((row, idx) => {
        const excelRow = idx + 2; // +1 header, +1 đếm từ 1
        const pick = (...keys: string[]) => {
          for (const k of keys) {
            const found = Object.keys(row).find(
              (rk) => rk.trim().toLowerCase() === k.toLowerCase()
            );
            if (found && String(row[found]).trim() !== "") return String(row[found]).trim();
          }
          return "";
        };

        const sku = pick("Mã SKU", "MaSKU", "SKU", "sku_code", "skuCode");
        const rawCost = pick("Giá vốn", "GiaVon", "cost_price", "costPrice");

        if (!sku) {
          errors.push({ row: excelRow, message: "Thiếu Mã SKU" });
          return;
        }
        // Bỏ dấu phân tách hàng nghìn người dùng gõ trong Excel (52.000 / 52,000)
        const cost = Number(rawCost.replace(/[.,\s]/g, ""));
        if (rawCost === "" || Number.isNaN(cost) || cost < 0) {
          errors.push({
            row: excelRow,
            message: `Giá vốn không hợp lệ ("${rawCost}")`,
          });
          return;
        }
        wanted.set(sku.toLowerCase(), { cost, row: excelRow });
      });

      if (wanted.size === 0) {
        res.status(400).json({
          error: "Không có dòng nào hợp lệ trong file",
          errors,
        });
        return;
      }

      const skuList = [...wanted.keys()];

      // Tìm sản phẩm gốc theo cả mã nội bộ lẫn mã trên sàn.
      // Kéo CẢ dòng sàn chưa liên kết: giá vốn của chúng lưu ở cấp SKU sàn.
      const [products, channelProducts] = await Promise.all([
        prisma.product.findMany({
          where: { userId: ownerId },
          select: { id: true, skuCode: true },
        }),
        prisma.channelProduct.findMany({
          where: { channel: { userId: ownerId } },
          select: { id: true, productId: true, channelId: true, channelSku: true },
        }),
      ]);

      const productIdBySku = new Map<string, string>();
      for (const p of products) productIdBySku.set(p.skuCode.toLowerCase(), p.id);
      // Mã sàn chỉ dùng khi mã nội bộ không khớp, tránh ghi đè nhầm
      for (const cp of channelProducts) {
        if (!cp.productId) continue;
        const key = cp.channelSku.toLowerCase();
        if (!productIdBySku.has(key)) productIdBySku.set(key, cp.productId);
      }
      // SKU sàn CHƯA liên kết — một mã có thể xuất hiện ở nhiều gian.
      const unlinkedBySku = new Map<
        string,
        { id: string; channelId: string; channelSku: string }[]
      >();
      for (const cp of channelProducts) {
        if (cp.productId) continue;
        const key = cp.channelSku.toLowerCase();
        const list = unlinkedBySku.get(key) ?? [];
        list.push({ id: cp.id, channelId: cp.channelId, channelSku: cp.channelSku });
        unlinkedBySku.set(key, list);
      }

      // Gom theo giá vốn để mỗi giá chỉ cần một lệnh updateMany
      const byCost = new Map<number, string[]>();
      const byCostUnlinked = new Map<
        number,
        { id: string; channelId: string; channelSku: string }[]
      >();
      let matched = 0;
      for (const sku of skuList) {
        const entry = wanted.get(sku)!;
        const productId = productIdBySku.get(sku);
        if (productId) {
          matched++;
          const list = byCost.get(entry.cost) ?? [];
          list.push(productId);
          byCost.set(entry.cost, list);
          continue;
        }
        const unlinked = unlinkedBySku.get(sku);
        if (unlinked && unlinked.length > 0) {
          matched++;
          const list = byCostUnlinked.get(entry.cost) ?? [];
          list.push(...unlinked);
          byCostUnlinked.set(entry.cost, list);
          continue;
        }
        errors.push({
          row: entry.row,
          message: `Không tìm thấy SKU "${sku}" trong hệ thống`,
        });
      }

      if (matched === 0) {
        res.status(400).json({
          error: "Không có SKU nào trong file khớp với sản phẩm trong hệ thống",
          errors,
        });
        return;
      }

      // Trọn gói: hoặc cập nhật hết, hoặc không đổi gì.
      // Vá luôn giá vốn của các dòng hàng đã bán mà lúc bán chưa biết giá vốn,
      // giống hệt đường nhập tay — xem chú thích ở applyCostPrice.
      const result = await prisma.$transaction(async (tx) => {
        const touched = new Set<string>();
        let backfilled = 0;
        for (const [cost, ids] of byCost) {
          await tx.product.updateMany({
            where: { id: { in: ids }, userId: ownerId },
            data: { costPrice: cost },
          });
          const patched = await tx.orderItem.updateMany({
            where: {
              productId: { in: ids },
              costPriceAtSale: 0,
              order: { channel: { userId: ownerId } },
            },
            data: { costPriceAtSale: cost },
          });
          backfilled += patched.count;
          for (const id of ids) touched.add(id);
        }
        // SKU sàn chưa liên kết: giá vốn lưu trên ChannelProduct + vá đơn cũ
        // theo (gian, mã SKU) — cùng nguyên tắc "chỉ vá dòng đang 0".
        for (const [cost, cps] of byCostUnlinked) {
          await tx.channelProduct.updateMany({
            where: { id: { in: cps.map((c) => c.id) } },
            data: { costPrice: cost },
          });
          for (const cp of cps) {
            const patched = await tx.orderItem.updateMany({
              where: {
                channelSku: cp.channelSku,
                costPriceAtSale: 0,
                productId: null,
                order: { channelId: cp.channelId },
              },
              data: { costPriceAtSale: cost },
            });
            backfilled += patched.count;
          }
          for (const cp of cps) touched.add(cp.id);
        }
        return { updated: touched.size, backfilled };
      });

      res.json({
        updated: result.updated,
        backfilledOrderLines: result.backfilled,
        totalRows: rows.length,
        errors,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/finance/analytics — 3 chỉ số chính + chuỗi Doanh thu vs Tổng chi phí theo ngày.
// Mọi số tiền trả về là SỐ ĐẦY ĐỦ (không viết tắt).
router.get("/analytics", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;

    const range = parseDateRange(req.query);
    const scope = channelScope(req);

    // THU/CHI VẬN HÀNH NHẬP TAY — luật lọc theo sàn/gian: khi đang lọc
    // (Lazada/Shopee/1 gian cụ thể) CHỈ tính khoản đã gắn đúng nguồn tiền
    // sàn/gian đó (fundChannel); khoản KHÔNG gắn gian nào chỉ xuất hiện ở chế
    // độ "Tất cả sàn". Không chia đều, không gom phí sàn cấn trừ vào đây.
    const manualTxnScope = hasChannelFilter(req)
      ? { fundChannelId: { not: null }, fundChannel: scope }
      : {};

    const [delivered, expenses, inFlight, cancelled, operatingIncomeAgg, taxCfg] =
      await Promise.all([
      fetchDeliveredOrders(scope, range),
      prisma.operatingExpense.findMany({
        where: {
          userId: ownerId,
          direction: TransactionDirection.EXPENSE,
          expenseDate: range,
          ...manualTxnScope,
        },
        select: {
          amount: true,
          type: true,
          category: true,
          expenseDate: true,
        },
      }),
      // Đơn chưa giao xong → tiền chưa về ví.
      // PROCESSED (đã đóng gói, chờ shipper) cũng là tiền treo y như PENDING và
      // SHIPPING — bỏ sót nó là cả nhóm đơn này biến mất khỏi "Tiền chờ về".
      prisma.order.findMany({
        where: {
          channel: scope,
          shippingStatus: {
            in: [
              ShippingStatus.PENDING,
              ShippingStatus.PROCESSED,
              ShippingStatus.SHIPPING,
            ],
          },
          createdAt: range,
        },
        include: {
          items: true,
          inventoryLogs: {
            where: { changeQuantity: { lt: 0 } },
            include: { product: { select: { costPrice: true } } },
          },
          channel: { select: { channelName: true, shopName: true } },
        },
      }),
      // Đơn bị hủy/bom hàng → phục vụ quản trị rủi ro
      prisma.order.findMany({
        where: {
          channel: scope,
          shippingStatus: "CANCELLED",
          createdAt: range,
        },
        select: { totalAmount: true },
      }),
      // Tổng THU vận hành nhập tay trong kỳ (đền bù, thưởng…) — cùng luật lọc
      // sàn/gian với chi phí nhập tay (manualTxnScope).
      prisma.operatingExpense.aggregate({
        _sum: { amount: true },
        where: {
          userId: ownerId,
          direction: TransactionDirection.INCOME,
          expenseDate: range,
          ...manualTxnScope,
        },
      }),
      // Cấu hình thuế của shop (trang "Thuế bổ sung") — dùng ở khối THUẾ dưới cùng.
      getShopTaxConfig(ownerId),
    ]);
    const operatingIncomeTotal = Number(operatingIncomeAgg._sum.amount ?? 0);

    // ===== DÒNG TIỀN TREO =====
    // Tiền chờ về (dự kiến): đơn Đang giao/Chờ xử lý — dùng số TẠM TÍNH
    let pendingPayout = 0;
    let pendingCogs = 0;
    for (const o of inFlight) {
      const { fee } = orderPlatformFee(o);
      pendingPayout += Number(o.totalAmount) - fee;
      pendingCogs += orderCost(o).cost;
    }
    // Tiền thực tế (đã quyết toán): chỉ tính đơn sàn đã chốt giải ngân
    const settledOrders = delivered.filter((o) => o.isSettled);
    const settledPayout = settledOrders.reduce(
      (sum, o) => sum + Number(o.actualPayout),
      0
    );

    // ============================================================
    // BÓC TÁCH DÒNG TIỀN 4 CỘT
    // Phạm vi: đơn Đã giao + đơn đang đi đường (KHÔNG tính đơn đã hủy)
    // ============================================================
    const activeOrders = [...delivered, ...inFlight];

    // --- CỘT 1: TỔNG GIÁ TRỊ SẢN PHẨM (doanh số gốc, chưa trừ gì) ---
    const grossValue = activeOrders.reduce(
      (s, o) => s + Number(o.totalAmount),
      0
    );

    // Các khoản sàn khấu trừ (chỉ đơn đã quyết toán mới có số bóc tách chi tiết;
    // đơn chưa quyết toán gộp vào "phí nền tảng" theo số tạm tính)
    let feePlatform = 0; // phí cố định + dịch vụ + thanh toán
    let feeAffiliate = 0;
    let feeSellerVoucher = 0;
    let feeShippingDiff = 0;
    let platformSubsidyTotal = 0;

    // BUCKET "PHÍ SÀN" CHO CỘT CHI PHÍ — MỘT dòng duy nhất gom toàn bộ phí
    // HOẠT ĐỘNG sàn cấn trừ từ đối soát: phí cố định + thanh toán + dịch vụ +
    // tiếp thị liên kết. KHÔNG gồm thuế sàn (taxWithheld) — thuế tách dòng
    // riêng để theo dõi. Đơn CHƯA quyết toán dồn phí tạm tính theo % kênh.
    let platformFeeTotal = 0;

    for (const o of delivered) {
      if (o.isSettled) {
        feePlatform +=
          Number(o.fixedFee) + Number(o.serviceFee) + Number(o.paymentFee);
        feeAffiliate += Number(o.affiliateFee);
        feeSellerVoucher += Number(o.sellerVoucher);
        feeShippingDiff += Number(o.shippingFeeDiff);
        platformSubsidyTotal += Number(o.platformSubsidy);
        platformFeeTotal +=
          Number(o.fixedFee) +
          Number(o.paymentFee) +
          Number(o.serviceFee) +
          Number(o.affiliateFee);
      } else {
        feePlatform += Number(o.platformFee); // chưa quyết toán → số tạm tính
        platformFeeTotal += Number(o.platformFee);
      }
    }
    for (const o of inFlight) {
      feePlatform += Number(o.platformFee); // đơn đang đi đường luôn là tạm tính
      platformFeeTotal += Number(o.platformFee);
    }

    const totalDeduction =
      feePlatform +
      feeAffiliate +
      feeSellerVoucher +
      feeShippingDiff -
      platformSubsidyTotal;

    // --- CỘT 2: DOANH THU (sau khi trừ các khoản sàn giữ lại) ---
    const netRevenue = grossValue - totalDeduction;
    const cancelledValue = cancelled.reduce(
      (s, o) => s + Number(o.totalAmount),
      0
    );
    const totalOrderCount = activeOrders.length + cancelled.length;
    const cancelRate = pct(cancelled.length, totalOrderCount);

    // --- CỘT 3: CHI PHÍ (giá vốn + Phí sàn + chi phí vận hành nhập tay) ---
    const cogsAll = delivered.reduce((s, o) => s + orderCost(o).cost, 0) + pendingCogs;
    // Chi phí cố định/biến đổi CHỈ là khoản NHẬP TAY từ Thu chi vận hành (đã
    // qua luật lọc manualTxnScope) — tuyệt đối không gom phí sàn vào đây.
    const variableExpenseTotal = expenses
      .filter((e) => e.type === ExpenseType.VARIABLE)
      .reduce((s, e) => s + Number(e.amount), 0);
    const fixedExpenseTotal = expenses
      .filter((e) => e.type === ExpenseType.FIXED)
      .reduce((s, e) => s + Number(e.amount), 0);
    const totalCostColumn =
      cogsAll + platformFeeTotal + variableExpenseTotal + fixedExpenseTotal;

    // --- CỘT 4: LỢI NHUẬN ---
    // Lợi nhuận thực tế: từ đơn ĐÃ HOÀN THÀNH (đã quyết toán xong)
    const settledCogs = settledOrders.reduce((s, o) => s + orderCost(o).cost, 0);
    // Lợi nhuận THỰC TẾ: tiền thực nhận từ đơn Hoàn thành (đã trừ SẴN phí sàn trong
    // actualPayout) − giá vốn − chi phí biến đổi − chi phí cố định. KHÔNG gồm THU
    // vận hành (tách thành dòng riêng), không trừ phí sàn lần nữa.
    const actualProfit =
      settledPayout - settledCogs - variableExpenseTotal - fixedExpenseTotal;
    // Lợi nhuận dự kiến: từ đơn ĐANG CHỜ (số tạm tính)
    const expectedProfit = pendingPayout - pendingCogs;
    // TỔNG LỢI NHUẬN TẠM TÍNH = Thực tế + Dự kiến — hiệu năng của toàn bộ đơn
    // trong kỳ, CHƯA trừ nghĩa vụ thuế (2 dòng thuế nằm ở cột Chi phí).
    // "Thu nhập vận hành khác" KHÔNG cộng vào đây — nó là khoản ngoài đơn hàng,
    // hiển thị ở cuối cột Doanh thu cho đúng bản chất kế toán.
    const provisionalProfit = actualProfit + expectedProfit;

    // Tổng doanh thu + tổng giá vốn + tổng phí sàn (đơn Đã giao)
    let totalRevenue = 0;
    let totalCost = 0;
    let totalPlatformFee = 0;
    const revenueByDay = new Map<string, number>();
    const cogsByDay = new Map<string, number>();
    for (const o of delivered) {
      const revenue = Number(o.totalAmount);
      const { fee } = orderPlatformFee(o); // ưu tiên số quyết toán thực tế
      const { cost } = orderCost(o);
      totalRevenue += revenue;
      totalCost += cost;
      totalPlatformFee += fee;
      const key = toDateKey(o.createdAt);
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + revenue);
      // Chi phí trong ngày gồm giá vốn + phí sàn của đơn
      cogsByDay.set(key, (cogsByDay.get(key) ?? 0) + cost + fee);
    }
    // Lợi nhuận gộp = Doanh thu − Giá vốn (giữ nguyên chuẩn kế toán)
    const grossProfit = totalRevenue - totalCost;

    // Chi phí vận hành: tổng + phân rã cố định/biến đổi + theo ngày chi
    let totalOperatingExpense = 0;
    let fixedExpense = 0;
    let variableExpense = 0;
    const expenseByDay = new Map<string, number>();
    for (const e of expenses) {
      const amt = Number(e.amount);
      totalOperatingExpense += amt;
      if (e.type === ExpenseType.FIXED) fixedExpense += amt;
      else variableExpense += amt;
      const key = toDateKey(e.expenseDate);
      expenseByDay.set(key, (expenseByDay.get(key) ?? 0) + amt);
    }

    // Lợi nhuận thuần = Lợi nhuận gộp − Phí sàn − Chi phí vận hành
    const netProfit = grossProfit - totalPlatformFee - totalOperatingExpense;

    // ============================================================
    // THUẾ (module Hóa đơn & Thuế) — đọc cấu hình trang "Thuế bổ sung"
    // qua tax-config.ts, cùng công thức với /api/tax/report.
    //
    // Thuế sàn TMĐT khấu trừ tại nguồn trên DOANH THU GỐC:
    //  - Đơn ĐÃ quyết toán: số THẬT sàn đã trích (taxWithheld) — khoản này đã
    //    bị trừ sẵn trong actualPayout, tức ĐÃ phản ánh trong lợi nhuận thực
    //    tế. Chỉ báo cáo, KHÔNG trừ lần nữa kẻo trùng.
    //  - Đơn CHƯA quyết toán (kể cả đang đi đường): ước tính theo % cấu hình.
    // ============================================================
    // Cơ sở ước tính dùng DOANH THU GỐC (orderGrossRevenue) — cùng công thức
    // revenueGross của /realized-pnl để hai màn hình ra CÙNG một số thuế.
    let platformTaxActual = 0;
    let platformTaxEstimateBase = 0;
    for (const o of delivered) {
      if (o.isSettled) platformTaxActual += Number(o.taxWithheld);
      else platformTaxEstimateBase += orderGrossRevenue(o);
    }
    for (const o of inFlight) {
      platformTaxEstimateBase += orderGrossRevenue(o);
    }
    const platformTaxEstimated = platformTaxOn(platformTaxEstimateBase);

    // Thuế bổ sung: cơ sở tính theo cấu hình (lợi nhuận tạm tính / doanh thu).
    const additionalTax = additionalTaxOn(
      { grossRevenue: grossValue, profit: provisionalProfit },
      taxCfg
    );

    // LỢI NHUẬN RÒNG SAU THUẾ — công thức lũy kế của cột Lợi nhuận:
    //   = Lợi nhuận thực tế + Lợi nhuận dự kiến
    //     − Thuế sàn TMĐT ước tính − Thuế bổ sung dự phòng
    // Phần thuế sàn THẬT không trừ (đã nằm trong actualPayout như ghi chú trên).
    const netProfitAfterTax =
      provisionalProfit - platformTaxEstimated - additionalTax;

    // Cột CHI PHÍ gồm cả 2 dòng nghĩa vụ thuế (chuyển từ cột Lợi nhuận sang) —
    // tổng cột phải khớp tổng các dòng bên trong nó.
    // Dòng thuế sàn hiển thị SỐ ĐẦY ĐỦ = thuế THẬT (GTGT + TNCN sàn đã trích
    // trên đơn quyết toán, từ dữ liệu đối soát) + ước tính cho đơn chưa quyết
    // toán — khớp cột Thuế của bảng Lãi/Lỗ Thực Hiện. LƯU Ý: phần thuế THẬT đã
    // trừ sẵn trong actualPayout nên netProfitAfterTax phía trên KHÔNG trừ lại.
    const platformTaxTotal = platformTaxActual + platformTaxEstimated;
    const totalCostWithTax = totalCostColumn + platformTaxTotal + additionalTax;

    // Chuỗi 14 ngày: Doanh thu vs Tổng chi phí (giá vốn + chi phí vận hành phát sinh trong ngày)
    const days = 14;
    const today = new Date();
    const series: { date: string; label: string; revenue: number; cost: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = toDateKey(d);
      series.push({
        date: key,
        label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        revenue: revenueByDay.get(key) ?? 0,
        cost: (cogsByDay.get(key) ?? 0) + (expenseByDay.get(key) ?? 0),
      });
    }

    res.json({
      deliveredOrderCount: delivered.length,
      totalRevenue,
      totalCost,
      totalPlatformFee,
      // Dòng tiền treo
      pendingPayout, // tiền chờ về (dự kiến, số tạm tính)
      settledPayout, // tiền thực tế đã quyết toán về ví
      pendingOrderCount: inFlight.length,
      settledOrderCount: settledOrders.length,

      // ===== BÓC TÁCH DÒNG TIỀN 4 CỘT =====
      breakdown: {
        // Cột 1 — Tổng giá trị sản phẩm
        gross: {
          total: grossValue,
          orderCount: activeOrders.length,
          items: [
            {
              key: "platform",
              label: "Phí nền tảng",
              hint: "Phí cố định + phí dịch vụ + phí thanh toán sàn thu trên mỗi đơn",
              amount: feePlatform,
              percent: pct(feePlatform, grossValue),
            },
            {
              key: "affiliate",
              label: "Phí tiếp thị liên kết",
              hint: "Hoa hồng trả cho cộng tác viên / KOL khi đơn đến từ link affiliate",
              amount: feeAffiliate,
              percent: pct(feeAffiliate, grossValue),
            },
            {
              key: "voucher",
              label: "Voucher trợ giá của shop",
              hint: "Phần giảm giá do SHOP tự bỏ tiền (không phải sàn tài trợ)",
              amount: feeSellerVoucher,
              percent: pct(feeSellerVoucher, grossValue),
            },
            {
              key: "shipping",
              label: "Chênh lệch phí vận chuyển",
              hint: "Khoản sàn trừ thêm khi phí ship thực tế cao hơn phí đã thu của khách",
              amount: feeShippingDiff,
              percent: pct(feeShippingDiff, grossValue),
            },
            {
              key: "subsidy",
              label: "Trợ giá từ sàn",
              hint: "Khoản sàn hỗ trợ ngược lại cho shop — GIẢM chi phí (nên hiển thị dấu +)",
              amount: -platformSubsidyTotal, // âm vì làm giảm khấu trừ
              percent: -pct(platformSubsidyTotal, grossValue),
            },
          ],
          totalDeduction,
        },

        // Cột 2 — Doanh thu theo trạng thái
        revenue: {
          total: netRevenue,
          items: [
            {
              key: "completed",
              label: "Hoàn thành",
              hint: "Tiền sàn đã phê duyệt và giải ngân vào ví (số quyết toán thực tế)",
              amount: settledPayout,
              percent: pct(settledPayout, netRevenue),
              count: settledOrders.length,
            },
            {
              key: "pending",
              label: "Chờ xử lý",
              hint: "Đơn đang đi đường / chờ đối soát — tính theo % phí tạm tính của kênh",
              amount: pendingPayout,
              percent: pct(pendingPayout, netRevenue),
              count: inFlight.length,
            },
            {
              key: "cancelled",
              label: "Đã hủy",
              hint: "Tổng giá trị đơn bị hủy/bom hàng. Tỷ lệ % giúp quản trị rủi ro",
              amount: cancelledValue,
              percent: cancelRate,
              count: cancelled.length,
            },
            // Khoản THU ngoài đơn hàng — đứng cuối cột Doanh thu cho đúng bản
            // chất kế toán; KHÔNG cộng vào tổng Doanh thu phía trên (tổng đó
            // thuần là tiền từ đơn hàng sau khấu trừ sàn).
            {
              key: "operatingIncome",
              label: "Thu nhập vận hành khác",
              hint: "Khoản thu ngoài đơn hàng (đền bù, thưởng…) nhập tay từ module Thu chi vận hành — không thuộc doanh thu đơn hàng nên không cộng vào tổng cột.",
              amount: operatingIncomeTotal,
              percent: pct(operatingIncomeTotal, netRevenue),
            },
          ],
        },

        // Cột 3 — Chi phí (gồm cả nghĩa vụ thuế — tổng khớp tổng các dòng)
        costs: {
          total: totalCostWithTax,
          items: [
            {
              key: "cogs",
              label: "Giá vốn sản phẩm",
              hint: "Tổng giá vốn (COGS) của các đơn trong bộ lọc, lấy theo giá vốn đã cấu hình cho từng SKU",
              amount: cogsAll,
              percent: pct(cogsAll, totalCostWithTax),
            },
            {
              key: "platformFees",
              label: "Phí sàn",
              hint: "Tổng phí hoạt động sàn cấn trừ từ đối soát: phí cố định + phí thanh toán + phí dịch vụ + phí tiếp thị liên kết (KHÔNG gồm thuế sàn — thuế tách dòng riêng bên dưới). Đơn chưa quyết toán dùng phí tạm tính theo % kênh.",
              amount: platformFeeTotal,
              percent: pct(platformFeeTotal, totalCostWithTax),
            },
            {
              key: "variable",
              label: "Chi phí biến đổi",
              hint: "CHỈ khoản chi biến đổi NHẬP TAY ở Thu chi vận hành (ads, book KOC, đóng gói…). Khi lọc theo sàn/gian, chỉ tính khoản đã gắn đúng sàn/gian đó — khoản không gắn gian chỉ hiện ở \"Tất cả sàn\".",
              amount: variableExpenseTotal,
              percent: pct(variableExpenseTotal, totalCostWithTax),
            },
            {
              key: "fixed",
              label: "Chi phí cố định",
              hint: "CHỈ khoản chi cố định NHẬP TAY ở Thu chi vận hành (mặt bằng, lương nhân sự…). Khi lọc theo sàn/gian, chỉ tính khoản đã gắn đúng sàn/gian đó — khoản không gắn gian chỉ hiện ở \"Tất cả sàn\".",
              amount: fixedExpenseTotal,
              percent: pct(fixedExpenseTotal, totalCostWithTax),
            },
            // ---- Nghĩa vụ thuế (từ cấu hình Hóa đơn & Thuế → Thuế bổ sung).
            // Số DƯƠNG như mọi dòng chi phí khác; cột Lợi nhuận chỉ trừ chúng
            // ở dòng "Lợi nhuận ròng sau thuế".
            {
              key: "platformTax",
              label: "Thuế sàn TMĐT (GTGT + TNCN)",
              hint: `Đơn đã quyết toán: ${Math.round(platformTaxActual).toLocaleString("vi-VN")}đ thuế GTGT + TNCN sàn ĐÃ trích thật theo đối soát (khoản này đã trừ sẵn trong tiền về ví nên Lợi nhuận không trừ lại). Đơn chưa quyết toán: ước tính ${PLATFORM_TAX_RATE * 100}% trên doanh thu gốc.`,
              amount: platformTaxTotal,
              percent: pct(platformTaxTotal, totalCostWithTax),
            },
            {
              key: "additionalTax",
              label: "Thuế bổ sung dự phòng",
              hint:
                taxCfg.calculationBase === "REVENUE"
                  ? `${taxCfg.customTaxRate * 100}% trên DOANH THU của kỳ — cấu hình ở Hóa đơn & Thuế → Thuế bổ sung.`
                  : `${taxCfg.customTaxRate * 100}% trên LỢI NHUẬN tạm tính của kỳ — cấu hình ở Hóa đơn & Thuế → Thuế bổ sung.`,
              amount: additionalTax,
              percent: pct(additionalTax, totalCostWithTax),
            },
          ],
        },

        // Cột 4 — TỔNG LỢI NHUẬN TẠM TÍNH = Thực tế + Dự kiến.
        //
        // Cột này TINH GIẢN, chỉ phân rã theo trạng thái đơn (quản trị rủi ro
        // TMĐT: tiền đã về tay vs tiền đang trên đường). Các khoản đã dời đi:
        //   - Thu nhập vận hành khác → cuối cột Doanh thu.
        //   - 2 dòng nghĩa vụ thuế   → cuối cột Chi phí (số DƯƠNG như mọi dòng
        //     chi phí, hết cảnh item âm nằm lẫn trong cột lợi nhuận gây sai tổng).
        profit: {
          total: provisionalProfit,
          items: [
            // % ở đây là BIÊN LỢI NHUẬN (lãi / dòng tiền tương ứng),
            // không phải tỷ trọng — vì tổng lợi nhuận có thể âm.
            {
              key: "actual",
              label: "Lợi nhuận thực tế",
              hint: "Đơn Đã giao/Hoàn thành: tiền thực nhận về ví (đã trừ phí sàn + thuế sàn trích tại nguồn) − Giá vốn − Chi phí vận hành (biến đổi + cố định).",
              amount: actualProfit,
              percent: pct(actualProfit, settledPayout),
            },
            {
              key: "expected",
              label: "Lợi nhuận dự kiến",
              hint: "Đơn Chờ xử lý/Đang giao: tiền dự kiến nhận (số tạm tính) − giá vốn. Thuế ước tính cho nhóm đơn này nằm ở cột Chi phí.",
              amount: expectedProfit,
              percent: pct(expectedProfit, pendingPayout),
            },
          ],
        },
      },

      grossProfit,
      totalOperatingExpense,
      fixedExpense,
      variableExpense,
      netProfit,

      // ===== THUẾ (từ cấu hình trang "Thuế bổ sung") =====
      taxes: {
        calculationBase: taxCfg.calculationBase,
        platformTaxPercent: PLATFORM_TAX_RATE * 100,
        customTaxPercent: taxCfg.customTaxRate * 100,
        filterPeriod: taxCfg.filterPeriod,
        platformTaxActual, // sàn ĐÃ trích — chỉ để đối soát, đã nằm trong actualPayout
        platformTaxEstimated, // ước tính cho đơn chưa quyết toán — ĐÃ trừ vào netProfitAfterTax
        platformTaxTotal,
        additionalTax,
        netProfitAfterTax,
      },
      series,
      // Từ 30/07: thu/chi vận hành đã LỌC theo sàn/gian (manualTxnScope) nên
      // không còn cảnh "lọc gian nhưng chi phí của cả shop" — giữ field để
      // tương thích ngược, luôn false.
      operatingExpenseIsShopWide: false,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
