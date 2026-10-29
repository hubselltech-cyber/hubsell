// ============================================================
// SAO CHÉP SẢN PHẨM — DÒ THỬ CHỈ ĐỌC trên gian THẬT (lát 1b, docs/SAO-CHEP-SAN-PHAM.md mục 10)
//
// Quản trị nền tảng gọi để kiểm các API đọc của adapter thật (danh mục, gợi
// ý, thuộc tính, thương hiệu, vận chuyển, chi tiết 1 sản phẩm) trên một gian
// đã nối prod — KHÔNG tạo/sửa gì trên sàn. Mount riêng ở app.ts, không qua cờ
// LISTING_COPY_ENABLED để dò được trước khi mở tính năng.
// ============================================================

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { channelHasRealApi, getListingAdapter } from "../marketplace/listing/registry";
import type { AuthRequest } from "../middleware/auth";
import { channelItemKey } from "../services/listing-copy/source";

const router = Router();

type Step = { step: string; ok: boolean; ms: number; sample?: unknown; error?: string };

async function run(step: string, fn: () => Promise<unknown>): Promise<Step> {
  const t0 = Date.now();
  try {
    const sample = await fn();
    return { step, ok: true, ms: Date.now() - t0, sample };
  } catch (err) {
    return { step, ok: false, ms: Date.now() - t0, error: String((err as Error)?.message ?? err).slice(0, 500) };
  }
}

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const channelId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      res.status(404).json({ error: "Không thấy gian." });
      return;
    }
    const real = channelHasRealApi(channel);
    const adapter = getListingAdapter(channel);
    const first = await prisma.channelProduct.findFirst({
      where: { channelId: channel.id, status: "ACTIVE", externalId: { not: null } },
      orderBy: { lastSyncedAt: "desc" },
      select: { id: true, externalId: true, productName: true, channelSku: true },
    });
    const steps: Step[] = [];
    const listing = await run("fetchListing (chi tiết 1 sản phẩm)", async () => {
      if (!first) throw new Error("Gian chưa có sản phẩm sàn nào để đọc.");
      const l = await adapter.fetchListing(channel, channelItemKey(first));
      return l
        ? { title: l.title, images: l.images.length, descriptionImages: l.descriptionImages.length, variants: l.variants.length, options: l.options, categoryId: l.categoryId, categoryPath: l.categoryPath, weightGrams: l.weightGrams, brandName: l.brandName, descriptionLen: l.description.length }
        : null;
    });
    steps.push(listing);
    const title = (listing.sample as { title?: string } | null)?.title || first?.productName || "Áo thun cotton nam";
    const rec = await run("recommendCategory (gợi ý danh mục)", () =>
      adapter.recommendCategory(channel, {
        title,
        description: "",
        images: [],
        descriptionImages: [],
        categoryId: null,
        categoryPath: null,
        brandName: null,
        weightGrams: null,
        dimensionsCm: null,
        options: [],
        variants: [],
        attributes: [],
      })
    );
    steps.push(rec);
    const catId = (rec.sample as { id?: string }[] | undefined)?.[0]?.id ?? null;
    steps.push(
      await run("searchCategories (cây danh mục, 5 lá đầu)", async () => (await adapter.searchCategories(channel, "")).slice(0, 5))
    );
    if (catId) {
      steps.push(await run(`getCategoryRequirements (${catId})`, () => adapter.getCategoryRequirements(channel, catId)));
      steps.push(await run(`searchBrands (${catId}, 5 đầu)`, async () => (await adapter.searchBrands(channel, catId, "")).slice(0, 5)));
    }
    steps.push(await run("getLogistics (kênh vận chuyển)", () => adapter.getLogistics(channel)));
    res.json({
      channel: { id: channel.id, shopName: channel.shopName, channelName: channel.channelName, realApi: real, adapter: adapter.name },
      sourceItem: first,
      steps,
      note: "Chỉ đọc — không tạo/sửa gì trên sàn. Bước createListing phải thử bằng 1 sản phẩm thật trên gian test rồi xóa.",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
