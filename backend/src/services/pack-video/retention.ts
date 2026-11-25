// ============================================================
// VIDEO ĐÓNG HÀNG — ÁP LUẬT GIỮ / TỰ XÓA lên sổ (lát W5, 18/11/2026, thiết kế mục 19.4)
//
// Hai pha, mỗi pha đọc THEO LÔ THEO KHÓA, không quét bảng đơn, không gọi sàn:
//
//  1. GÁN HẠN — video STORED chưa có hạn (deleteAfter IS NULL): đọc 500 dòng theo khóa chính (recordedDate,
//     id) tiếp từ con trỏ lượt trước (maintenance_jobs), đọc đơn của chúng theo KHÓA CHÍNH, chạy luật thuần
//     (lib/pack-video-retention.ts) rồi ghi:
//       · hạn đã chắc → deleteAfter + deleteRule, MỘT lần (UPDATE có điều kiện "deleteAfter IS NULL");
//       · phải giữ    → holdReason (chỉ ghi khi lý do đổi);
//       · chưa đủ dữ liệu → không ghi gì, lượt sau xét lại.
//  2. TỚI HẠN — video STORED có deleteAfter ≤ hôm nay (chỉ mục một phần pack_videos_delete_after_idx): đọc
//     lại đơn, nếu giờ đã có dấu hiệu hoàn thì GỠ hạn (chặn xóa, ghi holdReason). Còn lại:
//       · CHẠY BÓNG (mặc định): KHÔNG xóa gì trên R2, không đổi trạng thái — dòng STORED có deleteAfter đã qua
//         chính là bản ghi "sẽ xóa" để đối chiếu với đơn thật; báo số qua nhật ký.
//       · XÓA THẬT (env PACK_VIDEO_DELETE_ENABLED=1): xóa tệp trên R2 → đánh dấu DELETED. Xóa tệp lỗi thì
//         giữ nguyên dòng, lượt sau thử lại.
//
// Không giữ trạng thái ở biến cấp tệp; con trỏ lượt gán hạn nằm ở database. Mọi lệnh gọi R2 nằm NGOÀI giao
// dịch database (I5). "Đã đối soát" không phải mốc xóa — luật không đọc cột đối soát nào.
// ============================================================

import { Prisma } from "@prisma/client";
import {
  PACK_VIDEO_JANITOR_BATCH,
  PACK_VIDEO_JANITOR_MAX_BATCHES,
  PACK_VIDEO_PENDING_STALE_DAYS,
  packVideoDeleteEnabled,
} from "../../config/pack-video";
import type { R2Storage } from "../../integrations/r2/client";
import { keyBelongsToOwner } from "../../lib/pack-video-key";
import {
  decideRetention,
  isSeenAnchoredRule,
  vnDateKey,
  type RetentionDecision,
  type RetentionOrder,
  type RetentionVideo,
} from "../../lib/pack-video-retention";
import { prisma } from "../../lib/prisma";
import { complaintDueOf } from "../../lib/return-complaint-due";
import { matchOrderByTrackingCode } from "./order-match";

export const ASSIGN_JOB_KEY = "pack-retention-assign";

/**
 * BẢN của bảng luật. Đổi luật (số ngày, thêm nhánh) thì đổi chuỗi này: lượt gán hạn kế tiếp GỠ mọi hạn đã ghi
 * theo bản cũ trên video còn lưu rồi tính lại từ đầu (hạn chỉ ghi một lần nên không tự đổi theo luật mới).
 * 2026-11-25: hết hạn + 3 ngày, sàn ngày quay + 7, trần 60 ngày (anh Trung chốt).
 */
export const RETENTION_RULE_VERSION = "2026-11-25";
export const RULE_VERSION_JOB_KEY = "pack-retention-rule-version";

export interface RetentionDeps {
  now?: () => Date;
  /** Ghi đè công tắc xóa thật (test). */
  deleteEnabled?: boolean;
  /** Chỉ cần khi xóa thật. */
  storage?: () => R2Storage;
  batchSize?: number;
  maxBatches?: number;
  /** Chỉ xét video của một chủ shop (test / chạy tay). Khi đặt, con trỏ lượt gán hạn không đọc / ghi. */
  onlyOwnerId?: string;
}

export interface AssignReport {
  scanned: number;
  assigned: Record<string, number>;
  held: Record<string, number>;
  waiting: number;
}

export interface DueReport {
  scanned: number;
  /** Chạy bóng: số video tới hạn mà SẼ xóa nếu bật xóa thật. */
  wouldDelete: number;
  deleted: number;
  /** Tới hạn nhưng đọc lại đơn thì phải GIỮ / CHỜ (đơn mới có dấu hiệu hoàn, kho báo hỏng…) → gỡ hạn, chặn xóa. */
  blockedAtDue: number;
  /** Tới hạn nhưng tính lại ra hạn MUỘN hơn (hạn khiếu nại của sàn dời) → ghi hạn mới. */
  postponed: number;
  /** Video chưa khớp đơn tới hạn mà khớp lại được tem (mã vận đơn cấp muộn) → gắn đơn, gỡ hạn, xét lại. */
  rematched: number;
  errors: number;
  shadow: boolean;
}

interface VideoRow {
  recordedDate: Date;
  id: string;
  ownerId: string;
  kind: string;
  orderId: string | null;
  objectKey: string;
  holdReason: string | null;
}

type DueRow = VideoRow & { deleteAfter: Date; deleteRule: string | null; trackingCode: string };

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/** Đọc đơn của một lô video theo KHÓA CHÍNH; trả map orderId → (chủ shop, cột luật cần). */
async function loadOrders(rows: VideoRow[]): Promise<Map<string, { ownerId: string; order: RetentionOrder }>> {
  const ids = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const orders = await prisma.order.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      shippingStatus: true,
      deliveredAt: true,
      stockShippedAt: true,
      returnStatus: true,
      returnRequestedAt: true,
      returnedAt: true,
      returnDeliveredAt: true,
      refundedAmount: true,
      platformRefundAmount: true,
      platformReturnStatus: true,
      returnSolution: true,
      returnTrackingCode: true,
      returnComplaintDueAt: true,
      returnComplaintDueProvisional: true,
      channel: { select: { userId: true, channelName: true } },
    },
  });
  return new Map(
    orders.map((o) => {
      // Hạn khiếu nại của người bán — CÙNG hàm với cột "Hạn khiếu nại" / "Thời hạn" trên web.
      const due = complaintDueOf({
        platform: o.channel.channelName,
        returnStatus: o.returnStatus,
        returnedAt: o.returnedAt,
        returnDeliveredAt: o.returnDeliveredAt,
        platformReturnStatus: o.platformReturnStatus,
        returnTrackingCode: o.returnTrackingCode,
        returnComplaintDueAt: o.returnComplaintDueAt,
        returnComplaintDueProvisional: o.returnComplaintDueProvisional,
      });
      return [
        o.id,
        {
          ownerId: o.channel.userId,
          order: {
            platform: o.channel.channelName,
            shippingStatus: o.shippingStatus,
            deliveredAt: o.deliveredAt,
            stockShippedAt: o.stockShippedAt,
            returnStatus: o.returnStatus,
            returnRequestedAt: o.returnRequestedAt,
            returnedAt: o.returnedAt,
            returnDeliveredAt: o.returnDeliveredAt,
            refundedAmount: Number(o.refundedAmount),
            platformRefundAmount: Number(o.platformRefundAmount),
            platformReturnStatus: o.platformReturnStatus,
            returnSolution: o.returnSolution,
            complaintDue:
              due.state === "DUE"
                ? { state: "DUE", dueAt: due.dueAt, provisional: due.source === "platform_provisional" }
                : { state: due.state },
          },
        },
      ];
    })
  );
}

/** Luật cho một dòng — đơn của chủ shop KHÁC (không thể xảy ra, nhưng chặn) coi như không đọc được. */
function decideFor(
  row: VideoRow,
  orders: Map<string, { ownerId: string; order: RetentionOrder }>,
  now: Date
): RetentionDecision {
  const found = row.orderId ? orders.get(row.orderId) : undefined;
  const order = found && found.ownerId === row.ownerId ? found.order : null;
  const video: RetentionVideo = {
    kind: row.kind === "UNBOX" ? "UNBOX" : "PACK",
    recordedDate: dateKey(row.recordedDate),
    orderId: row.orderId,
  };
  return decideRetention(video, order, now);
}

const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1);

/** Pha 1 — gán hạn cho video STORED chưa có hạn. */
export async function assignRetention(deps: RetentionDeps = {}): Promise<AssignReport> {
  const now = (deps.now ?? (() => new Date()))();
  const size = deps.batchSize ?? PACK_VIDEO_JANITOR_BATCH;
  const maxBatches = deps.maxBatches ?? PACK_VIDEO_JANITOR_MAX_BATCHES;
  const report: AssignReport = { scanned: 0, assigned: {}, held: {}, waiting: 0 };

  const owner = ownerCond(deps);
  const persist = !deps.onlyOwnerId;
  if (persist) await resetOnRuleChange();
  const job = persist
    ? await prisma.maintenanceJob.upsert({ where: { key: ASSIGN_JOB_KEY }, create: { key: ASSIGN_JOB_KEY }, update: {} })
    : null;
  // Con trỏ "YYYY-MM-DD|id". Tới cuối sổ thì quay về đầu ở lượt sau (dòng đang giữ / đang chờ được xét lại).
  let cursor = parseCursor(job?.cursor ?? null);

  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await prisma.$queryRaw<VideoRow[]>(Prisma.sql`
      SELECT v."recordedDate", v."id", v."ownerId", v."kind", v."orderId", v."objectKey", v."holdReason"
      FROM "pack_videos" v
      WHERE v."status" = 'STORED' AND v."deleteAfter" IS NULL ${owner}
        ${cursor ? Prisma.sql`AND (v."recordedDate", v."id") > (${cursor.date}::date, ${cursor.id})` : Prisma.empty}
      ORDER BY v."recordedDate", v."id"
      LIMIT ${size}`);
    if (rows.length === 0) {
      cursor = null;
      break;
    }
    report.scanned += rows.length;
    const orders = await loadOrders(rows);

    const set: { rd: string; id: string; d: string; r: string }[] = [];
    const hold: { rd: string; id: string; h: string }[] = [];
    for (const row of rows) {
      const d = decideFor(row, orders, now);
      if (d.kind === "DELETE_AFTER") {
        set.push({ rd: dateKey(row.recordedDate), id: row.id, d: d.deleteAfter, r: d.rule });
        bump(report.assigned, d.rule);
      } else if (d.kind === "HOLD") {
        if (row.holdReason !== d.reason) hold.push({ rd: dateKey(row.recordedDate), id: row.id, h: d.reason });
        bump(report.held, d.reason);
      } else {
        report.waiting += 1;
      }
    }
    // Hai câu UPDATE cho cả lô (không 500 câu lẻ). Điều kiện "deleteAfter IS NULL" = ghi hạn MỘT lần.
    if (set.length) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "pack_videos" v
        SET "deleteAfter" = x.d, "deleteRule" = x.r, "holdReason" = NULL
        FROM unnest(${set.map((s) => s.rd)}::date[], ${set.map((s) => s.id)}::text[],
                    ${set.map((s) => s.d)}::date[], ${set.map((s) => s.r)}::text[]) AS x(rd, id, d, r)
        WHERE v."recordedDate" = x.rd AND v."id" = x.id AND v."status" = 'STORED' AND v."deleteAfter" IS NULL`);
    }
    if (hold.length) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "pack_videos" v
        SET "holdReason" = x.h
        FROM unnest(${hold.map((s) => s.rd)}::date[], ${hold.map((s) => s.id)}::text[], ${hold.map((s) => s.h)}::text[])
          AS x(rd, id, h)
        WHERE v."recordedDate" = x.rd AND v."id" = x.id AND v."status" = 'STORED' AND v."deleteAfter" IS NULL`);
    }
    const last = rows[rows.length - 1];
    cursor = { date: dateKey(last.recordedDate), id: last.id };
    if (rows.length < size) {
      cursor = null;
      break;
    }
  }

  if (persist) {
    await prisma.maintenanceJob.update({
      where: { key: ASSIGN_JOB_KEY },
      data: {
        cursor: cursor ? `${cursor.date}|${cursor.id}` : null,
        processed: { increment: report.scanned },
        updatedAt: new Date(),
      },
    });
  }
  return report;
}

/**
 * Bảng luật đổi bản → gỡ hạn đã ghi theo bản cũ trên video CÒN LƯU (video đã xóa không đụng) + đưa con trỏ lượt
 * gán về đầu. Một giao dịch; chạy lại không sao. Trả số video được gỡ hạn (0 khi bản không đổi).
 */
export async function resetOnRuleChange(): Promise<number> {
  const job = await prisma.maintenanceJob.findUnique({ where: { key: RULE_VERSION_JOB_KEY }, select: { cursor: true } });
  if (job?.cursor === RETENTION_RULE_VERSION) return 0;
  const cleared = await prisma.$transaction(async (tx) => {
    const n = await tx.$executeRaw(Prisma.sql`
      UPDATE "pack_videos" SET "deleteAfter" = NULL, "deleteRule" = NULL
      WHERE "status" = 'STORED' AND "deleteAfter" IS NOT NULL`);
    await tx.maintenanceJob.upsert({
      where: { key: RULE_VERSION_JOB_KEY },
      create: { key: RULE_VERSION_JOB_KEY, cursor: RETENTION_RULE_VERSION, processed: n },
      update: { cursor: RETENTION_RULE_VERSION, processed: n, updatedAt: new Date() },
    });
    await tx.maintenanceJob.updateMany({ where: { key: ASSIGN_JOB_KEY }, data: { cursor: null } });
    return n;
  });
  console.log(`[pack-video-janitor] Bảng luật xóa đổi sang bản ${RETENTION_RULE_VERSION}: gỡ hạn cũ của ${cleared} video, tính lại`);
  return cleared;
}

function ownerCond(deps: RetentionDeps): Prisma.Sql {
  return deps.onlyOwnerId ? Prisma.sql`AND v."ownerId" = ${deps.onlyOwnerId}` : Prisma.empty;
}

function parseCursor(raw: string | null): { date: string; id: string } | null {
  const m = raw ? /^(\d{4}-\d{2}-\d{2})\|(.+)$/.exec(raw) : null;
  return m ? { date: m[1], id: m[2] } : null;
}

/** Pha 2 — video tới hạn: kiểm lại đơn, rồi chạy bóng (chỉ đếm) hoặc xóa thật. */
export async function processDueVideos(deps: RetentionDeps = {}): Promise<DueReport> {
  const now = (deps.now ?? (() => new Date()))();
  const today = vnDateKey(now);
  const size = deps.batchSize ?? PACK_VIDEO_JANITOR_BATCH;
  const maxBatches = deps.maxBatches ?? PACK_VIDEO_JANITOR_MAX_BATCHES;
  const shadow = !(deps.deleteEnabled ?? packVideoDeleteEnabled());
  const report: DueReport = {
    scanned: 0,
    wouldDelete: 0,
    deleted: 0,
    blockedAtDue: 0,
    postponed: 0,
    rematched: 0,
    errors: 0,
    shadow,
  };
  let storage: R2Storage | null = null;

  // Con trỏ trong lượt (chạy bóng thì dòng tới hạn không biến mất, phải đi tiếp chứ không đọc lại lô đầu).
  let after: { d: string; rd: string; id: string } | null = null;
  for (let batch = 0; batch < maxBatches; batch++) {
    const rows: DueRow[] = await prisma.$queryRaw<DueRow[]>(Prisma.sql`
      SELECT v."recordedDate", v."id", v."ownerId", v."kind", v."orderId", v."objectKey", v."holdReason",
             v."deleteAfter", v."deleteRule", v."trackingCode"
      FROM "pack_videos" v
      WHERE v."status" = 'STORED' AND v."deleteAfter" <= ${today}::date ${ownerCond(deps)}
        ${after ? Prisma.sql`AND (v."deleteAfter", v."recordedDate", v."id") > (${after.d}::date, ${after.rd}::date, ${after.id})` : Prisma.empty}
      ORDER BY v."deleteAfter", v."recordedDate", v."id"
      LIMIT ${size}`);
    if (rows.length === 0) break;
    report.scanned += rows.length;
    const orders = await loadOrders(rows);

    for (const row of rows) {
      // Video chưa khớp đơn: thử khớp lại tem MỘT lần trước khi xóa — Shopee cấp mã vận đơn muộn, đơn chưa đồng
      // bộ lúc quay (rủi ro X5). Khớp được thì gắn đơn + gỡ hạn, lượt gán sau tính hạn theo đơn.
      if (!row.orderId) {
        const match = await matchOrderByTrackingCode(row.ownerId, row.trackingCode, row.kind === "UNBOX" ? "UNBOX" : "PACK");
        if (match) {
          await prisma.packVideo.updateMany({
            where: { recordedDate: row.recordedDate, id: row.id, status: "STORED", orderId: null },
            data: {
              orderId: match.orderId,
              orderCode: match.orderCode,
              channelId: match.channelId,
              deleteAfter: null,
              deleteRule: null,
              holdReason: null,
            },
          });
          report.rematched += 1;
          continue;
        }
      }
      // ĐỌC LẠI đơn lúc tới hạn và tính lại theo luật hiện hành.
      const d = decideFor(row, orders, now);
      if (d.kind !== "DELETE_AFTER") {
        // Giờ phải GIỮ / CHỜ (đơn mới có dấu hiệu hoàn, kho báo hỏng, đơn không đọc được) → gỡ hạn, CHẶN xóa.
        await prisma.packVideo.updateMany({
          where: { recordedDate: row.recordedDate, id: row.id, status: "STORED" },
          data: { deleteAfter: null, deleteRule: null, holdReason: d.kind === "HOLD" ? d.reason : null },
        });
        report.blockedAtDue += 1;
        continue;
      }
      // Hạn tính lại MUỘN hơn hôm nay (hạn khiếu nại của sàn dời, đơn đổi nhánh luật) → ghi hạn mới, chưa xóa.
      // Luật tính từ "lúc thấy" (L2 / L3 / L5) tính lại luôn ra ngày muộn hơn: cùng luật đó thì KHÔNG dời nữa.
      if (d.deleteAfter > today && !(d.rule === row.deleteRule && isSeenAnchoredRule(d.rule))) {
        await prisma.packVideo.updateMany({
          where: { recordedDate: row.recordedDate, id: row.id, status: "STORED" },
          data: { deleteAfter: new Date(`${d.deleteAfter}T00:00:00.000Z`), deleteRule: d.rule },
        });
        report.postponed += 1;
        continue;
      }
      if (shadow) {
        report.wouldDelete += 1;
        continue;
      }
      if (!keyBelongsToOwner(row.objectKey, row.ownerId)) {
        report.errors += 1;
        continue;
      }
      try {
        storage ??= requireStorage(deps);
        await storage.remove(row.objectKey); // NGOÀI giao dịch database
        await prisma.packVideo.updateMany({
          where: { recordedDate: row.recordedDate, id: row.id, status: "STORED" },
          data: { status: "DELETED", deletedAt: now },
        });
        report.deleted += 1;
      } catch (err) {
        report.errors += 1;
        console.error(`[pack-video-janitor] Xóa tệp lỗi ${row.id}:`, (err as Error).message);
      }
    }
    const last: DueRow = rows[rows.length - 1];
    after = { d: dateKey(last.deleteAfter), rd: dateKey(last.recordedDate), id: last.id };
    if (rows.length < size) break;
  }
  return report;
}

export interface StalePendingReport {
  found: number;
  cleared: number;
  errors: number;
  shadow: boolean;
}

/**
 * Pha 3 — lượt tải lên DỞ DANG: dòng PENDING tạo quá PACK_VIDEO_PENDING_STALE_DAYS ngày (máy khách bỏ cuộc, xóa
 * app, đổi máy). Hủy lượt tải theo mảnh + xóa mảnh tệp + đánh dấu LOST — giờ quay KHÔNG tính (PENDING chưa từng
 * tính). Cùng công tắc với xóa thật: chạy bóng thì chỉ đếm.
 */
export async function sweepStalePending(deps: RetentionDeps = {}): Promise<StalePendingReport> {
  const now = (deps.now ?? (() => new Date()))();
  const shadow = !(deps.deleteEnabled ?? packVideoDeleteEnabled());
  const before = new Date(now.getTime() - PACK_VIDEO_PENDING_STALE_DAYS * 86_400_000);
  const report: StalePendingReport = { found: 0, cleared: 0, errors: 0, shadow };
  const rows = await prisma.packVideo.findMany({
    where: { status: "PENDING", createdAt: { lt: before }, ...(deps.onlyOwnerId ? { ownerId: deps.onlyOwnerId } : {}) },
    orderBy: [{ recordedDate: "asc" }, { id: "asc" }],
    take: deps.batchSize ?? PACK_VIDEO_JANITOR_BATCH,
    select: { recordedDate: true, id: true, ownerId: true, objectKey: true, uploadId: true },
  });
  report.found = rows.length;
  if (shadow || rows.length === 0) return report;
  const storage = requireStorage(deps);
  for (const row of rows) {
    if (!keyBelongsToOwner(row.objectKey, row.ownerId)) {
      report.errors += 1;
      continue;
    }
    try {
      if (row.uploadId) await storage.abortMultipart(row.objectKey, row.uploadId).catch(() => {});
      await storage.remove(row.objectKey); // NGOÀI giao dịch database
      await prisma.packVideo.updateMany({
        where: { recordedDate: row.recordedDate, id: row.id, status: "PENDING" },
        data: { status: "LOST", uploadId: null, deletedAt: now, deleteRule: "STALE_UPLOAD" },
      });
      report.cleared += 1;
    } catch (err) {
      report.errors += 1;
      console.error(`[pack-video-janitor] Dọn lượt tải dở lỗi ${row.id}:`, (err as Error).message);
    }
  }
  return report;
}

function requireStorage(deps: RetentionDeps): R2Storage {
  if (!deps.storage) throw new Error("Bật xóa thật mà không có kho R2");
  return deps.storage();
}
