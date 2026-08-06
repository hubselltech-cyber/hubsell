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
  readChannelId,
  readChannelName,
  type ChannelScope,
} from "../channel-filter";
import {
  additionalTaxOn,
  getShopTaxConfig,
  PLATFORM_TAX_RATE,
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
// LƯU Ý: riêng LAZADA giá dòng hàng là paid_price ĐÃ trừ voucher shop —
// computePnlRow cộng ngược lại từ sao kê/totalAmount, không xử lý ở đây.
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

// Đổi Date → "yyyy-mm-dd"
function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// GET /api/finance/orders-analysis — quét đơn Đã giao tìm ĐƠN LỖ.
// NGUỒN SỐ: computePnlRow (SSOT) — Lợi nhuận đơn = Doanh thu thực tế
// (platformRevenue, "Tổng tiền" sàn báo) − Giá vốn; Sàn khấu trừ = Giá trị
// đơn − Doanh thu thực tế. ≤ 0 ⇒ ĐƠN LỖ.
// Đơn chứa SKU chưa cấu hình giá vốn ⇒ kèm warning để chủ shop đi nhập giá vốn.
router.get("/orders-analysis", async (req: AuthRequest, res, next) => {
  try {
    const delivered = await fetchPnlOrders(
      channelScope(req),
      parseDateRange(req.query),
      ShippingStatus.DELIVERED
    );

    const analyzed = delivered.map((o) => {
      const r = computePnlRow(o);
      const revenue = r.revenueGross;
      const platformFee = r.revenueGross - r.platformRevenue; // toàn bộ sàn khấu trừ
      const cost = r.costSnapshot;
      const profit = r.profitAfterTax; // = Doanh thu thực tế − giá vốn
      const isLoss = profit <= 0;

      // BÓC TÁCH LÝ DO LỖ:
      // - COST: bán dưới giá vốn (lỗ ngay từ khâu nhập hàng/định giá)
      // - FEE : bán trên giá vốn nhưng sàn khấu trừ ăn hết lãi
      let lossReason: "COST" | "FEE" | null = null;
      if (isLoss && !r.missingCostPrice) {
        lossReason = revenue < cost ? "COST" : "FEE";
      }

      return {
        id: r.id,
        orderCode: r.orderCode,
        customerName: r.customerName,
        channelName: r.channelName,
        shopName: r.shopName,
        createdAt: r.createdAt,
        revenue,
        platformFee,
        isSettled: r.isSettled, // khấu trừ đã là số quyết toán hay còn chờ đối soát
        cost,
        profit, // âm hoặc 0 = lỗ
        isLoss,
        lossReason,
        ...(r.missingCostPrice ? { warning: "Chưa nhập giá vốn" } : {}),
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
// NGUỒN SỐ GỐC DUY NHẤT (SINGLE SOURCE OF TRUTH) CỦA MODULE TÀI CHÍNH
//
// "Lãi/Lỗ Thực Hiện" là nguồn số gốc. Mọi con số tài chính của MỘT đơn
// (doanh thu gốc, từng bucket phí, giá vốn, thuế, lợi nhuận) sinh ra từ đúng
// MỘT hàm computePnlRow() trên đúng MỘT tập đơn fetchPnlOrders():
//   - /realized-pnl : hiển thị từng dòng computePnlRow (chi tiết + phân trang).
//   - /analytics    : Báo cáo dòng tiền — chỉ là VIEW tổng hợp, CHỈ được
//     SUM() các trường của những dòng này theo nhóm; TUYỆT ĐỐI không tự
//     query/tính lại theo công thức riêng.
// Muốn đổi công thức phí/thuế/lãi: sửa MỘT chỗ ở đây, mọi trang tự khớp nhau.
//
// Quy ước: các trường phí bóc riêng để hai bảng tự chọn cột. Đơn ĐÃ QUYẾT TOÁN
// dùng phí thực tế (chính xác); CHƯA quyết toán mọi bucket phí/thuế = 0 ("chờ
// đối soát" — quyết định chủ shop 30/07: sổ đối soát không bịa phí % kênh).
// netRevenue = doanh thu sau khi trừ toàn bộ phí sàn; profit = netRevenue − giá vốn.
// ============================================================

/** Đơn kèm đủ dữ liệu quan hệ để bóc số Lãi/Lỗ. */
type PnlOrder = Prisma.OrderGetPayload<{
  include: {
    channel: { select: { channelName: true; shopName: true } };
    // Kèm SKU kho gốc + ảnh để /sku-pnl gom nhóm — cùng tập đơn SSOT.
    items: { include: { product: { select: { skuCode: true; imageUrl: true } } } };
    inventoryLogs: { include: { product: { select: { costPrice: true } } } };
    lazadaSettlement: true;
  };
}>;

/** TẬP ĐƠN ĐẦU VÀO dùng chung: cùng WHERE, cùng include, cùng trần an toàn.
 * EXPORT cho Tổng quan (/api/analytics) + cash-flow dùng chung SSOT. */
export function fetchPnlOrders(
  scope: ChannelScope,
  range?: DateRangeFilter,
  shippingStatus?: ShippingStatus
): Promise<PnlOrder[]> {
  return prisma.order.findMany({
    where: {
      channel: scope,
      createdAt: range,
      ...(shippingStatus ? { shippingStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      channel: { select: { channelName: true, shopName: true } },
      items: { include: { product: { select: { skuCode: true, imageUrl: true } } } },
      inventoryLogs: {
        where: { changeQuantity: { lt: 0 } },
        include: { product: { select: { costPrice: true } } },
      },
      // Sao kê quyết toán chi tiết Lazada — bảng tab Lazada đọc số thật từ đây.
      lazadaSettlement: true,
    },
    take: 2000, // trần an toàn — báo cáo theo khoảng ngày thường nằm dưới mức này
  });
}

/** Dòng Lãi/Lỗ đã bóc số của một đơn — đơn vị số liệu gốc của mọi báo cáo. */
type PnlRow = ReturnType<typeof computePnlRow>;

// Bóc toàn bộ số liệu tài chính của MỘT đơn — công thức gốc duy nhất.
// EXPORT cho Tổng quan (/api/analytics) dùng chung SSOT, không tự tính riêng.
export function computePnlRow(o: PnlOrder) {
  const { cost, missingCostPrice } = orderCost(o);

  // ---- DOANH THU GỐC & VOUCHER SHOP ----
  // LAZADA khác Shopee/TikTok: OrderItem.price là paid_price ĐÃ trừ voucher
  // shop, còn totalAmount (order.price) là giá GỐC CHƯA trừ (đối chiếu đơn
  // thật 527296226771786: totalAmount 248.000 = "Item Price Credit" sao kê;
  // Σ items 241.676 = 248.000 − 6.324 voucher). Order.sellerVoucher của
  // Lazada luôn 0 (xem chú thích syncLazadaSettlements) nên bóc tại đây:
  //  - ĐÃ đối soát: itemRevenue + sellerVoucher CÓ DẤU của sao kê — đúng số
  //    bảng tab Lazada hiển thị, thẻ Tổng SUM lên là khớp từng xu.
  //  - CHƯA đối soát: suy từ totalAmount − Σ paid_price (phần shop giảm giá).
  let revenueGross = orderGrossRevenue(o);
  let sellerVoucher = Number(o.sellerVoucher);
  if (o.channel.channelName === "LAZADA") {
    const lz = o.lazadaSettlement;
    if (o.isSettled && lz && Number(lz.itemRevenue) !== 0) {
      revenueGross = Number(lz.itemRevenue);
      sellerVoucher = -Number(lz.sellerVoucher); // sao kê âm → magnitude dương
    } else {
      sellerVoucher = Math.max(Number(o.totalAmount) - revenueGross, 0);
      revenueGross += sellerVoucher; // trả cột "Giá trị đơn hàng" về giá gốc
    }
  }

  // Gộp phí theo bucket cột. CẬP NHẬT QUYẾT ĐỊNH CHỦ SHOP 05/08: bảng Lãi/Lỗ
  // hiển thị REAL-TIME — đơn CHƯA quyết toán dùng SỐ ƯỚC TÍNH CỦA CHÍNH SHOPEE
  // (sync từ get_escrow_detail, xem syncShopeePendingEscrowEstimates), gắn
  // nhãn "chờ đối soát" qua isSettled. Vẫn giữ nguyên tắc 30/07: TUYỆT ĐỐI
  // không tự bịa phí % kênh — chưa sync được số của sàn thì cột = 0.
  const feeFixedPayment = Number(o.fixedFee) + Number(o.paymentFee);
  const feeService = Number(o.serviceFee);
  // Phí "dịch vụ PiShip" (bảo hiểm giao hàng Shopee VN) — cột riêng, xem
  // mapShopeeEscrowToOrder. Sàn khác chưa có nguồn → luôn 0.
  const feeSellerProtection = Number(o.sellerProtectionFee);
  const feeAffiliate = Number(o.affiliateFee);
  const platformSubsidy = Number(o.platformSubsidy);
  const shippingFeeDiff = Number(o.shippingFeeDiff);

  // Thuế sàn TMĐT của đơn: số THẬT sàn trích (đã quyết toán) hoặc số sàn ƯỚC
  // TÍNH (chưa quyết toán, sync từ escrow detail). Trang Báo cáo thuế
  // (/api/tax/report) vẫn tự ước nghĩa vụ 1,5% riêng — không dùng trường này.
  const platformTax = Number(o.taxWithheld);

  // DOANH THU THỰC TẾ = Giá trị đơn hàng − giảm giá bằng xu/voucher của Shop.
  // CHƯA trừ phí/thuế sàn — mạch đọc trên UI: Giá trị đơn hàng → các cột phí &
  // thuế bóc tách → Doanh thu thực tế → Giá vốn → Lợi nhuận thực tế.
  const actualRevenue = revenueGross - sellerVoucher;

  // "Doanh thu ước tính" — TÁI LẬP từ các cột phí đã bóc, để ĐỐI CHIẾU với
  // actualPayout: đơn đã quyết toán mà hai số lệch nhau nghĩa là còn khoản
  // chưa bóc đúng cột. Đối chiếu đơn VN thật 2607303CGEHBCA + 260728T943X8PX
  // (05/08/2026):
  //   - platformSubsidy (Shopee) = shopee_discount: sàn giảm trực tiếp vào giá
  //     rồi BÙ LẠI trong escrow → CỘNG. (voucher_from_shopee/coins bù cho
  //     NGƯỜI MUA đã bị loại từ tầng mapping — xem mapShopeeEscrowToOrder.)
  //   - Trừ cả PiShip + thuế sàn thu hộ (trước đây bỏ sót 2 khoản này).
  // Đơn HOÀN (seller_return_refund) cố ý KHÔNG ước — lệch ước tính/payout
  // trên đơn hoàn là tín hiệu thật, đọc theo returnStatus.
  const netRevenue =
    actualRevenue -
    feeFixedPayment -
    feeService -
    feeSellerProtection -
    feeAffiliate -
    shippingFeeDiff -
    platformTax +
    platformSubsidy;
  const profit = netRevenue - cost;

  // DOANH THU THỰC TẾ TRÊN SÀN — "Tổng tiền" sàn báo: đơn ĐÃ đối soát =
  // escrow_amount thật; đơn CHƯA đối soát = escrow_amount ƯỚC TÍNH của sàn
  // (khớp dòng "Doanh thu đơn hàng ước tính" trên Seller Center) nếu đã sync
  // được, không thì rơi về số từ API đơn hàng. UI phân biệt qua isSettled.
  const platformRevenue =
    Number(o.actualPayout) !== 0 ? Number(o.actualPayout) : actualRevenue;

  // LÃI SAU THUẾ = MỘT công thức duy nhất chủ shop chốt (31/07):
  // Doanh thu thực tế − Giá vốn. Đơn đã đối soát: payout đã net hết
  // phí/thuế/xu; đơn chờ: doanh thu tạm từ API đơn − giá vốn (không ước phí).
  const profitAfterTax = platformRevenue - cost;

  return {
    id: o.id,
    orderCode: o.orderCode,
    shippingStatus: o.shippingStatus,
    // Trục hoàn/trả — Tổng quan cần để loại đơn đang hoàn khỏi doanh thu.
    returnStatus: o.returnStatus,
    isSettled: o.isSettled,
    channelId: o.channelId,
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
    // Doanh thu thực tế = Giá trị đơn hàng − voucher/xu Shop (chưa trừ phí/thuế)
    actualRevenue,
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
    feeSellerProtection, // phí "dịch vụ PiShip" (bảo hiểm giao hàng)
    feeAffiliate,
    // Khấu trừ lúc giải ngân — bóc tách hiển thị, đã nằm trong actualPayout
    adWalletTopup: Number(o.adWalletTopup),
    taxWithheld: Number(o.taxWithheld),
    // Hiệu quả
    costSnapshot: cost,
    netRevenue,
    actualPayout: Number(o.actualPayout),
    // "Tổng tiền" sàn báo — nguồn duy nhất của cột "Doanh thu trên sàn"
    platformRevenue,
    profit,
    // Thuế sàn TMĐT (số thật khi đã quyết toán / 0 khi chờ đối soát) + lãi sau thuế
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
}

// ============================================================
// LÃI/LỖ THỰC HIỆN — CHI TIẾT TỪNG ĐƠN THEO SÀN (Shopee / TikTok / Lazada)
// Trả về "detail row" GIÀU trường (superset) kèm dòng sản phẩm; frontend tách
// theo từng sàn để render đúng cột đặc thù. Có phân trang + tóm tắt theo sàn.
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

    // NGUỒN SỐ GỐC: cùng tập đơn + cùng công thức với mọi báo cáo tài chính.
    const orders = await fetchPnlOrders(
      channelScope(req),
      parseDateRange(req.query),
      shippingStatus
    );
    const allRows = orders.map(computePnlRow);

    // Bộ lọc nhanh "Lợi nhuận âm": chỉ giữ đơn LỖ (profit < 0). Áp trước khi
    // phân trang & tóm tắt để số liệu khớp đúng những gì bảng đang hiển thị.
    const lossOnly =
      req.query.lossOnly === "true" || req.query.lossOnly === "1";
    const lossFiltered = lossOnly
      ? allRows.filter((r) => r.profit < 0)
      : allRows;

    // Tìm kiếm theo MÃ ĐƠN (contains, không phân biệt hoa thường) — áp trước
    // phân trang & tóm tắt để mọi con số khớp đúng những gì bảng hiển thị.
    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim().toLowerCase()
        : "";
    const filtered = search
      ? lossFiltered.filter((r) => r.orderCode.toLowerCase().includes(search))
      : lossFiltered;

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
    // platformTax = số THẬT sàn trích của đơn đã quyết toán (đơn chờ đối soát
    // = 0 — không ước tính); profit ở đây CHƯA trừ thuế nên trừ không sợ trùng.
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
    const [channels, pnlOrders, withdrawals, opTxns] = await Promise.all([
      prisma.channel.findMany({
        where: scope,
        orderBy: [{ channelName: "asc" }, { shopName: "asc" }],
        select: { id: true, channelName: true, shopName: true },
      }),
      // NGUỒN SỐ GỐC: cùng tập đơn + cùng công thức computePnlRow với mọi
      // báo cáo (chốt SSOT) — hết cảnh cash-flow tự tính totalAmount − phí
      // riêng rồi lệch với thẻ Doanh thu (Lazada: totalAmount là giá GỐC
      // chưa trừ voucher, tự trừ phí ước % là bịa số).
      fetchPnlOrders(scope),
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
    // Tiền của MỖI đơn = platformRevenue ("Tổng tiền" sàn báo: payout THẬT
    // khi đã quyết toán / số API đơn hàng khi chờ — không ước phí %), khớp
    // từng xu với thẻ Doanh thu của Báo cáo dòng tiền.
    for (const r of pnlOrders.map(computePnlRow)) {
      const row = byChannel.get(r.channelId);
      if (!row) continue;
      if (r.shippingStatus === ShippingStatus.CANCELLED) continue; // hủy → bỏ

      const money = r.platformRevenue;
      if (r.shippingStatus === ShippingStatus.DELIVERED && r.isSettled) {
        row.settled += money; // tiền đã về ví (số THẬT sao kê)
      } else if (r.shippingStatus === ShippingStatus.DELIVERED) {
        row.pendingSettle += money; // đã giao, chờ sàn quyết toán
      } else {
        // đang giao / chuẩn bị, hoặc đang hoàn (chưa quyết toán)
        row.inTransit += money;
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
      // NGUỒN SỐ GỐC: cùng tập đơn SSOT (đơn không có dòng hàng thì vòng phân
      // bổ bên dưới tự bỏ qua — không cần filter riêng).
      fetchPnlOrders(channelScope(req), range, ShippingStatus.DELIVERED),
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
      // Sàn khấu trừ của đơn = Giá trị đơn − Doanh thu thực tế (SSOT) — gồm
      // đủ phí + thuế + voucher/xu; đơn chưa đối soát chỉ gồm voucher đã biết.
      const r = computePnlRow(order);
      const orderFee = r.revenueGross - r.platformRevenue;

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

    // THU/CHI VẬN HÀNH NHẬP TAY — luật lọc theo sàn/gian (khoản gắn 3 mức:
    // đích danh gian / chung cấp sàn fundPlatform / chung toàn shop):
    //   - "Tất cả sàn" (không lọc)   → tính HẾT (cả khoản chung mọi mức).
    //   - Lọc CẤP SÀN (Lazada…)      → khoản gắn gian thuộc sàn đó + khoản
    //     chung CỦA SÀN đó (fundPlatform); khoản chung toàn shop KHÔNG tính.
    //   - Lọc đích danh MỘT gian     → CHỈ khoản gắn đúng gian đó; mọi khoản
    //     chung (cấp sàn lẫn toàn shop) đều KHÔNG tính.
    // Không chia đều, không gom phí sàn cấn trừ vào đây.
    const filterChannelId = readChannelId(req);
    const filterChannelName = readChannelName(req);
    const manualTxnScope = filterChannelId
      ? { fundChannelId: { not: null }, fundChannel: scope }
      : filterChannelName
        ? {
            OR: [
              { fundChannelId: { not: null }, fundChannel: scope },
              { fundChannelId: null, fundPlatform: filterChannelName },
            ],
          }
        : {};

    const [pnlOrders, expenses, operatingIncomeAgg, adSpendAgg, taxCfg] = await Promise.all([
      // NGUỒN SỐ GỐC: CÙNG tập đơn + CÙNG công thức với trang Lãi/Lỗ Thực Hiện
      // (không lọc trạng thái = tab "Tất cả" bên Lãi/Lỗ; cùng WHERE, cùng trần).
      fetchPnlOrders(scope, range),
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
      // CHI PHÍ QUẢNG CÁO SÀN theo ngày (bảng AdSpend, sync từ Ads API) —
      // lọc theo cùng channel scope với tập đơn, khoảng ngày theo bộ lọc.
      prisma.adSpend.aggregate({
        _sum: { amount: true },
        where: { channel: scope, ...(range ? { date: range } : {}) },
      }),
      // Cấu hình thuế của shop (trang "Thuế bổ sung") — dùng ở khối THUẾ dưới cùng.
      getShopTaxConfig(ownerId),
    ]);
    const operatingIncomeTotal = Number(operatingIncomeAgg._sum.amount ?? 0);
    const adsSpendTotal = Number(adSpendAgg._sum.amount ?? 0);

    // ============================================================
    // VIEW TỔNG HỢP TỪ NGUỒN SỐ GỐC — mọi con số bên dưới CHỈ là SUM() các
    // trường của dòng computePnlRow: trang Lãi/Lỗ có đơn nào thì đây có đơn
    // đó, Lãi/Lỗ hiển thị số nào thì đây cộng đúng số đó. Không tính lại.
    // ============================================================
    const pnlRows = pnlOrders.map(computePnlRow);
    const sumBy = (rows: PnlRow[], pick: (r: PnlRow) => number) =>
      rows.reduce((s, r) => s + pick(r), 0);

    // Phân nhóm theo trạng thái — cùng trục với tab lọc bên Lãi/Lỗ.
    const cancelledRows = pnlRows.filter(
      (r) => r.shippingStatus === ShippingStatus.CANCELLED
    );
    const activeRows = pnlRows.filter(
      (r) => r.shippingStatus !== ShippingStatus.CANCELLED
    );
    const settledRows = activeRows.filter((r) => r.isSettled);
    // "Chờ quyết toán" = sàn chưa giải ngân: đang đi đường HOẶC đã giao nhưng
    // chưa đối soát (nhóm đã-giao-chưa-quyết-toán trước đây bị bỏ sót khỏi cả
    // hai dòng doanh thu/lợi nhuận — nay theo đúng trục isSettled của Lãi/Lỗ).
    const pendingRows = activeRows.filter((r) => !r.isSettled);
    const deliveredRows = activeRows.filter(
      (r) => r.shippingStatus === ShippingStatus.DELIVERED
    );

    // ===== DÒNG TIỀN TREO =====
    const settledPayout = sumBy(settledRows, (r) => r.actualPayout); // đã về ví
    const pendingNetRevenue = sumBy(pendingRows, (r) => r.netRevenue); // chờ về

    // --- CỘT 1: TỔNG GIÁ TRỊ SẢN PHẨM = Σ cột "Doanh thu gốc" của Lãi/Lỗ ---
    // Mang TOÀN BỘ khấu trừ của sàn (phí + thuế + voucher + chênh lệch VC −
    // trợ giá) để: Giá trị sản phẩm − Tổng khấu trừ = thẻ DOANH THU (thác
    // nước 4 thẻ, chốt chủ shop 31/07).
    const grossValue = sumBy(activeRows, (r) => r.revenueGross);
    // Phí nền tảng = CĐ + thanh toán + dịch vụ + PiShip (bảo hiểm giao hàng).
    const feePlatform = sumBy(
      activeRows,
      (r) => r.feeFixedPayment + r.feeService + r.feeSellerProtection
    );
    const feeAffiliate = sumBy(activeRows, (r) => r.feeAffiliate);
    const feeSellerVoucher = sumBy(activeRows, (r) => r.sellerVoucher);
    // Từ 05/08 các bucket SUM trên TOÀN BỘ đơn hoạt động: đơn chờ quyết toán
    // đã mang SỐ ƯỚC TÍNH CỦA CHÍNH SHOPEE (syncShopeePendingEscrowEstimates,
    // chưa sync = 0) — SUM cả hai nhóm thì thác nước Giá trị SP − Khấu trừ =
    // thẻ Doanh thu mới khớp từng đồng với platformRevenue mới của đơn chờ.
    const feeShippingDiff = sumBy(activeRows, (r) => r.shippingFeeDiff);
    const platformSubsidyTotal = sumBy(activeRows, (r) => r.platformSubsidy);
    const adWalletTotal = sumBy(activeRows, (r) => r.adWalletTopup);
    // Thuế sàn TMĐT = Σ cột "Thuế sàn" (platformTax): số THẬT (đơn quyết toán)
    // + số sàn ước tính (đơn chờ) — là một DÒNG KHẤU TRỪ của thẻ Tổng giá trị
    // SP, không thuộc Chi phí.
    const platformTaxActual = sumBy(settledRows, (r) => r.platformTax);
    const platformTaxEstimated = sumBy(pendingRows, (r) => r.platformTax);
    const platformTaxTotal = platformTaxActual + platformTaxEstimated;

    const totalDeduction =
      feePlatform +
      feeAffiliate +
      platformTaxTotal +
      feeSellerVoucher +
      feeShippingDiff +
      adWalletTotal -
      platformSubsidyTotal;

    // --- CỘT 2: DOANH THU THỰC TẾ = Σ platformRevenue ("Tổng tiền" sàn báo):
    // đơn đã quyết toán = actualPayout (tiền THẬT về ví, đã cấn trừ hết
    // phí/thuế/xu); đơn chờ = số từ API đơn hàng (tạm tính). Phí & thuế sàn
    // KHÔNG nằm ở cột Chi phí nữa — chúng là khấu trừ của thẻ Tổng giá trị SP;
    // nhờ vậy: Giá trị SP − Khấu trừ = Doanh thu, Doanh thu − Chi phí = LN.
    const actualRevenueTotal = sumBy(activeRows, (r) => r.platformRevenue);
    const settledActualRevenue = sumBy(settledRows, (r) => r.platformRevenue);
    const pendingActualRevenue = sumBy(pendingRows, (r) => r.platformRevenue);
    const cancelledValue = sumBy(cancelledRows, (r) => r.revenueGross);
    const cancelRate = pct(cancelledRows.length, pnlRows.length);

    // --- CỘT 3: CHI PHÍ (giá vốn + chi phí vận hành nhập tay + thuế bổ sung).
    // KHÔNG còn dòng Phí sàn/Thuế sàn (đã cấn trừ trong Doanh thu, giữ lại là
    // trừ trùng — chốt chủ shop 31/07; chi tiết phí vẫn xem ở thẻ Tổng giá
    // trị SP + bảng Lãi/Lỗ). ---
    const cogsAll = sumBy(activeRows, (r) => r.costSnapshot);
    // Chi phí cố định/biến đổi CHỈ là khoản NHẬP TAY từ Thu chi vận hành (đã
    // qua luật lọc manualTxnScope) — tuyệt đối không gom phí sàn vào đây.
    const variableExpenseTotal = expenses
      .filter((e) => e.type === ExpenseType.VARIABLE)
      .reduce((s, e) => s + Number(e.amount), 0);
    const fixedExpenseTotal = expenses
      .filter((e) => e.type === ExpenseType.FIXED)
      .reduce((s, e) => s + Number(e.amount), 0);
    // + Chi phí quảng cáo sàn (AdSpend — sync tự động, tách khỏi khoản nhập tay).
    const totalCostColumn =
      cogsAll + variableExpenseTotal + fixedExpenseTotal + adsSpendTotal;

    // --- CỘT 4: LỢI NHUẬN ---
    // Thực tế = Σ cột "Lãi sau thuế" (profitAfterTax) của đơn ĐÃ QUYẾT TOÁN
    // trên Lãi/Lỗ − chi phí vận hành nhập tay. KHÔNG gồm THU vận hành (tách
    // dòng riêng), không trừ phí sàn lần nữa (netRevenue đã trừ).
    const actualProfit =
      sumBy(settledRows, (r) => r.profitAfterTax) -
      variableExpenseTotal -
      fixedExpenseTotal -
      adsSpendTotal;
    // Dự kiến = Σ cột "Lãi sau thuế" (profitAfterTax) của đơn chờ quyết toán.
    // Nhóm này CHƯA bị trừ phí/thuế nào (bucket = 0, chờ đối soát) — cột Chi
    // phí cũng không chứa khoản ước tính nào của nhóm.
    const expectedProfit = sumBy(pendingRows, (r) => r.profitAfterTax);
    // TỔNG LỢI NHUẬN TẠM TÍNH = Thực tế + Dự kiến + THU vận hành khác (chốt
    // chủ shop 31/07 chiều: khoản thu nhập tay PHẢI cộng vào tổng lợi nhuận —
    // dời từ cuối cột Doanh thu về lại cột Lợi nhuận làm dòng thứ 3). Đẳng
    // thức thác nước thành: thẻ Lợi nhuận = Doanh thu − Chi phí + Thu khác.
    const provisionalProfit = actualProfit + expectedProfit + operatingIncomeTotal;

    // Tổng doanh thu + tổng giá vốn + tổng phí sàn (đơn Đã giao) — cùng các
    // trường dòng Lãi/Lỗ: doanh thu gốc, giá vốn snapshot, 3 bucket phí sàn.
    let totalRevenue = 0;
    let totalCost = 0;
    let totalPlatformFee = 0;
    const revenueByDay = new Map<string, number>();
    const cogsByDay = new Map<string, number>();
    for (const r of deliveredRows) {
      const fee =
        r.feeFixedPayment + r.feeService + r.feeSellerProtection + r.feeAffiliate;
      totalRevenue += r.revenueGross;
      totalCost += r.costSnapshot;
      totalPlatformFee += fee;
      const key = toDateKey(r.createdAt);
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + r.revenueGross);
      // Chi phí trong ngày gồm giá vốn + phí sàn của đơn
      cogsByDay.set(key, (cogsByDay.get(key) ?? 0) + r.costSnapshot + fee);
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
    // (Thuế sàn TMĐT platformTaxActual/Estimated/Total đã tính ở CỘT 1 —
    // từ 31/07 là dòng khấu trừ của thẻ Tổng giá trị SP.)
    // ============================================================
    // Thuế bổ sung: cơ sở tính theo cấu hình (lợi nhuận tạm tính / doanh thu).
    const additionalTax = additionalTaxOn(
      { grossRevenue: grossValue, profit: provisionalProfit },
      taxCfg
    );

    // LỢI NHUẬN RÒNG SAU THUẾ = Tổng lợi nhuận tạm tính − Thuế bổ sung dự
    // phòng. KHÔNG trừ thuế sàn nữa: thuế THẬT đã nằm sẵn trong actualPayout
    // (tức trong provisionalProfit) — trừ thêm là trừ trùng.
    // Cơ sở tính thuế là LN TRƯỚC thuế (provisionalProfit) — không lấy số sau
    // thuế kẻo thành công thức vòng lặp.
    const netProfitAfterTax = provisionalProfit - additionalTax;

    // Từ 07/08 (chốt nghiệp vụ kế toán): thuế bổ sung KHÔNG nằm trong cột
    // CHI PHÍ nữa — thuế thu nhập không phải chi phí vận hành, để chung làm
    // méo cơ cấu (có kỳ thuế chiếm >90% "chi phí"). Nó thành DÒNG KHẤU TRỪ
    // cuối cột Lợi nhuận: LN trước thuế − Thuế dự phòng = LN ròng (chuẩn P&L).

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
      deliveredOrderCount: deliveredRows.length,
      totalRevenue,
      totalCost,
      totalPlatformFee,
      // Dòng tiền treo
      pendingPayout: pendingNetRevenue, // doanh thu chờ sàn đối soát (CHƯA trừ phí — không ước tính)
      settledPayout, // tiền thực tế đã quyết toán về ví
      pendingOrderCount: pendingRows.length,
      settledOrderCount: settledRows.length,

      // ===== BÓC TÁCH DÒNG TIỀN 4 CỘT =====
      breakdown: {
        // Cột 1 — Tổng giá trị sản phẩm
        gross: {
          total: grossValue,
          orderCount: activeRows.length,
          items: [
            {
              key: "platform",
              label: "Phí nền tảng",
              hint: "Các loại phí sàn thu trên mỗi đơn: phí cố định, phí dịch vụ, phí thanh toán.",
              amount: feePlatform,
              percent: pct(feePlatform, grossValue),
            },
            {
              key: "affiliate",
              label: "Phí tiếp thị liên kết",
              hint: "Hoa hồng trả cho người giới thiệu đơn (cộng tác viên, KOL).",
              amount: feeAffiliate,
              percent: pct(feeAffiliate, grossValue),
            },
            {
              key: "platformTax",
              label: "Thuế sàn TMĐT (GTGT + TNCN)",
              hint: "Thuế sàn thu hộ nhà nước, trừ thẳng vào tiền hàng trước khi trả về shop.",
              amount: platformTaxTotal,
              percent: pct(platformTaxTotal, grossValue),
            },
            {
              key: "voucher",
              label: "Voucher trợ giá của shop",
              hint: "Tiền giảm giá cho khách do shop tự chịu (không phải sàn tài trợ).",
              amount: feeSellerVoucher,
              percent: pct(feeSellerVoucher, grossValue),
            },
            {
              key: "shipping",
              label: "Chênh lệch phí vận chuyển",
              hint: "Phí ship thực tế cao hơn phí đã thu của khách — sàn trừ phần chênh vào shop.",
              amount: feeShippingDiff,
              percent: pct(feeShippingDiff, grossValue),
            },
            {
              key: "adWallet",
              label: "Nạp ví quảng cáo",
              hint: "Tiền sàn giữ lại từ đơn hàng để nạp vào ví quảng cáo của shop.",
              amount: adWalletTotal,
              percent: pct(adWalletTotal, grossValue),
            },
            {
              key: "subsidy",
              label: "Trợ giá từ sàn",
              hint: "Tiền sàn hỗ trợ thêm cho shop — được cộng ngược lại (dấu +).",
              amount: -platformSubsidyTotal, // âm vì làm giảm khấu trừ
              percent: -pct(platformSubsidyTotal, grossValue),
            },
          ],
          totalDeduction,
        },

        // Cột 2 — DOANH THU THỰC TẾ theo trạng thái (Σ platformRevenue =
        // "Tổng tiền" sàn báo — từ 31/07 chính là cột "Doanh thu trên sàn"
        // của bảng Lãi/Lỗ; = Giá trị sản phẩm − Tổng khấu trừ của thẻ 1)
        revenue: {
          total: actualRevenueTotal,
          items: [
            {
              key: "completed",
              label: "Hoàn thành",
              hint: "Tiền các đơn sàn đã đối soát xong và trả về ví — số thật, đã trừ hết phí.",
              amount: settledActualRevenue,
              percent: pct(settledActualRevenue, actualRevenueTotal),
              count: settledRows.length,
            },
            {
              key: "pending",
              label: "Chờ xử lý",
              hint: "Tiền các đơn đang chờ sàn đối soát — tạm tính, chưa trừ phí sàn.",
              amount: pendingActualRevenue,
              percent: pct(pendingActualRevenue, actualRevenueTotal),
              count: pendingRows.length,
            },
            {
              key: "cancelled",
              label: "Đã hủy",
              hint: "Tổng giá trị đơn bị hủy hoặc bom hàng — không tính vào doanh thu.",
              amount: cancelledValue,
              percent: cancelRate,
              count: cancelledRows.length,
            },
            // (Khoản THU vận hành nhập tay đã dời về cột Lợi nhuận — dòng thứ
            // 3, CỘNG vào tổng lợi nhuận tạm tính; chốt chủ shop 31/07 chiều.)
          ],
        },

        // Cột 3 — Chi phí = giá vốn + vận hành nhập tay (thuần chi phí VẬN
        // HÀNH). Phí sàn & Thuế sàn KHÔNG ở đây (chốt 31/07): đã bị sàn cấn
        // trừ TRƯỚC KHI ra thẻ Doanh thu. Thuế bổ sung dự phòng cũng KHÔNG ở
        // đây (chốt 07/08) — nó là dòng khấu trừ của cột Lợi nhuận.
        costs: {
          total: totalCostColumn,
          items: [
            {
              key: "cogs",
              label: "Giá vốn sản phẩm",
              hint: "Tiền vốn nhập hàng của các đơn trong kỳ (theo giá vốn đã cấu hình cho từng sản phẩm).",
              amount: cogsAll,
              percent: pct(cogsAll, totalCostColumn),
            },
            {
              key: "adsSpend",
              label: "Chi phí quảng cáo sàn (Ads)",
              hint: "Tiền quảng cáo đã tiêu trên sàn — hệ thống tự lấy về mỗi ngày, không cần nhập tay.",
              amount: adsSpendTotal,
              percent: pct(adsSpendTotal, totalCostColumn),
            },
            {
              key: "variable",
              label: "Chi phí biến đổi",
              hint: "Chi phí phát sinh theo đơn bạn nhập ở Thu chi vận hành (đóng gói, book KOC…).",
              amount: variableExpenseTotal,
              percent: pct(variableExpenseTotal, totalCostColumn),
            },
            {
              key: "fixed",
              label: "Chi phí cố định",
              hint: "Chi phí hằng tháng bạn nhập ở Thu chi vận hành (mặt bằng, lương nhân sự…).",
              amount: fixedExpenseTotal,
              percent: pct(fixedExpenseTotal, totalCostColumn),
            },
          ],
        },

        // Cột 4 — TỔNG LỢI NHUẬN TẠM TÍNH = Thực tế + Dự kiến + Thu vận hành
        // khác (dòng 3 — chốt chủ shop 31/07 chiều: khoản thu nhập tay phải
        // CỘNG vào tổng; trước đó nằm tham khảo cuối cột Doanh thu).
        //
        // Từ 07/08 (chuẩn P&L kế toán): 3 dòng trên = LN TRƯỚC thuế; dòng 4
        // "Thuế bổ sung dự phòng" amount ÂM (colorBySign của FE tự render
        // "− đỏ") → tổng thẻ = Σ items = LN RÒNG sau thuế dự phòng. Đẳng thức
        // thác nước: Doanh thu − Chi phí + Thu khác − Thuế dự phòng = LN ròng.
        profit: {
          total: netProfitAfterTax,
          items: [
            // % ở đây là BIÊN LỢI NHUẬN (lãi / dòng tiền tương ứng),
            // không phải tỷ trọng — vì tổng lợi nhuận có thể âm.
            {
              key: "actual",
              label: "Lợi nhuận thực tế",
              hint: "Lãi của các đơn sàn đã đối soát xong — đã trừ đủ phí sàn, giá vốn và chi phí vận hành.",
              amount: actualProfit,
              percent: pct(actualProfit, settledActualRevenue),
            },
            {
              key: "expected",
              label: "Lợi nhuận dự kiến",
              hint: "Lãi tạm tính của đơn chưa đối soát — chưa trừ phí sàn nên số cuối có thể thấp hơn một chút.",
              amount: expectedProfit,
              percent: pct(expectedProfit, pendingActualRevenue),
            },
            {
              key: "operatingIncome",
              label: "Thu nhập vận hành khác",
              hint: "Khoản thu ngoài đơn hàng (đền bù, thưởng, hoàn tiền…) bạn nhập ở Thu chi vận hành.",
              amount: operatingIncomeTotal,
              percent: pct(operatingIncomeTotal, actualRevenueTotal),
            },
            // Dòng khấu trừ thuế (amount ÂM): trích lập dự phòng thuế thu
            // nhập — đứng DƯỚI lợi nhuận trước thuế theo chuẩn P&L, không
            // phải chi phí vận hành. % = tỷ lệ ăn vào LN trước thuế. Shop
            // chưa cấu hình % (thuế = 0) thì ẨN dòng cho gọn — thẻ về đúng
            // 3 dòng như trước, tổng không đổi.
            ...(additionalTax > 0
              ? [
                  {
                    key: "additionalTax",
                    label: "Thuế bổ sung dự phòng",
                    // KHÔNG nêu con số % trong câu (mỗi shop cài một mức khác
                    // nhau) — tỷ lệ thật đã hiện ở dòng note ngay dưới số tiền.
                    hint:
                      "Trích một phần " +
                      (taxCfg.calculationBase === "REVENUE"
                        ? "doanh thu"
                        : "lợi nhuận") +
                      " theo mức % bạn cài đặt để dành nộp thuế — chỉnh ở Hóa đơn & Thuế → Thuế bổ sung.",
                    amount: -additionalTax,
                    percent: pct(additionalTax, provisionalProfit),
                  },
                ]
              : []),
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
        platformTaxEstimated, // luôn 0 từ 30/07 (không ước thuế đơn chờ) — giữ field cho FE cũ
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
