// ============================================================
// SAO CHÉP SẢN PHẨM — /api/sao-chep-san-pham (docs/SAO-CHEP-SAN-PHAM.md mục 5)
//
// Đường dẫn tiếng Việt không dấu như /api/quang-cao: tránh các đoạn ad/ads/
// campaign bị bộ lọc chặn quảng cáo cắt (app.ts gotcha 25/09). Mount ở app.ts
// với requireAuth + requirePermission("operations.copy-listing") + requirePlanUnlocked
// + requireChannel. Tên: backend `listing-copy`, FE/quyền `copy-listing`, URL
// `sao-chep-san-pham`, hàng đợi `listing.copy` — cùng một tính năng.
// ============================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express, { Router, type NextFunction, type Response } from "express";
import { prisma } from "../lib/prisma";
import { isStorageConfigured, productImages } from "../lib/supabase-storage";
import { pathToRoot } from "../lib/tree";
import { getListingAdapter } from "../marketplace/listing/registry";
import { normalizeDims } from "../marketplace/listing/rules";
import { syncChannelProducts } from "../marketplace/product-sync";
import { canSeeFinancials, type AuthRequest } from "../middleware/auth";
import { applyTargetToBatch, createBatch, getBatch, listBatches, submitBatch } from "../services/listing-copy/batch";
import { ListingCopyError } from "../services/listing-copy/errors";
import {
  attachUploadsToJob,
  imageQuotaOf,
  LOCAL_UPLOAD_DIR,
  LOCAL_UPLOAD_ENABLED,
  quotaExceeded,
  recordUpload,
} from "../services/listing-copy/images";
import { createJob, updateJobSource, updateTarget, type TargetPatch } from "../services/listing-copy/job-edit";
import { checkManualDraft, findTakenSkus, MANUAL_LIMITS, parseManualListing } from "../services/listing-copy/manual";
import { str } from "../services/listing-copy/parse";
import { listChannelSources, listProductSources } from "../services/listing-copy/source";
import { scheduleAfterProductSync } from "../workers/product-catalog-sync";

const router = Router();

/** Lỗi nghiệp vụ → mã + câu tiếng Việt; còn lại giao error handler chung. */
function sendError(res: Response, err: unknown, next: NextFunction): void {
  if (err instanceof ListingCopyError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

function pageParams(req: AuthRequest): { page: number; pageSize: number } {
  return {
    page: Math.max(1, Number(req.query.page) || 1),
    pageSize: Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)),
  };
}

/** undefined = không gửi; null / "" = xóa; còn lại = số (NaN → null). */
function numOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Gian hàng của chủ shop trong phạm vi nhân viên — ACTIVE, không Offline. */
async function ownChannel(req: AuthRequest, channelId: string) {
  return prisma.channel.findFirst({
    where: {
      id: channelId,
      userId: req.ownerId!,
      status: "ACTIVE",
      channelName: { not: "OFFLINE" },
      ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
    },
  });
}

// ---------------------------------------------------------------- Bước 1: nguồn

/** Gian đích khả dụng + gian nguồn: ACTIVE, không Offline, trong phạm vi nhân viên. */
router.get("/channels", async (req: AuthRequest, res, next) => {
  try {
    const channels = await prisma.channel.findMany({
      where: {
        userId: req.ownerId!,
        status: "ACTIVE",
        channelName: { not: "OFFLINE" },
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
      },
      select: { id: true, shopName: true, channelName: true, refreshToken: true, _count: { select: { channelProducts: true } } },
      orderBy: [{ channelName: "asc" }, { shopName: "asc" }],
    });
    res.json({
      items: channels.map((c) => ({
        id: c.id,
        shopName: c.shopName,
        channelName: c.channelName,
        apiConnected: Boolean(c.refreshToken),
        productCount: c._count.channelProducts,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/sources", async (req: AuthRequest, res, next) => {
  try {
    const { page, pageSize } = pageParams(req);
    const search = str(req.query.search);
    if (str(req.query.type) === "product") {
      res.json(await listProductSources(req.ownerId!, search, page, pageSize));
      return;
    }
    const channelId = str(req.query.channelId);
    if (!channelId) throw new ListingCopyError("Thiếu channelId.");
    if (!(await ownChannel(req, channelId))) throw new ListingCopyError("Gian nguồn không thuộc shop này.", 404);
    res.json(await listChannelSources(channelId, search, page, pageSize));
  } catch (err) {
    sendError(res, err, next);
  }
});

/**
 * Kéo danh mục sản phẩm của gian nguồn về NGAY (30/10/2026, anh hỏi "sản phẩm vừa đăng trên sàn
 * có về ngay không?"): bình thường worker product-catalog-sync chỉ làm mới mỗi đêm 03:00–05:00, nên
 * sản phẩm mới đăng hôm nay chưa có trong bước 1. Cùng việc với nút "Đồng bộ từ sàn" ở Giá vốn /
 * Liên kết SP nhưng nằm dưới quyền operations.copy-listing (nhân viên chỉ có quyền sao chép vẫn bấm
 * được). Gian vừa kéo < 2 phút → trả luôn, không gọi sàn lại (giữ quota API).
 */
router.post("/sources/sync", async (req: AuthRequest, res, next) => {
  try {
    const channelId = str((req.body ?? {}).channelId);
    if (!channelId) throw new ListingCopyError("Thiếu channelId.");
    const channel = await ownChannel(req, channelId);
    if (!channel) throw new ListingCopyError("Gian nguồn không thuộc shop này.", 404);
    const RECENT_MS = 2 * 60 * 1000;
    if (channel.lastProductSyncAt && Date.now() - channel.lastProductSyncAt.getTime() < RECENT_MS) {
      res.json({ skipped: true, lastProductSyncAt: channel.lastProductSyncAt, scanned: 0, created: 0, updated: 0 });
      return;
    }
    try {
      const r = await syncChannelProducts(channel);
      await scheduleAfterProductSync(channel.id, true);
      res.json({ skipped: false, lastProductSyncAt: new Date(), scanned: r.scanned, created: r.created, updated: r.updated });
    } catch (err) {
      await scheduleAfterProductSync(channel.id, false, (err as Error).message);
      res.status(502).json({ error: `Không kéo được danh mục từ sàn: ${(err as Error).message}` });
    }
  } catch (err) {
    sendError(res, err, next);
  }
});

// ---------------------------------------------------------------- Đợt nhiều sản phẩm (lát 2)

router.get("/batches", async (req: AuthRequest, res, next) => {
  try {
    const { page, pageSize } = pageParams(req);
    res.json(await listBatches(req.ownerId!, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.post("/batches", async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sourceType = body.sourceType === "PRODUCT" ? "PRODUCT" : body.sourceType === "CHANNEL" ? "CHANNEL" : null;
    if (!sourceType) throw new ListingCopyError("sourceType phải là CHANNEL hoặc PRODUCT.");
    const sourceKeys = Array.isArray(body.sourceKeys) ? body.sourceKeys.map(String) : [];
    const targetChannelIds = Array.isArray(body.targetChannelIds) ? body.targetChannelIds.map(String) : [];
    const batch = await createBatch({
      ownerId: req.ownerId!,
      userId: req.userId!,
      allowedChannelIds: req.allowedChannelIds ?? null,
      sourceType,
      sourceChannelId: str(body.sourceChannelId) || undefined,
      sources: sourceKeys.map((key) => ({ key })),
      targetChannelIds,
    });
    res.status(201).json(batch);
  } catch (err) {
    sendError(res, err, next);
  }
});

router.get("/batches/:id", async (req: AuthRequest, res, next) => {
  try {
    res.json(await getBatch(req.ownerId!, req.params.id));
  } catch (err) {
    sendError(res, err, next);
  }
});

router.post("/batches/:id/submit", async (req: AuthRequest, res, next) => {
  try {
    res.json(await submitBatch(req.ownerId!, req.params.id, { actorId: req.userId ?? null, allowCost: canSeeFinancials(req) }));
  } catch (err) {
    sendError(res, err, next);
  }
});

/** Áp cấu hình của một gian cho các sản phẩm còn lại cùng gian trong đợt. */
router.post("/batches/:id/targets/:tid/apply", async (req: AuthRequest, res, next) => {
  try {
    const applied = await applyTargetToBatch(req.ownerId!, req.params.id, req.params.tid);
    res.json({ applied, batch: await getBatch(req.ownerId!, req.params.id) });
  } catch (err) {
    sendError(res, err, next);
  }
});

// ---------------------------------------------------------------- Lượt (một sản phẩm) trong đợt

/** Tạo lượt lẻ — FE dùng cho nguồn "Tạo mới" (docs mục 24); CHANNEL/PRODUCT đi qua /batches. */
router.post("/jobs", async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sourceType =
      body.sourceType === "PRODUCT" ? "PRODUCT" : body.sourceType === "CHANNEL" ? "CHANNEL" : body.sourceType === "MANUAL" ? "MANUAL" : null;
    if (!sourceType) throw new ListingCopyError("sourceType phải là CHANNEL, PRODUCT hoặc MANUAL.");
    const targetChannelIds = Array.isArray(body.targetChannelIds) ? body.targetChannelIds.map(String) : [];
    let manual: { listing: ReturnType<typeof parseManualListing>["listing"]; meta: ReturnType<typeof parseManualListing>["manual"] } | undefined;
    if (sourceType === "MANUAL") {
      const parsed = parseManualListing(body.listing);
      // Mã đã có ở Tổng kho / gian đã nối → chặn ngay (khách sửa mã trước khi sang bước 2).
      const taken = await findTakenSkus(req.ownerId!, parsed.listing.variants.filter((v) => !v.excluded).map((v) => v.sku));
      if (taken.length > 0) {
        throw new ListingCopyError(`Mã SKU đã có: ${taken.map((t) => `${t.sku} (${t.where})`).join(", ")} — đặt mã khác.`);
      }
      if (!canSeeFinancials(req)) parsed.manual.costPrice = null;
      manual = { listing: parsed.listing, meta: parsed.manual };
    }
    const job = await createJob({
      ownerId: req.ownerId!,
      userId: req.userId!,
      allowedChannelIds: req.allowedChannelIds ?? null,
      sourceType,
      sourceChannelId: str(body.sourceChannelId) || undefined,
      sourceItemId: str(body.sourceItemId) || undefined,
      sourceGroupKey: str(body.sourceGroupKey) || undefined,
      manual,
      targetChannelIds,
    });
    if (manual) {
      // Gắn ảnh đã tải lên vào job (lát C) — để cron không coi là mồ côi và dọn đúng job nháp.
      const l = manual.listing;
      await attachUploadsToJob(req.ownerId!, job.id, [...l.images, ...l.descriptionImages, ...l.variants.map((v) => v.imageUrl ?? "")]);
    }
    res.status(201).json(job);
  } catch (err) {
    sendError(res, err, next);
  }
});

/** Sửa bài đăng (tên / mô tả / ảnh / giá-tồn-SKU từng phân loại) — áp cho mọi gian đích của lượt. */
router.patch("/jobs/:id", async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const images = Array.isArray(body.images) ? (body.images as unknown[]).map(String) : undefined;
    // Ảnh khách vừa tải lên (lát C) gắn vào lượt để cron không coi là mồ côi.
    if (images) await attachUploadsToJob(req.ownerId!, req.params.id, images);
    res.json(
      await updateJobSource(req.ownerId!, req.params.id, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.description === "string" ? { description: body.description } : {}),
        ...(images ? { images } : {}),
        ...(Array.isArray(body.variants)
          ? {
              variants: (body.variants as Record<string, unknown>[])
                .filter((e) => e && typeof e === "object" && Number.isInteger(Number(e.index)))
                .map((e) => {
                  const price = numOrNull(e.price);
                  const stock = numOrNull(e.stock);
                  return {
                    index: Number(e.index),
                    ...(typeof price === "number" ? { price } : {}),
                    ...(typeof stock === "number" ? { stock } : {}),
                    ...(typeof e.sku === "string" ? { sku: e.sku } : {}),
                    ...(typeof e.excluded === "boolean" ? { excluded: e.excluded } : {}),
                  };
                }),
            }
          : {}),
      })
    );
  } catch (err) {
    sendError(res, err, next);
  }
});

router.patch("/jobs/:id/targets/:tid", async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: TargetPatch = {};
    if (body.categoryId !== undefined) patch.categoryId = body.categoryId === null ? null : str(body.categoryId) || null;
    if (body.attributes && typeof body.attributes === "object" && !Array.isArray(body.attributes)) {
      patch.attributes = Object.fromEntries(
        Object.entries(body.attributes as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)])
      );
    }
    if (body.brandId !== undefined) patch.brandId = body.brandId === null ? null : str(body.brandId) || null;
    if (body.brandName !== undefined) patch.brandName = body.brandName === null ? null : str(body.brandName) || null;
    if (Array.isArray(body.logisticIds)) patch.logisticIds = body.logisticIds.map(String);
    const w = numOrNull(body.weightGrams);
    if (w !== undefined) patch.weightGrams = w === null ? null : Math.max(0, Math.round(w));
    // Cả 3 ô trống / 0 → null (không gửi sàn); điền dở → giữ để computeMissing báo "chưa đủ 3 số".
    if (body.dimensionsCm !== undefined) patch.dimensionsCm = normalizeDims(body.dimensionsCm);
    const p = numOrNull(body.priceAdjustPercent);
    if (p !== undefined) patch.priceAdjustPercent = p ?? 0;
    const s = numOrNull(body.stock);
    if (s !== undefined) patch.stock = s === null ? null : Math.max(0, Math.round(s));
    res.json(await updateTarget(req.ownerId!, req.params.id, req.params.tid, patch));
  } catch (err) {
    sendError(res, err, next);
  }
});

/** Tra cứu của gian đích (danh mục / thương hiệu) — đọc theo adapter của gian. */
async function targetChannel(req: AuthRequest) {
  const job = await prisma.listingCopyJob.findFirst({ where: { id: req.params.id, userId: req.ownerId! }, select: { id: true } });
  if (!job) throw new ListingCopyError("Không tìm thấy lượt sao chép.", 404);
  const t = await prisma.listingCopyTarget.findFirst({ where: { id: req.params.tid, jobId: job.id }, select: { channelId: true } });
  if (!t) throw new ListingCopyError("Không tìm thấy gian đích.", 404);
  const channel = await prisma.channel.findUnique({ where: { id: t.channelId } });
  if (!channel) throw new ListingCopyError("Gian đích không còn.", 404);
  return channel;
}

/**
 * Cây danh mục xổ cha → con của gian đích.
 * - ?parentId=X   → levels[0] = các con của X (trống = cấp gốc).
 * - ?selectedId=Y → path = chuỗi id gốc → Y, levels[i] = anh em ở cấp i (để điền sẵn
 *   các ô đã chọn); nếu Y chưa phải lá thì thêm một cấp con cuối.
 */
router.get("/jobs/:id/targets/:tid/category-tree", async (req: AuthRequest, res, next) => {
  try {
    const channel = await targetChannel(req);
    const all = await getListingAdapter(channel).getCategoryTree(channel);
    const byId = new Map(all.map((n) => [n.id, n]));
    const childrenOf = (parentId: string | null) => all.filter((n) => n.parentId === parentId);
    const selectedId = str(req.query.selectedId);
    const selected = selectedId ? byId.get(selectedId) : undefined;
    if (selected) {
      const path = pathToRoot(byId, selectedId, (n) => n.parentId, (n) => n.id);
      const levels = path.map((_, i) => childrenOf(i === 0 ? null : path[i - 1]));
      if (!selected.leaf) levels.push(childrenOf(selected.id));
      res.json({ path, levels });
      return;
    }
    const parentId = str(req.query.parentId) || null;
    res.json({ path: [], levels: [childrenOf(parentId)] });
  } catch (err) {
    sendError(res, err, next);
  }
});

router.get("/jobs/:id/targets/:tid/brands", async (req: AuthRequest, res, next) => {
  try {
    const channel = await targetChannel(req);
    res.json({
      items: await getListingAdapter(channel).searchBrands(channel, str(req.query.categoryId) || null, str(req.query.q)),
    });
  } catch (err) {
    sendError(res, err, next);
  }
});

// ---------------------------------------------------------------- Nguồn "Tạo mới" (docs mục 24)

/** Thẻ "Đạt chuẩn sàn" sống — thuần, không chạm DB/sàn. */
router.post("/check", (req: AuthRequest, res) => {
  try {
    const { listing } = parseManualListing(req.body?.listing);
    res.json({ byPlatform: checkManualDraft(listing) });
  } catch (err) {
    if (err instanceof ListingCopyError) {
      // Form chưa đủ cấu trúc (chưa có tên, SKU trống…) → trả lý do để thẻ hiện, không phải lỗi HTTP.
      res.json({ byPlatform: null, reason: err.message });
      return;
    }
    throw err;
  }
});

/** Mã SKU đã có ở Tổng kho / gian đã nối — kiểm sống khi khách gõ. */
router.post("/sku-check", async (req: AuthRequest, res, next) => {
  try {
    const skus = Array.isArray(req.body?.skus) ? (req.body.skus as unknown[]).map(String) : [];
    res.json({ taken: await findTakenSkus(req.ownerId!, skus) });
  } catch (err) {
    next(err);
  }
});

/**
 * Tải ảnh sản phẩm (FE đã nén canvas ≤ 400 KB; trần cứng 1 MB) → URL bền.
 * Prod: Supabase Storage bucket công khai product-images. Local chưa cấu hình Storage
 * → ghi `backend/.local-uploads` và phục vụ ở /local-uploads (app.ts), chỉ ngoài production.
 */
router.post(
  "/images",
  express.raw({ type: [...productImages.mime], limit: productImages.sizeLimit }),
  async (req: AuthRequest, res, next) => {
    try {
      const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim();
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new ListingCopyError("Chỉ nhận ảnh JPG/PNG/WebP (gửi thẳng nội dung ảnh).");
      // Trần ảnh theo gói (lát C) — chặn CỨNG tại nút tải lên, như trần gian/nhân viên.
      const quota = await imageQuotaOf(req.ownerId!);
      if (quotaExceeded(quota)) {
        throw new ListingCopyError(`Gói hiện tại cho tối đa ${quota.max} ảnh sản phẩm, đang dùng ${quota.used}. Nâng gói hoặc bỏ bớt ảnh ở lượt tạo mới cũ.`, 403);
      }
      const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
      const now = new Date();
      const rel = `${req.ownerId}/${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
      if (isStorageConfigured()) {
        const url = await productImages.upload(rel, body, contentType);
        await recordUpload({ ownerId: req.ownerId!, storage: "supabase", path: rel, url, bytes: body.length });
        res.json({ url });
        return;
      }
      if (!LOCAL_UPLOAD_ENABLED) throw new ListingCopyError("Kho ảnh chưa được cấu hình — báo support@hubsell.vn.", 503);
      const abs = path.join(LOCAL_UPLOAD_DIR, "product-images", rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, body);
      const url = `${req.protocol}://${req.get("host")}/local-uploads/product-images/${rel}`;
      await recordUpload({ ownerId: req.ownerId!, storage: "local", path: `product-images/${rel}`, url, bytes: body.length });
      res.json({ url });
    } catch (err) {
      sendError(res, err, next);
    }
  }
);

/** Trần form cho FE (một nguồn số) + trần ảnh theo gói của chủ shop. */
router.get("/manual-limits", async (req: AuthRequest, res, next) => {
  try {
    res.json({ ...MANUAL_LIMITS, imageQuota: await imageQuotaOf(req.ownerId!) });
  } catch (err) {
    next(err);
  }
});

export default router;
