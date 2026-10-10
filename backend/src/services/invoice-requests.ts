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

import { InvoiceLogStatus, Prisma, ShippingStatus } from "@prisma/client";

import {
  decideScopeFromPlatformReturn,
  issueAdjustmentForOrder,
  PLATFORM_RETURN_DONE_STATUSES,
  type AdjustmentScope,
} from "../integrations/invoice/adjust-order";
import { isPublishAllowed } from "../integrations/invoice/misa-safety";
import { AWAITING_SIGNATURE_CODE, isDeferredAtProvider } from "../integrations/invoice/draft-signing";
import { issueInvoiceForOrder, type IssueOrderResult } from "../integrations/invoice/issue-order";
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
/** Điều chỉnh giảm một hóa đơn đã phát hành (lát 10): targetKey = mã dòng nhật ký hóa đơn gốc. */
export const REQUEST_KIND_ADJUST = "ADJUST";
export const REQUEST_SOURCE_MANUAL = "MANUAL";
/** Điều chỉnh TỰ ĐỘNG khi sàn chốt hoàn (lát 11). */
export const REQUEST_SOURCE_AUTO_RETURN = "AUTO_RETURN";
/**
 * Điều chỉnh tự động chưa làm được vì sàn CHƯA báo số tiền / dòng hàng hoàn, hoặc nhà
 * cung cấp lỗi tạm: thử lại sau chừng này, tối đa AUTO_ADJUST_MAX_AGE_MS kể từ lúc sàn
 * chốt hoàn (hai số anh Trung nhận ở mục 4.6 D: 60 phút, 7 ngày).
 */
export const AUTO_ADJUST_RETRY_MS = 60 * 60_000;
export const AUTO_ADJUST_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/**
 * Yêu cầu tự động được ghi TRƯỚC lượt cập nhật đơn và GIỮ CHỖ chừng này; đồng bộ hoàn
 * ghi xong đơn + số lượng trả thì thả cho chạy ngay. Tiến trình chết giữa chừng thì
 * yêu cầu tự tới hạn sau mốc này — đủ lâu để lượt đồng bộ kế ghi nốt số lượng trả
 * (em tự chọn 10 phút).
 */
export const AUTO_ADJUST_HOLD_MS = 10 * 60_000;
/** Làn chạy tới mà đơn chưa mang trạng thái "hoàn đã chốt" (lượt ghi đơn chưa xong) → xem lại sau 1 phút. */
export const AUTO_ADJUST_NOT_READY_MS = 60_000;
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
  /** Tờ nháp đã lập trên web nhà cung cấp, chờ chủ shop ký theo lô (lát T1 tenant). */
  awaiting: number;
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
    awaiting: 0,
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
    else if (g.errorCode === AWAITING_SIGNATURE_CODE) p.awaiting += n;
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

// ---------- Yêu cầu ĐƠN LẺ: xuất một đơn theo mã, điều chỉnh tay (lát 10) ----------

/** Phạm vi điều chỉnh ở dạng ghi được vào cột JSON (Map → object thường). */
type StoredAdjustScope = { kind: "FULL" } | { kind: "AMOUNT"; amount: number } | { kind: "ITEMS"; bySku: Record<string, number> };

export function encodeAdjustScope(scope: AdjustmentScope): StoredAdjustScope {
  return scope.kind === "ITEMS" ? { kind: "ITEMS", bySku: Object.fromEntries(scope.bySku) } : scope;
}
export function decodeAdjustScope(raw: unknown): AdjustmentScope {
  const s = (raw ?? {}) as Partial<StoredAdjustScope> & { bySku?: Record<string, number>; amount?: number };
  if (s.kind === "ITEMS" && s.bySku) return { kind: "ITEMS", bySku: new Map(Object.entries(s.bySku).map(([k, v]) => [k, Number(v)])) };
  if (s.kind === "AMOUNT" && typeof s.amount === "number") return { kind: "AMOUNT", amount: s.amount };
  return { kind: "FULL" };
}

/** Kết quả chi tiết làn ghi lại cho nơi đang chờ (cột params, khóa `result`). */
export interface StoredRequestResult {
  httpStatus: number;
  error?: string;
  code?: string;
  reason?: string;
  suggestion?: string;
  /** Tờ nháp chờ chủ shop ký trên web nhà cung cấp (lát T1 tenant) — không phải lỗi. */
  awaitingSignature?: boolean;
  /** Câu cho người bấm khi 202 (chờ ký / chờ số). */
  message?: string;
}

export interface SingleRequestInput {
  ownerId: string;
  kind: typeof REQUEST_KIND_ISSUE | typeof REQUEST_KIND_ADJUST;
  /** ISSUE: mã đơn. ADJUST: mã dòng nhật ký của hóa đơn gốc. */
  targetKey: string;
  /** ADJUST: { reason, scope } (scope đã qua encodeAdjustScope). */
  params?: Prisma.InputJsonObject;
  requestedById?: string | null;
}

/**
 * Ghi MỘT yêu cầu đơn lẻ (không thuộc lô nào) rồi gọi làn của shop. Trả null khi
 * đơn / hóa đơn đó đang có yêu cầu chờ (chỉ mục duy nhất riêng phần).
 */
export async function submitSingleRequest(input: SingleRequestInput): Promise<{ id: string } | null> {
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (input.kind === REQUEST_KIND_ADJUST) {
        // Chủ shop bấm điều chỉnh TAY trong lúc yêu cầu TỰ ĐỘNG của chính hóa đơn này còn
        // chờ (sàn chưa báo số, có thể chờ tới 7 ngày): bấm tay thắng, yêu cầu tự động
        // nhường chỗ — không thì chỉ mục duy nhất chặn người bấm suốt thời gian đó.
        await tx.invoiceRequest.updateMany({
          where: {
            ownerId: input.ownerId,
            kind: REQUEST_KIND_ADJUST,
            source: REQUEST_SOURCE_AUTO_RETURN,
            targetKey: input.targetKey,
            status: "PENDING",
          },
          data: { status: "CANCELLED", finishedAt: new Date(), error: "Chủ shop lập điều chỉnh tay." },
        });
      }
      const created = await tx.invoiceRequest.create({
        data: {
          ownerId: input.ownerId,
          kind: input.kind,
          source: REQUEST_SOURCE_MANUAL,
          targetKey: input.targetKey,
          params: input.params,
          requestedById: input.requestedById ?? null,
          // Đơn lẻ là việc có người đang chờ ngay: tới hạn ngay, không xếp sau mốc nghỉ của lô.
          nextRetryAt: new Date(Date.now() - DUE_NOW_SKEW_MS),
        },
        select: { id: true },
      });
      await tx.invoiceLane.upsert({ where: { ownerId: input.ownerId }, create: { ownerId: input.ownerId }, update: {} });
      return created;
    });
    await signalInvoiceLane(input.ownerId);
    return row;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

export interface FinishedRequest {
  status: string;
  resultLogId: string | null;
  errorCode: string | null;
  error: string | null;
  result: StoredRequestResult | null;
}

const WAIT_POLL_MS = 400;

/**
 * CHỜ một yêu cầu đơn lẻ có kết cục, hỏi lại mỗi 0,4 giây (một câu theo khóa chính).
 * Hết `timeoutMs` mà chưa xong: đánh dấu "báo chuông khi xong" rồi trả null — nơi gọi
 * trả lời "đã nhận". Đánh dấu là một UPDATE có điều kiện: yêu cầu vừa xong đúng lúc
 * đó thì đọc lại và trả kết quả như thường, không ai bị bỏ rơi.
 */
export async function awaitRequest(ownerId: string, id: string, timeoutMs: number): Promise<FinishedRequest | null> {
  const read = async (): Promise<FinishedRequest | null> => {
    const row = await prisma.invoiceRequest.findFirst({
      where: { id, ownerId },
      select: { status: true, resultLogId: true, errorCode: true, error: true, params: true },
    });
    if (!row || row.status === "PENDING") return null;
    const result = ((row.params ?? {}) as { result?: StoredRequestResult }).result ?? null;
    return { status: row.status, resultLogId: row.resultLogId, errorCode: row.errorCode, error: row.error, result };
  };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const done = await read();
    if (done) return done;
    if (Date.now() >= deadline) break;
    await sleep(WAIT_POLL_MS);
  }
  const marked = await prisma.$executeRaw`
    UPDATE "invoice_requests"
    SET "params" = coalesce("params", '{}'::jsonb) || '{"notify":true}'::jsonb, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "id" = ${id} AND "ownerId" = ${ownerId} AND "status" = 'PENDING'`;
  return marked === 0 ? read() : null;
}

// ---------- Điều chỉnh TỰ ĐỘNG khi sàn chốt hoàn (lát 11) ----------

/**
 * Điểm vào DUY NHẤT của tự điều chỉnh — ba tệp returns-sync gọi hai lần quanh lượt
 * ghi đơn, đúng lần trạng thái hoàn CHUYỂN VÀO nhóm đã chốt:
 *   · "before" (TRƯỚC khi ghi đơn): chế độ queue ghi một dòng yêu cầu giữ chỗ. Ghi
 *     trước + chỉ mục duy nhất = tiến trình chết giữa chừng thì lượt đồng bộ sau thấy
 *     lại đúng lần chuyển trạng thái đó và ghi lại, không mất và không trùng.
 *   · "after" (SAU khi đã ghi đơn + số lượng trả): thả yêu cầu cho chạy ngay.
 * (Đường cũ bắn lệnh trong RAM đúng một lần — INVOICE_AUTO_ADJUST_MODE=legacy — đã
 * gỡ ở bước 6c, 10/10/2026.)
 * KHÔNG ném: tự điều chỉnh không được làm hỏng vòng đồng bộ hoàn.
 */
export async function autoAdjustOnPlatformReturn(ownerId: string, orderId: string, phase: "before" | "after"): Promise<void> {
  try {
    if (phase === "after") {
      // Chỉ thả dòng CHƯA chạy lượt nào (dòng đang chờ thử lại giữ nguyên lịch của nó).
      await prisma.$executeRaw`
        UPDATE "invoice_requests"
        SET "nextRetryAt" = (now() AT TIME ZONE 'UTC') - interval '30 seconds', "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE "ownerId" = ${ownerId} AND "kind" = ${REQUEST_KIND_ADJUST} AND "source" = ${REQUEST_SOURCE_AUTO_RETURN}
          AND "status" = 'PENDING' AND "attempts" = 0 AND "params"->>'orderId' = ${orderId}`;
      return;
    }
    if (!isPublishAllowed()) return;
    const cfg = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId: null },
      select: { autoAdjustEnabled: true },
    });
    if (!cfg?.autoAdjustEnabled) return;
    const original = await prisma.invoiceLog.findFirst({
      where: { ownerId, orderId, status: InvoiceLogStatus.ISSUED, adjustmentForLogId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!original) return; // đơn chưa từng xuất hóa đơn
    const adjusted = await prisma.invoiceLog.findFirst({
      where: { adjustmentForLogId: original.id, status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] } },
      select: { id: true },
    });
    if (adjusted) return; // đã có điều chỉnh đang chờ / đã phát hành
    await prisma.$transaction(async (tx) => {
      await tx.invoiceRequest.create({
        data: {
          ownerId,
          kind: REQUEST_KIND_ADJUST,
          source: REQUEST_SOURCE_AUTO_RETURN,
          targetKey: original.id,
          // Phạm vi KHÔNG ghi ở đây: làn quyết lúc chạy theo số sàn báo mới nhất.
          params: { auto: true, orderId },
          nextRetryAt: new Date(Date.now() + AUTO_ADJUST_HOLD_MS),
        },
      });
      await tx.invoiceLane.upsert({ where: { ownerId }, create: { ownerId }, update: {} });
    });
  } catch (err) {
    // Trùng chỉ mục duy nhất = yêu cầu cho hóa đơn này đang chờ sẵn (bấm tay, hoặc lượt đồng bộ trước).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    console.error(`[auto-adjust/sàn] Đơn ${orderId}: không ghi được yêu cầu điều chỉnh (${phase}) —`, (err as Error).message);
  }
}

type AutoAdjustStep =
  | { kind: "RESULT"; r: IssueOrderResult; orderCode: string }
  /** Chưa làm được, xem lại sau `ms`. */
  | { kind: "WAIT"; ms: number; note: string; orderCode: string }
  /** Không còn việc để làm (shop tắt công tắc, hóa đơn gốc không còn hiệu lực). */
  | { kind: "DROP"; note: string };

/** Một lượt của yêu cầu điều chỉnh tự động: kiểm lại điều kiện, quyết phạm vi theo số sàn báo, rồi lập. */
async function runAutoAdjust(ownerId: string, reqRow: { targetKey: string }): Promise<AutoAdjustStep> {
  const cfg = await prisma.invoiceConfig.findFirst({
    where: { ownerId, channelId: null },
    select: { autoAdjustEnabled: true },
  });
  if (!cfg?.autoAdjustEnabled) return { kind: "DROP", note: "Shop đã tắt tự động điều chỉnh khi hoàn." };
  const original = await prisma.invoiceLog.findFirst({
    where: { id: reqRow.targetKey, ownerId, status: InvoiceLogStatus.ISSUED, adjustmentForLogId: null },
    select: { id: true, orderId: true, orderCode: true, totalAmount: true },
  });
  if (!original?.orderId) return { kind: "DROP", note: "Hóa đơn gốc không còn ở trạng thái đã phát hành." };
  const order = await prisma.order.findUnique({ where: { id: original.orderId }, select: { platformReturnStatus: true } });
  if (!PLATFORM_RETURN_DONE_STATUSES.has(order?.platformReturnStatus ?? "")) {
    return { kind: "WAIT", ms: AUTO_ADJUST_NOT_READY_MS, note: "Chờ đồng bộ hoàn ghi xong trạng thái của đơn.", orderCode: original.orderCode };
  }
  const decided = await decideScopeFromPlatformReturn(original.orderId, Number(original.totalAmount));
  if (!decided) {
    return { kind: "WAIT", ms: AUTO_ADJUST_RETRY_MS, note: "Sàn chưa báo số tiền hoàn / dòng hàng trả.", orderCode: original.orderCode };
  }
  const r = await issueAdjustmentForOrder(ownerId, { userId: ownerId }, original.id, decided.reason, decided.scope);
  return { kind: "RESULT", r, orderCode: original.orderCode };
}

/** Tự điều chỉnh hỏng hẳn → MỘT chuông bảo chủ shop làm tay (nhãn "Cần điều chỉnh" vẫn còn ở Lịch sử). */
async function notifyAutoAdjustFailed(ownerId: string, orderCode: string, why: string): Promise<void> {
  await notify(ownerId, {
    type: "INVOICE_AUTO_ADJUST_FAILED",
    title: `Chưa tự lập được hóa đơn điều chỉnh cho đơn ${orderCode}`,
    body: `${why} Lập tay tại Lịch sử hóa đơn (dòng mang nhãn "Cần điều chỉnh").`,
    link: "/invoicing/history",
  });
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

/**
 * Đóng một yêu cầu — chỉ khi nó còn PENDING (khách vừa bấm Dừng thì thôi). Kết quả
 * chi tiết GỘP vào cột params bằng một câu UPDATE (jsonb ||) để không đè cờ "báo
 * chuông" mà nơi đang chờ có thể vừa ghi. Trả true = có người hết kiên nhẫn chờ,
 * cần báo chuông.
 */
async function finishRequest(
  id: string,
  data: { status: "DONE" | "FAILED"; resultLogId?: string | null; errorCode?: string | null; error?: string | null },
  r?: IssueOrderResult
): Promise<boolean> {
  const stored: StoredRequestResult | null = r
    ? {
        httpStatus: r.httpStatus,
        error: r.error,
        code: r.errorCode,
        reason: r.reason,
        suggestion: r.suggestion,
        awaitingSignature: r.awaitingSignature,
        message: r.message,
      }
    : null;
  const patch = JSON.stringify(stored ? { result: stored } : {});
  const rows = await prisma.$queryRaw<{ notify: boolean | null }[]>`
    UPDATE "invoice_requests"
    SET "status" = ${data.status},
        "resultLogId" = ${data.resultLogId ?? null},
        "errorCode" = ${data.errorCode ?? null},
        "error" = ${data.error ?? null},
        "attempts" = "attempts" + 1,
        "finishedAt" = (now() AT TIME ZONE 'UTC'),
        "updatedAt" = (now() AT TIME ZONE 'UTC'),
        "params" = coalesce("params", '{}'::jsonb) || ${patch}::jsonb
    WHERE "id" = ${id} AND "status" = 'PENDING'
    RETURNING ("params"->>'notify')::boolean AS "notify"`;
  return rows[0]?.notify === true;
}

/** Chuông cho yêu cầu đơn lẻ mà nơi chờ đã trả lời "đã nhận" trước khi có kết quả. */
async function notifySingleFinished(
  ownerId: string,
  reqRow: { kind: string; targetKey: string },
  r: IssueOrderResult
): Promise<void> {
  const adjust = reqRow.kind === REQUEST_KIND_ADJUST;
  const what = adjust ? "hóa đơn điều chỉnh" : `hóa đơn cho đơn ${reqRow.targetKey}`;
  if (r.awaitingSignature) {
    await notify(ownerId, {
      type: "INVOICE_SINGLE_DONE",
      title: `Đã lập tờ nháp ${what} — chờ bạn ký`,
      body: r.message ?? "Vào web nhà cung cấp hóa đơn, lọc Chưa phát hành và Ký & phát hành; Hubsell tự nhận số sau khi ký.",
      link: "/invoicing/history",
    });
    return;
  }
  await notify(ownerId, {
    type: "INVOICE_SINGLE_DONE",
    title: r.ok ? `Đã lập ${what}${r.log?.invoiceNo ? ` số ${r.log.invoiceNo}` : ""}` : `Chưa lập được ${what}`,
    body: r.ok ? "Xem và tải PDF tại Lịch sử & Báo cáo thuế." : (r.error ?? "Nhà cung cấp từ chối phát hành"),
    link: "/invoicing/history",
  });
}

/** Gọi đúng lõi theo loại yêu cầu. */
function runOneRequest(ownerId: string, reqRow: { kind: string; targetKey: string; params: unknown }): Promise<IssueOrderResult> {
  if (reqRow.kind === REQUEST_KIND_ADJUST) {
    const p = (reqRow.params ?? {}) as { reason?: string; scope?: unknown };
    return issueAdjustmentForOrder(ownerId, { userId: ownerId }, reqRow.targetKey, p.reason ?? "Khách trả hàng hoàn tiền", decodeAdjustScope(p.scope));
  }
  return issueInvoiceForOrder(ownerId, { userId: ownerId }, reqRow.targetKey);
}

/**
 * MỘT LƯỢT yêu cầu bấm tay của MỘT SHOP. Nơi gọi (làn của shop) bảo đảm một shop chỉ
 * có một lượt chạy tại một thời điểm. Không ném lỗi nghiệp vụ; lỗi database ném ra.
 */
export async function runIssueRequestsForShop(ownerId: string, opts: RequestRunOptions): Promise<RequestRunResult> {
  const now = opts.now ?? new Date();
  const due = await prisma.invoiceRequest.findMany({
    // Mọi loại yêu cầu (xuất, điều chỉnh) chung một hàng, cũ trước.
    where: { ownerId, status: "PENDING", nextRetryAt: { lte: now } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: opts.budget,
    select: { id: true, kind: true, source: true, targetKey: true, batchId: true, params: true, createdAt: true },
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
    // ĐIỀU CHỈNH TỰ ĐỘNG (lát 11): luật riêng — chưa đủ dữ kiện hay nhà cung cấp lỗi
    // tạm thì hẹn lại 60 phút tới tối đa 7 ngày; hỏng hẳn thì một chuông. Không kéo
    // theo yêu cầu bấm tay, và không bị yêu cầu bấm tay kéo theo.
    if (reqRow.source === REQUEST_SOURCE_AUTO_RETURN) {
      const step = await runAutoAdjust(ownerId, reqRow);
      if (step.kind === "DROP") {
        await prisma.invoiceRequest.updateMany({
          where: { id: reqRow.id, status: "PENDING" },
          data: { status: "CANCELLED", finishedAt: new Date(), error: step.note },
        });
        continue;
      }
      const tooOld = Date.now() - reqRow.createdAt.getTime() >= AUTO_ADJUST_MAX_AGE_MS;
      const retry = async (note: string, ms: number, errorCode: string | null): Promise<void> => {
        if (tooOld) {
          result.failed += 1;
          const why = `${note} Đã thử lại suốt 7 ngày kể từ khi sàn chốt hoàn.`;
          await prisma.invoiceRequest.updateMany({
            where: { id: reqRow.id, status: "PENDING" },
            data: { status: "FAILED", finishedAt: new Date(), attempts: { increment: 1 }, errorCode, error: why },
          });
          await notifyAutoAdjustFailed(ownerId, step.orderCode, why);
          return;
        }
        await prisma.invoiceRequest.updateMany({
          where: { id: reqRow.id, status: "PENDING" },
          data: { attempts: { increment: 1 }, nextRetryAt: new Date(Date.now() + ms), errorCode, error: note },
        });
      };
      if (step.kind === "WAIT") {
        await retry(step.note, step.ms, null);
        continue;
      }
      const ar = step.r;
      const gap = i < due.length - 1 ? (ar.pauseBeforeNextMs ?? 0) : 0;
      if (ar.ok) {
        result.issued += 1;
        await finishRequest(reqRow.id, { status: "DONE", resultLogId: ar.log?.id ?? null }, ar);
        console.log(`[auto-adjust/sàn] Đơn ${step.orderCode}: đã lập hóa đơn điều chỉnh số ${ar.log?.invoiceNo ?? "?"}`);
      } else if (isDeferredAtProvider(ar)) {
        // Tờ nháp điều chỉnh chờ chủ shop ký / chờ số: việc này xong phần của nó, vòng hỏi lo tiếp.
        await finishRequest(reqRow.id, { status: "DONE", resultLogId: ar.log?.id ?? null, errorCode: ar.errorCode ?? null, error: ar.message ?? null }, ar);
        console.log(`[auto-adjust/sàn] Đơn ${step.orderCode}: đã lập tờ nháp điều chỉnh, chờ chủ shop ký`);
      } else if (ar.errorCode === OUTCOME_UNKNOWN_CODE) {
        await finishRequest(reqRow.id, { status: "DONE", resultLogId: ar.log?.id ?? null, errorCode: REQUEST_CODE_UNKNOWN, error: ar.error ?? null }, ar);
      } else if (ar.httpStatus === 409 && !ar.errorCode) {
        // Hóa đơn gốc đã có điều chỉnh (chủ shop vừa làm tay) → việc này coi như xong.
        await finishRequest(reqRow.id, { status: "DONE", errorCode: REQUEST_CODE_ALREADY_ISSUED, error: ar.error ?? null }, ar);
      } else if (ar.errorScope === "TRANSIENT") {
        await retry(ar.error ?? "Nhà cung cấp hóa đơn đang trục trặc.", AUTO_ADJUST_RETRY_MS, ar.errorCode ?? null);
        // Nhà cung cấp đang trục trặc: dừng lượt, các yêu cầu khác để lượt sau.
        transient = true;
        break;
      } else {
        result.failed += 1;
        const why = ar.error ?? "Nhà cung cấp từ chối lập hóa đơn điều chỉnh.";
        await finishRequest(reqRow.id, { status: "FAILED", resultLogId: ar.log?.id ?? null, errorCode: ar.errorCode ?? null, error: why }, ar);
        console.error(`[auto-adjust/sàn] Đơn ${step.orderCode}: ${why}`);
        await notifyAutoAdjustFailed(ownerId, step.orderCode, why);
      }
      if (gap > 0) await sleep(gap);
      continue;
    }

    const r = await runOneRequest(ownerId, reqRow);
    const pauseMs = i < due.length - 1 ? (r.pauseBeforeNextMs ?? 0) : 0;
    /** Đơn lẻ = có người đang chờ câu trả lời ngay trên màn hình (lát 10). */
    const single = reqRow.batchId === null;
    let bell = false;

    if (r.ok) {
      result.issued += 1;
      bell = await finishRequest(reqRow.id, { status: "DONE", resultLogId: r.log?.id ?? null }, r);
    } else if (r.conflict === "ISSUED") {
      result.issued += 1;
      bell = await finishRequest(reqRow.id, { status: "DONE", errorCode: REQUEST_CODE_ALREADY_ISSUED, error: r.error ?? null }, r);
    } else if (isDeferredAtProvider(r)) {
      // Tờ nháp chờ chủ shop ký trên web nhà cung cấp / đã ký chờ số (lát T1 tenant): yêu
      // cầu xong phần của nó; vòng hỏi theo giờ nối số. Lô đếm riêng (BatchProgress.awaiting).
      bell = await finishRequest(
        reqRow.id,
        { status: "DONE", resultLogId: r.log?.id ?? null, errorCode: r.errorCode ?? null, error: r.message ?? null },
        r
      );
    } else if (r.conflict === "PENDING" || r.errorCode === OUTCOME_UNKNOWN_CODE) {
      // Dòng InvoiceLog đang chờ là vé của đơn; vòng quét lát 6b tra lại rồi nối số
      // hoặc trả đơn về Hàng chờ. Yêu cầu này xong phần của nó.
      bell = await finishRequest(
        reqRow.id,
        { status: "DONE", resultLogId: r.log?.id ?? null, errorCode: REQUEST_CODE_UNKNOWN, error: r.error ?? null },
        r
      );
    } else if (r.errorScope === "TRANSIENT") {
      transient = true;
      const reason = r.error ?? "Nhà cung cấp hóa đơn đang trục trặc";
      if (single) {
        // Đơn lẻ không tự thử lại: người bấm đang chờ, nhận lỗi ngay và tự bấm lại
        // (đúng hành vi trước lát 10). Lượt vẫn dừng vì nhà cung cấp đang trục trặc.
        result.failed += 1;
        bell = await finishRequest(reqRow.id, { status: "FAILED", resultLogId: r.log?.id ?? null, errorCode: r.errorCode ?? null, error: reason }, r);
        if (bell) await notifySingleFinished(ownerId, reqRow, r);
      }
      // Nhà cung cấp đang trục trặc thì đơn nào cũng vậy: cả phần đang chờ CỦA CÁC LÔ tính một lượt.
      await prisma.invoiceRequest.updateMany({
        where: { ownerId, batchId: { not: null }, status: "PENDING", nextRetryAt: { lte: now } },
        data: { attempts: { increment: 1 }, nextRetryAt: new Date(Date.now() + REQUEST_RETRY_MS), errorCode: r.errorCode ?? null, error: reason },
      });
      const exhausted = await prisma.invoiceRequest.findMany({
        // Chỉ yêu cầu của các lô: yêu cầu tự động có nhịp thử lại riêng (60 phút, 7 ngày).
        where: { ownerId, batchId: { not: null }, status: "PENDING", attempts: { gte: REQUEST_MAX_ATTEMPTS } },
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
      bell = await finishRequest(
        reqRow.id,
        { status: "FAILED", resultLogId: r.log?.id ?? null, errorCode: r.errorCode ?? null, error: r.error ?? "Nhà cung cấp từ chối phát hành" },
        r
      );
      if (r.errorScope === "ACCOUNT") {
        aborted = true;
        if (bell) await notifySingleFinished(ownerId, reqRow, r);
        const rest = await prisma.invoiceRequest.findMany({
          // Yêu cầu tự động không bị đánh hỏng theo: nó tự thử lại theo nhịp của nó.
          where: { ownerId, status: "PENDING", source: { not: REQUEST_SOURCE_AUTO_RETURN } },
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
    if (bell) await notifySingleFinished(ownerId, reqRow, r);
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
      where: { ownerId, status: "PENDING", nextRetryAt: { lte: new Date() } },
      data: { nextRetryAt: new Date(Date.now() + requestBacklogDelayMs()) },
    });
  }
  console.log(
    `[Invoice-requests] Shop ${ownerId}: ${result.processed} yêu cầu — phát hành ${result.issued}` +
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
    p.awaiting > 0 ? `${p.awaiting} tờ nháp chờ bạn ký trên web nhà cung cấp (ký theo lô, nên ký trong ngày)` : null,
    p.failed > 0 ? `${p.failed} đơn lỗi` : null,
    p.checking > 0 ? `${p.checking} tờ đang kiểm lại với nhà cung cấp` : null,
    p.cancelled > 0 ? `${p.cancelled} đơn đã dừng` : null,
  ].filter(Boolean);
  await notify(ownerId, {
    type: "INVOICE_BULK_DONE",
    title: p.awaiting > 0 ? `Đã lập ${p.issued + p.awaiting}/${p.total} hóa đơn` : `Đã xuất ${p.issued}/${p.total} hóa đơn`,
    body:
      parts.length > 0
        ? `Còn lại: ${parts.join(", ")}. Xem lý do từng đơn tại Lịch sử hóa đơn.`
        : "Xem và tải PDF tại Lịch sử & Báo cáo thuế.",
    link: "/invoicing/history",
  });
}
