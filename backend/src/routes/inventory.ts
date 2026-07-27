import { Router } from "express";
import { InventoryLogType, Role, WebhookJobStatus } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { syncShopeeStockForProducts } from "../integrations/shopee/inventory-sync";

const router = Router();

// POST /api/inventory/adjust — Điều chỉnh xuất/nhập kho thủ công.
// Dùng DATABASE TRANSACTION: cập nhật tồn kho + ghi InventoryLog phải cùng
// thành công hoặc cùng thất bại, để số liệu không bao giờ lệch nhau.
router.post("/adjust", async (req: AuthRequest, res, next) => {
  try {
    const { productId, type, quantity, reason } = req.body ?? {};

    if (typeof productId !== "string" || productId.length === 0) {
      res.status(400).json({ error: "Thiếu mã sản phẩm" });
      return;
    }
    if (type !== "IMPORT" && type !== "EXPORT") {
      res.status(400).json({ error: "Loại điều chỉnh phải là IMPORT (nhập) hoặc EXPORT (xuất)" });
      return;
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      res.status(400).json({ error: "Số lượng phải là số nguyên dương" });
      return;
    }
    if (reason !== undefined && typeof reason !== "string") {
      res.status(400).json({ error: "Lý do không hợp lệ" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Khoá dòng sản phẩm để tránh 2 người điều chỉnh cùng lúc gây sai số
      const rows = await tx.$queryRaw<
        { id: string; quantityInStock: number }[]
      >`SELECT "id", "quantityInStock" FROM "Product" WHERE "id" = ${productId} AND "userId" = ${req.ownerId!} FOR UPDATE`;

      const product = rows[0];
      if (!product) {
        throw Object.assign(new Error("Không tìm thấy sản phẩm"), { statusCode: 404 });
      }

      const delta = type === "IMPORT" ? qty : -qty;
      const newQuantity = product.quantityInStock + delta;

      if (newQuantity < 0) {
        throw Object.assign(
          new Error(
            `Không đủ hàng để xuất: tồn kho hiện tại ${product.quantityInStock}, muốn xuất ${qty}`
          ),
          { statusCode: 400 }
        );
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: { quantityInStock: newQuantity },
      });

      const log = await tx.inventoryLog.create({
        data: {
          productId,
          changeQuantity: delta,
          type: type === "IMPORT" ? InventoryLogType.IMPORT : InventoryLogType.EXPORT,
          reason: reason?.trim() || (type === "IMPORT" ? "Nhập kho thủ công" : "Xuất kho thủ công"),
        },
      });

      return { product: updated, log };
    });

    res.json(result);
  } catch (err) {
    // Lỗi nghiệp vụ có statusCode riêng (404 / 400)
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    next(err);
  }
});

// GET /api/inventory/logs?productId=... — Lịch sử xuất nhập kho của một sản phẩm
router.get("/logs", async (req: AuthRequest, res, next) => {
  try {
    const productId = typeof req.query.productId === "string" ? req.query.productId : "";
    if (!productId) {
      res.status(400).json({ error: "Thiếu mã sản phẩm" });
      return;
    }

    // Chỉ xem được log sản phẩm của chính mình
    const product = await prisma.product.findFirst({
      where: { id: productId, userId: req.ownerId! },
      select: { id: true },
    });
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm" });
      return;
    }

    const logs = await prisma.inventoryLog.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// ĐỒNG BỘ TỒN KHO TỰ ĐỘNG — cảnh báo lệch tồn + nhật ký đối soát
//
// Nguồn dữ liệu do luồng webhook Shopee ghi (integrations/shopee/inventory-sync):
//   InventorySyncAlert — đẩy tồn lên sàn thất bại sau đủ số lần retry, tồn trên
//     sàn ĐANG LỆCH, chủ shop phải chỉnh tay rồi bấm "Đã xử lý".
//   InventorySyncLog   — mỗi lượt đẩy tồn một dòng [SKU, số cũ, số mới, kết quả].
// Phạm vi: theo gian hàng của chủ shop; SALES bị bó theo gian được phân công.
// ============================================================

/** Điều kiện lọc kênh theo quyền: gian của shop + phạm vi phân công (SALES). */
function syncChannelScope(req: AuthRequest) {
  return {
    userId: req.ownerId!,
    ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
  };
}

// GET /api/inventory/sync-alerts — cảnh báo lệch tồn CHƯA xử lý (mới nhất trước)
router.get("/sync-alerts", async (req: AuthRequest, res, next) => {
  try {
    const alerts = await prisma.inventorySyncAlert.findMany({
      where: { resolvedAt: null, channel: syncChannelScope(req) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { channel: { select: { shopName: true, channelName: true } } },
    });

    // Tồn khả dụng HIỆN TẠI của từng SKU cảnh báo — số chuẩn Hubsell mà nút
    // "Cập nhật tồn" trên Trung tâm điều hành sẽ đè lên sàn.
    const skuAlerts = alerts.filter((a) => a.channelSku);
    const mappings = skuAlerts.length
      ? await prisma.channelProduct.findMany({
          where: {
            OR: skuAlerts.map((a) => ({
              channelId: a.channelId,
              channelSku: a.channelSku!,
            })),
            productId: { not: null },
          },
          select: {
            channelId: true,
            channelSku: true,
            product: { select: { quantityInStock: true, holdQuantity: true } },
          },
        })
      : [];
    const availableByKey = new Map(
      mappings.map((m) => [
        `${m.channelId}:${m.channelSku}`,
        m.product ? m.product.quantityInStock - m.product.holdQuantity : null,
      ])
    );

    res.json(
      alerts.map((a) => ({
        id: a.id,
        shopName: a.channel.shopName,
        channelSku: a.channelSku,
        orderSn: a.orderSn,
        message: a.message,
        createdAt: a.createdAt,
        hubsellAvailable: a.channelSku
          ? (availableByKey.get(`${a.channelId}:${a.channelSku}`) ?? null)
          : null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /api/inventory/sync-alerts/:id/resolve — đánh dấu đã xử lý tay xong
router.patch("/sync-alerts/:id/resolve", async (req: AuthRequest, res, next) => {
  try {
    // updateMany + điều kiện sở hữu: không sửa được cảnh báo của shop khác.
    const updated = await prisma.inventorySyncAlert.updateMany({
      where: { id: req.params.id, resolvedAt: null, channel: syncChannelScope(req) },
      data: { resolvedAt: new Date() },
    });
    if (updated.count === 0) {
      res.status(404).json({ error: "Không tìm thấy cảnh báo (hoặc đã xử lý rồi)" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/sync-alerts/:id/force-sync — nút [Cập nhật tồn] trên thẻ
// cảnh báo của Trung tâm điều hành: ĐÈ trực tiếp tồn khả dụng chuẩn từ Hubsell
// lên sàn cho SKU của cảnh báo (đẩy tới MỌI gian Shopee đang liên kết SKU đó),
// thành công thì tự đóng cảnh báo + ghi nhật ký vận hành.
router.post("/sync-alerts/:id/force-sync", async (req: AuthRequest, res, next) => {
  try {
    const alert = await prisma.inventorySyncAlert.findFirst({
      where: { id: req.params.id, resolvedAt: null, channel: syncChannelScope(req) },
      include: { channel: { select: { shopName: true, userId: true } } },
    });
    if (!alert) {
      res.status(404).json({ error: "Không tìm thấy cảnh báo (hoặc đã xử lý rồi)" });
      return;
    }
    if (!alert.channelSku) {
      res.status(400).json({
        error: "Cảnh báo này không gắn SKU cụ thể — hãy kiểm tra kết nối gian hàng rồi bấm Đã xử lý.",
      });
      return;
    }

    const mapping = await prisma.channelProduct.findFirst({
      where: {
        channelId: alert.channelId,
        channelSku: alert.channelSku,
        productId: { not: null },
      },
      select: {
        productId: true,
        product: { select: { quantityInStock: true, holdQuantity: true } },
      },
    });
    if (!mapping?.productId || !mapping.product) {
      res.status(400).json({
        error: `SKU ${alert.channelSku} chưa liên kết với sản phẩm kho — vào "Liên kết sản phẩm" nối trước rồi thử lại.`,
      });
      return;
    }

    const available =
      mapping.product.quantityInStock - mapping.product.holdQuantity;
    const result = await syncShopeeStockForProducts(
      {
        orderSn: alert.orderSn ?? undefined,
        productIds: [mapping.productId],
        oldAvailable: { [mapping.productId]: available },
      },
      "force-sync từ Trung tâm điều hành"
    );

    if (result.failed > 0) {
      // Lượt đè thất bại — syncShopeeStockForProducts đã tự ghi log + cảnh báo
      // mới; giữ nguyên cảnh báo hiện tại cho chủ shop xử lý tiếp.
      res.status(502).json({
        error: `Đẩy lại tồn kho thất bại (${result.failed} lượt lỗi) — Shopee vẫn từ chối. Xem cảnh báo/log đồng bộ để biết chi tiết.`,
      });
      return;
    }

    await prisma.inventorySyncAlert.update({
      where: { id: alert.id },
      data: { resolvedAt: new Date() },
    });
    await prisma.opsActivity.create({
      data: {
        ownerId: alert.channel.userId,
        tag: "channel",
        message: `✅ Đã đẩy lại tồn kho chuẩn từ Hubsell (${Math.max(0, available)}) cho SKU ${alert.channelSku} lên gian "${alert.channel.shopName}" — cảnh báo lệch tồn được đóng.`,
      },
    });

    res.json({ ok: true, pushed: result.pushed, applied: Math.max(0, available) });
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/webhook-logs — trang đối soát hàng đợi webhook + job đối
// soát tồn (CHỈ Quản trị): dev/admin soi payload thô mà không phải vào DB.
router.get("/webhook-logs", async (req: AuthRequest, res, next) => {
  try {
    if (req.userRole !== Role.ADMIN) {
      res.status(403).json({ error: "Chỉ Quản trị (toàn quyền) được xem nhật ký webhook" });
      return;
    }

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const statusRaw = typeof req.query.status === "string" ? req.query.status : "";
    const status = (Object.values(WebhookJobStatus) as string[]).includes(statusRaw)
      ? (statusRaw as WebhookJobStatus)
      : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    // Phạm vi dữ liệu: chỉ log thuộc các gian hàng của shop này (khớp theo
    // shop_id sàn — job đối soát tồn cũng ghi shopId của gian nên phủ cả hai).
    const channels = await prisma.channel.findMany({
      where: { userId: req.ownerId!, externalShopId: { not: null } },
      select: { externalShopId: true },
    });
    const shopIds = channels.map((c) => c.externalShopId!);

    const where = {
      shopId: { in: shopIds },
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { orderSn: { contains: q, mode: "insensitive" as const } },
              // SKU nằm trong payload JSON của job đối soát; mã đơn cũng nằm
              // trong payload webhook — contains phủ cả hai kiểu tìm.
              { payload: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, statusCounts] = await Promise.all([
      prisma.shopeeWebhookLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.shopeeWebhookLog.groupBy({
        by: ["status"],
        where: { shopId: { in: shopIds } },
        _count: { _all: true },
      }),
    ]);

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        eventCode: r.eventCode,
        shopId: r.shopId,
        orderSn: r.orderSn,
        status: r.status,
        attempts: r.attempts,
        nextRetryAt: r.nextRetryAt,
        processedAt: r.processedAt,
        lastError: r.lastError,
        payload: r.payload,
        createdAt: r.createdAt,
      })),
      counts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/sync-logs — nhật ký đối soát các lượt đẩy tồn lên sàn
router.get("/sync-logs", async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const logs = await prisma.inventorySyncLog.findMany({
      where: { channel: syncChannelScope(req) },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { channel: { select: { shopName: true } } },
    });
    res.json(
      logs.map((l) => ({
        id: l.id,
        shopName: l.channel.shopName,
        channelSku: l.channelSku,
        oldQuantity: l.oldQuantity,
        newQuantity: l.newQuantity,
        status: l.status,
        message: l.message,
        createdAt: l.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

export default router;
