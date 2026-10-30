// ============================================================
// SAO CHÉP SẢN PHẨM — NGHIỆP VỤ (docs/SAO-CHEP-SAN-PHAM.md)
//
//   createJob    : chụp nguồn → tạo job + một target mỗi gian đích, gợi ý danh
//                  mục + luật bắt buộc → missing[].
//   updateTarget : khách sửa danh mục / thuộc tính / cân nặng… → tính lại missing.
//   submitJob    : target đủ điều kiện → QUEUED + xếp việc listing.copy; hàng
//                  đợi chưa sẵn sàng (dev) → chạy tại chỗ.
//   processTarget: worker — gọi adapter tạo sản phẩm, ghi kết quả, tạo dòng
//                  ChannelProduct cho gian đích NỐI SẴN SKU kho (luật mã trùng).
// ============================================================

import { Prisma, type Channel, type ListingCopyTarget } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { enqueue, QUEUES, QueueUnavailableError } from "../../lib/queue";
import { getListingAdapter } from "../../marketplace/listing/registry";
import { humanizeListingError } from "../../marketplace/listing/error-text";
import { activeVariants, adjustPrice, computeMissing, computeWarnings, effectiveOptions, normalizeDims, type MissingCode } from "../../marketplace/listing/rules";
import { ensureWarehouseProducts, type ManualMeta, type ManualSource } from "./manual";
import type {
  CategoryRequirements,
  ListingDimensions,
  ListingDraft,
  NormalizedListing,
} from "../../marketplace/listing/types";
import {
  buildListingFromProducts,
  productIdsBySku,
  sourceSkuToProductId,
} from "./source";

export class ListingCopyError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

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

/** Tùy chọn khi Đăng — ai bấm (ghi sổ kho) và có được ghi giá vốn không (nhân viên: không). */
export interface SubmitOptions {
  actorId?: string | null;
  allowCost?: boolean;
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

/** Kiểu JSON ghi Prisma (InputJsonValue) từ object thường. */
export function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export function asListing(v: Prisma.JsonValue): NormalizedListing {
  const l = v as unknown as NormalizedListing;
  // Job tạo trước lát "ảnh trong mô tả" chưa có trường này.
  if (!Array.isArray(l.descriptionImages)) l.descriptionImages = [];
  return l;
}

function asRecord(v: Prisma.JsonValue): Record<string, string> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
}

function asStringArray(v: Prisma.JsonValue): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** Bảng có thể còn {0,0,0} ghi trước 29/10 → normalizeDims trả null, không gửi sàn. */
function asDims(v: Prisma.JsonValue | null): ListingDimensions | null {
  return normalizeDims(v);
}

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

async function evaluateTarget(
  channel: Channel,
  listing: NormalizedListing,
  state: {
    categoryId: string | null;
    attributes: Record<string, string>;
    brandId: string | null;
    logisticIds: string[];
    weightGrams: number | null;
    dimensionsCm: ListingDimensions | null;
  }
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

export async function createJob(input: CreateJobInput) {
  const targetIds = [...new Set(input.targetChannelIds)].filter(Boolean);
  if (targetIds.length === 0) throw new ListingCopyError("Chọn ít nhất một gian đích.");
  if (targetIds.length > 20) throw new ListingCopyError("Mỗi lượt tối đa 20 gian đích.");

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
    include: { targets: true },
  });
  if (!input.batchId) await prisma.listingCopyJob.update({ where: { id: job.id }, data: { batchId: job.id } });
  return getJob(input.ownerId, job.id);
}

export interface JobView {
  id: string;
  batchId: string;
  sourceType: "CHANNEL" | "PRODUCT" | "MANUAL";
  sourceChannel: { id: string; shopName: string; channelName: string } | null;
  sourceTitle: string;
  sourceImageUrl: string | null;
  source: NormalizedListing;
  status: string;
  createdAt: Date;
  submittedAt: Date | null;
  finishedAt: Date | null;
  targets: TargetView[];
}

export interface TargetView {
  id: string;
  channel: { id: string; shopName: string; channelName: string };
  categoryId: string | null;
  categoryName: string | null;
  categoryConfidence: number | null;
  attributes: Record<string, string>;
  /** Định nghĩa thuộc tính của danh mục đang chọn (để FE vẽ ô nhập). */
  attributeDefs: CategoryRequirements["attributes"];
  requirements: Omit<CategoryRequirements, "attributes"> | null;
  brandId: string | null;
  brandName: string | null;
  logisticIds: string[];
  logisticOptions: { id: string; name: string; enabled: boolean }[];
  weightGrams: number | null;
  dimensionsCm: ListingDimensions | null;
  priceAdjustPercent: number;
  stock: number | null;
  missing: string[];
  /** Cảnh báo không chặn đăng (rules.computeWarnings) — tính lại mỗi lần, không lưu DB. */
  warnings: string[];
  status: string;
  error: string | null;
  remoteItemId: string | null;
  remoteUrl: string | null;
  attempts: number;
  listedAt: Date | null;
}

export async function getJob(ownerId: string, jobId: string): Promise<JobView> {
  const job = await prisma.listingCopyJob.findFirst({
    where: { id: jobId, userId: ownerId },
    include: { targets: { orderBy: { id: "asc" } } },
  });
  if (!job) throw new ListingCopyError("Không tìm thấy lượt sao chép.", 404);
  const channelIds = [...new Set([...job.targets.map((t) => t.channelId), job.sourceChannelId].filter(Boolean))] as string[];
  const channels = await prisma.channel.findMany({ where: { id: { in: channelIds } } });
  const byId = new Map(channels.map((c) => [c.id, c]));
  const sourceListing = asListing(job.source);
  const targets: TargetView[] = await Promise.all(
    job.targets.map(async (t) => {
      const channel = byId.get(t.channelId);
      const adapter = channel ? getListingAdapter(channel) : null;
      const requirements =
        channel && adapter && t.categoryId ? await adapter.getCategoryRequirements(channel, t.categoryId) : null;
      const logisticOptions =
        channel && adapter && channel.channelName === "SHOPEE" ? await adapter.getLogistics(channel) : [];
      const { attributes: attributeDefs = [], ...rest } = requirements ?? {};
      return {
        id: t.id,
        channel: channel
          ? { id: channel.id, shopName: channel.shopName, channelName: channel.channelName }
          : { id: t.channelId, shopName: "(gian đã xóa)", channelName: "OFFLINE" },
        categoryId: t.categoryId,
        categoryName: t.categoryName,
        categoryConfidence: t.categoryConfidence,
        attributes: asRecord(t.attributes),
        attributeDefs,
        requirements: requirements ? (rest as Omit<CategoryRequirements, "attributes">) : null,
        brandId: t.brandId,
        brandName: t.brandName,
        logisticIds: asStringArray(t.logisticIds),
        logisticOptions,
        weightGrams: t.weightGrams,
        dimensionsCm: asDims(t.dimensionsCm),
        priceAdjustPercent: t.priceAdjustPercent,
        stock: t.stock,
        missing: asStringArray(t.missing),
        warnings: channel ? computeWarnings(channel.channelName, sourceListing) : [],
        status: t.status,
        error: t.error,
        remoteItemId: t.remoteItemId,
        remoteUrl: t.remoteUrl,
        attempts: t.attempts,
        listedAt: t.listedAt,
      };
    })
  );
  const sc = job.sourceChannelId ? byId.get(job.sourceChannelId) : null;
  return {
    id: job.id,
    batchId: job.batchId ?? job.id,
    sourceType: job.sourceType,
    sourceChannel: sc ? { id: sc.id, shopName: sc.shopName, channelName: sc.channelName } : null,
    sourceTitle: job.sourceTitle,
    sourceImageUrl: job.sourceImageUrl,
    source: asListing(job.source),
    status: job.status,
    createdAt: job.createdAt,
    submittedAt: job.submittedAt,
    finishedAt: job.finishedAt,
    targets,
  };
}

export interface SourcePatch {
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

export const MAX_SOURCE_IMAGES = 9;

/**
 * Sửa tên / mô tả / giá + tồn từng phân loại của nguồn đã chụp (áp cho mọi gian
 * đích) rồi tính lại missing. % điều chỉnh giá và "Tồn đăng" của từng gian vẫn
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
    const cleaned: string[] = [];
    for (const u of patch.images) {
      const t = String(u).trim();
      if (/^https?:\/\//i.test(t) && t.length <= 2048 && !cleaned.includes(t)) cleaned.push(t);
    }
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
  const { missing } = await evaluateTarget(channel, listing, {
    categoryId: t.categoryId,
    attributes: asRecord(t.attributes),
    brandId: t.brandId,
    logisticIds: asStringArray(t.logisticIds),
    weightGrams: t.weightGrams,
    dimensionsCm: asDims(t.dimensionsCm),
  });
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

  let categoryId = t.categoryId;
  let categoryName = t.categoryName;
  let categoryConfidence = t.categoryConfidence;
  let attributes = asRecord(t.attributes);
  if (patch.categoryId !== undefined && patch.categoryId !== t.categoryId) {
    categoryId = patch.categoryId;
    categoryConfidence = null;
    categoryName = null;
    if (categoryId) {
      // Kiểm trên TOÀN BỘ cây (searchCategories cắt 300 lá — sàn thật có hàng nghìn).
      const all = await adapter.getCategoryTree(channel);
      const byId = new Map(all.map((n) => [n.id, n]));
      const node = byId.get(categoryId);
      if (!node) throw new ListingCopyError("Danh mục không hợp lệ với sàn này.");
      if (!node.leaf) throw new ListingCopyError("Phải chọn tới danh mục cấp cuối (lá).");
      const path: string[] = [];
      let cur: (typeof node) | undefined = node;
      let guard = 0;
      while (cur && guard++ < 10) {
        path.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      categoryName = path.join(" > ");
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
  const logisticIds = patch.logisticIds ?? asStringArray(t.logisticIds);
  const weightGrams = patch.weightGrams !== undefined ? patch.weightGrams : t.weightGrams;
  const dimensionsCm = patch.dimensionsCm !== undefined ? patch.dimensionsCm : asDims(t.dimensionsCm);
  const priceAdjustPercent =
    patch.priceAdjustPercent !== undefined ? Math.max(-50, Math.min(100, Math.round(patch.priceAdjustPercent))) : t.priceAdjustPercent;
  const stock = patch.stock !== undefined ? patch.stock : t.stock;

  const { missing } = await evaluateTarget(channel, listing, {
    categoryId,
    attributes,
    brandId,
    logisticIds,
    weightGrams,
    dimensionsCm,
  });
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

export interface SubmitResult {
  queued: number;
  skipped: { targetId: string; shopName: string; missing: string[] }[];
}

export async function submitJob(ownerId: string, jobId: string, opts: SubmitOptions = {}): Promise<SubmitResult> {
  const job = await prisma.listingCopyJob.findFirst({ where: { id: jobId, userId: ownerId }, include: { targets: true } });
  if (!job) throw new ListingCopyError("Không tìm thấy lượt sao chép.", 404);
  const listing = asListing(job.source);
  const channels = await prisma.channel.findMany({ where: { id: { in: job.targets.map((t) => t.channelId) } } });
  const byId = new Map(channels.map((c) => [c.id, c]));
  const result: SubmitResult = { queued: 0, skipped: [] };
  const toQueue: string[] = [];
  for (const t of job.targets) {
    if (t.status !== "PENDING" && t.status !== "FAILED") continue;
    // Tính lại ngay trước khi gửi — SKU có thể vừa xuất hiện trên gian đích.
    const channel = byId.get(t.channelId);
    if (!channel) continue;
    const { missing } = await evaluateTarget(channel, listing, {
      categoryId: t.categoryId,
      attributes: asRecord(t.attributes),
      brandId: t.brandId,
      logisticIds: asStringArray(t.logisticIds),
      weightGrams: t.weightGrams,
      dimensionsCm: asDims(t.dimensionsCm),
    });
    if (missing.length > 0) {
      await prisma.listingCopyTarget.update({ where: { id: t.id }, data: { missing: json(missing) } });
      result.skipped.push({ targetId: t.id, shopName: channel.shopName, missing });
      continue;
    }
    toQueue.push(t.id);
  }
  if (toQueue.length === 0) {
    throw new ListingCopyError("Chưa gian nào đủ điều kiện đăng — điền các ô còn thiếu trước.");
  }
  // Nguồn "Tạo mới": ghi Tổng kho TRƯỚC khi vào hàng đợi (SP có trong Hàng hóa kể cả khi sàn
  // PENDING/lỗi; bấm Đăng lại không tạo trùng). KHÔNG nối gian — docs mục 24.3-1.
  if (job.sourceType === "MANUAL") {
    const r = await ensureWarehouseProducts(ownerId, opts.actorId ?? null, asListing(job.source) as ManualSource, {
      allowCost: opts.allowCost ?? true,
    });
    if (r.created > 0) console.log(`[listing-copy] Tạo mới ${job.id}: ghi Tổng kho ${r.created} SKU (bỏ qua ${r.skipped} đã có)`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.listingCopyTarget.updateMany({
      where: { id: { in: toQueue } },
      data: { status: "QUEUED", error: null },
    });
    await tx.listingCopyJob.update({
      where: { id: job.id },
      data: { status: "SUBMITTED", submittedAt: job.submittedAt ?? new Date(), finishedAt: null },
    });
  });
  for (const targetId of toQueue) {
    await enqueueTarget(targetId);
    result.queued += 1;
  }
  return result;
}

export interface ListingCopyJobData {
  targetId: string;
}

async function enqueueTarget(targetId: string): Promise<void> {
  try {
    await enqueue<ListingCopyJobData>(QUEUES.listingCopy, { targetId }, { key: `listing-copy:${targetId}` });
  } catch (err) {
    if (err instanceof QueueUnavailableError) {
      // Dev local chưa có hàng đợi → chạy tại chỗ, không chặn phản hồi HTTP.
      setImmediate(() => {
        processTarget(targetId).catch((e) => console.error(`[listing-copy] ${targetId} lỗi:`, (e as Error).message));
      });
      return;
    }
    throw err;
  }
}

/** Worker: đăng MỘT gian đích. Ném lỗi = pg-boss thử lại; trạng thái ghi ở bảng. */
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
  const draft: ListingDraft = {
    listing,
    categoryId: t.categoryId ?? "",
    attributes: asRecord(t.attributes),
    brandId: t.brandId,
    brandName: t.brandName,
    logisticIds: asStringArray(t.logisticIds),
    weightGrams: t.weightGrams,
    dimensionsCm: asDims(t.dimensionsCm),
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

/**
 * Sản phẩm mới trên gian đích → ghi ngay ChannelProduct nối SKU kho (nguồn gian:
 * theo productId của dòng nguồn; nguồn kho: theo skuCode). Nhờ vậy tồn kho đồng
 * bộ được ngay, không phải đợi lượt đồng bộ sản phẩm kế tiếp.
 */
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

export async function rollupJob(jobId: string): Promise<void> {
  const targets = await prisma.listingCopyTarget.findMany({ where: { jobId }, select: { status: true } });
  const open = targets.some((t) => t.status === "QUEUED" || t.status === "RUNNING");
  if (open) return;
  const ok = targets.filter((t) => t.status === "LISTED" || t.status === "PENDING_REVIEW").length;
  const failed = targets.filter((t) => t.status === "FAILED").length;
  const pending = targets.filter((t) => t.status === "PENDING").length;
  const status = failed === 0 && pending === 0 ? "DONE" : ok === 0 && pending === 0 ? "FAILED" : "PARTIAL";
  await prisma.listingCopyJob.update({ where: { id: jobId }, data: { status, finishedAt: new Date() } });
}
