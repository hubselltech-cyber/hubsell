import { Router } from "express";
import {
  ChannelName,
  ExpenseCategory,
  ExpenseType,
  Prisma,
  ShippingDisputeStatus,
} from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { MOCK_CATALOG, mockImageFor } from "../mockMarketplace";

const router = Router();

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
function fetchDeliveredOrders(ownerId: string) {
  return prisma.order.findMany({
    where: { channel: { userId: ownerId }, shippingStatus: "DELIVERED" },
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
    const { description, name, type, category, amount, note, expenseDate } =
      req.body ?? {};

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

    const expense = await prisma.operatingExpense.create({
      data: {
        userId: req.ownerId!,
        name: finalName,
        type: type as ExpenseType,
        category: finalCategory,
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
    const delivered = await fetchDeliveredOrders(req.ownerId!);

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
      where: { userId: req.ownerId! },
      orderBy: { expenseDate: "desc" },
    });
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

// GET /api/finance/sku-products?channel=all|shopee|tiktok|lazada|offline
// Danh sách SKU (đã đồng bộ từ sàn) để chủ shop nhập giá vốn.
// - Kênh cụ thể  → các SKU sàn đã liên kết (ProductMapping) của kênh đó
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
      imageUrl: string | null;
      sellingPrice: string;
      costPrice: string;
    }[] = [];

    // 1) SKU trên sàn (từ bảng liên kết ProductMapping)
    if (channel !== "offline") {
      const mappings = await prisma.productMapping.findMany({
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
          channel: { select: { channelName: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      for (const m of mappings) {
        rows.push({
          skuId: m.id,
          productId: m.productId,
          sku: m.channelSku,
          productName: m.product.productName,
          variantName: m.channelProductName,
          channelName: m.channel.channelName,
          imageUrl: m.product.imageUrl,
          sellingPrice: String(m.product.sellingPrice),
          costPrice: String(m.product.costPrice),
        });
      }
    }

    // 2) Sản phẩm kho chưa liên kết sàn nào → coi là hàng bán Offline
    if (channel === "offline" || channel === "all") {
      const unmapped = await prisma.product.findMany({
        where: { userId: req.ownerId!, mappings: { none: {} } },
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
// đang ACTIVE rồi UPSERT vào Product + ProductMapping:
//   - SKU sàn chưa có   → tạo Product mới (giá vốn = 0 để chủ shop nhập) + liên kết
//   - SKU sàn đã có     → cập nhật tên hiển thị/ảnh trên sàn
// LƯU Ý: KHÔNG bao giờ ghi đè giá vốn (costPrice) vì đó là dữ liệu chủ shop tự nhập.
//
// Khi tích hợp API thật: thay MOCK_CATALOG bằng lời gọi API Shopee/TikTok/Lazada,
// phần upsert bên dưới giữ nguyên.
router.post("/sync-products", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;

    // Chỉ quét các gian hàng online đang hoạt động
    const channels = await prisma.channel.findMany({
      where: {
        userId: ownerId,
        status: "ACTIVE",
        channelName: { not: ChannelName.OFFLINE },
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
    let unchanged = 0;
    const perChannel: { channelName: ChannelName; scanned: number; created: number }[] =
      [];

    for (const channel of channels) {
      const catalog = MOCK_CATALOG[channel.channelName];
      let createdHere = 0;

      for (const item of catalog) {
        const image = mockImageFor(channel.channelName, item.name);

        // Đã liên kết SKU sàn này chưa?
        const mapping = await prisma.productMapping.findUnique({
          where: {
            channelId_channelSku: {
              channelId: channel.id,
              channelSku: item.channelSku,
            },
          },
          include: { product: { select: { id: true, imageUrl: true } } },
        });

        if (mapping) {
          // Đã có → cập nhật thông tin hiển thị từ sàn (KHÔNG đụng vào giá vốn)
          const needNameUpdate = mapping.channelProductName !== item.name;
          const needImage = !mapping.product.imageUrl;

          if (needNameUpdate || needImage) {
            await prisma.$transaction(async (tx) => {
              if (needNameUpdate) {
                await tx.productMapping.update({
                  where: { id: mapping.id },
                  data: { channelProductName: item.name },
                });
              }
              if (needImage) {
                await tx.product.update({
                  where: { id: mapping.product.id },
                  data: { imageUrl: image },
                });
              }
            });
            updated++;
          } else {
            unchanged++;
          }
          continue;
        }

        // Chưa có → tạo sản phẩm gốc (nếu chưa tồn tại SKU nội bộ) rồi liên kết
        const internalSku = item.channelSku.trim().toUpperCase();
        await prisma.$transaction(async (tx) => {
          let product = await tx.product.findUnique({
            where: { userId_skuCode: { userId: ownerId, skuCode: internalSku } },
          });

          if (!product) {
            product = await tx.product.create({
              data: {
                userId: ownerId,
                skuCode: internalSku,
                productName: item.name,
                costPrice: 0, // chủ shop sẽ nhập ở trang Cấu hình Giá vốn
                sellingPrice: item.price,
                quantityInStock: 0,
                imageUrl: image,
              },
            });
          } else if (!product.imageUrl) {
            product = await tx.product.update({
              where: { id: product.id },
              data: { imageUrl: image },
            });
          }

          await tx.productMapping.create({
            data: {
              productId: product.id,
              channelId: channel.id,
              channelSku: item.channelSku,
              channelProductName: item.name,
            },
          });
        });

        created++;
        createdHere++;
      }

      perChannel.push({
        channelName: channel.channelName,
        scanned: catalog.length,
        created: createdHere,
      });
    }

    // Đếm số SKU vẫn chưa có giá vốn sau khi đồng bộ
    const missingCostCount = await prisma.product.count({
      where: { userId: ownerId, costPrice: { lte: 0 } },
    });

    res.json({
      message: `Đã quét ${perChannel.reduce((s, c) => s + c.scanned, 0)} sản phẩm từ ${channels.length} gian hàng.`,
      created,
      updated,
      unchanged,
      missingCostCount,
      perChannel,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/finance/update-cost — cập nhật giá vốn cho một SKU.
// Body: { sku_id, cost_price }. sku_id có thể là id của ProductMapping hoặc id Product.
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
    const mapping = await prisma.productMapping.findFirst({
      where: { id: skuId, channel: { userId: req.ownerId! } },
      select: { productId: true },
    });
    if (mapping) {
      productId = mapping.productId;
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

// GET /api/finance/analytics — 3 chỉ số chính + chuỗi Doanh thu vs Tổng chi phí theo ngày.
// Mọi số tiền trả về là SỐ ĐẦY ĐỦ (không viết tắt).
router.get("/analytics", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;

    const [delivered, expenses, inFlight, cancelled] = await Promise.all([
      fetchDeliveredOrders(ownerId),
      prisma.operatingExpense.findMany({
        where: { userId: ownerId },
        select: {
          amount: true,
          type: true,
          category: true,
          expenseDate: true,
        },
      }),
      // Đơn đang trên đường / chờ đối soát → tiền chưa về ví
      prisma.order.findMany({
        where: {
          channel: { userId: ownerId },
          shippingStatus: { in: ["PENDING", "SHIPPING"] },
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
    const adsExpense = expenses
      .filter((e) => e.category === ExpenseCategory.ADS)
      .reduce((s, e) => s + Number(e.amount), 0);
    const otherExpense = expenses
      .filter((e) => e.category !== ExpenseCategory.ADS)
      .reduce((s, e) => s + Number(e.amount), 0);
    const totalCostColumn = cogsAll + adsExpense + otherExpense;

    // --- CỘT 4: LỢI NHUẬN ---
    // Lợi nhuận thực tế: từ đơn ĐÃ HOÀN THÀNH (đã quyết toán xong)
    const settledCogs = settledOrders.reduce((s, o) => s + orderCost(o).cost, 0);
    const actualProfit = settledPayout - settledCogs;
    // Lợi nhuận dự kiến: từ đơn ĐANG CHỜ (số tạm tính)
    const expectedProfit = pendingPayout - pendingCogs;
    // Tổng lợi nhuận = (thực tế + dự kiến) − chi phí vận hành ngoài sàn
    const totalProfit = actualProfit + expectedProfit - adsExpense - otherExpense;

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
              key: "ads",
              label: "Chi phí quảng cáo",
              hint: "Tiền chạy quảng cáo trên sàn (nhóm chi phí Quảng cáo)",
              amount: adsExpense,
              percent: pct(adsExpense, totalCostColumn),
            },
            {
              key: "other",
              label: "Chi phí vận hành khác",
              hint: "Mặt bằng, lương nhân viên, đóng gói… (các nhóm chi phí còn lại)",
              amount: otherExpense,
              percent: pct(otherExpense, totalCostColumn),
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
