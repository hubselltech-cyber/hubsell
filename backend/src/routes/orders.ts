import express, { Router } from "express";
import {
  Carrier,
  ChannelName,
  InventoryLogType,
  Prisma,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { mockSettlement } from "../marketplace/mockMarketplace";
import { channelScope } from "../lib/channel-filter";
import { attachItemImages } from "../services/item-images";
import {
  CARRIER_LABEL,
  carrierFromName,
  expressShippingWhere,
  isExpressShipping,
  notExpressShippingWhere,
} from "../services/shipping";
import {
  buildPickListPdf,
  getFulfillmentAdapter,
  mergePdfParts,
  readFulfillDefaults,
  type FulfillChoice,
  type FulfillOrderRef,
} from "../services/fulfillment";
import { isShopeeConfigured } from "../integrations/shopee/config";
import { syncShopeeOrders } from "../integrations/shopee/service";
import { syncShopeeReturns } from "../integrations/shopee/returns-sync";
import { isLazadaConfigured } from "../integrations/lazada/config";
import { syncLazadaOrders } from "../integrations/lazada/service";
import { enqueueStockPush } from "../integrations/inventory-push";

const router = Router();

const VALID_STATUSES = Object.values(ShippingStatus);

/** Giá trị có phải trạng thái vận chuyển hợp lệ không. */
function isStatus(value: unknown): value is ShippingStatus {
  return (VALID_STATUSES as string[]).includes(value as string);
}

/** Giá trị query có phải một hãng vận chuyển hợp lệ không (chặn lọc bừa). */
function isCarrier(value: string): value is Carrier {
  return (Object.values(Carrier) as string[]).includes(value);
}

/**
 * Dựng mảnh `where` từ CHUNG một bộ query lọc của màn Đơn hàng — dùng cho cả
 * danh sách (GET /) lẫn thống kê (GET /stats) để hai nơi luôn cùng phạm vi.
 */
function ordersWhere(req: AuthRequest): Prisma.OrderWhereInput {
  const shippingStatus =
    typeof req.query.shippingStatus === "string" ? req.query.shippingStatus : "";
  const carrier =
    typeof req.query.carrier === "string" ? req.query.carrier : "";
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  // Bộ lọc con của tab "Đã xử lý": "yes" = đã in phiếu, "no" = chưa in.
  // Giá trị khác thì bỏ qua, coi như không lọc.
  const printed = typeof req.query.printed === "string" ? req.query.printed : "";
  // Loại đơn theo độ khó đóng gói: "single" = 1 dòng hàng (đóng nhanh),
  // "multi" = từ 2 dòng trở lên (phải soát kỹ hơn).
  const orderType =
    typeof req.query.orderType === "string" ? req.query.orderType : "";
  const returnStatusQ =
    typeof req.query.returnStatus === "string" ? req.query.returnStatus : "";

  return {
      channel: channelScope(req),
      ...(isStatus(shippingStatus) ? { shippingStatus } : {}),
      ...(isCarrier(carrier) ? { carrier } : {}),
      ...(printed === "yes"
        ? { labelPrintedAt: { not: null } }
        : printed === "no"
          ? { labelPrintedAt: null }
          : {}),
      // Đơn cũ chưa ghi chi tiết dòng hàng có itemCount = 0, cố ý KHÔNG rơi vào
      // nhóm nào — không biết đơn gồm mấy mặt hàng thì đừng đoán bừa cho kho.
      ...(orderType === "single"
        ? { itemCount: 1 }
        : orderType === "multi"
          ? { itemCount: { gt: 1 } }
          : {}),
      ...((Object.values(ReturnStatus) as string[]).includes(returnStatusQ)
        ? { returnStatus: returnStatusQ as ReturnStatus }
        : {}),
      // Ô tìm kiếm đa năng: gõ gì cũng ra — mã đơn, tên khách, số điện thoại
      // hoặc mã vận đơn. Bỏ dấu cách và gạch trong SĐT để "0901 234 567" vẫn
      // khớp với "0901234567" đang lưu.
      ...(search
        ? {
            OR: [
              { orderCode: { contains: search, mode: "insensitive" as const } },
              { customerName: { contains: search, mode: "insensitive" as const } },
              { customerPhone: { contains: search.replace(/[\s.-]/g, "") } },
              { trackingCode: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
  };
}

// GET /api/orders?page=1&pageSize=20&shippingStatus=PENDING&channelId=...
// Danh sách đơn hàng gom về từ TẤT CẢ các kênh, có bộ lọc + phân trang.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    // Trần 100: cho phép chủ shop mở rộng 20 → 50 → 100 đơn/trang khi soát
    // đơn hàng loạt, nhưng không để gõ tay ?pageSize=100000 làm nghẽn truy vấn.
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const where = ordersWhere(req);

    // GHIM ĐƠN HỎA TỐC CHƯA BÀN GIAO LÊN ĐẦU (anh Trung 19/08, nới 22/08):
    // đơn hỏa tốc phải đứng trên mọi đơn khác dù ra đơn sớm hơn, để seller
    // phát hiện và bàn giao vận chuyển ngay; giữ ghim CẢ Chờ xử lý lẫn Đã xử
    // lý (in vận đơn xong vẫn chưa ra khỏi tay mình) — chỉ nhả về thứ tự thời
    // gian khi nhảy sang Đang giao. Prisma không orderBy theo biểu thức được
    // nên chia 2 nhóm — nhóm ghim lấy trước, nhóm còn lại điền tiếp — và tự
    // cắt trang trên tổng 2 nhóm để phân trang vẫn đúng.
    const PINNED_STATUSES = [ShippingStatus.PENDING, ShippingStatus.PROCESSED];
    const pinnedWhere: Prisma.OrderWhereInput = {
      AND: [
        where,
        { shippingStatus: { in: PINNED_STATUSES } },
        expressShippingWhere(),
      ],
    };
    // Phần bù: ĐÃ bàn giao trở đi hoặc KHÔNG hỏa tốc (kể cả chưa có tên hãng).
    const restWhere: Prisma.OrderWhereInput = {
      AND: [
        where,
        {
          OR: [
            { shippingStatus: { notIn: PINNED_STATUSES } },
            notExpressShippingWhere(),
          ],
        },
      ],
    };
    const listInclude = {
      channel: { select: { channelName: true, shopName: true } },
      // Kèm dòng hàng để bảng hiện được tên + SKU + số lượng sản phẩm
      items: {
        select: {
          id: true,
          productName: true,
          channelSku: true,
          quantity: true,
          price: true,
          // Ảnh lấy từ sản phẩm gốc để bảng hiện thumbnail; sản phẩm đã bị
          // xoá thì productId là null nên phải cho phép thiếu.
          product: { select: { imageUrl: true } },
        },
      },
    } satisfies Prisma.OrderInclude;
    const offset = (page - 1) * pageSize;
    const fetchPage = async () => {
      const pinnedTotal = await prisma.order.count({ where: pinnedWhere });
      const pinned =
        offset < pinnedTotal
          ? await prisma.order.findMany({
              where: pinnedWhere,
              orderBy: { createdAt: "desc" },
              skip: offset,
              take: pageSize,
              include: listInclude,
            })
          : [];
      const remain = pageSize - pinned.length;
      const rest =
        remain > 0
          ? await prisma.order.findMany({
              where: restWhere,
              orderBy: { createdAt: "desc" },
              skip: Math.max(0, offset - pinnedTotal),
              take: remain,
              include: listInclude,
            })
          : [];
      return [...pinned, ...rest];
    };

    const [total, items, statusCounts, notPrinted, alreadyPrinted] =
      await Promise.all([
      prisma.order.count({ where }),
      fetchPage(),
      // Đếm số đơn theo từng trạng thái để hiện badge trên tab.
      // Cố ý BỎ shippingStatus VÀ printed khỏi điều kiện đếm — nếu không thì
      // tab/bộ lọc con đang mở sẽ là chỗ duy nhất có số, các tab khác luôn 0.
      prisma.order.groupBy({
        by: ["shippingStatus"],
        _count: { _all: true },
        where: { ...where, shippingStatus: undefined, labelPrintedAt: undefined },
      }),
      // Riêng nhóm "Đã xử lý" cần tách thêm chưa in / đã in cho 2 bộ lọc con
      prisma.order.count({
        where: {
          ...where,
          shippingStatus: ShippingStatus.PROCESSED,
          labelPrintedAt: null,
        },
      }),
      prisma.order.count({
        where: {
          ...where,
          shippingStatus: ShippingStatus.PROCESSED,
          labelPrintedAt: { not: null },
        },
      }),
    ]);

    const counts: Record<string, number> = { ALL: 0 };
    for (const g of statusCounts) {
      counts[g.shippingStatus] = g._count._all;
      counts.ALL += g._count._all;
    }
    counts.PROCESSED_NOT_PRINTED = notPrinted;
    counts.PROCESSED_PRINTED = alreadyPrinted;

    res.json({
      // Gắn ảnh dòng hàng: SP kho gốc → fallback ảnh ChannelProduct
      items: await attachItemImages(items),
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      counts,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/orders/stats — PHIẾU BỐC HÀNG: thống kê SẢN PHẨM / SKU cần nhặt.
//
// CỐ ĐỊNH phạm vi trạng thái = Chờ xử lý + Đã xử lý (chốt với anh Trung
// 13/08: mục đích duy nhất là nhân viên nhìn vào để bốc hàng — đơn đã giao
// đi không còn gì để nhặt). Các bộ lọc còn lại (sàn/shop/hãng VC/tìm kiếm)
// + ?days= (0 = không giới hạn ngày) vẫn nhận nguyên từ query danh sách.
// Gộp bằng JS sau MỘT lượt findMany: cần doanh số = SUM(price×quantity) mà
// groupBy Prisma không nhân được 2 cột; cỡ vài nghìn dòng là nhẹ.
// ============================================================
router.get("/stats", async (req: AuthRequest, res, next) => {
  try {
    const daysRaw = Number(req.query.days);
    const days = Number.isFinite(daysRaw)
      ? Math.min(365, Math.max(0, Math.floor(daysRaw)))
      : 0;
    const since =
      days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
    const rows = await prisma.orderItem.findMany({
      where: {
        order: {
          ...ordersWhere(req),
          // Đè MỌI lựa chọn trạng thái từ query — phiếu bốc hàng chỉ có
          // nghĩa với đơn chưa bàn giao vận chuyển
          shippingStatus: {
            in: [ShippingStatus.PENDING, ShippingStatus.PROCESSED],
          },
          ...(since ? { createdAt: { gte: since } } : {}),
        },
      },
      select: {
        orderId: true,
        productName: true,
        channelSku: true,
        quantity: true,
        price: true,
        // Cờ hỏa tốc tính từ tên hãng nguyên văn của ĐƠN chứa dòng hàng
        order: { select: { shippingCarrierName: true } },
      },
      // Trần an toàn — đơn đang chờ xử lý hiếm khi vượt nổi con số này
      take: 20000,
    });

    interface Agg {
      name: string;
      sku: string | null;
      qty: number;
      /** Số món thuộc đơn HỎA TỐC — kho phải nhặt TRƯỚC. */
      expressQty: number;
      revenue: number;
      orderIds: Set<string>;
    }
    const blank = (name: string, sku: string | null): Agg => ({
      name,
      sku,
      qty: 0,
      expressQty: 0,
      revenue: 0,
      orderIds: new Set<string>(),
    });
    const byProduct = new Map<string, Agg>();
    const bySku = new Map<string, Agg>();
    const allOrderIds = new Set<string>();
    let totalQty = 0;
    let totalExpressQty = 0;
    let totalRevenue = 0;
    for (const r of rows) {
      const revenue = Number(r.price) * r.quantity;
      const express = isExpressShipping(r.order.shippingCarrierName);

      const p = byProduct.get(r.productName) ?? blank(r.productName, null);
      p.qty += r.quantity;
      if (express) p.expressQty += r.quantity;
      p.revenue += revenue;
      p.orderIds.add(r.orderId);
      // Nhớ MỘT sku đại diện để tra ảnh ChannelProduct cho dòng sản phẩm
      if (!p.sku && r.channelSku) p.sku = r.channelSku;
      byProduct.set(r.productName, p);

      const skuKey = r.channelSku || "(không có SKU)";
      const s = bySku.get(skuKey) ?? blank(r.productName, skuKey);
      s.qty += r.quantity;
      if (express) s.expressQty += r.quantity;
      s.revenue += revenue;
      s.orderIds.add(r.orderId);
      bySku.set(skuKey, s);

      allOrderIds.add(r.orderId);
      totalQty += r.quantity;
      if (express) totalExpressQty += r.quantity;
      totalRevenue += revenue;
    }

    // HỎA TỐC nổi lên ĐẦU danh sách (kho nhặt trước), trong nhóm xếp theo qty
    const top = (m: Map<string, Agg>) =>
      [...m.values()]
        .sort((a, b) => b.expressQty - a.expressQty || b.qty - a.qty)
        .slice(0, 50)
        .map(({ orderIds, ...rest }) => ({ ...rest, orders: orderIds.size }));
    const topProducts = top(byProduct);
    const topSkus = top(bySku);

    // Ảnh cho từng dòng: tra ChannelProduct theo sku (ưu tiên ảnh sàn — cùng
    // luật với danh sách đơn); một lượt query cho cả hai bảng xếp hạng
    const skuSet = new Set<string>();
    for (const r of [...topProducts, ...topSkus]) if (r.sku) skuSet.add(r.sku);
    const imageMap = new Map<string, string>();
    if (skuSet.size > 0) {
      const imgs = await prisma.channelProduct.findMany({
        where: {
          channel: channelScope(req),
          channelSku: { in: [...skuSet] },
          imageUrl: { not: null },
        },
        select: { channelSku: true, imageUrl: true },
      });
      for (const i of imgs) {
        if (i.imageUrl && !imageMap.has(i.channelSku)) {
          imageMap.set(i.channelSku, i.imageUrl);
        }
      }
    }
    const withImage = <T extends { sku: string | null }>(r: T) => ({
      ...r,
      imageUrl: r.sku ? (imageMap.get(r.sku) ?? null) : null,
    });

    res.json({
      days,
      totals: {
        qty: totalQty,
        expressQty: totalExpressQty,
        orders: allOrderIds.size,
        revenue: totalRevenue,
      },
      byProduct: topProducts.map(withImage),
      bySku: topSkus.map(withImage),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/orders/:id/status — chuyển trạng thái vận chuyển của đơn.
// Đặc biệt: chuyển sang CANCELLED (Đã hủy) sẽ TỰ ĐỘNG CỘNG HOÀN LẠI tồn kho
// cho các sản phẩm gốc mà đơn này từng trừ, và ghi log hệ thống — trong 1 transaction.
router.patch("/:id/status", async (req: AuthRequest, res, next) => {
  try {
    const { shippingStatus } = req.body ?? {};
    if (!isStatus(shippingStatus)) {
      res.status(400).json({
        error: `Trạng thái không hợp lệ. Chọn một trong: ${VALID_STATUSES.join(", ")}`,
      });
      return;
    }
    const newStatus = shippingStatus;

    const order = await prisma.order.findFirst({
      where: { id: req.params.id, channel: { userId: req.ownerId! } },
      include: { channel: { select: { channelName: true, shopName: true } } },
    });
    if (!order) {
      res.status(404).json({ error: "Không tìm thấy đơn hàng" });
      return;
    }
    // Nhân viên bị giới hạn kênh không được xử lý đơn của kênh ngoài phạm vi
    if (req.allowedChannelIds && !req.allowedChannelIds.includes(order.channelId)) {
      res.status(403).json({ error: "Bạn không có quyền xử lý đơn của kênh này" });
      return;
    }
    if (order.shippingStatus === "CANCELLED") {
      res.status(409).json({ error: "Đơn đã hủy — không thể đổi trạng thái nữa" });
      return;
    }
    if (order.shippingStatus === newStatus) {
      res.status(400).json({ error: "Đơn đang ở trạng thái này rồi" });
      return;
    }

    // Trường hợp thường: chỉ đổi trạng thái
    if (newStatus !== "CANCELLED") {
      // GĐ2 — QUYẾT TOÁN: đơn chuyển sang "Đã giao" ⇒ bóc tách số liệu tài chính
      // THỰC TẾ do sàn trả về (phí cố định, phí dịch vụ, phí thanh toán, trợ giá)
      // và ghi đè số tạm tính. Báo cáo dòng tiền dùng số này.
      let settlementData: Prisma.OrderUpdateInput = {};
      if (newStatus === "DELIVERED" && !order.isSettled) {
        const s = mockSettlement(
          order.channel.channelName,
          Number(order.totalAmount),
          order.orderCode
        );
        settlementData = {
          isSettled: true,
          settledAt: new Date(),
          fixedFee: s.fixedFee,
          serviceFee: s.serviceFee,
          paymentFee: s.paymentFee,
          affiliateFee: s.affiliateFee,
          sellerVoucher: s.sellerVoucher,
          shippingFeeQuoted: s.shippingFeeQuoted,
          shippingFeeActual: s.shippingFeeActual,
          shippingFeeDiff: s.shippingFeeDiff,
          platformSubsidy: s.platformSubsidy,
          actualPayout: s.actualPayout,
        };
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { shippingStatus: newStatus, ...settlementData },
        include: { channel: { select: { channelName: true, shopName: true } } },
      });
      res.json({ order: updated, restored: [] });
      return;
    }

    // Trường hợp HỦY ĐƠN: hoàn kho trong 1 transaction
    const result = await prisma.$transaction(async (tx) => {
      // Tìm các log TRỪ kho gắn với đơn này (changeQuantity < 0)
      const deductions = await tx.inventoryLog.findMany({
        where: { orderId: order.id, changeQuantity: { lt: 0 } },
        include: { product: { select: { id: true, productName: true } } },
      });

      const restored: {
        productId: string;
        productName: string;
        restoredQuantity: number;
        newQuantity: number;
      }[] = [];

      for (const log of deductions) {
        const qty = Math.abs(log.changeQuantity);
        const updatedProduct = await tx.product.update({
          where: { id: log.productId },
          data: { quantityInStock: { increment: qty } },
        });
        await tx.inventoryLog.create({
          data: {
            productId: log.productId,
            changeQuantity: qty,
            type: InventoryLogType.SYNC,
            reason: `Hoàn kho tự động do hủy đơn ${order.orderCode}`,
            orderId: order.id,
          },
        });
        restored.push({
          productId: log.productId,
          productName: log.product.productName,
          restoredQuantity: qty,
          newQuantity: updatedProduct.quantityInStock,
        });
      }

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          shippingStatus: ShippingStatus.CANCELLED,
          // Ghi mốc đã cộng kho để luồng quét hàng hoàn không cộng lần nữa.
          // Chỉ ghi khi thật sự có bút toán hoàn — đơn không có log trừ kho thì
          // chưa từng trừ, nên cũng chưa cộng gì.
          ...(restored.length > 0
            ? {
                stockRestoredAt: new Date(),
                returnStatus: ReturnStatus.RECEIVED_INTACT,
                returnedAt: new Date(),
              }
            : {
                returnStatus: ReturnStatus.AWAITING,
                // Mốc đếm ngày đối soát bắt đầu từ đây
                returnRequestedAt: new Date(),
              }),
        },
        include: { channel: { select: { channelName: true, shopName: true } } },
      });

      return { order: updatedOrder, restored };
    });

    // Hủy đơn vừa hoàn kho → đẩy tồn khả dụng mới lên các sàn đã liên kết.
    await enqueueStockPush(
      result.restored.map((l) => l.productId),
      { source: `hủy đơn ${order.orderCode}` }
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// XỬ LÝ ĐƠN TẬP TRUNG — chuẩn bị hàng THẬT qua API sàn + in vận đơn (04/09/2026)
//
// Trước 04/09 ba nút BulkBar chỉ đổi trạng thái trong DB (placeholder thời demo)
// — anh Trung phát hiện trên prod: bấm "chuẩn bị" mà Shopee vẫn im, phiếu in
// không có mã vạch nên shipper không quét được. Giờ:
//   shipping-options → hỏi sàn phương án (pickup/dropoff, địa chỉ, khung giờ)
//   confirm          → ship_order / pack+rts THẬT, sàn OK mới ghi PROCESSED
//   labels           → PDF vận đơn CHÍNH CHỦ của sàn + phiếu nhặt hàng Hubsell,
//                      ghép thành một file A6 in một lượt
// Mọi việc gọi sàn nằm trong services/fulfillment/* theo adapter từng sàn.
// ============================================================

const BULK_MAX = 200;

/** Đọc + kiểm mảng orderIds trong body; trả null khi đã trả lỗi cho client. */
/** Nhịp giữa hai lần ship_order/pack cùng gian trong một mẻ Chuẩn bị hàng. */
const ARRANGE_GAP_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readBulkOrderIds(
  req: AuthRequest,
  res: express.Response,
  max = BULK_MAX
): string[] | null {
  const { orderIds } = req.body ?? {};
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    res.status(400).json({ error: "Chưa chọn đơn hàng nào" });
    return null;
  }
  if (!orderIds.every((id) => typeof id === "string" && id)) {
    res.status(400).json({ error: "orderIds phải là mảng chuỗi" });
    return null;
  }
  if (orderIds.length > max) {
    res.status(400).json({ error: `Tối đa ${max} đơn mỗi lần xử lý` });
    return null;
  }
  return orderIds as string[];
}

const CHANNEL_LABEL: Record<ChannelName, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok",
  OFFLINE: "Offline",
};

function toFulfillRef(o: {
  id: string;
  orderCode: string;
  trackingCode: string | null;
  platformPackageId: string | null;
}): FulfillOrderRef {
  return {
    id: o.id,
    orderCode: o.orderCode,
    trackingCode: o.trackingCode,
    platformPackageId: o.platformPackageId,
  };
}

/** Đọc lựa chọn sắp xếp vận chuyển theo gian từ body (phòng thủ với dữ liệu lạ). */
function readChoices(raw: unknown): Record<string, FulfillChoice> {
  const out: Record<string, FulfillChoice> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [channelId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const c = v as Record<string, unknown>;
    if (c.method !== "PICKUP" && c.method !== "DROPOFF") continue;
    out[channelId] = {
      method: c.method,
      addressId: typeof c.addressId === "string" ? c.addressId : undefined,
      pickupTimeId: typeof c.pickupTimeId === "string" ? c.pickupTimeId : undefined,
      branchId: typeof c.branchId === "string" ? c.branchId : undefined,
    };
  }
  return out;
}

/**
 * POST /api/orders/bulk/shipping-options — hỏi sàn phương án vận chuyển cho
 * các gian có đơn đang chọn. Body: { orderIds }
 *
 * Trả một nhóm mỗi gian: mode PLATFORM (sàn cho chọn/không cần chọn), INTERNAL
 * (kênh offline — chỉ đổi trạng thái), UNSUPPORTED (TikTok đang giữ chỗ),
 * ERROR (không hỏi được sàn — thường do gian mất kết nối). Hộp thoại "Chuẩn bị
 * hàng" dựng form từ đây, điền sẵn lựa chọn lần trước của gian.
 */
router.post("/bulk/shipping-options", async (req: AuthRequest, res, next) => {
  try {
    const orderIds = readBulkOrderIds(req, res);
    if (!orderIds) return;

    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        channel: channelScope(req),
        shippingStatus: ShippingStatus.PENDING,
      },
      select: {
        id: true,
        orderCode: true,
        trackingCode: true,
        platformPackageId: true,
        channelId: true,
        channel: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const groups = new Map<string, { channel: (typeof orders)[number]["channel"]; orders: typeof orders }>();
    for (const o of orders) {
      const g = groups.get(o.channelId) ?? { channel: o.channel, orders: [] };
      g.orders.push(o);
      groups.set(o.channelId, g);
    }

    const result = await Promise.all(
      [...groups.values()].map(async ({ channel, orders: list }) => {
        const base = {
          channelId: channel.id,
          channelName: channel.channelName,
          shopName: channel.shopName,
          orderCount: list.length,
          defaults: readFulfillDefaults(channel.fulfillmentSettings),
          methods: [] as string[],
          pickupAddresses: [] as unknown[],
          dropoffBranches: [] as unknown[],
          note: undefined as string | undefined,
        };
        const adapter = getFulfillmentAdapter(channel.channelName);
        if (!adapter) {
          return { ...base, mode: "INTERNAL", note: "Kênh offline — chỉ ghi nhận đã chuẩn bị trong Hubsell" };
        }
        if (!adapter.supported) {
          const opts = await adapter.getShippingOptions(channel, toFulfillRef(list[0]));
          return { ...base, mode: "UNSUPPORTED", note: opts.note };
        }
        try {
          const opts = await adapter.getShippingOptions(channel, toFulfillRef(list[0]));
          return { ...base, ...opts, mode: "PLATFORM" };
        } catch (err) {
          return {
            ...base,
            mode: "ERROR",
            note: err instanceof Error ? err.message : "Không hỏi được sàn",
          };
        }
      })
    );

    res.json({ groups: result, pendingCount: orders.length });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/bulk/confirm — "Chuẩn bị hàng" THẬT cho nhiều đơn.
 * Body: { orderIds: string[], choices?: { [channelId]: FulfillChoice } }
 *
 * Với sàn có adapter: gọi sàn từng đơn (ship_order / pack+rts); sàn OK mới
 * ghi PROCESSED + packedAt + mã vận đơn/kiện. Sàn từ chối thì đơn ở nguyên
 * Chờ xử lý kèm lý do — không "giả vờ đã xử lý". Kênh offline: đổi trạng thái
 * nội bộ như cũ. Lựa chọn của từng gian được lưu làm mặc định lần sau.
 *
 * Bỏ qua có chọn lọc thay vì fail cả mẻ: 50 đơn mà 1 đơn hỏng thì báo riêng
 * đơn đó, 49 đơn còn lại vẫn chạy.
 */
router.post("/bulk/confirm", async (req: AuthRequest, res, next) => {
  try {
    const orderIds = readBulkOrderIds(req, res);
    if (!orderIds) return;
    const choices = readChoices(req.body?.choices);

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds }, channel: channelScope(req) },
      select: {
        id: true,
        orderCode: true,
        shippingStatus: true,
        trackingCode: true,
        platformPackageId: true,
        channelId: true,
        channel: true,
      },
    });

    const found = new Set(orders.map((o) => o.id));
    const skipped: { orderCode: string; reason: string }[] = [];
    const failed: { orderCode: string; reason: string }[] = [];
    const notes: { orderCode: string; note: string }[] = [];
    const ready: typeof orders = [];

    for (const o of orders) {
      if (o.shippingStatus === ShippingStatus.PENDING) ready.push(o);
      else if (o.shippingStatus === ShippingStatus.CANCELLED)
        skipped.push({ orderCode: o.orderCode, reason: "Đơn đã hủy" });
      else skipped.push({ orderCode: o.orderCode, reason: "Đơn đã rời trạng thái Chờ xử lý" });
    }
    for (const id of orderIds.filter((x) => !found.has(x))) {
      skipped.push({ orderCode: id, reason: "Không tìm thấy hoặc ngoài quyền" });
    }

    if (ready.length === 0) {
      res.status(409).json({
        error: "Không có đơn nào ở trạng thái Chờ xử lý để chuẩn bị",
        confirmed: 0,
        confirmedIds: [],
        skipped,
        failed,
      });
      return;
    }

    const groups = new Map<string, typeof ready>();
    for (const o of ready) {
      groups.set(o.channelId, [...(groups.get(o.channelId) ?? []), o]);
    }

    const confirmedIds: string[] = [];
    const markProcessed = async (
      id: string,
      extra: { trackingCode?: string | null; platformPackageId?: string | null; carrierName?: string | null } = {}
    ) => {
      // Hãng sàn gán lúc sắp xếp (Lazada trả ngay shipment_provider) — ghi luôn
      // để phiếu xuất hàng in ngay sau đó không bị "Chưa gán"; sync sau vẫn đè.
      const carrier = extra.carrierName ? carrierFromName(extra.carrierName) : null;
      await prisma.order.update({
        where: { id },
        data: {
          shippingStatus: ShippingStatus.PROCESSED,
          packedAt: new Date(),
          ...(extra.trackingCode ? { trackingCode: extra.trackingCode } : {}),
          ...(extra.platformPackageId ? { platformPackageId: extra.platformPackageId } : {}),
          ...(extra.carrierName ? { shippingCarrierName: extra.carrierName } : {}),
          ...(carrier ? { carrier } : {}),
        },
      });
      confirmedIds.push(id);
    };

    // Các gian chạy song song, trong một gian chạy TUẦN TỰ (đỡ dồn rate-limit
    // và để lỗi token của gian hiện ra một lần thay vì 50 lần).
    await Promise.all(
      [...groups.values()].map(async (list) => {
        const channel = list[0].channel;
        const adapter = getFulfillmentAdapter(channel.channelName);
        if (!adapter) {
          for (const o of list) await markProcessed(o.id);
          return;
        }
        if (!adapter.supported) {
          const r = await adapter.arrangeShipment(channel, toFulfillRef(list[0]), { method: "PICKUP" });
          for (const o of list) failed.push({ orderCode: o.orderCode, reason: r.error ?? "Sàn chưa hỗ trợ" });
          return;
        }
        const choice: FulfillChoice =
          choices[channel.id] ?? readFulfillDefaults(channel.fulfillmentSettings) ?? { method: "PICKUP" };
        if (choices[channel.id]) {
          // Lưu mặc định (bỏ khung giờ — đổi theo ngày)
          await prisma.channel.update({
            where: { id: channel.id },
            data: {
              fulfillmentSettings: {
                method: choice.method,
                ...(choice.addressId ? { addressId: choice.addressId } : {}),
                ...(choice.branchId ? { branchId: choice.branchId } : {}),
              },
            },
          });
        }
        for (const [idx, o] of list.entries()) {
          // Nhịp nhỏ giữa hai đơn cùng gian: sàn nhận từng đơn rõ ràng, không dồn
          // rate-limit khi mẻ 50 đơn (chậm thêm ~0,3s/đơn — người dùng không cảm nhận).
          if (idx > 0) await sleep(ARRANGE_GAP_MS);
          const r = await adapter.arrangeShipment(channel, toFulfillRef(o), choice);
          if (r.ok) {
            await markProcessed(o.id, {
              trackingCode: r.trackingCode,
              platformPackageId: r.packageId,
              carrierName: r.carrierName,
            });
            if (r.note) notes.push({ orderCode: o.orderCode, note: r.note });
          } else {
            failed.push({ orderCode: o.orderCode, reason: r.error ?? "Sàn từ chối" });
          }
        }
      })
    );

    res.json({ confirmed: confirmedIds.length, confirmedIds, skipped, failed, notes });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/bulk/label-readiness — sàn đã cấp vận đơn cho đơn nào? (05/09)
 * Body: { orderIds: string[] }
 *
 * Bước ĐỢI giữa "Chuẩn bị hàng" và "In": ship_order xong, Shopee cần vài giây
 * tới vài chục giây mới có tracking_number; xin PDF ngay là đơn chưa có mã bị
 * rơi khỏi file in. Giao diện gọi endpoint này mỗi ~2,5s tới khi waiting rỗng
 * (hoặc hết kiên nhẫn ~45s) rồi mới gọi /bulk/labels MỘT lần cho cả mẻ.
 *
 * Chỉ hỏi sàn cho đơn còn thiếu mã (rẻ); mã khám phá được ghi luôn vào Order.
 * Đơn không ở trạng thái in được / kênh offline / sàn giữ chỗ → coi là "ready"
 * để không chặn mẻ — /bulk/labels sẽ báo lý do đúng cho từng đơn đó.
 */
router.post("/bulk/label-readiness", async (req: AuthRequest, res, next) => {
  try {
    const orderIds = readBulkOrderIds(req, res);
    if (!orderIds) return;

    const rows = await prisma.order.findMany({
      where: { id: { in: orderIds }, channel: channelScope(req) },
      select: {
        id: true,
        orderCode: true,
        shippingStatus: true,
        trackingCode: true,
        platformPackageId: true,
        channelId: true,
        channel: true,
      },
    });

    const ready: string[] = [];
    const waiting: { id: string; orderCode: string; reason?: string }[] = [];
    const failed: { orderCode: string; reason: string }[] = [];
    const groups = new Map<string, typeof rows>();
    for (const o of rows) {
      const printable =
        o.shippingStatus === ShippingStatus.PROCESSED || o.shippingStatus === ShippingStatus.SHIPPING;
      const adapter = getFulfillmentAdapter(o.channel.channelName);
      if (!printable || !adapter || !adapter.supported || !adapter.probeLabelReadiness) {
        ready.push(o.id);
        continue;
      }
      groups.set(o.channelId, [...(groups.get(o.channelId) ?? []), o]);
    }

    await Promise.all(
      [...groups.values()].map(async (list) => {
        const channel = list[0].channel;
        const adapter = getFulfillmentAdapter(channel.channelName)!;
        try {
          const r = await adapter.probeLabelReadiness!(channel, list.map(toFulfillRef));
          ready.push(...r.ready);
          for (const w of r.waiting) waiting.push({ id: w.orderId, orderCode: w.orderCode, reason: w.reason });
          for (const [id, d] of r.discovered) {
            await prisma.order.update({
              where: { id },
              data: {
                ...(d.trackingCode ? { trackingCode: d.trackingCode } : {}),
                ...(d.packageId ? { platformPackageId: d.packageId } : {}),
              },
            });
          }
        } catch (err) {
          // Lỗi cả gian (token hỏng…) — không chặn mẻ, /bulk/labels sẽ báo rõ
          const reason = err instanceof Error ? err.message : "Không hỏi được sàn";
          for (const o of list) {
            ready.push(o.id);
            failed.push({ orderCode: o.orderCode, reason });
          }
        }
      })
    );

    res.json({ ready, waiting, failed });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/bulk/labels — in vận đơn + phiếu nhặt hàng.
 * Body: { orderIds: string[], labels?: boolean (mặc định true), pickList?: boolean (mặc định true) }
 *
 * Trả MỘT file PDF (application/pdf): với từng đơn theo thứ tự chọn, trang vận
 * đơn CHÍNH CHỦ của sàn rồi tới phiếu nhặt hàng Hubsell (khổ A6 cả hai). Đơn
 * nào sàn chưa cấp vận đơn thì vẫn có phiếu nhặt hàng; danh sách lỗi gửi kèm
 * header X-Hubsell-Labels (base64 JSON) để giao diện báo đúng đơn nào thiếu.
 *
 * CỐ Ý KHÔNG đánh dấu đã in ở đây — endpoint chỉ ĐỌC. Đánh dấu nằm ở
 * /bulk/mark-printed, frontend gọi SAU khi hộp thoại in đã mở: đánh dấu sớm
 * mà trình duyệt chặn pop-up là đơn rơi khỏi nhóm "Chưa in" dù chưa có tờ nào.
 */
router.post("/bulk/labels", async (req: AuthRequest, res, next) => {
  try {
    const orderIds = readBulkOrderIds(req, res);
    if (!orderIds) return;
    const wantLabels = req.body?.labels !== false;
    const wantPickList = req.body?.pickList !== false;
    if (!wantLabels && !wantPickList) {
      res.status(400).json({ error: "Phải chọn in vận đơn hoặc phiếu nhặt hàng" });
      return;
    }

    const rows = await prisma.order.findMany({
      where: { id: { in: orderIds }, channel: channelScope(req) },
      include: {
        channel: true,
        items: { select: { productName: true, channelSku: true, quantity: true } },
      },
    });
    if (rows.length === 0) {
      res.status(404).json({ error: "Không tìm thấy đơn hàng nào" });
      return;
    }
    // Giữ đúng thứ tự seller chọn trên bảng
    const byId = new Map(rows.map((r) => [r.id, r]));
    const orders = orderIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));

    const labelPdfs = new Map<string, Buffer>();
    const failed: { orderCode: string; reason: string }[] = [];

    if (wantLabels) {
      const groups = new Map<string, typeof orders>();
      for (const o of orders) {
        if (o.shippingStatus !== ShippingStatus.PROCESSED && o.shippingStatus !== ShippingStatus.SHIPPING) {
          failed.push({
            orderCode: o.orderCode,
            reason:
              o.shippingStatus === ShippingStatus.PENDING
                ? "Chưa chuẩn bị hàng — sàn chưa cấp vận đơn"
                : "Đơn không ở trạng thái in được vận đơn",
          });
          continue;
        }
        groups.set(o.channelId, [...(groups.get(o.channelId) ?? []), o]);
      }
      await Promise.all(
        [...groups.values()].map(async (list) => {
          const channel = list[0].channel;
          const adapter = getFulfillmentAdapter(channel.channelName);
          if (!adapter) return; // offline: không có vận đơn sàn, chỉ phiếu nhặt
          try {
            const r = await adapter.fetchLabels(channel, list.map(toFulfillRef));
            for (const [id, pdf] of r.pdfs) labelPdfs.set(id, pdf);
            for (const f of r.failed) failed.push({ orderCode: f.orderCode, reason: f.reason });
            // Mã vận đơn/kiện khám phá được trong lúc lấy phiếu → lưu lại
            for (const [id, d] of r.discovered) {
              await prisma.order.update({
                where: { id },
                data: {
                  ...(d.trackingCode ? { trackingCode: d.trackingCode } : {}),
                  ...(d.packageId ? { platformPackageId: d.packageId } : {}),
                },
              });
              const o = byId.get(id);
              if (o && d.trackingCode) o.trackingCode = d.trackingCode;
            }
          } catch (err) {
            const reason = err instanceof Error ? err.message : "Không lấy được vận đơn từ sàn";
            for (const o of list) failed.push({ orderCode: o.orderCode, reason });
          }
        })
      );
    }

    const parts = [];
    for (const o of orders) {
      const label = labelPdfs.get(o.id) ?? null;
      const pickList = wantPickList
        ? await buildPickListPdf({
            orderCode: o.orderCode,
            channelLabel: CHANNEL_LABEL[o.channel.channelName] ?? o.channel.channelName,
            shopName: o.channel.shopName,
            trackingCode: o.trackingCode,
            carrierLabel: o.carrier ? CARRIER_LABEL[o.carrier] : o.shippingCarrierName || "Chưa gán",
            isExpress: isExpressShipping(o.shippingCarrierName),
            createdAt: o.createdAt,
            items: o.items.map((i) => ({ sku: i.channelSku, name: i.productName, quantity: i.quantity })),
          })
        : null;
      if (label || pickList) parts.push({ label, pickList });
    }
    if (parts.length === 0) {
      res.status(409).json({ error: "Không có phiếu nào để in", failed });
      return;
    }

    const merged = await mergePdfParts(parts);
    // id các đơn KHÔNG có vận đơn sàn trong file — frontend không đánh dấu đã in
    const failedCodes = new Set(failed.map((f) => f.orderCode));
    const summary = {
      orders: orders.length,
      labels: labelPdfs.size,
      pages: merged.pages,
      broken: merged.broken,
      failed,
      failedIds: orders.filter((o) => failedCodes.has(o.orderCode)).map((o) => o.id),
    };
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="hubsell-phieu-${orders.length}-don.pdf"`);
    res.setHeader("X-Hubsell-Labels", Buffer.from(JSON.stringify(summary), "utf8").toString("base64"));
    res.send(merged.pdf);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/bulk/mark-printed — đánh dấu đã in phiếu.
 * Body: { orderIds: string[] }
 *
 * Gọi SAU khi hộp thoại in đã mở thành công (xem chú thích ở /bulk/labels).
 * Chỉ ghi cho đơn chưa từng in: in lại lần hai vẫn được nhưng GIỮ NGUYÊN mốc
 * lần đầu, vì cái shop cần biết là "phiếu này đã ra giấy từ lúc nào", không
 * phải lần in gần nhất.
 */
router.post("/bulk/mark-printed", async (req: AuthRequest, res, next) => {
  try {
    const { orderIds } = req.body ?? {};
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn đơn hàng nào" });
      return;
    }
    if (orderIds.length > 200) {
      res.status(400).json({ error: "Tối đa 200 đơn mỗi lần" });
      return;
    }

    const result = await prisma.order.updateMany({
      where: {
        id: { in: orderIds },
        labelPrintedAt: null, // chỉ đơn chưa từng in
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
      },
      data: { labelPrintedAt: new Date() },
    });

    res.json({ markedPrinted: result.count });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/lookup?code=... — tra một đơn theo mã quét được.
 *
 * Máy quét bắn ra chuỗi gì thì tra chuỗi đó: tem vận đơn Shopee/TikTok in cả
 * mã vận đơn lẫn mã đơn, và mã QR thường chứa thêm ký tự thừa. Nên thử lần
 * lượt: khớp chính xác mã vận đơn (CẢ HAI CHIỀU — kiện hoàn Shopee mang mã
 * riêng ở returnTrackingCode) → mã đơn → cuối cùng mới khớp lỏng (chứa).
 * Khớp lỏng để cuối vì nó dễ ra nhiều kết quả; ra nhiều thì báo rõ chứ không
 * đoán bừa lấy đơn đầu tiên — quét nhầm đơn là cộng kho nhầm sản phẩm.
 *
 * TỰ CHỮA LÀNH: tra trượt mà user có gian sàn thật → đồng bộ nhanh (đơn trục
 * update 2 ngày + yêu cầu hoàn Shopee) rồi tra lại MỘT lần. Nhân viên kho quét
 * kiện vừa về là ra đơn ngay cả khi worker nền chưa tới nhịp — không ai phải
 * biết nút "Đồng bộ" ở đâu. Cooldown theo user chống đốt quota khi quét liên
 * tiếp nhiều mã lạ (mã hỏng, tem đơn vị khác).
 */
const LOOKUP_SYNC_COOLDOWN_MS = 90 * 1000;
/** ownerId → lần đồng bộ cứu quét gần nhất (in-memory, mất khi restart là vô hại). */
const lastLookupSyncAt = new Map<string, number>();

router.get("/lookup", async (req: AuthRequest, res, next) => {
  try {
    const raw = typeof req.query.code === "string" ? req.query.code.trim() : "";
    if (!raw) {
      res.status(400).json({ error: "Chưa có mã để tra cứu" });
      return;
    }
    // Máy quét hay kèm khoảng trắng/xuống dòng ở cuối; mã QR có thể là URL
    const code = raw.replace(/\s+/g, "");

    const scope: Prisma.OrderWhereInput = {
      channel: { userId: req.ownerId! },
      ...(req.allowedChannelIds
        ? { channelId: { in: req.allowedChannelIds } }
        : {}),
    };
    const include = {
      channel: { select: { channelName: true, shopName: true } },
      items: {
        select: {
          id: true,
          productName: true,
          channelSku: true,
          quantity: true,
          price: true,
          product: { select: { imageUrl: true } },
        },
      },
    };

    /** Một lượt tra trọn vẹn: khớp chính xác → khớp lỏng. */
    const findByCode = async () => {
      // 1) Khớp chính xác — mã vận đơn chiều đi, chiều hoàn, hoặc mã đơn
      const exact = await prisma.order.findFirst({
        where: {
          ...scope,
          OR: [
            { trackingCode: code },
            { returnTrackingCode: code },
            { orderCode: code },
          ],
        },
        include,
      });
      if (exact) return { order: exact, ambiguous: null };

      // 2) Khớp lỏng — dành cho mã QR chứa URL hoặc tiền tố của sàn
      if (code.length < 6) return { order: null, ambiguous: null };
      const loose = await prisma.order.findMany({
        where: {
          ...scope,
          OR: [
            { trackingCode: { contains: code, mode: "insensitive" } },
            { returnTrackingCode: { contains: code, mode: "insensitive" } },
            { orderCode: { contains: code, mode: "insensitive" } },
          ],
        },
        include,
        take: 5,
      });
      if (loose.length > 1) return { order: null, ambiguous: loose };
      return { order: loose[0] ?? null, ambiguous: null };
    };

    let { order, ambiguous } = await findByCode();
    let resynced = false;

    // 3) TỰ CHỮA LÀNH — tra trượt thì hỏi thẳng sàn rồi tra lại một lần.
    if (!order && !ambiguous) {
      const now = Date.now();
      const last = lastLookupSyncAt.get(req.ownerId!) ?? 0;
      if (now - last > LOOKUP_SYNC_COOLDOWN_MS) {
        const realChannels = await prisma.channel.findMany({
          where: {
            userId: req.ownerId!,
            ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
            channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
            status: "ACTIVE",
            refreshToken: { not: null },
          },
        });
        if (realChannels.length > 0) {
          lastLookupSyncAt.set(req.ownerId!, now);
          resynced = true;
          for (const channel of realChannels) {
            try {
              if (channel.channelName === ChannelName.SHOPEE) {
                if (!isShopeeConfigured()) continue;
                await syncShopeeOrders(channel, {
                  daysBack: 2,
                  timeRangeField: "update_time",
                });
                await syncShopeeReturns(channel, { daysBack: 7 });
              } else {
                if (!isLazadaConfigured()) continue;
                await syncLazadaOrders(channel, { daysBack: 2, byUpdateTime: true });
              }
            } catch (err) {
              // Một gian lỗi không chặn gian khác — mục tiêu là cứu lượt quét.
              console.warn(
                `[Lookup] Đồng bộ cứu quét lỗi gian "${channel.shopName}":`,
                (err as Error).message
              );
            }
          }
          ({ order, ambiguous } = await findByCode());
        }
      }
    }

    if (ambiguous) {
      res.status(409).json({
        error: `Mã "${raw}" khớp với ${ambiguous.length} đơn — quét lại hoặc nhập chính xác mã vận đơn`,
        candidates: ambiguous.map((o) => ({
          orderCode: o.orderCode,
          trackingCode: o.trackingCode,
        })),
      });
      return;
    }

    if (!order) {
      res.status(404).json({
        error: resynced
          ? `Không tìm thấy đơn nào có mã "${raw}" — đã hỏi lại sàn vẫn không có. Kiểm tra tem có đúng kiện của shop không.`
          : `Không tìm thấy đơn nào có mã "${raw}"`,
      });
      return;
    }

    res.json({ order: (await attachItemImages([order]))[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * Cộng NGƯỢC tồn kho cho một đơn hoàn dựa trên log TRỪ kho của chính đơn đó.
 *
 * Dùng chung cho nhập kho LẺ (/:id/return) và NHẬP KHO TẤT CẢ (bulk-inbound)
 * để hai đường không lệch nhau. Hàm này KHÔNG tự kiểm tra stockRestoredAt —
 * nơi gọi phải kiểm tra trước rồi tự ghi mốc, đúng như chốt chặn hiện hành.
 */
async function restoreReturnStockTx(
  tx: Prisma.TransactionClient,
  order: { id: string; orderCode: string },
  reason: string
) {
  const restored: {
    productId: string;
    productName: string;
    restoredQuantity: number;
    newQuantity: number;
  }[] = [];
  const deductions = await tx.inventoryLog.findMany({
    where: { orderId: order.id, changeQuantity: { lt: 0 } },
    include: { product: { select: { id: true, productName: true } } },
  });
  for (const log of deductions) {
    const qty = Math.abs(log.changeQuantity);
    const updated = await tx.product.update({
      where: { id: log.productId },
      data: { quantityInStock: { increment: qty } },
    });
    await tx.inventoryLog.create({
      data: {
        productId: log.productId,
        changeQuantity: qty,
        type: InventoryLogType.SYNC,
        reason,
        orderId: order.id,
      },
    });
    restored.push({
      productId: log.productId,
      productName: log.product.productName,
      restoredQuantity: qty,
      newQuantity: updated.quantityInStock,
    });
  }
  return restored;
}

/**
 * POST /api/orders/returns/bulk-inbound — "NHẬP KHO TẤT CẢ ĐƠN ĐÃ NHẬN".
 *
 * Không cần body, không cần chọn từng đơn: quét toàn bộ đơn RECEIVED (kho đã
 * quét nhận nhưng chưa nhập kho) trong phạm vi gian hàng được phép, cộng ngược
 * tồn kho rồi chuyển RECEIVED_INTACT. Thiết kế cho thao tác 1 chạm trên điện
 * thoại — mọi đơn đã quét nhận đều là đơn kho ĐÃ cầm hàng trên tay nên gộp
 * chung một nút là an toàn.
 *
 * Mỗi đơn chạy trong MỘT transaction riêng: một đơn lỗi không kéo sập cả lô,
 * các đơn đã nhập xong giữ nguyên kết quả. Chốt chặn stockRestoredAt vẫn áp
 * dụng từng đơn — đơn đã cộng kho lúc hủy chỉ đổi trạng thái, không cộng thêm.
 */
router.post("/returns/bulk-inbound", async (req: AuthRequest, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
        returnStatus: ReturnStatus.RECEIVED,
      },
      select: { id: true, orderCode: true, stockRestoredAt: true },
      orderBy: { returnedAt: "asc" },
    });

    const results: {
      orderCode: string;
      restored: {
        productId: string;
        productName: string;
        restoredQuantity: number;
        newQuantity: number;
      }[];
    }[] = [];
    const failed: { orderCode: string; error: string }[] = [];

    for (const order of orders) {
      try {
        const restored = await prisma.$transaction(async (tx) => {
          const lines =
            order.stockRestoredAt === null
              ? await restoreReturnStockTx(
                  tx,
                  order,
                  `Nhập kho hàng hoàn (nhập kho tất cả) — đơn ${order.orderCode}`
                )
              : [];
          await tx.order.update({
            where: { id: order.id },
            data: {
              returnStatus: ReturnStatus.RECEIVED_INTACT,
              shippingStatus: ShippingStatus.CANCELLED,
              ...(lines.length > 0 ? { stockRestoredAt: new Date() } : {}),
            },
          });
          return lines;
        });
        results.push({ orderCode: order.orderCode, restored });
      } catch (err) {
        failed.push({
          orderCode: order.orderCode,
          error: err instanceof Error ? err.message : "Lỗi không xác định",
        });
      }
    }

    // Hàng hoàn vừa nhập lại kho → đẩy tồn khả dụng mới lên các sàn đã liên kết.
    await enqueueStockPush(
      results.flatMap((r) => r.restored.map((l) => l.productId)),
      { source: "nhập kho hàng hoàn (nhập kho tất cả)" }
    );

    res.json({
      processed: results.length,
      restockedUnits: results.reduce(
        (sum, r) => sum + r.restored.reduce((s, l) => s + l.restoredQuantity, 0),
        0
      ),
      orders: results,
      failed,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/:id/return — CÔNG ĐOẠN 2 xử lý lẻ: chốt số phận kiện hàng
 * hoàn kho đang cầm trên tay.
 * Body: { condition: "INTACT" | "DAMAGED", note?: string }
 *
 * INTACT  → NHẬP KHO: cộng NGƯỢC tồn kho cho từng SKU, ghi InventoryLog.
 * DAMAGED → KHÔNG cộng kho, gắn cờ chờ khiếu nại sàn/đơn vị vận chuyển.
 *
 * Gọi được từ AWAITING (xử lý tắt, bỏ qua bước quét nhận) lẫn RECEIVED (luồng
 * chuẩn 2 công đoạn). Cộng kho chỉ xảy ra ĐÚNG MỘT LẦN nhờ mốc stockRestoredAt:
 * đơn hủy trước khi giao đã được cộng kho ngay lúc hủy, nếu nhân viên còn quét
 * nhận hoàn nữa thì chỉ đổi trạng thái chứ không cộng thêm.
 */
router.post("/:id/return", async (req: AuthRequest, res, next) => {
  try {
    const { condition, note } = req.body ?? {};
    if (condition !== "INTACT" && condition !== "DAMAGED") {
      res.status(400).json({
        error: "condition phải là INTACT (nguyên vẹn) hoặc DAMAGED (hư hỏng/mất)",
      });
      return;
    }
    if (note !== undefined && typeof note !== "string") {
      res.status(400).json({ error: "Ghi chú phải là chuỗi" });
      return;
    }

    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
      },
      select: {
        id: true,
        orderCode: true,
        shippingStatus: true,
        returnStatus: true,
        returnNote: true,
        returnedAt: true,
        stockRestoredAt: true,
      },
    });
    if (!order) {
      res.status(404).json({ error: "Không tìm thấy đơn hàng" });
      return;
    }
    // Chỉ xử lý được đơn đang chờ về tay hoặc đã quét nhận. Các trạng thái sau
    // đó (đã nhập kho / đang khiếu nại / đã chốt) đều là đã xử lý xong.
    if (
      order.returnStatus !== ReturnStatus.AWAITING &&
      order.returnStatus !== ReturnStatus.RECEIVED &&
      order.returnStatus !== ReturnStatus.NONE
    ) {
      res.status(409).json({
        error: `Đơn ${order.orderCode} đã được xử lý hoàn trước đó rồi`,
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Chỉ cộng kho khi hàng nguyên vẹn VÀ đơn này chưa từng được cộng
      const shouldRestore =
        condition === "INTACT" && order.stockRestoredAt === null;

      const restored = shouldRestore
        ? await restoreReturnStockTx(
            tx,
            order,
            `Nhận hàng hoàn nguyên vẹn — đơn ${order.orderCode}`
          )
        : [];

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          returnStatus:
            condition === "INTACT"
              ? ReturnStatus.RECEIVED_INTACT
              : ReturnStatus.DAMAGED,
          // Ghi chú mới nối vào ghi chú cũ (nếu có từ lúc quét nhận) — đè mất
          // là mất căn cứ đối soát
          returnNote:
            typeof note === "string" && note.trim()
              ? [order.returnNote, note.trim()].filter(Boolean).join(" · ")
              : order.returnNote,
          // Mốc "đã cầm hàng trên tay" ghi ở lần quét nhận; xử lý tắt từ
          // AWAITING thì ghi tại đây
          returnedAt: order.returnedAt ?? new Date(),
          // Đơn hoàn về thì coi như đã kết thúc vòng đời giao hàng
          shippingStatus: ShippingStatus.CANCELLED,
          ...(restored.length > 0 ? { stockRestoredAt: new Date() } : {}),
        },
        include: { channel: { select: { channelName: true, shopName: true } } },
      });

      return { order: updatedOrder, restored, shouldRestore };
    });

    // Hàng hoàn nguyên vẹn vừa cộng kho → đẩy tồn mới lên các sàn đã liên kết.
    await enqueueStockPush(
      result.restored.map((l) => l.productId),
      { source: `nhận hàng hoàn — đơn ${order.orderCode}` }
    );

    // LƯU Ý (25/08): KHÔNG cắm hook hóa đơn điều chỉnh vào đây — anh Trung chốt
    // luồng thuế THUẦN THEO API SÀN, kho vật lý chỉ kiểm soát nội bộ (xem
    // adjust-order.ts, hook nằm ở returns-sync của từng sàn).
    res.json({
      order: result.order,
      restored: result.restored,
      // Nói rõ vì sao không cộng kho, để giao diện hiển thị đúng lý do
      stockSkippedReason:
        condition === "DAMAGED"
          ? "Hàng hư hỏng/mất — không cộng lại tồn kho, đã gắn cờ chờ khiếu nại"
          : order.stockRestoredAt !== null
            ? "Đơn này đã được cộng lại tồn kho từ trước (lúc hủy đơn) — không cộng thêm lần nữa"
            : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
