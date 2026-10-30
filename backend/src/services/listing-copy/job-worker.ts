// ============================================================
// SAO CHÉP SẢN PHẨM — WORKER: đăng MỘT gian đích (việc listing.copy {targetId}).
//
//   processTarget  : gọi adapter tạo sản phẩm, ghi kết quả (LISTED / PENDING_REVIEW /
//                    FAILED + câu tiếng Việt), rồi gom trạng thái job.
//   linkNewListing : sản phẩm mới trên gian đích → ghi ChannelProduct NỐI SẴN SKU kho
//                    (nguồn gian: theo productId dòng nguồn; nguồn kho: theo skuCode;
//                    nguồn "Tạo mới": KHÔNG nối — docs mục 24.3-1).
//   rollupStatus   : luật gom trạng thái (thuần, có test) — dùng cho job lẫn đợt.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { humanizeListingError } from "../../marketplace/listing/error-text";
import { getListingAdapter } from "../../marketplace/listing/registry";
import { activeVariants, adjustPrice, effectiveOptions } from "../../marketplace/listing/rules";
import type { ListingDraft, NormalizedListing } from "../../marketplace/listing/types";
import { asListing, targetState } from "./json-fields";
import { productIdsBySku, sourceSkuToProductId } from "./source";

/** Payload việc listing.copy. */
export interface ListingCopyJobData {
  targetId: string;
}

export type RollupStatus = "DRAFT" | "SUBMITTED" | "DONE" | "PARTIAL" | "FAILED";

/**
 * Gom trạng thái các gian đích thành trạng thái job / đợt: còn gian đang xếp hàng hoặc đang
 * đăng → SUBMITTED; chưa gian nào đăng → DRAFT; mọi gian lên (hoặc chờ duyệt) → DONE; không
 * gian nào lên và không còn gian chờ → FAILED; còn lại → PARTIAL.
 */
export function rollupStatus(statuses: string[]): RollupStatus {
  if (statuses.some((s) => s === "QUEUED" || s === "RUNNING")) return "SUBMITTED";
  const ok = statuses.filter((s) => s === "LISTED" || s === "PENDING_REVIEW").length;
  const failed = statuses.filter((s) => s === "FAILED").length;
  const pending = statuses.filter((s) => s === "PENDING").length;
  if (ok === 0 && failed === 0) return "DRAFT";
  if (failed === 0 && pending === 0) return "DONE";
  if (ok === 0 && pending === 0) return "FAILED";
  return "PARTIAL";
}

/**
 * Worker: đăng MỘT gian đích. Ném lỗi = pg-boss thử lại; trạng thái ghi ở bảng.
 * Nhận cả RUNNING: việc bị thử lại sau khi tiến trình chết giữa chừng vẫn được đăng
 * (có thể tạo trùng trên sàn nếu chết SAU khi sàn đã tạo — chấp nhận, hiếm; không nhận
 * thì target kẹt RUNNING vĩnh viễn).
 */
export async function processTarget(targetId: string): Promise<void> {
  const t = await prisma.listingCopyTarget.findUnique({ where: { id: targetId }, include: { job: true } });
  if (!t) return;
  if (t.status !== "QUEUED" && t.status !== "FAILED" && t.status !== "RUNNING") return;
  const channel = await prisma.channel.findUnique({ where: { id: t.channelId } });
  if (!channel) {
    await prisma.listingCopyTarget.update({
      where: { id: t.id },
      data: { status: "FAILED", error: "Gian đích không còn." },
    });
    await rollupJob(t.jobId);
    return;
  }
  await prisma.listingCopyTarget.update({
    where: { id: t.id },
    data: { status: "RUNNING", attempts: { increment: 1 } },
  });
  const stored = asListing(t.job.source);
  // Chỉ phân loại khách GIỮ mới lên sàn; nhóm phân loại rút theo (giá trị không còn ai dùng thì bỏ).
  const active = activeVariants(stored);
  const listing: NormalizedListing = { ...stored, options: effectiveOptions(stored), variants: active };
  const state = targetState(t);
  const draft: ListingDraft = {
    listing,
    categoryId: t.categoryId ?? "",
    attributes: state.attributes,
    brandId: t.brandId,
    brandName: t.brandName,
    logisticIds: state.logisticIds,
    weightGrams: t.weightGrams,
    dimensionsCm: state.dimensionsCm,
    variants: active.map((v) => ({
      ...v,
      price: adjustPrice(v.price, t.priceAdjustPercent),
      stock: t.stock ?? v.stock,
    })),
  };
  try {
    const result = await getListingAdapter(channel).createListing(channel, draft);
    await linkNewListing(t.job, channel, draft, result);
    await prisma.listingCopyTarget.update({
      where: { id: t.id },
      data: {
        status: result.status,
        error: null,
        remoteItemId: result.remoteItemId,
        remoteUrl: result.remoteUrl,
        listedAt: new Date(),
      },
    });
  } catch (err) {
    const raw = String((err as Error)?.message ?? err).slice(0, 700);
    // Dòng 1 tiếng Việt cho người bán, dòng 2 nguyên văn sàn (marketplace/listing/error-text.ts).
    const message = humanizeListingError(channel.channelName, raw).slice(0, 1000);
    await prisma.listingCopyTarget.update({
      where: { id: t.id },
      data: { status: "FAILED", error: message },
    });
    console.warn(`[listing-copy] ${channel.shopName} (${channel.channelName}) đăng thất bại: ${raw}`);
  }
  await rollupJob(t.jobId);
}

async function linkNewListing(
  job: { userId: string; sourceType: "CHANNEL" | "PRODUCT" | "MANUAL"; sourceChannelId: string | null },
  channel: Channel,
  draft: ListingDraft,
  result: { remoteItemId: string; variants: { sku: string; remoteId: string }[] }
): Promise<void> {
  const skus = draft.variants.map((v) => v.sku);
  // Nguồn "Tạo mới" (MANUAL): KHÔNG nối gian ↔ Tổng kho (anh chốt 30/10, docs mục 24.3-1) —
  // khách muốn nối thì bấm Tự khớp, trùng mã chính xác vì cùng một mã.
  const productBySku =
    job.sourceType === "MANUAL"
      ? new Map<string, string>()
      : job.sourceType === "CHANNEL" && job.sourceChannelId
        ? await sourceSkuToProductId(job.sourceChannelId, skus)
        : await productIdsBySku(job.userId, skus);
  const remoteBySku = new Map(result.variants.map((v) => [v.sku, v.remoteId]));
  for (const v of draft.variants) {
    await prisma.channelProduct.upsert({
      where: { channelId_channelSku: { channelId: channel.id, channelSku: v.sku } },
      create: {
        channelId: channel.id,
        channelSku: v.sku,
        productName: draft.listing.title,
        variantName: v.name,
        price: v.price,
        imageUrl: v.imageUrl ?? draft.listing.images[0] ?? null,
        externalId: remoteBySku.get(v.sku) ?? result.remoteItemId,
        channelStock: v.stock,
        status: "ACTIVE",
        lastSyncedAt: new Date(),
        productId: productBySku.get(v.sku) ?? null,
      },
      update: {
        productName: draft.listing.title,
        variantName: v.name,
        price: v.price,
        externalId: remoteBySku.get(v.sku) ?? result.remoteItemId,
        status: "ACTIVE",
        lastSyncedAt: new Date(),
        ...(productBySku.get(v.sku) ? { productId: productBySku.get(v.sku) } : {}),
      },
    });
  }
}

/** Gom trạng thái job sau khi một gian đích xong; còn gian đang đăng thì chưa chốt. */
export async function rollupJob(jobId: string): Promise<void> {
  const targets = await prisma.listingCopyTarget.findMany({ where: { jobId }, select: { status: true } });
  const status = rollupStatus(targets.map((t) => t.status));
  if (status === "SUBMITTED" || status === "DRAFT") return;
  await prisma.listingCopyJob.update({ where: { id: jobId }, data: { status, finishedAt: new Date() } });
}
