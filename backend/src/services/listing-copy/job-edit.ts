// ============================================================
// SAO CHÉP SẢN PHẨM — TẠO + SỬA bản nháp (docs/SAO-CHEP-SAN-PHAM.md)
//
//   createJob       : chụp nguồn (gian / kho / "Tạo mới") → job + một target mỗi gian
//                     đích, gợi ý danh mục + luật bắt buộc → missing[].
//   updateJobSource : khách sửa tên / mô tả / ảnh / giá-tồn-SKU từng phân loại (áp mọi gian).
//   updateTarget    : khách sửa danh mục / thuộc tính / cân nặng… của MỘT gian → tính lại missing.
//   reevaluate      : tính lại missing cho một target (dùng sau "Áp cho sản phẩm còn lại").
// ============================================================

import { Prisma, type Channel, type ListingCopyTarget } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { pathToRoot } from "../../lib/tree";
import { getListingAdapter } from "../../marketplace/listing/registry";
import { activeVariants, computeMissing, type MissingCode, type TargetDraftState } from "../../marketplace/listing/rules";
import type { CategoryRequirements, ListingDimensions, NormalizedListing } from "../../marketplace/listing/types";
import { ListingCopyError } from "./errors";
import { getJob, type JobView } from "./job-view";
import { asListing, asRecord, json, targetState } from "./json-fields";
import { type ManualMeta, type ManualSource } from "./manual";
import { urlList } from "./parse";
import { buildListingFromProducts } from "./source";

export interface CreateJobInput {
  ownerId: string;
  userId: string;
  allowedChannelIds: string[] | null;
  sourceType: "CHANNEL" | "PRODUCT" | "MANUAL";
  sourceChannelId?: string;
  sourceItemId?: string;
  sourceGroupKey?: string;
  /** Nguồn MANUAL (docs mục 24): sản phẩm khách tự soạn + meta kho. */
  manual?: { listing: NormalizedListing; meta: ManualMeta };
  targetChannelIds: string[];
  /** Đợt nhiều sản phẩm (lát 2); bỏ trống = job lẻ, batchId = chính id job. */
  batchId?: string;
}

export interface TargetPatch {
  categoryId?: string | null;
  attributes?: Record<string, string>;
  brandId?: string | null;
  brandName?: string | null;
  logisticIds?: string[];
  weightGrams?: number | null;
  dimensionsCm?: ListingDimensions | null;
  priceAdjustPercent?: number;
  stock?: number | null;
}

interface SourcePatch {
  title?: string;
  description?: string;
  /**
   * Giá / tồn từng phân loại theo VỊ TRÍ trong source.variants (anh yêu cầu 29/10: khách được sửa giá + tồn nguồn).
   * 30/10: thêm `sku` (nguồn sàn không có mã người bán → khách nhập để sàn đích nhận + nối kho) và
   * `excluded` (bỏ phân loại khỏi bài đăng — vượt trần phân loại sàn đích).
   */
  variants?: { index: number; price?: number; stock?: number; sku?: string; excluded?: boolean }[];
  /**
   * 30/10 (anh chốt): khách XÓA ảnh cũ / TẢI ảnh mới ngay trong Sửa bài đăng — danh sách ảnh thay thế
   * toàn bộ (thứ tự = thứ tự đăng, ảnh đầu = bìa), tối đa 9 (Shopee/TikTok; Lazada lấy 8 đầu).
   */
  images?: string[];
}

const MAX_SOURCE_IMAGES = 9;
const MAX_TARGETS_PER_JOB = 20;

async function loadTargetChannels(ownerId: string, allowed: string[] | null, ids: string[]): Promise<Channel[]> {
  const channels = await prisma.channel.findMany({
    where: { id: { in: ids }, userId: ownerId, status: "ACTIVE", ...(allowed ? { id: { in: allowed } } : {}) },
  });
  if (channels.length !== new Set(ids).size) {
    throw new ListingCopyError("Có gian đích không thuộc shop này hoặc đã ngắt kết nối.");
  }
  if (channels.some((c) => c.channelName === "OFFLINE")) {
    throw new ListingCopyError("Không đăng được lên gian Offline.");
  }
  return channels;
}

/** SKU của nguồn đã tồn tại trên gian đích — đăng sẽ trùng, chặn từ bước xem trước. */
async function existingSkusOn(channelId: string, skus: string[]): Promise<string[]> {
  if (skus.length === 0) return [];
  const rows = await prisma.channelProduct.findMany({
    where: { channelId, channelSku: { in: skus } },
    select: { channelSku: true },
  });
  return rows.map((r) => r.channelSku);
}

/** Tính "còn thiếu" của một gian đích theo trạng thái đã chọn + luật danh mục (hỏi adapter). */
export async function evaluateTarget(
  channel: Channel,
  listing: NormalizedListing,
  state: Omit<TargetDraftState, "existingSkus">
): Promise<{ missing: MissingCode[]; requirements: CategoryRequirements | null }> {
  const adapter = getListingAdapter(channel);
  const requirements = state.categoryId ? await adapter.getCategoryRequirements(channel, state.categoryId) : null;
  const existingSkus = await existingSkusOn(
    channel.id,
    activeVariants(listing).map((v) => v.sku).filter(Boolean)
  );
  const missing = computeMissing(channel.channelName, listing, { ...state, existingSkus }, requirements);
  return { missing, requirements };
}

export async function createJob(input: CreateJobInput): Promise<JobView> {
  const targetIds = [...new Set(input.targetChannelIds)].filter(Boolean);
  if (targetIds.length === 0) throw new ListingCopyError("Chọn ít nhất một gian đích.");
  if (targetIds.length > MAX_TARGETS_PER_JOB) throw new ListingCopyError(`Mỗi lượt tối đa ${MAX_TARGETS_PER_JOB} gian đích.`);

  let listing: NormalizedListing | null = null;
  let sourceChannel: Channel | null = null;
  if (input.sourceType === "CHANNEL") {
    if (!input.sourceChannelId || !input.sourceItemId) throw new ListingCopyError("Thiếu gian nguồn hoặc sản phẩm nguồn.");
    sourceChannel = await prisma.channel.findFirst({
      where: {
        id: input.sourceChannelId,
        userId: input.ownerId,
        ...(input.allowedChannelIds ? { id: { in: input.allowedChannelIds } } : {}),
      },
    });
    if (!sourceChannel) throw new ListingCopyError("Gian nguồn không thuộc shop này.", 404);
    if (targetIds.includes(sourceChannel.id)) throw new ListingCopyError("Gian đích không được trùng gian nguồn.");
    listing = await getListingAdapter(sourceChannel).fetchListing(sourceChannel, input.sourceItemId);
  } else if (input.sourceType === "MANUAL") {
    if (!input.manual) throw new ListingCopyError("Thiếu nội dung sản phẩm tạo mới.");
    listing = input.manual.listing;
  } else {
    if (!input.sourceGroupKey) throw new ListingCopyError("Thiếu sản phẩm kho nguồn.");
    listing = await buildListingFromProducts(input.ownerId, input.sourceGroupKey);
  }
  if (!listing) throw new ListingCopyError("Không đọc được sản phẩm nguồn.", 404);
  // Job MANUAL lưu kèm meta kho (giá vốn mặc định) ngay trong source — adapter chỉ đọc phần listing.
  const sourceJson: ManualSource = input.sourceType === "MANUAL" ? { ...listing, manual: input.manual!.meta } : listing;

  const channels = await loadTargetChannels(input.ownerId, input.allowedChannelIds, targetIds);

  // Gợi ý danh mục + luật cho từng gian đích — gọi song song, gian nào lỗi thì
  // để trống danh mục (khách chọn tay), không làm hỏng cả lượt.
  const prepared = await Promise.all(
    channels.map(async (channel) => {
      const adapter = getListingAdapter(channel);
      let categoryId: string | null = null;
      let categoryName: string | null = null;
      let categoryConfidence: number | null = null;
      try {
        const suggestions = await adapter.recommendCategory(channel, listing);
        if (suggestions[0]) {
          categoryId = suggestions[0].id;
          categoryName = suggestions[0].path.join(" > ");
          categoryConfidence = suggestions[0].confidence;
        }
      } catch (err) {
        console.warn(`[listing-copy] gợi ý danh mục ${channel.shopName} lỗi: ${(err as Error).message}`);
      }
      const requirements = categoryId ? await adapter.getCategoryRequirements(channel, categoryId) : null;
      // Điền sẵn thuộc tính trùng tên từ nguồn (vd Chất liệu).
      const attributes: Record<string, string> = {};
      for (const def of requirements?.attributes ?? []) {
        const src = listing.attributes.find((a) => a.name.toLowerCase() === def.name.toLowerCase());
        if (src) attributes[def.id] = src.value;
      }
      let logisticIds: string[] = [];
      if ((requirements ?? { logisticsRequired: channel.channelName === "SHOPEE" }).logisticsRequired) {
        const options = await adapter.getLogistics(channel);
        logisticIds = options.filter((o) => o.enabled).map((o) => o.id);
      }
      let brandId: string | null = null;
      let brandName: string | null = null;
      if (listing.brandName) {
        const found = (await adapter.searchBrands(channel, categoryId, listing.brandName))[0];
        if (found) {
          brandId = found.id;
          brandName = found.name;
        }
      }
      const state = {
        categoryId,
        attributes,
        brandId,
        logisticIds,
        weightGrams: listing.weightGrams,
        dimensionsCm: listing.dimensionsCm,
      };
      const { missing } = await evaluateTarget(channel, listing, state);
      return { channel, categoryId, categoryName, categoryConfidence, attributes, logisticIds, brandId, brandName, missing };
    })
  );

  const job = await prisma.listingCopyJob.create({
    data: {
      userId: input.ownerId,
      createdById: input.userId,
      sourceType: input.sourceType,
      sourceChannelId: sourceChannel?.id ?? null,
      sourceItemId: input.sourceItemId ?? null,
      sourceGroupKey: input.sourceGroupKey ?? null,
      sourceTitle: listing.title,
      sourceImageUrl: listing.images[0] ?? null,
      source: json(sourceJson),
      batchId: input.batchId ?? null,
      targets: {
        create: prepared.map((p) => ({
          channelId: p.channel.id,
          categoryId: p.categoryId,
          categoryName: p.categoryName,
          categoryConfidence: p.categoryConfidence,
          attributes: json(p.attributes),
          logisticIds: json(p.logisticIds),
          brandId: p.brandId,
          brandName: p.brandName,
          weightGrams: listing.weightGrams,
          dimensionsCm: listing.dimensionsCm ? json(listing.dimensionsCm) : Prisma.JsonNull,
          missing: json(p.missing),
        })),
      },
    },
    select: { id: true },
  });
  if (!input.batchId) await prisma.listingCopyJob.update({ where: { id: job.id }, data: { batchId: job.id } });
  return getJob(input.ownerId, job.id);
}

/**
 * Sửa tên / mô tả / ảnh / giá + tồn + SKU từng phân loại của nguồn đã chụp (áp cho mọi
 * gian đích) rồi tính lại missing. % điều chỉnh giá và "Tồn đăng" của từng gian vẫn
 * áp CHỒNG lên số nguồn đã sửa.
 */
export async function updateJobSource(ownerId: string, jobId: string, patch: SourcePatch): Promise<JobView> {
  const job = await prisma.listingCopyJob.findFirst({ where: { id: jobId, userId: ownerId }, include: { targets: true } });
  if (!job) throw new ListingCopyError("Không tìm thấy lượt sao chép.", 404);
  // Sửa được khi không gian nào đang đăng và còn gian chưa đăng xong (chờ / lỗi) —
  // gian lỗi vì tên dài quá chuẩn sàn thì khách sửa tên rồi đăng lại ngay tại đây.
  if (job.targets.some((t) => t.status === "QUEUED" || t.status === "RUNNING")) {
    throw new ListingCopyError("Đang đăng, chờ xong rồi sửa.");
  }
  const open = job.targets.filter((t) => t.status === "PENDING" || t.status === "FAILED");
  if (open.length === 0) throw new ListingCopyError("Mọi gian đã đăng xong, không sửa được nữa.");
  const listing = asListing(job.source);
  if (typeof patch.title === "string") listing.title = patch.title.trim();
  if (typeof patch.description === "string") listing.description = patch.description.trim();
  if (patch.images) {
    const cleaned = urlList(patch.images, MAX_SOURCE_IMAGES + 1);
    if (cleaned.length === 0) throw new ListingCopyError("Bài đăng cần ít nhất một ảnh.");
    if (cleaned.length > MAX_SOURCE_IMAGES) throw new ListingCopyError(`Tối đa ${MAX_SOURCE_IMAGES} ảnh (Shopee/TikTok nhận 9, Lazada 8).`);
    listing.images = cleaned;
    // Ảnh phân loại trỏ tới ảnh vừa bị bỏ → bỏ luôn liên kết (sàn sẽ dùng ảnh bìa).
    for (const v of listing.variants) if (v.imageUrl && !cleaned.includes(v.imageUrl) && !listing.descriptionImages.includes(v.imageUrl)) v.imageUrl = null;
  }
  for (const e of patch.variants ?? []) {
    const v = listing.variants[e.index];
    if (!v) continue;
    if (e.price !== undefined) v.price = Math.max(0, Math.round(e.price));
    if (e.stock !== undefined) v.stock = Math.max(0, Math.round(e.stock));
    if (e.sku !== undefined) v.sku = e.sku.trim().slice(0, 100);
    if (e.excluded !== undefined) {
      if (e.excluded) v.excluded = true;
      else delete v.excluded;
    }
  }
  if (activeVariants(listing).length === 0) throw new ListingCopyError("Phải giữ ít nhất một phân loại để đăng.");
  await prisma.listingCopyJob.update({
    where: { id: job.id },
    data: { source: json(listing), sourceTitle: listing.title, sourceImageUrl: listing.images[0] ?? null },
  });
  await Promise.all(open.map((t) => reevaluate(t, listing)));
  return getJob(ownerId, jobId);
}

export async function reevaluate(t: ListingCopyTarget, listing: NormalizedListing): Promise<void> {
  const channel = await prisma.channel.findUnique({ where: { id: t.channelId } });
  if (!channel) return;
  const { missing } = await evaluateTarget(channel, listing, targetState(t));
  await prisma.listingCopyTarget.update({ where: { id: t.id }, data: { missing: json(missing) } });
}

export async function updateTarget(ownerId: string, jobId: string, targetId: string, patch: TargetPatch): Promise<JobView> {
  const job = await prisma.listingCopyJob.findFirst({ where: { id: jobId, userId: ownerId } });
  if (!job) throw new ListingCopyError("Không tìm thấy lượt sao chép.", 404);
  const t = await prisma.listingCopyTarget.findFirst({ where: { id: targetId, jobId } });
  if (!t) throw new ListingCopyError("Không tìm thấy gian đích.", 404);
  if (t.status !== "PENDING" && t.status !== "FAILED") {
    throw new ListingCopyError("Gian này đang đăng hoặc đã đăng xong, không sửa được.");
  }
  const channel = await prisma.channel.findUnique({ where: { id: t.channelId } });
  if (!channel) throw new ListingCopyError("Gian đích không còn.", 404);
  const adapter = getListingAdapter(channel);
  const listing = asListing(job.source);
  const current = targetState(t);

  let categoryId = t.categoryId;
  let categoryName = t.categoryName;
  let categoryConfidence = t.categoryConfidence;
  let attributes = asRecord(t.attributes);
  if (patch.categoryId !== undefined && patch.categoryId !== t.categoryId) {
    categoryId = patch.categoryId;
    categoryConfidence = null;
    categoryName = null;
    if (categoryId) {
      // Kiểm trên TOÀN BỘ cây (sàn thật có hàng nghìn lá).
      const all = await adapter.getCategoryTree(channel);
      const byId = new Map(all.map((n) => [n.id, n]));
      const node = byId.get(categoryId);
      if (!node) throw new ListingCopyError("Danh mục không hợp lệ với sàn này.");
      if (!node.leaf) throw new ListingCopyError("Phải chọn tới danh mục cấp cuối (lá).");
      categoryName = pathToRoot(byId, categoryId, (n) => n.parentId, (n) => n.name).join(" > ");
      // Đổi danh mục = bộ thuộc tính khác → giữ lại giá trị trùng id, bỏ phần còn lại.
      const req = await adapter.getCategoryRequirements(channel, categoryId);
      const keep: Record<string, string> = {};
      for (const def of req?.attributes ?? []) if (attributes[def.id]) keep[def.id] = attributes[def.id];
      attributes = keep;
    } else {
      attributes = {};
    }
  }
  if (patch.attributes) attributes = { ...attributes, ...patch.attributes };
  const brandId = patch.brandId !== undefined ? patch.brandId : t.brandId;
  let brandName = patch.brandName !== undefined ? patch.brandName : t.brandName;
  if (patch.brandId !== undefined && patch.brandName === undefined) {
    brandName = brandId
      ? adapter.getBrandName
        ? await adapter.getBrandName(channel, categoryId, brandId)
        : ((await adapter.searchBrands(channel, categoryId, "")).find((b) => b.id === brandId)?.name ?? null)
      : null;
  }
  const logisticIds = patch.logisticIds ?? current.logisticIds;
  const weightGrams = patch.weightGrams !== undefined ? patch.weightGrams : t.weightGrams;
  const dimensionsCm = patch.dimensionsCm !== undefined ? patch.dimensionsCm : current.dimensionsCm;
  const priceAdjustPercent =
    patch.priceAdjustPercent !== undefined ? Math.max(-50, Math.min(100, Math.round(patch.priceAdjustPercent))) : t.priceAdjustPercent;
  const stock = patch.stock !== undefined ? patch.stock : t.stock;

  const { missing } = await evaluateTarget(channel, listing, { categoryId, attributes, brandId, logisticIds, weightGrams, dimensionsCm });
  await prisma.listingCopyTarget.update({
    where: { id: t.id },
    data: {
      categoryId,
      categoryName,
      categoryConfidence,
      attributes: json(attributes),
      brandId,
      brandName,
      logisticIds: json(logisticIds),
      weightGrams,
      dimensionsCm: dimensionsCm ? json(dimensionsCm) : Prisma.JsonNull,
      priceAdjustPercent,
      stock,
      missing: json(missing),
      // Sửa lại sau khi thất bại → quay về chờ đăng.
      ...(t.status === "FAILED" ? { status: "PENDING", error: null } : {}),
    },
  });
  return getJob(ownerId, jobId);
}
