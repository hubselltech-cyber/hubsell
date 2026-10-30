// ============================================================
// SAO CHÉP SẢN PHẨM — ĐỌC một lượt (job + mọi gian đích) cho màn hình.
// Mỗi gian đích kèm định nghĩa thuộc tính của danh mục đang chọn + kênh vận chuyển
// (Shopee) — adapter đệm theo gian/danh mục nên mở đợt 50 SP không gọi sàn 100 lượt.
// ============================================================

import { prisma } from "../../lib/prisma";
import { getListingAdapter } from "../../marketplace/listing/registry";
import { computeWarnings } from "../../marketplace/listing/rules";
import type { CategoryRequirements, ListingDimensions, NormalizedListing } from "../../marketplace/listing/types";
import { ListingCopyError } from "./errors";
import { asListing, asStringArray, targetState } from "./json-fields";

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

interface TargetView {
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
      const state = targetState(t);
      return {
        id: t.id,
        channel: channel
          ? { id: channel.id, shopName: channel.shopName, channelName: channel.channelName }
          : { id: t.channelId, shopName: "(gian đã xóa)", channelName: "OFFLINE" },
        categoryId: t.categoryId,
        categoryName: t.categoryName,
        categoryConfidence: t.categoryConfidence,
        attributes: state.attributes,
        attributeDefs,
        requirements: requirements ? (rest as Omit<CategoryRequirements, "attributes">) : null,
        brandId: t.brandId,
        brandName: t.brandName,
        logisticIds: state.logisticIds,
        logisticOptions,
        weightGrams: t.weightGrams,
        dimensionsCm: state.dimensionsCm,
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
    source: sourceListing,
    status: job.status,
    createdAt: job.createdAt,
    submittedAt: job.submittedAt,
    finishedAt: job.finishedAt,
    targets,
  };
}
