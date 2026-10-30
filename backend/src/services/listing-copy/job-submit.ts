// ============================================================
// SAO CHÉP SẢN PHẨM — GỬI ĐĂNG một lượt: target đủ điều kiện → QUEUED + xếp việc
// listing.copy (worker xử lý ở job-worker.ts); target còn thiếu bị bỏ qua và báo.
// Nguồn "Tạo mới": ghi Tổng kho TRƯỚC khi vào hàng đợi (docs mục 24.3-1).
// ============================================================

import { prisma } from "../../lib/prisma";
import { enqueue, QUEUES, QueueUnavailableError } from "../../lib/queue";
import { ListingCopyError } from "./errors";
import { evaluateTarget } from "./job-edit";
import { processTarget, type ListingCopyJobData } from "./job-worker";
import { asListing, json, targetState } from "./json-fields";
import { ensureWarehouseProducts, type ManualSource } from "./manual";

/** Tùy chọn khi Đăng — ai bấm (ghi sổ kho) và có được ghi giá vốn không (nhân viên: không). */
export interface SubmitOptions {
  actorId?: string | null;
  allowCost?: boolean;
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
    const { missing } = await evaluateTarget(channel, listing, targetState(t));
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
    const r = await ensureWarehouseProducts(ownerId, opts.actorId ?? null, listing as ManualSource, {
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

async function enqueueTarget(targetId: string): Promise<void> {
  try {
    await enqueue<ListingCopyJobData>(QUEUES.listingCopy, { targetId }, { key: `listing-copy:${targetId}` });
  } catch (err) {
    if (!(err instanceof QueueUnavailableError)) throw err;
    // Dev local chưa có hàng đợi → chạy tại chỗ, không chặn phản hồi HTTP. Production KHÔNG
    // xử lý việc đăng trong tiến trình web (mất khi restart, không giới hạn song song).
    if (process.env.NODE_ENV === "production") {
      throw new ListingCopyError("Hàng đợi đăng chưa sẵn sàng — thử lại sau ít phút.", 503);
    }
    setImmediate(() => {
      processTarget(targetId).catch((e) => console.error(`[listing-copy] ${targetId} lỗi:`, (e as Error).message));
    });
  }
}
