import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { Prisma, InventoryLogType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { canSeeFinancials, type AuthRequest } from "../middleware/auth";
import {
  availableToPush,
  enqueueStockPush,
  getSafetyStockDefault,
  PUSHABLE_CHANNELS,
} from "../integrations/inventory-push";
import { effectiveLowStockThreshold, isLowStock } from "../services/low-stock";

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

/**
 * Bỏ trường giá vốn khỏi dữ liệu trả về cho người không được xem tài chính.
 * Giấu cột trên giao diện là chưa đủ — mở tab Network vẫn đọc được nguyên số.
 */
function hideCost<T extends { costPrice: unknown }>(
  product: T,
  seesFinancials: boolean
): T | Omit<T, "costPrice"> {
  if (seesFinancials) return product;
  const { costPrice: _costPrice, ...rest } = product;
  return rest;
}

// Kiểm tra một giá trị có phải số tiền hợp lệ (>= 0) không
function parseMoney(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || Number.isNaN(n) || n < 0) return null;
  return n;
}

// Thuế suất GTGT hợp lệ (module Thuế & Hóa đơn — giữ chỗ). Trả null nếu không hợp lệ.
const VAT_RATES = [0, 5, 8, 10];
function parseVatRate(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return VAT_RATES.includes(n) ? n : null;
}

/**
 * Kiểm tra bảng size cho Trợ lý vận hành: mảng {size, heightCm:[min,max],
 * weightKg:[min,max]}. Trả về mảng đã làm sạch, hoặc null nếu sai cấu trúc —
 * dữ liệu này được AI đọc thẳng nên thà chặn từ đầu còn hơn tư vấn bậy.
 */
function parseSizeChart(value: unknown): Prisma.InputJsonValue | null {
  if (!Array.isArray(value)) return null;
  const cleaned: { size: string; heightCm: [number, number]; weightKg: [number, number] }[] = [];
  for (const row of value) {
    const r = row as { size?: unknown; heightCm?: unknown; weightKg?: unknown };
    const okRange = (x: unknown): x is [number, number] =>
      Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === "number" && n > 0);
    if (
      typeof r?.size !== "string" ||
      r.size.trim() === "" ||
      !okRange(r.heightCm) ||
      !okRange(r.weightKg)
    ) {
      return null;
    }
    cleaned.push({ size: r.size.trim(), heightCm: r.heightCm, weightKg: r.weightKg });
  }
  return cleaned;
}

// Lấy giá trị của một cột trong hàng Excel, thử nhiều tên cột có thể (không phân biệt hoa/thường)
function pickColumn(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    normalized[key.trim().toLowerCase()] = row[key];
  }
  for (const a of aliases) {
    const v = normalized[a.trim().toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

// Tên cột chấp nhận cho từng trường (khớp với file mẫu tải về)
const COLS = {
  sku: ["Mã SKU", "SKU", "Ma SKU", "skuCode", "Mã sản phẩm"],
  name: ["Tên sản phẩm", "Tên SP", "productName", "Ten san pham"],
  cost: ["Giá vốn", "costPrice", "Gia von"],
  selling: ["Giá bán", "sellingPrice", "Gia ban"],
  quantity: ["Tồn kho", "Số lượng", "quantityInStock", "Ton kho", "So luong"],
};

// GET /api/products?page=1&pageSize=10&search=...
// Danh sách sản phẩm của user đang đăng nhập, có phân trang + tìm theo SKU/Tên.
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    const where: Prisma.ProductWhereInput = {
      userId: req.ownerId!,
      ...(search
        ? {
            OR: [
              { skuCode: { contains: search, mode: "insensitive" } },
              { productName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Tóm tắt liên kết sàn cho cột "Bán trên" của hub Hàng hóa — mỗi dòng
        // vài chip nhỏ, chi tiết đầy đủ lấy lazy qua /:id/channel-links.
        include: {
          channelProducts: {
            select: {
              channelId: true,
              channelSku: true,
              externalId: true,
              channelStock: true,
              channel: {
                select: { channelName: true, shopName: true, stockSyncEnabled: true },
              },
            },
          },
        },
      }),
    ]);

    // Cờ "đang lệch tồn với sàn" theo SKU sàn của trang hiện tại — HAI query
    // cho cả trang: cảnh báo mở (đẩy fail) + job đang chờ (lệch tạm, sắp khớp).
    const pageSkus = items.flatMap((p) => p.channelProducts.map((c) => c.channelSku));
    const [openAlerts, pendingJobs, safetyDefault, lowStockDefault] = await Promise.all([
      pageSkus.length
        ? prisma.inventorySyncAlert.findMany({
            where: {
              resolvedAt: null,
              channelSku: { in: pageSkus },
              channel: { userId: req.ownerId! },
            },
            select: { channelSku: true },
          })
        : [],
      pageSkus.length
        ? prisma.stockPushJob.findMany({
            where: { channelSku: { in: pageSkus }, channel: { userId: req.ownerId! } },
            select: { channelId: true, channelSku: true },
          })
        : [],
      getSafetyStockDefault(req.ownerId!),
      prisma.shopSyncSetting
        .findUnique({ where: { userId: req.ownerId! }, select: { lowStockDefault: true } })
        .then((s) => s?.lowStockDefault ?? 0),
    ]);
    const alertSkus = new Set(openAlerts.map((a) => a.channelSku));
    const pendingKeys = new Set(pendingJobs.map((j) => `${j.channelId}:${j.channelSku}`));

    const seesFinancials = canSeeFinancials(req);
    res.json({
      items: items.map((p) => {
        const { channelProducts, ...core } = p;
        // "CÓ THỂ BÁN" = số Hubsell đẩy lên mọi gian — cột chính của hub.
        const availableToSell = availableToPush(p, safetyDefault);
        // Lệch với số sàn đang giữ (theo lần đẩy/đọc gần nhất) ở gian ĐANG BẬT
        // đồng bộ, và không có job chờ đẩy → lệch thật, cần nhìn tới.
        const stockMismatch = channelProducts.some(
          (c) =>
            c.channel.stockSyncEnabled &&
            c.externalId &&
            PUSHABLE_CHANNELS.includes(c.channel.channelName) &&
            c.channelStock !== null &&
            c.channelStock !== availableToSell &&
            !pendingKeys.has(`${c.channelId}:${c.channelSku}`)
        );
        return {
          ...hideCost(core, seesFinancials),
          availableToSell,
          safetyStockEffective: p.safetyStock ?? safetyDefault,
          // Cảnh báo sắp hết hàng: ngưỡng đang áp (riêng ?? shop) + cờ đang dưới ngưỡng.
          lowStockThresholdEffective: effectiveLowStockThreshold(p, lowStockDefault),
          isLowStock: isLowStock(p, lowStockDefault),
          channelLinks: channelProducts.map((c) => ({
            channelSku: c.channelSku,
            channelName: c.channel.channelName,
            shopName: c.channel.shopName,
            stockSyncEnabled: c.channel.stockSyncEnabled,
          })),
          hasSyncAlert: channelProducts.some((c) => alertSkus.has(c.channelSku)),
          stockMismatch,
        };
      }),
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      costPriceHidden: !seesFinancials,
      safetyStockDefault: safetyDefault,
      lowStockDefault,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/products/:id/channel-links — chi tiết các SKU sàn đã nối vào một
// sản phẩm kho (dòng bung của hub Hàng hóa): gian nào, SKU sàn nào, lượt đẩy
// tồn gần nhất ra sao, có đang lệch tồn không. Lấy LAZY khi người dùng bung
// dòng — không tải theo trang danh sách.
router.get("/:id/channel-links", async (req: AuthRequest, res, next) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
      select: { id: true, quantityInStock: true, holdQuantity: true, safetyStock: true },
    });
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm" });
      return;
    }
    const expected = availableToPush(product, await getSafetyStockDefault(req.ownerId!));

    const links = await prisma.channelProduct.findMany({
      where: { productId: product.id },
      select: {
        id: true,
        channelId: true,
        channelSku: true,
        productName: true,
        externalId: true,
        channelStock: true,
        lastSyncedAt: true,
        channel: {
          select: { channelName: true, shopName: true, status: true, stockSyncEnabled: true },
        },
      },
      orderBy: [{ channel: { channelName: "asc" } }, { channelSku: "asc" }],
    });

    // Lượt đẩy tồn gần nhất + cờ lệch + job chờ của TỪNG SKU sàn — ba query cho cả cụm.
    const skus = links.map((l) => l.channelSku);
    const pendingJobs = skus.length
      ? await prisma.stockPushJob.findMany({
          where: { channelSku: { in: skus }, channel: { userId: req.ownerId! } },
          select: { channelId: true, channelSku: true },
        })
      : [];
    const pendingKeys = new Set(pendingJobs.map((j) => `${j.channelId}:${j.channelSku}`));
    const [logs, alerts] = skus.length
      ? await Promise.all([
          prisma.inventorySyncLog.findMany({
            where: {
              channelSku: { in: skus },
              channel: { userId: req.ownerId! },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              channelId: true,
              channelSku: true,
              status: true,
              newQuantity: true,
              createdAt: true,
            },
          }),
          prisma.inventorySyncAlert.findMany({
            where: {
              resolvedAt: null,
              channelSku: { in: skus },
              channel: { userId: req.ownerId! },
            },
            select: { channelId: true, channelSku: true },
          }),
        ])
      : [[], []];

    const latestByKey = new Map<string, (typeof logs)[number]>();
    for (const l of logs) {
      const key = `${l.channelId}:${l.channelSku}`;
      if (!latestByKey.has(key)) latestByKey.set(key, l); // đã sort desc — bản đầu là mới nhất
    }
    const alertKeys = new Set(alerts.map((a) => `${a.channelId}:${a.channelSku}`));

    res.json(
      links.map((l) => {
        const key = `${l.channelId}:${l.channelSku}`;
        const last = latestByKey.get(key);
        const pushable = Boolean(l.externalId) && l.channel.channelName !== "TIKTOK";
        const hasAlert = alertKeys.has(key);
        // Trạng thái khớp của gian với "có thể bán" Hubsell — một chữ cho UI:
        //   off      = gian chưa bật đồng bộ (số sàn là của sàn, không so)
        //   pending  = đang có job chờ đẩy (sắp khớp)
        //   alert    = đẩy thất bại, cảnh báo đang mở
        //   match / mismatch / unknown (sàn chưa từng trả số)
        const state = !pushable
          ? "unknown"
          : hasAlert
            ? "alert"
            : pendingKeys.has(key)
              ? "pending"
              : !l.channel.stockSyncEnabled
                ? "off"
                : l.channelStock === null
                  ? "unknown"
                  : l.channelStock === expected
                    ? "match"
                    : "mismatch";
        return {
          id: l.id,
          channelSku: l.channelSku,
          productName: l.productName,
          channelName: l.channel.channelName,
          shopName: l.channel.shopName,
          channelActive: l.channel.status === "ACTIVE",
          /// Sàn này có đẩy tồn được không (TikTok chưa có externalId thì không).
          pushable,
          stockSyncEnabled: l.channel.stockSyncEnabled,
          /// Tồn sàn theo lần đẩy/đọc gần nhất + mốc đọc (null = chưa từng biết).
          channelStock: l.channelStock,
          channelStockAt: l.lastSyncedAt,
          /// Số Hubsell muốn sàn giữ ("có thể bán").
          expected,
          state,
          lastSync: last
            ? {
                status: last.status,
                newQuantity: last.newQuantity,
                at: last.createdAt,
              }
            : null,
          hasAlert,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/products — Thêm sản phẩm mới kèm số lượng kho ban đầu.
// Tạo sản phẩm + ghi log nhập kho trong CÙNG một transaction.
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const {
      skuCode,
      productName,
      costPrice,
      sellingPrice,
      initialQuantity,
      taxName,
      vatRate,
    } = req.body ?? {};

    if (typeof skuCode !== "string" || skuCode.trim().length === 0) {
      res.status(400).json({ error: "Vui lòng nhập mã SKU" });
      return;
    }
    if (typeof productName !== "string" || productName.trim().length === 0) {
      res.status(400).json({ error: "Vui lòng nhập tên sản phẩm" });
      return;
    }
    // Nhân viên vẫn được thêm sản phẩm mới (kho nhập hàng là việc của họ) nhưng
    // giá vốn thì để 0 cho chủ shop vào cấu hình sau, không nhận từ nhân viên.
    const seesFinancials = canSeeFinancials(req);
    const cost = seesFinancials ? parseMoney(costPrice) : 0;
    const selling = parseMoney(sellingPrice);
    if (cost === null || selling === null) {
      res.status(400).json({ error: "Giá vốn / giá bán phải là số không âm" });
      return;
    }
    const initQty = Number(initialQuantity ?? 0);
    if (!Number.isInteger(initQty) || initQty < 0) {
      res.status(400).json({ error: "Số lượng kho ban đầu phải là số nguyên không âm" });
      return;
    }

    // Thuế & Hóa đơn (giữ chỗ) — tuỳ chọn. vatRate sai chuẩn thì về 0 thay vì chặn
    // cả việc tạo sản phẩm, vì đây là trường phụ của module đang dựng khung.
    const invoiceTaxName =
      typeof taxName === "string" && taxName.trim() ? taxName.trim() : null;
    const invoiceVatRate = parseVatRate(vatRate) ?? 0;

    const sku = skuCode.trim().toUpperCase();

    // SKU không được trùng trong phạm vi user
    const existed = await prisma.product.findUnique({
      where: { userId_skuCode: { userId: req.ownerId!, skuCode: sku } },
    });
    if (existed) {
      res.status(409).json({ error: `Mã SKU "${sku}" đã tồn tại` });
      return;
    }

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          userId: req.ownerId!,
          skuCode: sku,
          productName: productName.trim(),
          costPrice: cost,
          sellingPrice: selling,
          quantityInStock: initQty,
          taxName: invoiceTaxName,
          vatRate: invoiceVatRate,
        },
      });

      if (initQty > 0) {
        await tx.inventoryLog.create({
          data: {
            productId: created.id,
            changeQuantity: initQty,
            type: InventoryLogType.IMPORT,
            reason: "Nhập kho ban đầu khi tạo sản phẩm",
          },
        });
      }

      return created;
    });

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/products/:id — Cập nhật thông tin sản phẩm (không chỉnh tồn kho ở đây)
router.patch("/:id", async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findFirst({
      where: { id, userId: req.ownerId! },
    });
    if (!product) {
      res.status(404).json({ error: "Không tìm thấy sản phẩm" });
      return;
    }

    const {
      skuCode,
      productName,
      costPrice,
      sellingPrice,
      taxName,
      vatRate,
      material,
      careInstructions,
      sizeChart,
    } = req.body ?? {};
    const data: Prisma.ProductUpdateInput = {};

    if (skuCode !== undefined) {
      if (typeof skuCode !== "string" || skuCode.trim().length === 0) {
        res.status(400).json({ error: "Mã SKU không hợp lệ" });
        return;
      }
      const sku = skuCode.trim().toUpperCase();
      if (sku !== product.skuCode) {
        const dup = await prisma.product.findUnique({
          where: { userId_skuCode: { userId: req.ownerId!, skuCode: sku } },
        });
        if (dup) {
          res.status(409).json({ error: `Mã SKU "${sku}" đã tồn tại` });
          return;
        }
      }
      data.skuCode = sku;
    }
    if (productName !== undefined) {
      if (typeof productName !== "string" || productName.trim().length === 0) {
        res.status(400).json({ error: "Tên sản phẩm không hợp lệ" });
        return;
      }
      data.productName = productName.trim();
    }
    if (costPrice !== undefined) {
      if (!canSeeFinancials(req)) {
        res.status(403).json({
          error: "Chỉ chủ shop mới được sửa giá vốn",
        });
        return;
      }
      const cost = parseMoney(costPrice);
      if (cost === null) {
        res.status(400).json({ error: "Giá vốn phải là số không âm" });
        return;
      }
      data.costPrice = cost;
    }
    if (sellingPrice !== undefined) {
      const selling = parseMoney(sellingPrice);
      if (selling === null) {
        res.status(400).json({ error: "Giá bán phải là số không âm" });
        return;
      }
      data.sellingPrice = selling;
    }
    // Thuế & Hóa đơn (giữ chỗ) — cho phép cập nhật độc lập.
    if (taxName !== undefined) {
      data.taxName =
        typeof taxName === "string" && taxName.trim() ? taxName.trim() : null;
    }
    if (vatRate !== undefined) {
      const rate = parseVatRate(vatRate);
      if (rate === null) {
        res.status(400).json({ error: "Thuế suất phải là 0, 5, 8 hoặc 10 (%)" });
        return;
      }
      data.vatRate = rate;
    }

    // ── Thông số cho Trợ lý vận hành (AI CSKH) — chuỗi rỗng/null là XOÁ ──
    if (material !== undefined) {
      data.material =
        typeof material === "string" && material.trim() ? material.trim() : null;
    }
    if (careInstructions !== undefined) {
      data.careInstructions =
        typeof careInstructions === "string" && careInstructions.trim()
          ? careInstructions.trim()
          : null;
    }
    if (sizeChart !== undefined) {
      if (sizeChart === null || (Array.isArray(sizeChart) && sizeChart.length === 0)) {
        data.sizeChart = Prisma.DbNull;
      } else {
        const chart = parseSizeChart(sizeChart);
        if (chart === null) {
          res.status(400).json({
            error:
              'Bảng size sai cấu trúc — cần mảng {"size","heightCm":[min,max],"weightKg":[min,max]}',
          });
          return;
        }
        data.sizeChart = chart;
      }
    }

    // ── Tồn an toàn per-SKU (Đồng bộ tồn kho đa sàn) — null/rỗng = dùng mặc
    // định toàn shop (ShopSyncSetting.safetyStockDefault) ──
    const { safetyStock, lowStockThreshold } = req.body ?? {};
    if (safetyStock !== undefined) {
      if (safetyStock === null || safetyStock === "") {
        data.safetyStock = null;
      } else {
        const n = Number(safetyStock);
        if (!Number.isInteger(n) || n < 0) {
          res.status(400).json({ error: "Tồn an toàn phải là số nguyên không âm" });
          return;
        }
        data.safetyStock = n;
      }
    }
    // ── Ngưỡng cảnh báo sắp hết hàng per-SKU — null/rỗng = mặc định shop, 0 = tắt ──
    if (lowStockThreshold !== undefined) {
      if (lowStockThreshold === null || lowStockThreshold === "") {
        data.lowStockThreshold = null;
      } else {
        const n = Number(lowStockThreshold);
        if (!Number.isInteger(n) || n < 0) {
          res.status(400).json({ error: "Ngưỡng cảnh báo phải là số nguyên không âm" });
          return;
        }
        data.lowStockThreshold = n;
      }
    }

    const updated = await prisma.product.update({ where: { id }, data });

    // Đổi tồn an toàn làm đổi TỒN KHẢ DỤNG → đẩy số mới lên các sàn đã liên kết.
    // Đổi ngưỡng cảnh báo → cùng cửa đó kiểm tra lại ngưỡng ngay (mở/đóng thẻ).
    if (safetyStock !== undefined || lowStockThreshold !== undefined) {
      await enqueueStockPush([id], {
        source:
          safetyStock !== undefined ? "đổi tồn an toàn của SKU" : "đổi ngưỡng cảnh báo của SKU",
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/products/import — Nhập sản phẩm hàng loạt từ file Excel.
// Cột chuẩn: [Mã SKU, Tên sản phẩm, Giá vốn, Giá bán, Tồn kho].
// - Thiếu SKU hoặc Tên → bỏ qua dòng đó, báo lỗi rõ ràng.
// - SKU đã tồn tại → CẬP NHẬT giá & tồn kho (upsert), ghi log chênh lệch kho.
// - SKU mới → tạo mới + ghi log nhập kho ban đầu.
// Tất cả chạy trong MỘT transaction (thành công/thất bại trọn gói).
router.post("/import", upload.single("file"), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Chưa chọn file Excel để tải lên" });
      return;
    }

    // Đọc workbook từ buffer, lấy sheet đầu tiên
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      res.status(400).json({ error: "File Excel không có sheet nào" });
      return;
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[firstSheetName],
      { defval: "" }
    );

    if (rows.length === 0) {
      res.status(400).json({ error: "File Excel không có dòng dữ liệu nào" });
      return;
    }

    // Bước 1: validate toàn bộ, gom dòng hợp lệ + danh sách lỗi
    type ValidRow = {
      skuCode: string;
      productName: string;
      costPrice: number;
      sellingPrice: number;
      quantityInStock: number;
    };
    const valid: ValidRow[] = [];
    const errors: { row: number; message: string }[] = [];
    const seenSku = new Set<string>();

    rows.forEach((row, idx) => {
      const excelRow = idx + 2; // +1 do header, +1 do đếm từ 1

      const rawSku = pickColumn(row, COLS.sku);
      const rawName = pickColumn(row, COLS.name);

      if (rawSku === undefined) {
        errors.push({ row: excelRow, message: "Thiếu Mã SKU — đã bỏ qua" });
        return;
      }
      if (rawName === undefined) {
        errors.push({ row: excelRow, message: "Thiếu Tên sản phẩm — đã bỏ qua" });
        return;
      }

      const skuCode = String(rawSku).trim().toUpperCase();
      const productName = String(rawName).trim();

      if (seenSku.has(skuCode)) {
        errors.push({
          row: excelRow,
          message: `Mã SKU "${skuCode}" bị lặp lại trong file — đã bỏ qua dòng sau`,
        });
        return;
      }

      // Nhân viên nhập file có cột Giá vốn thì cột đó bị bỏ qua, không phải
      // báo lỗi cả dòng — hàng vẫn vào kho, chủ shop vào đặt giá vốn sau.
      const cost = canSeeFinancials(req)
        ? parseMoney(pickColumn(row, COLS.cost) ?? 0)
        : 0;
      const selling = parseMoney(pickColumn(row, COLS.selling) ?? 0);
      if (cost === null || selling === null) {
        errors.push({
          row: excelRow,
          message: `SKU "${skuCode}": Giá vốn/Giá bán không hợp lệ — đã bỏ qua`,
        });
        return;
      }

      const qtyRaw = pickColumn(row, COLS.quantity) ?? 0;
      const qty = Number(qtyRaw);
      if (!Number.isInteger(qty) || qty < 0) {
        errors.push({
          row: excelRow,
          message: `SKU "${skuCode}": Tồn kho phải là số nguyên ≥ 0 — đã bỏ qua`,
        });
        return;
      }

      seenSku.add(skuCode);
      valid.push({
        skuCode,
        productName,
        costPrice: cost,
        sellingPrice: selling,
        quantityInStock: qty,
      });
    });

    if (valid.length === 0) {
      res.status(400).json({
        error: "Không có dòng hợp lệ nào trong file",
        created: 0,
        updated: 0,
        errors,
      });
      return;
    }

    // Bước 2: upsert hàng loạt trong MỘT transaction
    const ownerId = req.ownerId!;
    // Các sản phẩm CÓ đổi số tồn trong lần import — sau commit đẩy tồn mới lên sàn.
    const stockChangedIds: string[] = [];
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;

      // Lấy trước các sản phẩm đã tồn tại theo SKU để biết create hay update
      const existing = await tx.product.findMany({
        where: { userId: ownerId, skuCode: { in: valid.map((v) => v.skuCode) } },
      });
      const existingBySku = new Map(existing.map((p) => [p.skuCode, p]));

      for (const v of valid) {
        const found = existingBySku.get(v.skuCode);
        if (found) {
          // Cập nhật giá + tồn kho; ghi log phần chênh lệch tồn (nếu có)
          const delta = v.quantityInStock - found.quantityInStock;
          await tx.product.update({
            where: { id: found.id },
            data: {
              productName: v.productName,
              costPrice: v.costPrice,
              sellingPrice: v.sellingPrice,
              quantityInStock: v.quantityInStock,
            },
          });
          if (delta !== 0) {
            await tx.inventoryLog.create({
              data: {
                productId: found.id,
                changeQuantity: delta,
                type: InventoryLogType.SYNC,
                reason: "Điều chỉnh tồn kho khi nhập Excel",
              },
            });
            stockChangedIds.push(found.id);
          }
          updated++;
        } else {
          const createdProduct = await tx.product.create({
            data: {
              userId: ownerId,
              skuCode: v.skuCode,
              productName: v.productName,
              costPrice: v.costPrice,
              sellingPrice: v.sellingPrice,
              quantityInStock: v.quantityInStock,
            },
          });
          if (v.quantityInStock > 0) {
            await tx.inventoryLog.create({
              data: {
                productId: createdProduct.id,
                changeQuantity: v.quantityInStock,
                type: InventoryLogType.IMPORT,
                reason: "Nhập kho ban đầu từ file Excel",
              },
            });
          }
          created++;
        }
      }

      return { created, updated };
    });

    // Tồn vừa đổi qua Excel → đẩy tồn khả dụng mới lên các sàn đã liên kết.
    await enqueueStockPush(stockChangedIds, { source: "nhập tồn kho từ Excel" });

    res.json({
      created: result.created,
      updated: result.updated,
      totalImported: result.created + result.updated,
      skipped: errors.length,
      errors,
    });
  } catch (err) {
    // Lỗi từ multer (sai định dạng, quá dung lượng)
    const e = err as Error & { code?: string };
    if (e.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "File quá lớn (tối đa 5MB)" });
      return;
    }
    if (e.message?.includes("Excel")) {
      res.status(400).json({ error: e.message });
      return;
    }
    next(err);
  }
});

export default router;
