import { Router } from "express";
import { InventoryLogType, Role, StockPushStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { syncShopeeStockForProducts } from "../integrations/shopee/inventory-sync";
import {
  availableToPush,
  countPendingJobs,
  enqueueStockPush,
  enqueueStockPushForChannel,
  enqueueStockPushForOwner,
  getSafetyStockDefault,
  PUSHABLE_CHANNELS,
} from "../integrations/inventory-push";
import { syncChannelProducts } from "../marketplace/product-sync";
import { reconcileChannelStock } from "../workers/stock-reconcile";
import { scanOpsAlerts } from "../services/ops-alerts";

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
            product: {
              select: { quantityInStock: true, holdQuantity: true, safetyStock: true },
            },
          },
        })
      : [];
    // CÙNG công thức "có thể bán" với chiều đẩy — số hiện trên thẻ cảnh báo
    // phải đúng bằng số nút [Cập nhật tồn] sẽ đè lên sàn.
    const safetyDefault = await getSafetyStockDefault(req.ownerId!);
    const availableByKey = new Map(
      mappings.map((m) => [
        `${m.channelId}:${m.channelSku}`,
        m.product ? availableToPush(m.product, safetyDefault) : null,
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
        product: {
          select: { quantityInStock: true, holdQuantity: true, safetyStock: true },
        },
      },
    });
    if (!mapping?.productId || !mapping.product) {
      res.status(400).json({
        error: `SKU ${alert.channelSku} chưa liên kết với sản phẩm kho — vào "Liên kết sản phẩm" nối trước rồi thử lại.`,
      });
      return;
    }

    const available = availableToPush(
      mapping.product,
      await getSafetyStockDefault(req.ownerId!)
    );
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
// CẤU HÌNH ĐỒNG BỘ TỒN KHO ĐA SÀN — THEO TỪNG GIAN (05/09, mô hình Sapo)
//
// Hubsell là trung tâm điều tiết: một SKU kho niêm yết trên nhiều gian, mọi
// gian luôn nhận CÙNG một số "có thể bán". Mỗi gian có cờ BẬT/TẮT riêng
// (Channel.stockSyncEnabled); bật phải qua MÀN SO SÁNH (preview) để chủ shop
// thấy trước số nào sẽ ghi đè số nào — không còn switch toàn shop mù.
//
// CHỈ CHỦ SHOP: bật = Hubsell trở thành nguồn sự thật GHI ĐÈ tồn sàn —
// quyết định cấp shop, không nằm trong cây phân quyền nhân viên.
// ============================================================

function requireShopOwner(req: AuthRequest, res: import("express").Response): boolean {
  if (req.userRole !== Role.ADMIN) {
    res.status(403).json({ error: "Chỉ chủ shop mới được cấu hình đồng bộ tồn kho" });
    return false;
  }
  return true;
}

const INITIAL_STOCK_MODES = ["SUM", "MAX", "NONE"] as const;
type InitialStockMode = (typeof INITIAL_STOCK_MODES)[number];

/** Trạng thái đồng bộ của từng gian Shopee/Lazada đang hoạt động của chủ shop. */
async function listSyncChannels(ownerId: string) {
  const channels = await prisma.channel.findMany({
    where: {
      userId: ownerId,
      channelName: { in: PUSHABLE_CHANNELS },
      status: "ACTIVE",
    },
    select: {
      id: true,
      channelName: true,
      shopName: true,
      refreshToken: true,
      stockSyncEnabled: true,
      stockSyncEnabledAt: true,
      lastStockReconcileAt: true,
      lastStockReconcileMismatch: true,
      _count: {
        select: {
          channelProducts: {
            where: { productId: { not: null }, externalId: { not: null }, status: "ACTIVE" },
          },
        },
      },
    },
    orderBy: [{ channelName: "asc" }, { shopName: "asc" }],
  });
  return channels.map((c) => ({
    id: c.id,
    channelName: c.channelName,
    shopName: c.shopName,
    connected: Boolean(c.refreshToken),
    stockSyncEnabled: c.stockSyncEnabled,
    stockSyncEnabledAt: c.stockSyncEnabledAt,
    linkedCount: c._count.channelProducts,
    lastReconcileAt: c.lastStockReconcileAt,
    lastReconcileMismatch: c.lastStockReconcileMismatch,
  }));
}

/** Gian Shopee/Lazada thuộc chủ shop, đang hoạt động và còn kết nối — dùng chung cho các route theo gian. */
async function findSyncChannel(ownerId: string, channelId: string) {
  return prisma.channel.findFirst({
    where: {
      id: channelId,
      userId: ownerId,
      channelName: { in: PUSHABLE_CHANNELS },
      status: "ACTIVE",
      refreshToken: { not: null },
    },
  });
}

// GET /api/inventory/sync-settings — danh sách gian + cờ từng gian, tồn an
// toàn mặc định, cách gieo tồn ban đầu, số job đang chờ đẩy.
router.get("/sync-settings", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    const [setting, channels, pendingJobs] = await Promise.all([
      prisma.shopSyncSetting.findUnique({
        where: { userId: req.ownerId! },
        select: {
          safetyStockDefault: true,
          initialStockMode: true,
          lowStockDefault: true,
          updatedAt: true,
        },
      }),
      listSyncChannels(req.ownerId!),
      countPendingJobs(req.ownerId!),
    ]);
    const enabledCount = channels.filter((c) => c.stockSyncEnabled).length;
    res.json({
      channels,
      enabledCount,
      /// Tương thích chip header: "đang đồng bộ" = có ít nhất một gian bật.
      autoSyncEnabled: enabledCount > 0,
      safetyStockDefault: setting?.safetyStockDefault ?? 0,
      initialStockMode: (setting?.initialStockMode ?? "SUM") as InitialStockMode,
      lowStockDefault: setting?.lowStockDefault ?? 0,
      updatedAt: setting?.updatedAt ?? null,
      pendingJobs,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/inventory/sync-settings — Body: { safetyStockDefault?, initialStockMode?, lowStockDefault? }
// Đổi tồn an toàn mặc định → "có thể bán" đổi hàng loạt → xếp job đẩy lại cho
// các gian ĐANG BẬT (gian tắt không bị đụng). Đổi ngưỡng cảnh báo mặc định →
// quét lại thẻ sắp hết hàng ngay.
router.put("/sync-settings", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    const { safetyStockDefault, initialStockMode, lowStockDefault } = req.body ?? {};

    let safety: number | undefined;
    if (safetyStockDefault !== undefined) {
      safety = Number(safetyStockDefault);
      if (!Number.isInteger(safety) || safety < 0) {
        res.status(400).json({ error: "Tồn an toàn phải là số nguyên không âm" });
        return;
      }
    }
    let lowStock: number | undefined;
    if (lowStockDefault !== undefined) {
      lowStock = Number(lowStockDefault);
      if (!Number.isInteger(lowStock) || lowStock < 0) {
        res.status(400).json({ error: "Ngưỡng cảnh báo phải là số nguyên không âm (0 = tắt)" });
        return;
      }
    }
    let mode: InitialStockMode | undefined;
    if (initialStockMode !== undefined) {
      if (!INITIAL_STOCK_MODES.includes(initialStockMode)) {
        res.status(400).json({ error: "Cách gieo tồn ban đầu phải là SUM / MAX / NONE" });
        return;
      }
      mode = initialStockMode;
    }

    const before = await prisma.shopSyncSetting.findUnique({
      where: { userId: req.ownerId! },
      select: { safetyStockDefault: true, lowStockDefault: true },
    });
    const updated = await prisma.shopSyncSetting.upsert({
      where: { userId: req.ownerId! },
      update: {
        ...(safety !== undefined ? { safetyStockDefault: safety } : {}),
        ...(mode !== undefined ? { initialStockMode: mode } : {}),
        ...(lowStock !== undefined ? { lowStockDefault: lowStock } : {}),
      },
      create: {
        userId: req.ownerId!,
        safetyStockDefault: safety ?? 0,
        initialStockMode: mode ?? "SUM",
        lowStockDefault: lowStock ?? 0,
      },
    });

    const safetyChanged =
      safety !== undefined && safety !== (before?.safetyStockDefault ?? 0);
    let queued = 0;
    if (safetyChanged) {
      queued = (
        await enqueueStockPushForOwner(req.ownerId!, "đổi tồn an toàn mặc định", {
          force: false,
        })
      ).queued;
    }
    // Ngưỡng mặc định đổi → thẻ sắp hết hàng của mọi SKU dùng mặc định phải
    // mở/đóng lại ngay, không chờ vòng quét 10'.
    if (lowStock !== undefined && lowStock !== (before?.lowStockDefault ?? 0)) {
      await scanOpsAlerts(req.ownerId!, true);
    }

    res.json({
      safetyStockDefault: updated.safetyStockDefault,
      initialStockMode: updated.initialStockMode as InitialStockMode,
      lowStockDefault: updated.lowStockDefault,
      queued,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/sync-channels/:id/preview — MÀN SO SÁNH trước khi bật:
// kéo tồn THẬT từ sàn (làm mới ChannelProduct.channelStock) rồi đặt cạnh số
// "có thể bán" Hubsell sẽ đẩy, từng SKU đã liên kết. Không ghi gì lên sàn.
router.post("/sync-channels/:id/preview", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    const channel = await findSyncChannel(req.ownerId!, req.params.id);
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng (hoặc gian chưa kết nối API)" });
      return;
    }

    // Đọc tồn sàn mới nhất — số cũ trong DB có thể đã lệch vì bán/sửa tay trên sàn.
    let refreshed = true;
    let refreshError: string | null = null;
    try {
      await syncChannelProducts(channel);
    } catch (err) {
      refreshed = false;
      refreshError = err instanceof Error ? err.message : "Không đọc được tồn sàn";
    }

    const [rows, safetyDefault, unlinkedCount, pending] = await Promise.all([
      prisma.channelProduct.findMany({
        where: {
          channelId: channel.id,
          productId: { not: null },
          externalId: { not: null },
          status: "ACTIVE",
        },
        select: {
          channelSku: true,
          productName: true,
          channelStock: true,
          lastSyncedAt: true,
          product: {
            select: {
              skuCode: true,
              productName: true,
              quantityInStock: true,
              holdQuantity: true,
              safetyStock: true,
            },
          },
        },
        orderBy: { channelSku: "asc" },
      }),
      getSafetyStockDefault(req.ownerId!),
      prisma.channelProduct.count({
        where: { channelId: channel.id, productId: null, status: "ACTIVE" },
      }),
      prisma.stockPushJob.findMany({
        where: { channelId: channel.id },
        select: { channelSku: true },
      }),
    ]);
    const pendingSkus = new Set(pending.map((p) => p.channelSku));

    type PreviewState = "match" | "up" | "down" | "unknown";
    const items = rows.map((r) => {
      const hubsell = availableToPush(r.product!, safetyDefault);
      const onChannel = r.channelStock;
      let state: PreviewState = "unknown";
      if (onChannel !== null) {
        state = hubsell === onChannel ? "match" : hubsell > onChannel ? "up" : "down";
      }
      return {
        channelSku: r.channelSku,
        channelProductName: r.productName,
        skuCode: r.product!.skuCode,
        productName: r.product!.productName,
        quantityInStock: r.product!.quantityInStock,
        holdQuantity: r.product!.holdQuantity,
        safetyStock: r.product!.safetyStock ?? safetyDefault,
        hubsell,
        onChannel,
        state,
        pending: pendingSkus.has(r.channelSku),
      };
    });
    // Lệch lên đầu (về 0 trước — nguy hiểm nhất), khớp xếp cuối.
    const rank: Record<PreviewState, number> = { down: 0, up: 1, unknown: 2, match: 3 };
    items.sort((a, b) => {
      if (a.state !== b.state) return rank[a.state] - rank[b.state];
      if (a.state === "down") return a.hubsell - b.hubsell;
      return a.channelSku.localeCompare(b.channelSku);
    });

    const summary = {
      total: items.length,
      match: items.filter((i) => i.state === "match").length,
      up: items.filter((i) => i.state === "up").length,
      down: items.filter((i) => i.state === "down").length,
      unknown: items.filter((i) => i.state === "unknown").length,
      /// SKU sẽ bị đẩy về 0 dù sàn đang còn hàng — dấu hiệu kho Hubsell chưa nhập tồn.
      willZero: items.filter((i) => i.hubsell === 0 && (i.onChannel ?? 0) > 0).length,
      unlinked: unlinkedCount,
    };

    res.json({
      channel: { id: channel.id, channelName: channel.channelName, shopName: channel.shopName },
      refreshed,
      refreshError,
      safetyStockDefault: safetyDefault,
      summary,
      items: items.slice(0, 500),
      truncated: items.length > 500,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/inventory/sync-channels/:id — Body: { enabled: boolean }
// BẬT: ghi cờ + đẩy (force) toàn bộ SKU đã liên kết của gian về khớp Hubsell
// ngay một lượt. TẮT: hạ cờ + rút job tự động còn chờ của gian (job sync tay
// giữ nguyên vì là ý chí người dùng).
router.put("/sync-channels/:id", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled phải là true/false" });
      return;
    }
    const channel = await findSyncChannel(req.ownerId!, req.params.id);
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng (hoặc gian chưa kết nối API)" });
      return;
    }

    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        stockSyncEnabled: enabled,
        ...(enabled && !channel.stockSyncEnabled ? { stockSyncEnabledAt: new Date() } : {}),
      },
    });

    let queued = 0;
    if (enabled) {
      queued = (
        await enqueueStockPushForChannel(channel.id, `bật đồng bộ tồn gian "${channel.shopName}"`)
      ).queued;
    } else {
      await prisma.stockPushJob.deleteMany({
        where: { channelId: channel.id, forced: false, status: StockPushStatus.PENDING },
      });
    }

    await prisma.opsActivity.create({
      data: {
        ownerId: req.ownerId!,
        tag: "channel",
        message: enabled
          ? `🔗 Đã BẬT đồng bộ tồn kho cho gian "${channel.shopName}" — ${queued} SKU đang được đẩy về khớp Hubsell.`
          : `⏸️ Đã TẮT đồng bộ tồn kho cho gian "${channel.shopName}" — tồn trên gian này không còn tự cập nhật theo Hubsell.`,
      },
    });

    res.json({ id: channel.id, stockSyncEnabled: enabled, queued });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/sync-channels/:id/reconcile — "Đối soát ngay" một gian:
// đọc tồn sàn thật, SKU nào lệch với "có thể bán" thì xếp job đẩy lại (chỉ
// gian đang BẬT; gian tắt chỉ báo số lệch, không đẩy).
router.post("/sync-channels/:id/reconcile", async (req: AuthRequest, res, next) => {
  try {
    if (!requireShopOwner(req, res)) return;
    const channel = await findSyncChannel(req.ownerId!, req.params.id);
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian hàng (hoặc gian chưa kết nối API)" });
      return;
    }
    const r = await reconcileChannelStock(channel, "đối soát tay");
    res.json(r);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Không đối soát được";
    res.status(502).json({ error: `Không đọc được tồn từ sàn: ${msg}` });
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
