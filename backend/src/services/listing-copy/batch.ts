// ============================================================
// SAO CHÉP SẢN PHẨM — ĐỢT NHIỀU SẢN PHẨM (lát 2, docs/SAO-CHEP-SAN-PHAM.md mục 9)
//
// Đợt = N job cùng batchId (mỗi job một sản phẩm nguồn, mỗi job M target = M
// gian đích). Hàng đợi vẫn là từng cặp sản phẩm × gian → đợt lớn tự chạy lần
// lượt, sản phẩm thiếu thông tin đứng lại không chặn sản phẩm khác.
// "Áp cho sản phẩm còn lại": chép danh mục / thuộc tính / thương hiệu / vận
// chuyển / cân nặng / kích thước của một gian sang mọi gian CÙNG SÀN-GIAN trong
// đợt còn chờ (mẹo UpBase) — khách chọn một lần cho cả lô hàng cùng loại.
// ============================================================

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ListingCopyError } from "./errors";
import { createJob, reevaluate, type CreateJobInput } from "./job-edit";
import { submitJob, type SubmitOptions, type SubmitResult } from "./job-submit";
import { getJob, type JobView } from "./job-view";
import { rollupStatus, type RollupStatus } from "./job-worker";
import { asListing, json } from "./json-fields";
import { recheckBatchDue } from "./review-check";

interface BatchSourceRef {
  /** Khoá sản phẩm sàn (nguồn gian) hoặc groupKey kho (nguồn kho). */
  key: string;
}

export interface CreateBatchInput {
  ownerId: string;
  userId: string;
  allowedChannelIds: string[] | null;
  sourceType: "CHANNEL" | "PRODUCT";
  sourceChannelId?: string;
  sources: BatchSourceRef[];
  targetChannelIds: string[];
}

interface BatchView {
  id: string;
  createdAt: Date;
  jobs: JobView[];
  /** Nguồn tạo không được (không tìm thấy, lỗi đọc…) — báo khách, không làm hỏng đợt. */
  errors: { key: string; error: string }[];
}

const MAX_SOURCES_PER_BATCH = 50;
const CREATE_CONCURRENCY = 3;

export async function createBatch(input: CreateBatchInput): Promise<BatchView> {
  const keys = [...new Set(input.sources.map((s) => s.key).filter(Boolean))];
  if (keys.length === 0) throw new ListingCopyError("Chọn ít nhất một sản phẩm nguồn.");
  if (keys.length > MAX_SOURCES_PER_BATCH) {
    throw new ListingCopyError(`Mỗi đợt tối đa ${MAX_SOURCES_PER_BATCH} sản phẩm — chia thành nhiều đợt.`);
  }
  const batchId = randomUUID();
  const errors: { key: string; error: string }[] = [];
  // Tạo job theo lô nhỏ: mỗi job gọi gợi ý danh mục cho từng gian, không bung hết một lượt.
  for (let i = 0; i < keys.length; i += CREATE_CONCURRENCY) {
    await Promise.all(
      keys.slice(i, i + CREATE_CONCURRENCY).map(async (key) => {
        const jobInput: CreateJobInput = {
          ownerId: input.ownerId,
          userId: input.userId,
          allowedChannelIds: input.allowedChannelIds,
          sourceType: input.sourceType,
          sourceChannelId: input.sourceChannelId,
          sourceItemId: input.sourceType === "CHANNEL" ? key : undefined,
          sourceGroupKey: input.sourceType === "PRODUCT" ? key : undefined,
          targetChannelIds: input.targetChannelIds,
          batchId,
        };
        try {
          await createJob(jobInput);
        } catch (err) {
          errors.push({ key, error: String((err as Error)?.message ?? err) });
        }
      })
    );
  }
  const view = await getBatch(input.ownerId, batchId);
  if (view.jobs.length === 0) {
    throw new ListingCopyError(errors[0]?.error ?? "Không tạo được sản phẩm nào trong đợt.");
  }
  return { ...view, errors };
}

export async function getBatch(ownerId: string, batchId: string): Promise<BatchView> {
  // Khách mở đợt có bài "Chờ sàn duyệt" đã lâu chưa hỏi → hỏi sàn ngay (tối đa 5), màn hình không cũ.
  await recheckBatchDue(ownerId, batchId).catch((err) =>
    console.warn(`[listing-copy] hỏi lại duyệt khi mở đợt ${batchId} lỗi: ${(err as Error).message}`)
  );
  // Job trong đợt tạo song song (cùng mili-giây) → thêm id để thứ tự ổn định giữa các lần nạp.
  const jobs = await prisma.listingCopyJob.findMany({
    where: { userId: ownerId, batchId },
    select: { id: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (jobs.length === 0) throw new ListingCopyError("Không tìm thấy đợt sao chép.", 404);
  const views = await Promise.all(jobs.map((j) => getJob(ownerId, j.id)));
  return { id: batchId, createdAt: jobs[0].createdAt, jobs: views, errors: [] };
}

interface BatchSummary {
  id: string;
  createdAt: Date;
  sourceType: "CHANNEL" | "PRODUCT" | "MANUAL";
  productCount: number;
  firstTitle: string;
  firstImageUrl: string | null;
  /** Số gian đích riêng biệt. */
  channelCount: number;
  targets: { status: string; shopName: string; channelName: string }[];
  /** Tổng hợp theo rollupStatus (job-worker.ts): DRAFT / SUBMITTED / DONE / PARTIAL / FAILED. */
  status: RollupStatus;
}

export async function listBatches(ownerId: string, page: number, pageSize: number) {
  // Nhóm theo batchId trong SQL, phân trang theo đợt.
  const groups = await prisma.$queryRaw<{ batchId: string; createdAt: Date; n: number }[]>(
    Prisma.sql`SELECT "batchId", MIN("createdAt") AS "createdAt", COUNT(*)::int AS n
      FROM "listing_copy_jobs" WHERE "userId" = ${ownerId} AND "batchId" IS NOT NULL
      GROUP BY "batchId" ORDER BY MIN("createdAt") DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  );
  const totalRow = await prisma.$queryRaw<{ n: number }[]>(
    Prisma.sql`SELECT COUNT(DISTINCT "batchId")::int AS n FROM "listing_copy_jobs" WHERE "userId" = ${ownerId} AND "batchId" IS NOT NULL`
  );
  const ids = groups.map((g) => g.batchId);
  const jobs = ids.length
    ? await prisma.listingCopyJob.findMany({
        where: { userId: ownerId, batchId: { in: ids } },
        orderBy: { createdAt: "asc" },
        include: { targets: { select: { status: true, channelId: true } } },
      })
    : [];
  const channelIds = [...new Set(jobs.flatMap((j) => j.targets.map((t) => t.channelId)))];
  const channels = await prisma.channel.findMany({
    where: { id: { in: channelIds } },
    select: { id: true, shopName: true, channelName: true },
  });
  const byId = new Map(channels.map((c) => [c.id, c]));
  const items: BatchSummary[] = groups.map((g) => {
    const js = jobs.filter((j) => j.batchId === g.batchId);
    const targets = js.flatMap((j) => j.targets);
    const status = rollupStatus(targets.map((t) => t.status));
    // Mỗi gian một chip, gom trạng thái "xấu nhất" của gian đó trong đợt.
    const perChannel = new Map<string, string>();
    const rank = (st: string) => ["FAILED", "RUNNING", "QUEUED", "PENDING", "PENDING_REVIEW", "LISTED"].indexOf(st);
    for (const t of targets) {
      const cur = perChannel.get(t.channelId);
      if (cur === undefined || rank(t.status) < rank(cur)) perChannel.set(t.channelId, t.status);
    }
    return {
      id: g.batchId,
      createdAt: g.createdAt,
      sourceType: js[0]?.sourceType ?? "CHANNEL",
      productCount: js.length,
      firstTitle: js[0]?.sourceTitle ?? "",
      firstImageUrl: js[0]?.sourceImageUrl ?? null,
      channelCount: perChannel.size,
      targets: [...perChannel.entries()].map(([channelId, st]) => ({
        status: st,
        shopName: byId.get(channelId)?.shopName ?? "?",
        channelName: byId.get(channelId)?.channelName ?? "OFFLINE",
      })),
      status,
    };
  });
  return { items, total: totalRow[0]?.n ?? 0, page, pageSize };
}

interface BatchSubmitResult {
  queued: number;
  skipped: { jobId: string; targetId: string; shopName: string; missing: string[] }[];
  batch: BatchView;
}

export async function submitBatch(ownerId: string, batchId: string, opts: SubmitOptions = {}): Promise<BatchSubmitResult> {
  const jobs = await prisma.listingCopyJob.findMany({ where: { userId: ownerId, batchId }, select: { id: true } });
  if (jobs.length === 0) throw new ListingCopyError("Không tìm thấy đợt sao chép.", 404);
  let queued = 0;
  const skipped: BatchSubmitResult["skipped"] = [];
  for (const j of jobs) {
    try {
      const r: SubmitResult = await submitJob(ownerId, j.id, opts);
      queued += r.queued;
      skipped.push(...r.skipped.map((s) => ({ jobId: j.id, ...s })));
    } catch (err) {
      // Job không có gian nào đủ điều kiện → submitJob ném; coi như bỏ qua cả job.
      if (!(err instanceof ListingCopyError)) throw err;
    }
  }
  if (queued === 0) throw new ListingCopyError("Chưa sản phẩm nào đủ điều kiện đăng — điền các ô còn thiếu trước.");
  return { queued, skipped, batch: await getBatch(ownerId, batchId) };
}

/** Áp cấu hình gian `targetId` cho mọi gian cùng channel trong đợt còn chờ/lỗi. Trả số gian đã áp. */
export async function applyTargetToBatch(ownerId: string, batchId: string, targetId: string): Promise<number> {
  const src = await prisma.listingCopyTarget.findFirst({
    where: { id: targetId, job: { userId: ownerId, batchId } },
  });
  if (!src) throw new ListingCopyError("Không tìm thấy gian mẫu trong đợt.", 404);
  const others = await prisma.listingCopyTarget.findMany({
    where: {
      id: { not: src.id },
      channelId: src.channelId,
      status: { in: ["PENDING", "FAILED"] },
      job: { userId: ownerId, batchId },
    },
    include: { job: { select: { source: true } } },
  });
  for (const t of others) {
    await prisma.listingCopyTarget.update({
      where: { id: t.id },
      data: {
        categoryId: src.categoryId,
        categoryName: src.categoryName,
        categoryConfidence: null,
        attributes: json(src.attributes),
        brandId: src.brandId,
        brandName: src.brandName,
        logisticIds: json(src.logisticIds),
        weightGrams: src.weightGrams,
        dimensionsCm: src.dimensionsCm === null ? Prisma.JsonNull : json(src.dimensionsCm),
        priceAdjustPercent: src.priceAdjustPercent,
        stock: src.stock,
        ...(t.status === "FAILED" ? { status: "PENDING", error: null } : {}),
      },
    });
    const fresh = await prisma.listingCopyTarget.findUnique({ where: { id: t.id } });
    if (fresh) await reevaluate(fresh, asListing(t.job.source));
  }
  return others.length;
}
