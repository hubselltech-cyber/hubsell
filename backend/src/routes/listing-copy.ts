// ============================================================
// SAO CHÉP SẢN PHẨM — /api/sao-chep-san-pham (docs/SAO-CHEP-SAN-PHAM.md mục 5)
//
// Đường dẫn tiếng Việt không dấu như /api/quang-cao: tránh các đoạn ad/ads/
// campaign bị bộ lọc chặn quảng cáo cắt (app.ts gotcha 25/09). Mount ở app.ts
// với requireAuth + requirePermission("operations.copy-listing") + requirePlanUnlocked
// + requireChannel.
// ============================================================

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getListingAdapter } from "../marketplace/listing/registry";
import { normalizeDims } from "../marketplace/listing/rules";
import type { AuthRequest } from "../middleware/auth";
import {
  createJob,
  getJob,
  ListingCopyError,
  submitJob,
  updateJobSource,
  updateTarget,
  type TargetPatch,
} from "../services/listing-copy/service";
import { listChannelSources, listProductSources } from "../services/listing-copy/source";
import { applyTargetToBatch, createBatch, getBatch, listBatches, submitBatch } from "../services/listing-copy/batch";

const router = Router();

function sendError(res: import("express").Response, err: unknown, next: import("express").NextFunction): void {
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

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

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
    const type = str(req.query.type);
    if (type === "product") {
      res.json(await listProductSources(req.ownerId!, search, page, pageSize));
      return;
    }
    const channelId = str(req.query.channelId);
    if (!channelId) {
      res.status(400).json({ error: "Thiếu channelId." });
      return;
    }
    const channel = await prisma.channel.findFirst({
      where: {
        id: channelId,
        userId: req.ownerId!,
        ...(req.allowedChannelIds ? { id: { in: req.allowedChannelIds } } : {}),
      },
      select: { id: true },
    });
    if (!channel) {
      res.status(404).json({ error: "Gian nguồn không thuộc shop này." });
      return;
    }
    res.json(await listChannelSources(channelId, search, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// ---------- Đợt nhiều sản phẩm (lát 2) ----------

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
    if (!sourceType) {
      res.status(400).json({ error: "sourceType phải là CHANNEL hoặc PRODUCT." });
      return;
    }
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
    res.json(await submitBatch(req.ownerId!, req.params.id));
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

router.post("/jobs", async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sourceType = body.sourceType === "PRODUCT" ? "PRODUCT" : body.sourceType === "CHANNEL" ? "CHANNEL" : null;
    if (!sourceType) {
      res.status(400).json({ error: "sourceType phải là CHANNEL hoặc PRODUCT." });
      return;
    }
    const targetChannelIds = Array.isArray(body.targetChannelIds) ? body.targetChannelIds.map(String) : [];
    const job = await createJob({
      ownerId: req.ownerId!,
      userId: req.userId!,
      allowedChannelIds: req.allowedChannelIds ?? null,
      sourceType,
      sourceChannelId: str(body.sourceChannelId) || undefined,
      sourceItemId: str(body.sourceItemId) || undefined,
      sourceGroupKey: str(body.sourceGroupKey) || undefined,
      targetChannelIds,
    });
    res.status(201).json(job);
  } catch (err) {
    if (err instanceof ListingCopyError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get("/jobs/:id", async (req: AuthRequest, res, next) => {
  try {
    res.json(await getJob(req.ownerId!, req.params.id));
  } catch (err) {
    if (err instanceof ListingCopyError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.patch("/jobs/:id", async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(
      await updateJobSource(req.ownerId!, req.params.id, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.description === "string" ? { description: body.description } : {}),
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
                  };
                }),
            }
          : {}),
      })
    );
  } catch (err) {
    if (err instanceof ListingCopyError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

function numOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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
    if (err instanceof ListingCopyError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
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
    if (selectedId && byId.has(selectedId)) {
      const path: string[] = [];
      let cur = byId.get(selectedId);
      let guard = 0;
      while (cur && guard++ < 10) {
        path.unshift(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      const levels = path.map((_, i) => childrenOf(i === 0 ? null : path[i - 1]));
      const last = byId.get(selectedId)!;
      if (!last.leaf) levels.push(childrenOf(last.id));
      res.json({ path, levels });
      return;
    }
    const parentId = str(req.query.parentId) || null;
    res.json({ path: [], levels: [childrenOf(parentId)] });
  } catch (err) {
    if (err instanceof ListingCopyError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get("/jobs/:id/targets/:tid/brands", async (req: AuthRequest, res, next) => {
  try {
    const channel = await targetChannel(req);
    res.json({
      items: await getListingAdapter(channel).searchBrands(channel, str(req.query.categoryId) || null, str(req.query.q)),
    });
  } catch (err) {
    if (err instanceof ListingCopyError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.post("/jobs/:id/submit", async (req: AuthRequest, res, next) => {
  try {
    const result = await submitJob(req.ownerId!, req.params.id);
    res.json({ ...result, job: await getJob(req.ownerId!, req.params.id) });
  } catch (err) {
    if (err instanceof ListingCopyError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
