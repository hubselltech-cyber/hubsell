import { Router } from "express";
import { Carrier, InventoryLogType, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { mockSettlement } from "../mockMarketplace";

const router = Router();

const VALID_STATUSES = ["PENDING", "SHIPPING", "DELIVERED", "CANCELLED"] as const;
type ShippingStatus = (typeof VALID_STATUSES)[number];

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
      ...(shippingStatus ? { shippingStatus } : {}),
      ...(isCarrier(carrier) ? { carrier } : {}),
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

    const [total, items, statusCounts] = await Promise.all([
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
      // Cố ý BỎ shippingStatus khỏi điều kiện đếm — nếu không thì tab đang mở
      // sẽ là tab duy nhất có số, các tab khác luôn bằng 0.
      prisma.order.groupBy({
        by: ["shippingStatus"],
        _count: { _all: true },
        where: { ...where, shippingStatus: undefined },
      }),
    ]);

    const counts: Record<string, number> = { ALL: 0 };
    for (const g of statusCounts) {
      counts[g.shippingStatus] = g._count._all;
      counts.ALL += g._count._all;
    }

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
    if (!VALID_STATUSES.includes(shippingStatus)) {
      res.status(400).json({
        error: `Trạng thái không hợp lệ. Chọn một trong: ${VALID_STATUSES.join(", ")}`,
      });
      return;
    }
    const newStatus = shippingStatus as ShippingStatus;

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
 * POST /api/orders/bulk/confirm — "Xác nhận chuẩn bị hàng" cho nhiều đơn.
 * Body: { orderIds: string[] }
 *
 * Ở bản có tích hợp thật, đây là chỗ gọi API sàn để báo "đã đóng gói xong,
 * mời shipper tới lấy". Hubsell hiện dùng sàn giả lập nên bước này chỉ ghi mốc
 * `packedAt` và đẩy đơn từ Chờ xử lý → Đang giao. Khi nối API thật, thêm lời
 * gọi ra sàn ngay trước transaction; phần còn lại giữ nguyên.
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
      if (o.shippingStatus === "PENDING") ready.push(o.id);
      else if (o.shippingStatus === "CANCELLED")
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
      data: { shippingStatus: "SHIPPING", packedAt: new Date() },
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

    res.json({ labels: orders });
  } catch (err) {
    next(err);
  }
});

export default router;
