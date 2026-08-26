import { Router } from "express";
import { InventoryLogType, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { syncShopeeStockForProducts } from "../integrations/shopee/inventory-sync";
import {
  countPendingJobs,
  enqueueStockPush,
  enqueueStockPushForOwner,
} from "../integrations/inventory-push";

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

    // Kho vừa biến động tay → xếp job đẩy tồn khả dụng mới lên các sàn đã liên
    // kết (sau commit, best-effort — không chặn response).
    await enqueueStockPush([productId], {
      source: type === "IMPORT" ? "nhập kho thủ công" : "xuất kho thủ công",
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
      }
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

// Route GET /webhook-logs (trang "Nhật ký Webhook" trong Cấu hình) đã XÓA HẲN
// 06/08: dữ liệu vận hành nội bộ không nên lộ với khách hàng — nhật ký webhook
// toàn hệ thống chỉ còn ở /api/admin/webhook-logs (chặn isPlatformAdmin).

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

// ============================================================
// CẤU HÌNH ĐỒNG BỘ TỒN KHO ĐA SÀN (trang Quản lý Kho → Đồng bộ tồn kho)
// CHỈ CHỦ SHOP: bật switch = Hubsell trở thành nguồn sự thật GHI ĐÈ tồn sàn —
// quyết định cấp shop, không nằm trong cây phân quyền nhân viên.
// ============================================================

function requireShopOwner(req: AuthRequest, res: import("express").Response): boolean {
  if (req.userRole !== Role.ADMIN) {
    res.status(403).json({ error: "Chỉ chủ shop mới được cấu hình đồng bộ tồn kho" });
    return false;
  }
  return true;
}

// GET /api/inventory/sync-settings — cấu hình hiện tại + số job đang chờ đẩy.
router.get("/sync-settings", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    const setting = await prisma.shopSyncSetting.findUnique({
      where: { userId: req.ownerId! },
      select: { autoSyncEnabled: true, safetyStockDefault: true, updatedAt: true },
    });
    res.json({
      autoSyncEnabled: setting?.autoSyncEnabled ?? false,
      safetyStockDefault: setting?.safetyStockDefault ?? 0,
      updatedAt: setting?.updatedAt ?? null,
      pendingJobs: await countPendingJobs(req.ownerId!),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/inventory/sync-settings — Body: { autoSyncEnabled?, safetyStockDefault? }
// Bật autoSync (OFF→ON) hoặc đổi tồn an toàn khi đang ON → tự xếp job đẩy lại
// TOÀN BỘ SKU đã liên kết (đưa tồn sàn về khớp ngay, không chờ biến động sau).
router.put("/sync-settings", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    const { autoSyncEnabled, safetyStockDefault } = req.body ?? {};

    if (autoSyncEnabled !== undefined && typeof autoSyncEnabled !== "boolean") {
      res.status(400).json({ error: "autoSyncEnabled phải là true/false" });
      return;
    }
    let safety: number | undefined;
    if (safetyStockDefault !== undefined) {
      safety = Number(safetyStockDefault);
      if (!Number.isInteger(safety) || safety < 0) {
        res.status(400).json({ error: "Tồn an toàn phải là số nguyên không âm" });
        return;
      }
    }

    const before = await prisma.shopSyncSetting.findUnique({
      where: { userId: req.ownerId! },
      select: { autoSyncEnabled: true, safetyStockDefault: true },
    });
    const updated = await prisma.shopSyncSetting.upsert({
      where: { userId: req.ownerId! },
      update: {
        ...(autoSyncEnabled !== undefined ? { autoSyncEnabled } : {}),
        ...(safety !== undefined ? { safetyStockDefault: safety } : {}),
      },
      create: {
        userId: req.ownerId!,
        autoSyncEnabled: autoSyncEnabled ?? false,
        safetyStockDefault: safety ?? 0,
      },
    });

    // Cấu hình mới làm đổi số tồn cần đẩy → sync lại toàn bộ khi:
    //   (a) vừa BẬT autoSync (đưa tồn mọi sàn về khớp Hubsell ngay), hoặc
    //   (b) đang ON và đổi tồn an toàn mặc định (available đổi hàng loạt).
    const justEnabled = updated.autoSyncEnabled && !before?.autoSyncEnabled;
    const safetyChanged =
      safety !== undefined && safety !== (before?.safetyStockDefault ?? 0);
    let queued = 0;
    if (justEnabled || (updated.autoSyncEnabled && safetyChanged)) {
      queued = (
        await enqueueStockPushForOwner(
          req.ownerId!,
          justEnabled ? "bật tự động đồng bộ tồn" : "đổi tồn an toàn mặc định"
        )
      ).queued;
    }

    res.json({
      autoSyncEnabled: updated.autoSyncEnabled,
      safetyStockDefault: updated.safetyStockDefault,
      queued,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/sync-all — nút [Sync ngay toàn bộ]: đẩy lại tồn khả dụng
// của MỌI SKU đã liên kết lên mọi gian Shopee/Lazada, bất kể switch autoSync.
router.post("/sync-all", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    const r = await enqueueStockPushForOwner(req.ownerId!, "sync tay toàn bộ");
    res.json({ queued: r.queued });
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/sync-pending — số job còn chờ trong hàng đợi (UI poll
// để vẽ tiến độ sau khi bấm sync toàn bộ; nhẹ, gọi mỗi vài giây được).
router.get("/sync-pending", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    res.json({ pending: await countPendingJobs(req.ownerId!) });
  } catch (err) {
    next(err);
  }
});

export default router;
