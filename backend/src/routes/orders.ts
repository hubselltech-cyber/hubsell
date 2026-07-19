import { Router } from "express";
import {
  Carrier,
  InventoryLogType,
  Prisma,
  ShippingStatus,
} from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { mockSettlement } from "../mockMarketplace";

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

// GET /api/orders?page=1&pageSize=20&shippingStatus=PENDING&channelId=...
// Danh sách đơn hàng gom về từ TẤT CẢ các kênh, có bộ lọc + phân trang.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    // Trần 100: cho phép chủ shop mở rộng 20 → 50 → 100 đơn/trang khi soát
    // đơn hàng loạt, nhưng không để gõ tay ?pageSize=100000 làm nghẽn truy vấn.
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const shippingStatus =
      typeof req.query.shippingStatus === "string" ? req.query.shippingStatus : "";
    const channelId =
      typeof req.query.channelId === "string" ? req.query.channelId : "";
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

    // Phân quyền multi-store: nhân viên bị giới hạn kênh thì chỉ thấy đơn của kênh được gán.
    // Nếu lọc theo 1 kênh cụ thể mà kênh đó không nằm trong phạm vi → không trả gì.
    const channelWhere: Prisma.ChannelWhereInput = { userId: req.ownerId! };
    if (req.allowedChannelIds) {
      const allowed = req.allowedChannelIds;
      channelWhere.id = channelId
        ? { in: allowed.filter((id) => id === channelId) }
        : { in: allowed };
    } else if (channelId) {
      channelWhere.id = channelId;
    }

    const where: Prisma.OrderWhereInput = {
      channel: channelWhere,
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

    const [total, items, statusCounts, notPrinted, alreadyPrinted] =
      await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: { select: { channelName: true } },
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
      items,
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
      include: { channel: { select: { channelName: true } } },
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
        include: { channel: { select: { channelName: true } } },
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
          productName: log.product.productName,
          restoredQuantity: qty,
          newQuantity: updatedProduct.quantityInStock,
        });
      }

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { shippingStatus: "CANCELLED" },
        include: { channel: { select: { channelName: true } } },
      });

      return { order: updatedOrder, restored };
    });

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
        channel: { select: { channelName: true } },
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

export default router;
