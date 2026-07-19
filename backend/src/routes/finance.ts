import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import {
  ChannelName,
  ExpenseCategory,
  ExpenseType,
  Prisma,
  ChannelProductStatus,
  ShippingDisputeStatus,
  ShippingStatus,
} from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { MOCK_CATALOG, mockImageFor } from "../mockMarketplace";
import { parseDateRange, type DateRangeFilter } from "../date-range";

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
// - POST /expenses        : thêm chi phí vận hành (FIXED/VARIABLE)
// - GET  /orders-analysis : quét đơn Đã giao, tìm ĐƠN HÀNG LỖ
// - GET  /analytics       : doanh thu / lãi gộp / lãi thuần + chuỗi ngày
// Giá vốn của đơn ưu tiên lấy từ OrderItem.costPriceAtSale (snapshot lúc bán);
// đơn cũ chưa có OrderItem thì fallback qua InventoryLog × giá vốn hiện tại.
// ============================================================

const VALID_TYPES: ExpenseType[] = [ExpenseType.FIXED, ExpenseType.VARIABLE];
const VALID_CATEGORIES: ExpenseCategory[] = [
  ExpenseCategory.RENT,
  ExpenseCategory.SALARY,
  ExpenseCategory.PACKAGING,
  ExpenseCategory.ADS,
  ExpenseCategory.OTHER,
];

// Kiểu đơn đã kèm dữ liệu tính giá vốn
type DeliveredOrder = Prisma.OrderGetPayload<{
  include: {
    channel: { select: { channelName: true } };
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

// Phí sàn thực dùng cho một đơn:
// - Đã quyết toán → dùng số THỰC TẾ sàn trả về (fixed + service + payment − trợ giá)
// - Chưa quyết toán → dùng số TẠM TÍNH theo % của kênh
interface FeeFields {
  isSettled: boolean;
  platformFee: Prisma.Decimal;
  fixedFee: Prisma.Decimal;
  serviceFee: Prisma.Decimal;
  paymentFee: Prisma.Decimal;
  affiliateFee: Prisma.Decimal;
  sellerVoucher: Prisma.Decimal;
  shippingFeeDiff: Prisma.Decimal;
  platformSubsidy: Prisma.Decimal;
}

function orderPlatformFee(order: FeeFields): { fee: number; isSettled: boolean } {
  if (order.isSettled) {
    const fee =
      Number(order.fixedFee) +
      Number(order.serviceFee) +
      Number(order.paymentFee) +
      Number(order.affiliateFee) +
      Number(order.sellerVoucher) +
      Number(order.shippingFeeDiff) -
      Number(order.platformSubsidy);
    return { fee, isSettled: true };
  }
  return { fee: Number(order.platformFee), isSettled: false };
}

// Tỷ lệ % của một khoản so với tổng (làm tròn 2 chữ số, tránh chia cho 0)
function pct(amount: number, total: number): number {
  if (!total) return 0;
  return Math.round((amount / total) * 10000) / 100;
}

// Lấy toàn bộ đơn Đã giao của shop kèm dữ liệu giá vốn
function fetchDeliveredOrders(ownerId: string, range?: DateRangeFilter) {
  return prisma.order.findMany({
    where: {
      channel: { userId: ownerId },
      shippingStatus: "DELIVERED",
      createdAt: range,
    },
    orderBy: { createdAt: "desc" },
    include: {
      channel: { select: { channelName: true } },
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

// POST /api/finance/expenses — thêm chi phí vận hành
// Body: { description (hoặc name), type: FIXED|VARIABLE, amount, category?, note?, expenseDate? }
router.post("/expenses", async (req: AuthRequest, res, next) => {
  try {
    const {
      description,
      name,
      type,
      category,
      amount,
      note,
      expenseDate,
      appliedSku,
    } = req.body ?? {};

    const finalName = typeof description === "string" && description.trim()
      ? description.trim()
      : typeof name === "string" ? name.trim() : "";
    if (!finalName) {
      res.status(400).json({ error: "Vui lòng nhập mô tả khoản chi" });
      return;
    }
    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ error: "Phân loại phải là FIXED (cố định) hoặc VARIABLE (biến đổi)" });
      return;
    }
    const amt = typeof amount === "string" ? Number(amount) : amount;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt <= 0) {
      res.status(400).json({ error: "Số tiền phải là số dương" });
      return;
    }
    const finalCategory = VALID_CATEGORIES.includes(category)
      ? (category as ExpenseCategory)
      : ExpenseCategory.OTHER;

    let date: Date | undefined;
    if (expenseDate !== undefined && expenseDate !== "") {
      const d = new Date(expenseDate);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Ngày chi không hợp lệ" });
        return;
      }
      date = d;
    }

    // Chi phí BIẾN ĐỔI có thể gắn vào 1 SKU cụ thể; chi phí CỐ ĐỊNH thì không.
    let finalSku: string | null = null;
    if (type === ExpenseType.VARIABLE && typeof appliedSku === "string" && appliedSku.trim()) {
      const sku = appliedSku.trim().toUpperCase();
      const product = await prisma.product.findUnique({
        where: { userId_skuCode: { userId: req.ownerId!, skuCode: sku } },
        select: { skuCode: true },
      });
      if (!product) {
        res.status(404).json({ error: `Không tìm thấy sản phẩm có mã SKU "${sku}"` });
        return;
      }
      finalSku = product.skuCode;
    }

    const expense = await prisma.operatingExpense.create({
      data: {
        userId: req.ownerId!,
        name: finalName,
        type: type as ExpenseType,
        category: finalCategory,
        appliedSku: finalSku,
        amount: amt,
        note: typeof note === "string" && note.trim() ? note.trim() : null,
        ...(date ? { expenseDate: date } : {}),
      },
    });
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

// GET /api/finance/orders-analysis — quét đơn Đã giao.
// Lợi nhuận đơn = Doanh thu − Phí sàn − Tổng giá vốn. ≤ 0 ⇒ ĐƠN LỖ.
// Đơn chứa SKU chưa cấu hình giá vốn ⇒ kèm warning để chủ shop đi nhập giá vốn.
router.get("/orders-analysis", async (req: AuthRequest, res, next) => {
  try {
    const delivered = await fetchDeliveredOrders(
      req.ownerId!,
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

// GET /api/finance/expenses — danh sách chi phí vận hành
router.get("/expenses", async (req: AuthRequest, res, next) => {
  try {
    const expenses = await prisma.operatingExpense.findMany({
      where: { userId: req.ownerId!, expenseDate: parseDateRange(req.query) },
      orderBy: { expenseDate: "desc" },
    });
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

// GET /api/finance/sku-products?channel=all|shopee|tiktok|lazada|offline
// Danh sách SKU (đã đồng bộ từ sàn) để chủ shop nhập giá vốn.
// - Kênh cụ thể  → các SKU sàn đã liên kết của kênh đó
// - offline      → sản phẩm kho chưa liên kết sàn nào (bán tại quầy)
// - all          → cả hai
router.get("/sku-products", async (req: AuthRequest, res, next) => {
  try {
    const raw = typeof req.query.channel === "string" ? req.query.channel : "all";
    const channel = raw.toLowerCase();

    const rows: {
      skuId: string; // id dùng để cập nhật giá vốn (mapping id hoặc product id)
      productId: string;
      sku: string;
      productName: string;
      variantName: string | null; // phân loại (màu/size) — tên hiển thị trên sàn
      channelName: ChannelName;
      shopName: string; // gian hàng cụ thể — phân biệt 2 shop cùng một sàn
      imageUrl: string | null;
      sellingPrice: string;
      costPrice: string;
    }[] = [];

    // 1) SKU trên sàn ĐÃ liên kết về kho gốc.
    // Chỉ lấy dòng có productId: giá vốn thuộc về sản phẩm gốc, sản phẩm sàn
    // chưa liên kết thì chưa có kho nào để gắn giá vốn vào.
    if (channel !== "offline") {
      const channelProducts = await prisma.channelProduct.findMany({
        where: {
          productId: { not: null },
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
        rows.push({
          skuId: cp.id,
          productId: cp.productId!,
          sku: cp.channelSku,
          productName: cp.product!.productName,
          variantName: cp.variantName ?? cp.productName,
          channelName: cp.channel.channelName,
          shopName: cp.channel.shopName,
          imageUrl: cp.product!.imageUrl,
          sellingPrice: String(cp.product!.sellingPrice),
          costPrice: String(cp.product!.costPrice),
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
          channel: { userId: ownerId },
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
          missingCost: r.quantitySold > 0 && r.cogs <= 0,
          breakEven,
        };
      })
      // "Gà đẻ trứng vàng" lên đầu, mã gánh lỗ xuống cuối
      .sort((a, b) => b.profit - a.profit);

    // Chi phí cố định KHÔNG phân bổ vào SKU — trừ vào tổng lợi nhuận toàn shop
    const fixedTotal = await prisma.operatingExpense.aggregate({
      where: { userId: ownerId, type: ExpenseType.FIXED },
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
    const channelKey =
      typeof req.query.channel === "string" ? req.query.channel.toLowerCase() : "all";
    const statusKey =
      typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";

    const where: Prisma.OrderWhereInput = {
      channel: {
        userId: req.ownerId!,
        ...(CHANNEL_BY_KEY[channelKey]
          ? { channelName: CHANNEL_BY_KEY[channelKey] }
          : {}),
      },
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
        include: { channel: { select: { channelName: true } } },
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
// Lấy danh mục sản phẩm (mã SKU, tên/biến thể, giá bán, ảnh) từ từng gian hàng
// đang ACTIVE rồi UPSERT vào bảng đệm ChannelProduct:
//   - SKU sàn chưa có   → tạo Product mới (giá vốn = 0 để chủ shop nhập) + liên kết
//   - SKU sàn đã có     → cập nhật tên hiển thị/ảnh trên sàn
// LƯU Ý: KHÔNG bao giờ ghi đè giá vốn (costPrice) vì đó là dữ liệu chủ shop tự nhập.
//
// Khi tích hợp API thật: thay MOCK_CATALOG bằng lời gọi API Shopee/TikTok/Lazada,
// phần upsert bên dưới giữ nguyên.
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
    }[] = [];

    for (const channel of channels) {
      const catalog = MOCK_CATALOG[channel.channelName];
      let createdHere = 0;
      const now = new Date();

      for (const item of catalog) {
        // CHỈ ghi vào bảng đệm. KHÔNG tạo Product ở đây — tên và mã trên các
        // shop sàn thường lệch nhau, đẩy thẳng vào kho vật lý là sinh rác
        // không dọn nổi. Sản phẩm gốc chỉ do con người tạo ở trang Sản phẩm,
        // rồi nối thủ công tại trang Liên kết SP.
        const existing = await prisma.channelProduct.findUnique({
          where: {
            channelId_channelSku: {
              channelId: channel.id,
              channelSku: item.channelSku,
            },
          },
          select: { id: true },
        });

        const data = {
          productName: item.name,
          price: item.price,
          imageUrl: mockImageFor(channel.channelName, item.name),
          status: ChannelProductStatus.ACTIVE,
          lastSyncedAt: now,
        };

        if (existing) {
          // Cập nhật thông tin hiển thị từ sàn. TUYỆT ĐỐI không đụng vào
          // productId — liên kết là do người dùng cấu hình, đồng bộ không được
          // tự ý gỡ hay đổi.
          await prisma.channelProduct.update({
            where: { id: existing.id },
            data,
          });
          updated++;
        } else {
          await prisma.channelProduct.create({
            data: {
              channelId: channel.id,
              channelSku: item.channelSku,
              ...data,
              // productId để trống = chờ người dùng liên kết
            },
          });
          created++;
          createdHere++;
        }
      }

      // Sản phẩm không còn trong danh mục sàn → đánh dấu đã gỡ niêm yết thay vì
      // xoá, để không mất lịch sử liên kết nếu shop bật bán lại.
      const stillListed = catalog.map((c) => c.channelSku);
      await prisma.channelProduct.updateMany({
        where: { channelId: channel.id, channelSku: { notIn: stillListed } },
        data: { status: ChannelProductStatus.DELISTED },
      });

      perChannel.push({
        channelId: channel.id,
        channelName: channel.channelName,
        shopName: channel.shopName,
        scanned: catalog.length,
        created: createdHere,
      });
    }

    res.json({ created, updated, perChannel });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/finance/update-cost — cập nhật giá vốn cho một SKU.
// Body: { sku_id, cost_price }. sku_id có thể là id ChannelProduct hoặc id Product.
router.patch("/update-cost", async (req: AuthRequest, res, next) => {
  try {
    const skuId = req.body?.sku_id ?? req.body?.skuId ?? req.body?.variant_id;
    const rawCost = req.body?.cost_price ?? req.body?.costPrice;

    if (typeof skuId !== "string" || !skuId) {
      res.status(400).json({ error: "Thiếu sku_id" });
      return;
    }
    const cost = typeof rawCost === "string" ? Number(rawCost) : rawCost;
    if (typeof cost !== "number" || Number.isNaN(cost) || cost < 0) {
      res.status(400).json({ error: "Giá vốn phải là số không âm" });
      return;
    }

    // Tìm sản phẩm gốc: thử theo mapping trước, sau đó theo product id
    let productId: string | null = null;
    const channelProduct = await prisma.channelProduct.findFirst({
      where: { id: skuId, channel: { userId: req.ownerId! } },
      select: { productId: true },
    });
    if (channelProduct?.productId) {
      productId = channelProduct.productId;
    } else {
      const product = await prisma.product.findFirst({
        where: { id: skuId, userId: req.ownerId! },
        select: { id: true },
      });
      productId = product?.id ?? null;
    }

    if (!productId) {
      res.status(404).json({ error: "Không tìm thấy SKU / sản phẩm" });
      return;
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { costPrice: cost },
    });

    res.json({
      skuId,
      productId: updated.id,
      productName: updated.productName,
      costPrice: String(updated.costPrice),
    });
  } catch (err) {
    next(err);
  }
});

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
    if (productIds.size === 0) {
      res.status(404).json({ error: "Không tìm thấy SKU / sản phẩm nào" });
      return;
    }

    // Cùng một transaction: hoặc đổi hết, hoặc không đổi gì
    await prisma.product.updateMany({
      where: { id: { in: [...productIds] }, userId: req.ownerId! },
      data: { costPrice: cost },
    });

    res.json({ updated: productIds.size, costPrice: String(cost) });
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

      // Tìm sản phẩm gốc theo cả mã nội bộ lẫn mã trên sàn
      const [products, channelProducts] = await Promise.all([
        prisma.product.findMany({
          where: { userId: ownerId },
          select: { id: true, skuCode: true },
        }),
        prisma.channelProduct.findMany({
          where: { productId: { not: null }, channel: { userId: ownerId } },
          select: { productId: true, channelSku: true },
        }),
      ]);

      const productIdBySku = new Map<string, string>();
      for (const p of products) productIdBySku.set(p.skuCode.toLowerCase(), p.id);
      // Mã sàn chỉ dùng khi mã nội bộ không khớp, tránh ghi đè nhầm
      for (const cp of channelProducts) {
        const key = cp.channelSku.toLowerCase();
        if (!productIdBySku.has(key)) productIdBySku.set(key, cp.productId!);
      }

      // Gom theo giá vốn để mỗi giá chỉ cần một lệnh updateMany
      const byCost = new Map<number, string[]>();
      let matched = 0;
      for (const sku of skuList) {
        const entry = wanted.get(sku)!;
        const productId = productIdBySku.get(sku);
        if (!productId) {
          errors.push({
            row: entry.row,
            message: `Không tìm thấy SKU "${sku}" trong hệ thống`,
          });
          continue;
        }
        matched++;
        const list = byCost.get(entry.cost) ?? [];
        list.push(productId);
        byCost.set(entry.cost, list);
      }

      if (matched === 0) {
        res.status(400).json({
          error: "Không có SKU nào trong file khớp với sản phẩm trong hệ thống",
          errors,
        });
        return;
      }

      // Trọn gói: hoặc cập nhật hết, hoặc không đổi gì
      const updated = await prisma.$transaction(async (tx) => {
        const touched = new Set<string>();
        for (const [cost, ids] of byCost) {
          await tx.product.updateMany({
            where: { id: { in: ids }, userId: ownerId },
            data: { costPrice: cost },
          });
          for (const id of ids) touched.add(id);
        }
        return touched.size;
      });

      res.json({ updated, totalRows: rows.length, errors });
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

    const [delivered, expenses, inFlight, cancelled] = await Promise.all([
      fetchDeliveredOrders(ownerId, range),
      prisma.operatingExpense.findMany({
        where: { userId: ownerId, expenseDate: range },
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
          channel: { userId: ownerId },
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
          channel: { select: { channelName: true } },
        },
      }),
      // Đơn bị hủy/bom hàng → phục vụ quản trị rủi ro
      prisma.order.findMany({
        where: {
          channel: { userId: ownerId },
          shippingStatus: "CANCELLED",
          createdAt: range,
        },
        select: { totalAmount: true },
      }),
    ]);

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

    for (const o of delivered) {
      if (o.isSettled) {
        feePlatform +=
          Number(o.fixedFee) + Number(o.serviceFee) + Number(o.paymentFee);
        feeAffiliate += Number(o.affiliateFee);
        feeSellerVoucher += Number(o.sellerVoucher);
        feeShippingDiff += Number(o.shippingFeeDiff);
        platformSubsidyTotal += Number(o.platformSubsidy);
      } else {
        feePlatform += Number(o.platformFee); // chưa quyết toán → số tạm tính
      }
    }
    for (const o of inFlight) {
      feePlatform += Number(o.platformFee); // đơn đang đi đường luôn là tạm tính
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

    // --- CỘT 3: CHI PHÍ (giá vốn + chi phí vận hành ngoài sàn) ---
    const cogsAll = delivered.reduce((s, o) => s + orderCost(o).cost, 0) + pendingCogs;
    // Bóc tách theo MÔ HÌNH CHI PHÍ: biến đổi (gắn được vào SKU) vs cố định (toàn shop)
    const variableExpenseTotal = expenses
      .filter((e) => e.type === ExpenseType.VARIABLE)
      .reduce((s, e) => s + Number(e.amount), 0);
    const fixedExpenseTotal = expenses
      .filter((e) => e.type === ExpenseType.FIXED)
      .reduce((s, e) => s + Number(e.amount), 0);
    const totalCostColumn = cogsAll + variableExpenseTotal + fixedExpenseTotal;

    // --- CỘT 4: LỢI NHUẬN ---
    // Lợi nhuận thực tế: từ đơn ĐÃ HOÀN THÀNH (đã quyết toán xong)
    const settledCogs = settledOrders.reduce((s, o) => s + orderCost(o).cost, 0);
    const actualProfit = settledPayout - settledCogs;
    // Lợi nhuận dự kiến: từ đơn ĐANG CHỜ (số tạm tính)
    const expectedProfit = pendingPayout - pendingCogs;
    // Tổng lợi nhuận = (thực tế + dự kiến) − chi phí biến đổi − chi phí cố định
    const totalProfit =
      actualProfit + expectedProfit - variableExpenseTotal - fixedExpenseTotal;

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
          ],
        },

        // Cột 3 — Chi phí
        costs: {
          total: totalCostColumn,
          items: [
            {
              key: "cogs",
              label: "Giá vốn sản phẩm",
              hint: "Tổng tiền nhập hàng, lấy theo giá vốn đã cấu hình cho từng SKU",
              amount: cogsAll,
              percent: pct(cogsAll, totalCostColumn),
            },
            {
              key: "variable",
              label: "Chi phí biến đổi",
              hint: "Ads, book KOC, đóng gói… — khoản nào gắn SKU sẽ được tính vào lời/lỗ của chính SKU đó",
              amount: variableExpenseTotal,
              percent: pct(variableExpenseTotal, totalCostColumn),
            },
            {
              key: "fixed",
              label: "Chi phí cố định",
              hint: "Mặt bằng, lương nhân sự… — không gắn vào SKU nào, trừ thẳng vào lợi nhuận toàn shop",
              amount: fixedExpenseTotal,
              percent: pct(fixedExpenseTotal, totalCostColumn),
            },
          ],
        },

        // Cột 4 — Lợi nhuận
        profit: {
          total: totalProfit,
          items: [
            // % ở đây là BIÊN LỢI NHUẬN (lãi / doanh thu tương ứng),
            // không phải tỷ trọng — vì tổng lợi nhuận có thể âm.
            {
              key: "actual",
              label: "Lợi nhuận thực tế",
              hint: "Tiền thực nhận − giá vốn, tính trên các đơn ĐÃ quyết toán xong. % = biên lợi nhuận trên doanh thu hoàn thành",
              amount: actualProfit,
              percent: pct(actualProfit, settledPayout),
            },
            {
              key: "expected",
              label: "Lợi nhuận dự kiến",
              hint: "Tiền dự kiến nhận − giá vốn, tính trên các đơn đang chờ xử lý. % = biên lợi nhuận dự kiến",
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
      series,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
