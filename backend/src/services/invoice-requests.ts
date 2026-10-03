// ============================================================
// YÊU CẦU PHÁT HÀNH HÓA ĐƠN BẤM TAY — hóa đơn bước 5, lát 9 (03/10/2026).
// Thiết kế: docs/HANG-DOI-BEN.md mục 4.6 B + Q.
//
//   Web (bấm Xuất n đơn):  MỘT giao dịch ghi n dòng invoice_requests chung batchId
//                          + đặt làn của shop có mặt → commit → gửi tín hiệu
//                          invoice.issue(shop) → trả lời ngay. KHÔNG gọi nhà cung cấp.
//   Worker (làn của shop): runIssueRequestsForShop — làm lần lượt các dòng PENDING
//                          tới hạn, cũ trước, qua đúng lõi issueInvoiceForOrder.
//   Giao diện:             hỏi tiến độ theo batchId (getBatchProgress).
//
// Nguồn sự thật là BẢNG: tín hiệu pg-boss chỉ để worker chạy ngay; mất tín hiệu thì
// lưới quét của workers/invoice-lanes.ts nhặt (mặc định 5 giây).
//
// Kết cục một yêu cầu:
//   · phát hành được                     → DONE, kèm resultLogId
//   · đơn đã có hóa đơn từ trước          → DONE, errorCode ALREADY_ISSUED
//   · chưa rõ kết quả / đang có lượt chờ  → DONE, errorCode OUTCOME_UNKNOWN (vòng quét lát 6b lo tiếp)
//   · lỗi riêng đơn                       → FAILED kèm lý do, làm tiếp đơn sau
//   · lỗi TẠM của nhà cung cấp            → dừng lượt; MỌI yêu cầu đang chờ của shop tính
//                                           một lượt, hẹn lại sau 1 phút; đủ 3 lượt thì FAILED
//   · lỗi tầm TÀI KHOẢN                   → FAILED tờ đó + cả phần còn lại với cùng lý do
//                                           (đơn nào cũng sẽ lỗi y hệt, không đốt từng tờ)
// ============================================================

import { randomUUID } from "node:crypto";

import { InvoiceLogStatus, type Prisma, ShippingStatus } from "@prisma/client";

import { issueInvoiceForOrder } from "../integrations/invoice/issue-order";
import { OUTCOME_UNKNOWN_CODE } from "../integrations/invoice/unknown-outcome";
import { prisma } from "../lib/prisma";
import { enqueue, isQueueReady, QUEUES } from "../lib/queue";
import { notify } from "./notifications";

/**
 * Trần một lần bấm = cỡ trang lớn nhất của Hàng chờ xuất (100 đơn/trang): giao diện
 * không tick được nhiều hơn một trang. Vượt thì route báo lỗi rõ, không cắt im lặng.
 */
export const BULK_MAX_ORDERS = 100;
/** Lỗi tạm: tổng số lượt trước khi đánh hỏng (docs 4.6 D — bằng các hàng đợi khác). */
export const REQUEST_MAX_ATTEMPTS = 3;
/** Lỗi tạm: hẹn lượt kế sau chừng này (docs 4.6 D). */
export const REQUEST_RETRY_MS = 60_000;
/**
 * Hết ngân sách một lượt mà còn yêu cầu → phần còn lại nghỉ chừng này rồi mới chạy
 * lượt kế (nhịp "lô 20, nghỉ 1 phút" anh Trung chốt 01/10, mục 3.8; bấm tay cũng
 * theo nhịp này). Đổi bằng INVOICE_REQUEST_BACKLOG_SECONDS.
 */
export const DEFAULT_REQUEST_BACKLOG_SECONDS = 60;
export function requestBacklogDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.INVOICE_REQUEST_BACKLOG_SECONDS);
  return (Number.isFinite(n) && n >= 0 && n <= 3600 ? n : DEFAULT_REQUEST_BACKLOG_SECONDS) * 1000;
}

/**
 * Yêu cầu mới ghi giờ tới hạn LÙI chừng này so với đồng hồ máy web. Máy web ghi, máy
 * worker đọc: hai đồng hồ lệch nhau vài mili-giây tới vài giây là chuyện thường (test
 * 03/10 trên một máy đã lệch 9 ms giữa Prisma và Node) — không lùi thì tín hiệu tới
 * worker thấy "chưa tới hạn", phải chờ lưới quét. 30 giây: em tự chọn, rộng hơn mọi
 * độ lệch hợp lý của máy có đồng bộ giờ.
 */
export const DUE_NOW_SKEW_MS = 30_000;

export const REQUEST_KIND_ISSUE = "ISSUE";
export const REQUEST_SOURCE_MANUAL = "MANUAL";
export const REQUEST_CODE_UNKNOWN = "OUTCOME_UNKNOWN";
export const REQUEST_CODE_ALREADY_ISSUED = "ALREADY_ISSUED";

export interface InvoiceIssueSignal {
  ownerId: string;
}

/**
 * Gửi tín hiệu "shop này có yêu cầu mới" cho worker. KHÔNG ném: hàng đợi chưa sẵn
 * sàng hay gửi lỗi thì lưới quét invoice_requests vẫn nhặt, chỉ chậm vài giây.
 */
export async function signalInvoiceLane(ownerId: string): Promise<boolean> {
  if (!isQueueReady()) return false;
  try {
    await enqueue<InvoiceIssueSignal>(QUEUES.invoiceIssue, { ownerId }, { key: ownerId });
    return true;
  } catch (err) {
    console.warn("[Invoice-requests] Chưa gửi được tín hiệu invoice.issue (lưới quét sẽ nhặt):", (err as Error).message);
    return false;
  }
}

export interface AcceptBulkInput {
  ownerId: string;
  /** Phạm vi gian của người bấm (channelScope(req)) — nhân viên chỉ xuất được đơn gian mình. */
  channelWhere: Prisma.ChannelWhereInput;
  orderCodes: string[];
  requestedById?: string | null;
}

export interface AcceptBulkResult {
  /** null = không đơn nào được nhận. */
  batchId: string | null;
  queued: number;
  /** Đơn không được nhận kèm lý do — trả ngay cho người bấm. */
  skipped: Array<{ orderCode: string; reason: string }>;
}

/**
 * NHẬN một lần bấm Xuất hàng loạt: lọc đơn không xuất được (ngoài phạm vi, đã hủy,
 * đã có hóa đơn, đang nằm trong lượt khác), ghi yêu cầu, gọi làn. Không gọi nhà cung cấp.
 */
export async function acceptBulkIssue(input: AcceptBulkInput): Promise<AcceptBulkResult> {
  const { ownerId } = input;
  const codes = [...new Set(input.orderCodes)];
  const orders = await prisma.order.findMany({
    where: { orderCode: { in: codes }, channel: input.channelWhere },
    select: {
      orderCode: true,
      shippingStatus: true,
      invoiceLogs: {
        where: { status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] }, adjustmentForLogId: null },
        select: { status: true, invoiceNo: true },
        take: 1,
      },
    },
  });
  const byCode = new Map(orders.map((o) => [o.orderCode, o]));
  const skipped: AcceptBulkResult["skipped"] = [];
  const eligible: string[] = [];
  for (const code of codes) {
    const o = byCode.get(code);
    if (!o) skipped.push({ orderCode: code, reason: "Không tìm thấy đơn trong phạm vi của bạn" });
    else if (o.shippingStatus === ShippingStatus.CANCELLED) skipped.push({ orderCode: code, reason: "Đơn đã hủy" });
    else if (o.invoiceLogs[0]?.status === InvoiceLogStatus.ISSUED)
      skipped.push({ orderCode: code, reason: `Đơn đã có hóa đơn số ${o.invoiceLogs[0].invoiceNo ?? "?"}` });
    else if (o.invoiceLogs[0]) skipped.push({ orderCode: code, reason: "Đơn đang có hóa đơn chờ kết quả" });
    else eligible.push(code);
  }
  if (eligible.length === 0) return { batchId: null, queued: 0, skipped };

  const batchId = randomUUID();
  const created = await prisma.$transaction(async (tx) => {
    // Shop đang có yêu cầu NGHỈ giữa hai lượt (hoặc chờ thử lại sau lỗi tạm) thì yêu
    // cầu mới xếp sau mốc đó — bấm thêm lô không phá được nhịp nghỉ.
    const resting = await tx.invoiceRequest.findFirst({
      where: { ownerId, kind: REQUEST_KIND_ISSUE, status: "PENDING", nextRetryAt: { gt: new Date() } },
      orderBy: { nextRetryAt: "desc" },
      select: { nextRetryAt: true },
    });
    // skipDuplicates = ON CONFLICT DO NOTHING: đơn đang có yêu cầu chờ (chỉ mục duy
    // nhất riêng phần invoice_requests_open_key) không sinh dòng thứ hai.
    const rows = await tx.invoiceRequest.createManyAndReturn({
      data: eligible.map((orderCode) => ({
        ownerId,
        kind: REQUEST_KIND_ISSUE,
        source: REQUEST_SOURCE_MANUAL,
        targetKey: orderCode,
        batchId,
        requestedById: input.requestedById ?? null,
        nextRetryAt: resting ? resting.nextRetryAt : new Date(Date.now() - DUE_NOW_SKEW_MS),
      })),
      skipDuplicates: true,
      select: { targetKey: true },
    });
    if (rows.length > 0) {
      // Làn phải có mặt thì worker mới thuê được (shop chưa từng bật tự phát hành
      // chưa có dòng làn). Không đụng nextRunAt: đó là lịch của TỰ PHÁT HÀNH; yêu cầu
      // bấm tay tới hạn theo nextRetryAt của chính nó.
      await tx.invoiceLane.upsert({ where: { ownerId }, create: { ownerId }, update: {} });
    }
    return rows;
  });
  const createdCodes = new Set(created.map((r) => r.targetKey));
  for (const code of eligible) {
    if (!createdCodes.has(code)) skipped.push({ orderCode: code, reason: "Đơn đang nằm trong một lượt xuất khác" });
  }
  if (created.length === 0) return { batchId: null, queued: 0, skipped };
  await signalInvoiceLane(ownerId);
  return { batchId, queued: created.length, skipped };
}

export interface BatchProgress {
  batchId: string;
  total: number;
  /** Chưa tới lượt (kể cả đang chờ thử lại sau lỗi tạm). */
  pending: number;
  /** Đã có hóa đơn (phát hành ở lượt này, hoặc đơn đã có hóa đơn từ trước). */
  issued: number;
  failed: number;
  /** Chưa rõ kết quả — vòng quét đang kiểm lại với nhà cung cấp. */
  checking: number;
  cancelled: number;
  /** Còn dòng chờ = lô còn chạy. */
  active: boolean;
  /** Vài dòng lỗi đầu để hiện ngay tại chỗ; đủ danh sách ở Lịch sử hóa đơn. */
  errors: Array<{ orderCode: string; error: string }>;
}

const PROGRESS_ERROR_SAMPLE = 5;

/** Tiến độ một lô — hai câu theo chỉ mục (ownerId, batchId). null = không có lô này. */
export async function getBatchProgress(ownerId: string, batchId: string): Promise<BatchProgress | null> {
  const groups = await prisma.invoiceRequest.groupBy({
    by: ["status", "errorCode"],
    where: { ownerId, batchId },
    _count: { _all: true },
  });
  if (groups.length === 0) return null;
  const p: BatchProgress = {
    batchId,
    total: 0,
    pending: 0,
    issued: 0,
    failed: 0,
    checking: 0,
    cancelled: 0,
    active: false,
    errors: [],
  };
  for (const g of groups) {
    const n = g._count._all;
    p.total += n;
    if (g.status === "PENDING") p.pending += n;
    else if (g.status === "FAILED") p.failed += n;
    else if (g.status === "CANCELLED") p.cancelled += n;
    else if (g.errorCode === REQUEST_CODE_UNKNOWN) p.checking += n;
    else p.issued += n;
  }
  p.active = p.pending > 0;
  if (p.failed > 0) {
    const rows = await prisma.invoiceRequest.findMany({
      where: { ownerId, batchId, status: "FAILED" },
      orderBy: { finishedAt: "asc" },
      take: PROGRESS_ERROR_SAMPLE,
      select: { targetKey: true, error: true },
    });
    p.errors = rows.map((r) => ({ orderCode: r.targetKey, error: r.error ?? "Nhà cung cấp từ chối phát hành" }));
  }
  return p;
}

/** Lô đang chạy mới nhất của shop (để quay lại trang vẫn thấy tiến độ); null = không có. */
export async function findActiveBatchId(ownerId: string): Promise<string | null> {
  const row = await prisma.invoiceRequest.findFirst({
    where: { ownerId, kind: REQUEST_KIND_ISSUE, status: "PENDING", batchId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { batchId: true },
  });
  return row?.batchId ?? null;
}

/** Trong các mã đơn này, đơn nào đang có yêu cầu chờ (để Hàng chờ ghi "Đang xuất"). */
export async function openIssueRequestCodes(ownerId: string, orderCodes: string[]): Promise<Set<string>> {
  if (orderCodes.length === 0) return new Set();
  const rows = await prisma.invoiceRequest.findMany({
    where: { ownerId, kind: REQUEST_KIND_ISSUE, status: "PENDING", targetKey: { in: orderCodes } },
    select: { targetKey: true },
  });
  return new Set(rows.map((r) => r.targetKey));
}

/**
 * "Dừng phần còn lại": các yêu cầu CHƯA chạy của lô chuyển sang CANCELLED. Tờ đang
 * gọi dở nhà cung cấp vẫn hoàn tất (hóa đơn đã phát hành không xóa được). Trả số dòng đã dừng.
 */
export async function cancelBatch(ownerId: string, batchId: string): Promise<number> {
  const r = await prisma.invoiceRequest.updateMany({
    where: { ownerId, batchId, status: "PENDING" },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
  return r.count;
}

// ---------- Phía worker ----------

export type RequestRunOutcome = "IDLE" | "DONE" | "BACKLOG" | "TRANSIENT" | "ABORTED";

export interface RequestRunResult {
  /**
   *   IDLE      không có yêu cầu tới hạn;
   *   DONE      đã đi hết các yêu cầu lấy được;
   *   BACKLOG   hết ngân sách của lượt (có thể còn) hoặc bị dừng giữa chừng;
   *   TRANSIENT dừng vì lỗi tạm của nhà cung cấp;
   *   ABORTED   dừng vì lỗi tầm tài khoản — phần còn lại đã bị đánh hỏng cùng lý do.
   */
  outcome: RequestRunOutcome;
  /** Số yêu cầu đã đụng tới (kể cả dòng vừa bị khách dừng). */
  processed: number;
  issued: number;
  failed: number;
  interrupted: boolean;
}

export interface RequestRunOptions {
  /** Số tờ tối đa của lượt này. */
  budget: number;
  /** Hỏi TRƯỚC MỖI TỜ; true = dừng lượt (tiến trình đang tắt / mất làn). */
  shouldStop?: () => boolean | Promise<boolean>;
  now?: Date;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Đóng một yêu cầu — chỉ khi nó còn PENDING (khách vừa bấm Dừng thì thôi). */
async function finishRequest(
  id: string,
  data: { status: "DONE" | "FAILED"; resultLogId?: string | null; errorCode?: string | null; error?: string | null }
): Promise<void> {
  await prisma.invoiceRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { ...data, attempts: { increment: 1 }, finishedAt: new Date() },
  });
}

/**
 * MỘT LƯỢT yêu cầu bấm tay của MỘT SHOP. Nơi gọi (làn của shop) bảo đảm một shop chỉ
 * có một lượt chạy tại một thời điểm. Không ném lỗi nghiệp vụ; lỗi database ném ra.
 */
export async function runIssueRequestsForShop(ownerId: string, opts: RequestRunOptions): Promise<RequestRunResult> {
  const now = opts.now ?? new Date();
  const due = await prisma.invoiceRequest.findMany({
    where: { ownerId, kind: REQUEST_KIND_ISSUE, status: "PENDING", nextRetryAt: { lte: now } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: opts.budget,
    select: { id: true, targetKey: true, batchId: true },
  });
  const result: RequestRunResult = { outcome: "IDLE", processed: 0, issued: 0, failed: 0, interrupted: false };
  if (due.length === 0) return result;

  const batches = new Set<string>();
  let transient = false;
  let aborted = false;
  for (const [i, reqRow] of due.entries()) {
    if (opts.shouldStop && (await opts.shouldStop())) {
      result.interrupted = true;
      break;
    }
    // Khách bấm "Dừng phần còn lại" sau khi lượt này đã lấy danh sách → bỏ qua dòng đó.
    const still = await prisma.invoiceRequest.findUnique({ where: { id: reqRow.id }, select: { status: true } });
    if (still?.status !== "PENDING") continue;
    result.processed += 1;
    if (reqRow.batchId) batches.add(reqRow.batchId);

    // TUẦN TỰ — nhà cung cấp cấp số hóa đơn liên tục theo ký hiệu.
    const r = await issueInvoiceForOrder(ownerId, { userId: ownerId }, reqRow.targetKey);
    const pauseMs = i < due.length - 1 ? (r.pauseBeforeNextMs ?? 0) : 0;

    if (r.ok) {
      result.issued += 1;
      await finishRequest(reqRow.id, { status: "DONE", resultLogId: r.log?.id ?? null });
    } else if (r.conflict === "ISSUED") {
      result.issued += 1;
      await finishRequest(reqRow.id, { status: "DONE", errorCode: REQUEST_CODE_ALREADY_ISSUED, error: r.error ?? null });
    } else if (r.conflict === "PENDING" || r.errorCode === OUTCOME_UNKNOWN_CODE) {
      // Dòng InvoiceLog đang chờ là vé của đơn; vòng quét lát 6b tra lại rồi nối số
      // hoặc trả đơn về Hàng chờ. Yêu cầu này xong phần của nó.
      await finishRequest(reqRow.id, {
        status: "DONE",
        resultLogId: r.log?.id ?? null,
        errorCode: REQUEST_CODE_UNKNOWN,
        error: r.error ?? null,
      });
    } else if (r.errorScope === "TRANSIENT") {
      transient = true;
      const reason = r.error ?? "Nhà cung cấp hóa đơn đang trục trặc";
      // Nhà cung cấp đang trục trặc thì đơn nào cũng vậy: cả phần đang chờ tính một lượt.
      await prisma.invoiceRequest.updateMany({
        where: { ownerId, kind: REQUEST_KIND_ISSUE, status: "PENDING", nextRetryAt: { lte: now } },
        data: { attempts: { increment: 1 }, nextRetryAt: new Date(Date.now() + REQUEST_RETRY_MS), errorCode: r.errorCode ?? null, error: reason },
      });
      const exhausted = await prisma.invoiceRequest.findMany({
        where: { ownerId, kind: REQUEST_KIND_ISSUE, status: "PENDING", attempts: { gte: REQUEST_MAX_ATTEMPTS } },
        select: { id: true, batchId: true },
      });
      if (exhausted.length > 0) {
        await prisma.invoiceRequest.updateMany({
          where: { id: { in: exhausted.map((e) => e.id) }, status: "PENDING" },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            error: `${reason} Đã thử ${REQUEST_MAX_ATTEMPTS} lượt — tick lại đơn để xuất khi nhà cung cấp ổn định.`,
          },
        });
        result.failed += exhausted.length;
        for (const e of exhausted) if (e.batchId) batches.add(e.batchId);
      }
      break;
    } else {
      result.failed += 1;
      await finishRequest(reqRow.id, { status: "FAILED", resultLogId: r.log?.id ?? null, errorCode: r.errorCode ?? null, error: r.error ?? "Nhà cung cấp từ chối phát hành" });
      if (r.errorScope === "ACCOUNT") {
        aborted = true;
        const rest = await prisma.invoiceRequest.findMany({
          where: { ownerId, kind: REQUEST_KIND_ISSUE, status: "PENDING" },
          select: { id: true, batchId: true },
        });
        if (rest.length > 0) {
          await prisma.invoiceRequest.updateMany({
            where: { id: { in: rest.map((e) => e.id) }, status: "PENDING" },
            data: { status: "FAILED", finishedAt: new Date(), errorCode: r.errorCode ?? null, error: r.error ?? "Nhà cung cấp từ chối phát hành" },
          });
          result.failed += rest.length;
          for (const e of rest) if (e.batchId) batches.add(e.batchId);
        }
        break;
      }
    }
    if (pauseMs > 0) await sleep(pauseMs);
  }

  result.outcome = transient
    ? "TRANSIENT"
    : aborted
      ? "ABORTED"
      : result.interrupted || due.length >= opts.budget
        ? "BACKLOG"
        : "DONE";
  if (result.outcome === "BACKLOG" && !result.interrupted) {
    // Còn yêu cầu: cả phần còn lại nghỉ rồi mới tới lượt kế.
    await prisma.invoiceRequest.updateMany({
      where: { ownerId, kind: REQUEST_KIND_ISSUE, status: "PENDING", nextRetryAt: { lte: new Date() } },
      data: { nextRetryAt: new Date(Date.now() + requestBacklogDelayMs()) },
    });
  }
  console.log(
    `[Invoice-requests] Shop ${ownerId}: ${result.processed} yêu cầu bấm tay — phát hành ${result.issued}` +
      (result.failed > 0 ? `, ${result.failed} lỗi` : "") +
      (transient ? " — nhà cung cấp lỗi tạm, hẹn thử lại" : "") +
      (aborted ? " — lỗi tài khoản, phần còn lại đánh hỏng cùng lý do" : "") +
      (result.interrupted ? " — dừng giữa chừng, phần còn lại để lượt sau" : "")
  );
  for (const batchId of batches) await notifyIfBatchFinished(ownerId, batchId);
  return result;
}

/** Lô vừa hết dòng chờ → MỘT chuông tổng kết (chủ shop có thể đã rời trang). */
async function notifyIfBatchFinished(ownerId: string, batchId: string): Promise<void> {
  const p = await getBatchProgress(ownerId, batchId);
  if (!p || p.active) return;
  const parts = [
    p.failed > 0 ? `${p.failed} đơn lỗi` : null,
    p.checking > 0 ? `${p.checking} tờ đang kiểm lại với nhà cung cấp` : null,
    p.cancelled > 0 ? `${p.cancelled} đơn đã dừng` : null,
  ].filter(Boolean);
  await notify(ownerId, {
    type: "INVOICE_BULK_DONE",
    title: `Đã xuất ${p.issued}/${p.total} hóa đơn`,
    body:
      parts.length > 0
        ? `Còn lại: ${parts.join(", ")}. Xem lý do từng đơn tại Lịch sử hóa đơn.`
        : "Xem và tải PDF tại Lịch sử & Báo cáo thuế.",
    link: "/invoicing/history",
  });
}
