import { Router } from "express";
import {
  Carrier,
  ChannelName,
  InventoryLogType,
  Prisma,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { mockSettlement } from "../mockMarketplace";
import { channelScope } from "../channel-filter";
import { attachItemImages } from "../item-images";
import { isExpressShipping } from "../shipping";
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

    const [total, items, statusCounts, notPrinted, alreadyPrinted] =
      await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
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
        },
      }),
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

/**
 * POST /api/orders/bulk/confirm — "Xác nhận & chuẩn bị hàng" cho nhiều đơn.
 * Body: { orderIds: string[] }
 *
 * Chờ xử lý → ĐÃ XỬ LÝ (không nhảy thẳng sang Đang giao).
 * Đây là mốc chống đóng gói lặp: đơn đã xác nhận nằm riêng một nhóm, nhân viên
 * khác nhìn vào biết ngay đơn nào đang được gói, đơn nào chưa ai đụng tới.
 * Việc bàn giao cho shipper là bước RIÊNG (bulk/handover) vì hai việc này cách
 * nhau vài tiếng trong thực tế.
 *
 * Ở bản có tích hợp thật, đây là chỗ gọi API sàn để báo "đã đóng gói xong,
 * mời shipper tới lấy". Khi nối API thật, thêm lời gọi ra sàn ngay trước
 * transaction; phần còn lại giữ nguyên.
 *
 * Bỏ qua có chọn lọc thay vì fail cả mẻ: chọn 50 đơn mà 1 đơn đã hủy thì báo
 * riêng đơn đó, 49 đơn còn lại vẫn phải chạy — bắt làm lại từ đầu là hành
 * người dùng.
 */
router.post("/bulk/confirm", async (req: AuthRequest, res, next) => {
  try {
    const { orderIds } = req.body ?? {};
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn đơn hàng nào" });
      return;
    }
    if (!orderIds.every((id) => typeof id === "string" && id)) {
      res.status(400).json({ error: "orderIds phải là mảng chuỗi" });
      return;
    }
    if (orderIds.length > 200) {
      res.status(400).json({ error: "Tối đa 200 đơn mỗi lần xử lý" });
      return;
    }

    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
      },
      select: { id: true, orderCode: true, shippingStatus: true },
    });

    const found = new Set(orders.map((o) => o.id));
    const skipped: { orderCode: string; reason: string }[] = [];
    const ready: string[] = [];

    for (const o of orders) {
      if (o.shippingStatus === ShippingStatus.PENDING) ready.push(o.id);
      else if (o.shippingStatus === ShippingStatus.CANCELLED)
        skipped.push({ orderCode: o.orderCode, reason: "Đơn đã hủy" });
      else
        skipped.push({
          orderCode: o.orderCode,
          reason: "Đơn đã rời trạng thái Chờ xử lý",
        });
    }
    // Id không tra ra đơn nào = không thuộc shop hoặc ngoài phạm vi kênh
    const missing = orderIds.filter((id: string) => !found.has(id));
    for (const id of missing) {
      skipped.push({ orderCode: id, reason: "Không tìm thấy hoặc ngoài quyền" });
    }

    if (ready.length === 0) {
      res.status(409).json({
        error: "Không có đơn nào ở trạng thái Chờ xử lý để xác nhận",
        confirmed: 0,
        skipped,
      });
      return;
    }

    await prisma.order.updateMany({
      where: { id: { in: ready } },
      data: { shippingStatus: ShippingStatus.PROCESSED, packedAt: new Date() },
    });

    res.json({ confirmed: ready.length, skipped });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/bulk/handover — "Bàn giao vận chuyển" cho nhiều đơn.
 * Body: { orderIds: string[] }
 *
 * Đã xử lý → ĐANG GIAO. Tách riêng khỏi bước xác nhận vì trong thực tế shop
 * gói hàng buổi sáng nhưng shipper chiều mới tới lấy; gộp hai bước làm một thì
 * đơn nằm trong kho vẫn bị hiển thị là đang trên đường giao.
 */
router.post("/bulk/handover", async (req: AuthRequest, res, next) => {
  try {
    const { orderIds } = req.body ?? {};
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn đơn hàng nào" });
      return;
    }
    if (!orderIds.every((id) => typeof id === "string" && id)) {
      res.status(400).json({ error: "orderIds phải là mảng chuỗi" });
      return;
    }
    if (orderIds.length > 200) {
      res.status(400).json({ error: "Tối đa 200 đơn mỗi lần xử lý" });
      return;
    }

    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
      },
      select: { id: true, orderCode: true, shippingStatus: true },
    });

    const found = new Set(orders.map((o) => o.id));
    const skipped: { orderCode: string; reason: string }[] = [];
    const ready: string[] = [];

    for (const o of orders) {
      if (o.shippingStatus === ShippingStatus.PROCESSED) ready.push(o.id);
      else if (o.shippingStatus === ShippingStatus.PENDING)
        skipped.push({
          orderCode: o.orderCode,
          reason: "Chưa xác nhận chuẩn bị hàng",
        });
      else if (o.shippingStatus === ShippingStatus.CANCELLED)
        skipped.push({ orderCode: o.orderCode, reason: "Đơn đã hủy" });
      else
        skipped.push({ orderCode: o.orderCode, reason: "Đơn đã bàn giao rồi" });
    }
    for (const id of orderIds.filter((x: string) => !found.has(x))) {
      skipped.push({ orderCode: id, reason: "Không tìm thấy hoặc ngoài quyền" });
    }

    if (ready.length === 0) {
      res.status(409).json({
        error: "Không có đơn nào ở trạng thái Đã xử lý để bàn giao",
        confirmed: 0,
        skipped,
      });
      return;
    }

    await prisma.order.updateMany({
      where: { id: { in: ready } },
      data: { shippingStatus: ShippingStatus.SHIPPING },
    });

    res.json({ confirmed: ready.length, skipped });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/bulk/labels — lấy dữ liệu in phiếu giao hàng cho nhiều đơn.
 * Body: { orderIds: string[] }
 *
 * ⚠️ Đây là phiếu giao hàng do HUBSELL tự dựng từ dữ liệu đơn, KHÔNG phải file
 * vận đơn PDF chính thức của sàn. Muốn lấy phiếu chính chủ của Shopee/TikTok
 * thì phải có tích hợp API thật với quyền in vận đơn — chưa làm được ở bản này.
 */
router.post("/bulk/labels", async (req: AuthRequest, res, next) => {
  try {
    const { orderIds } = req.body ?? {};
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ error: "Chưa chọn đơn hàng nào" });
      return;
    }
    if (orderIds.length > 200) {
      res.status(400).json({ error: "Tối đa 200 phiếu mỗi lần in" });
      return;
    }

    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        channel: { userId: req.ownerId! },
        ...(req.allowedChannelIds
          ? { channelId: { in: req.allowedChannelIds } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        channel: { select: { channelName: true, shopName: true } },
        items: {
          select: { productName: true, channelSku: true, quantity: true },
        },
      },
    });

    if (orders.length === 0) {
      res.status(404).json({ error: "Không tìm thấy đơn hàng nào" });
      return;
    }

    // CỐ Ý KHÔNG đánh dấu đã in ở đây. Endpoint này chỉ ĐỌC.
    // Việc đánh dấu nằm ở /bulk/mark-printed, do frontend gọi SAU khi cửa sổ in
    // đã mở thành công. Nếu đánh dấu ngay tại đây, trình duyệt chặn pop-up là
    // đơn bị ghi "đã in" trong khi chẳng có tờ phiếu nào ra giấy — kho sẽ bỏ
    // sót đúng những đơn đó vì chúng đã rơi khỏi nhóm "Chưa in".
    res.json({ labels: orders });
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
