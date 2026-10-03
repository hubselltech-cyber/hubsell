// ============================================================
// LÀN TỰ PHÁT HÀNH HÓA ĐƠN THEO SHOP — hóa đơn bước 5, lát 8 (03/10/2026).
// Thay vòng chung một cờ RAM của workers/invoice-auto-issue.ts khi INVOICE_MODE=lanes.
//
//   Lưới quét mỗi 30 giây:  shop bật tự phát hành, không ngắt mạch, tới giờ chạy
//                           (invoice_lanes.nextRunAt), chưa ai thuê → nhận tối đa
//                           INVOICE_LANE_CONCURRENCY shop cùng lúc mỗi worker.
//   Làn của một shop:       THUÊ làn bằng một UPDATE có điều kiện (hạn 300 giây)
//                           → runAutoIssueForShop (20 tờ, tuần tự, nghỉ theo bảng
//                           khả năng) → trước mỗi tờ kiểm làn còn của mình, gia hạn
//                           mỗi 30 giây → hẹn lượt kế rồi trả làn.
//   Hẹn lượt kế:            còn tồn 1 phút · hết 15 phút · lỗi tạm lùi 1 → 5 → 15 phút
//                           · ngắt mạch thì chờ chủ shop bấm Chạy lại (route đặt nextRunAt về ngay).
//   Dừng êm (SIGTERM):      thôi nhận shop mới; lượt đang chạy dừng sau tờ đang dở,
//                           hẹn lại NGAY để worker khác nhận, trả làn.
//
// Vì sao thuê ở database mà không khóa cố vấn như đẩy tồn: một tờ tệ nhất khoảng
// 242 giây (lát 6), một lượt 20 tờ có thể dài hàng chục phút — không giữ một giao
// dịch chừng đó. Vì sao hạn thuê 300 giây chứ không 120: gia hạn chỉ làm được GIỮA
// hai tờ, một tờ 242 giây mà hạn 120 là làn bị cướp giữa lúc đang gọi nhà cung cấp.
// Chỉ mục duy nhất của lát 2 vẫn là chốt cuối: hai tiến trình có lọt vào cùng một
// shop thì cũng không có hai hóa đơn cho một đơn.
//
// Cấu hình: INVOICE_LANE_CONCURRENCY (2), INVOICE_LANE_SWEEP_SECONDS (30),
// INVOICE_AUTO_ISSUE_MINUTES (15, nhịp khi shop hết đơn; "0" = tắt).
//
// LÁT 9 (03/10/2026) — YÊU CẦU BẤM TAY đi chung làn:
//   Mỗi lượt của một shop:  1. yêu cầu bấm tay tới hạn (invoice_requests), cũ trước
//                           2. phần còn lại của 20 tờ cho tự phát hành — chỉ khi làn
//                              tới giờ theo lịch (nextRunAt), shop bật công tắc,
//                              INVOICE_MODE=lanes.
//   Ai gọi lượt:            tín hiệu pg-boss invoice.issue (ngay sau khi chủ shop bấm)
//                           + lưới quét yêu cầu mỗi 5 giây (mất tín hiệu vẫn chạy).
//                           Hai đường này thuê làn KHÔNG xét nextRunAt: nextRunAt là
//                           lịch của tự phát hành; yêu cầu tới hạn theo nextRetryAt của nó.
//   Lưới quét yêu cầu chạy ở MỌI INVOICE_MODE (đường lui legacy của tự phát hành
//   không làm chết nút bấm tay). Ngắt mạch chỉ chặn phần tự động.
// Cấu hình thêm: INVOICE_REQUEST_SWEEP_SECONDS (5).
// ============================================================

import { hostname } from "node:os";
import { randomBytes } from "node:crypto";

import { invoiceLaneConcurrency, invoiceMode, invoiceRequestSweepSeconds } from "../lib/queue-config";
import { prisma } from "../lib/prisma";
import { QUEUES, registerWorker } from "../lib/queue";
import { isPublishAllowed } from "../integrations/invoice/misa-safety";
import {
  runIssueRequestsForShop,
  type InvoiceIssueSignal,
  type RequestRunOutcome,
} from "../services/invoice-requests";
import {
  AUTO_ISSUE_CONFIG_SELECT,
  autoIssueSkipReason,
  MAX_PER_OWNER_PER_RUN,
  runAutoIssueForShop,
  type AutoIssueOutcome,
} from "./invoice-auto-issue";

/** Hạn thuê làn — em tự chọn, bằng hạn thuê gian của đẩy tồn; xem đầu tệp. */
export const LANE_LEASE_MS = 300_000;
/** Gia hạn khi đã qua chừng này kể từ lần gia hạn trước (chỉ kiểm giữa hai tờ). */
export const LANE_RENEW_EVERY_MS = 30_000;
/** Còn tồn → lượt kế sau 1 phút (anh Trung chốt 01/10, mục 3.8). */
export const BACKLOG_DELAY_MS = 60_000;
/** Lỗi tạm của nhà cung cấp → lùi theo nấc, trần ở nấc cuối (em tự chọn). */
export const TRANSIENT_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const DEFAULT_IDLE_MINUTES = 15;
const DEFAULT_SWEEP_SECONDS = 30;

/** Định danh tiến trình này trong cột leasedBy — đổi được trong test. */
let workerId = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
export function setInvoiceLaneWorkerId(id: string): void {
  workerId = id;
}
export function invoiceLaneWorkerId(): string {
  return workerId;
}

let stopping = false;
const running = new Map<string, Promise<void>>();
let sweepTimer: NodeJS.Timeout | null = null;
let requestSweepTimer: NodeJS.Timeout | null = null;

/** Nhịp khi shop hết đơn — dùng lại INVOICE_AUTO_ISSUE_MINUTES của đường cũ. */
export function idleDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const minutes = Number(env.INVOICE_AUTO_ISSUE_MINUTES ?? DEFAULT_IDLE_MINUTES);
  const m = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES;
  return m * 60_000;
}

function sweepSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.INVOICE_LANE_SWEEP_SECONDS);
  return Number.isFinite(n) && n >= 5 ? n : DEFAULT_SWEEP_SECONDS;
}

/** Điều kiện "shop đang được phép tự phát hành" — dùng ở lưới quét và khi tạo làn. */
const ACTIVE_CONFIG = {
  channelId: null,
  autoIssueEnabled: true,
  autoIssuePausedAt: null,
  provider: "MISA",
} as const;

/**
 * Tạo dòng làn cho shop bật tự phát hành mà chưa có (bật công tắc lần đầu, hoặc
 * shop có từ trước lát 8). nextRunAt mặc định = ngay → lượt đầu trong một nhịp quét.
 */
export interface SweepOptions {
  /** Cho test: chỉ xét các shop này (database dev có shop thật, không được quét nhầm). */
  onlyOwnerIds?: string[];
}

export async function ensureInvoiceLanes(opts: SweepOptions = {}): Promise<number> {
  const missing = await prisma.invoiceConfig.findMany({
    where: {
      ...ACTIVE_CONFIG,
      owner: { invoiceLane: null },
      ...(opts.onlyOwnerIds ? { ownerId: { in: opts.onlyOwnerIds } } : {}),
    },
    select: { ownerId: true },
    take: 500,
  });
  if (missing.length === 0) return 0;
  const r = await prisma.invoiceLane.createMany({
    data: missing.map((m) => ({ ownerId: m.ownerId })),
    skipDuplicates: true,
  });
  return r.count;
}

/**
 * Thuê làn của một shop cho tiến trình `by`. Một câu UPDATE có điều kiện: chỉ
 * thành công khi làn rảnh (hoặc hạn thuê cũ đã qua) và đã tới giờ. Trả true = của mình.
 */
export async function claimInvoiceLane(
  ownerId: string,
  by: string = workerId,
  now = new Date(),
  /** ignoreSchedule = thuê cho YÊU CẦU BẤM TAY (lát 9): không xét lịch tự phát hành. */
  opts: { ignoreSchedule?: boolean } = {}
): Promise<boolean> {
  const r = await prisma.invoiceLane.updateMany({
    where: {
      ownerId,
      ...(opts.ignoreSchedule ? {} : { nextRunAt: { lte: now } }),
      OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
    },
    data: { leasedBy: by, leasedUntil: new Date(now.getTime() + LANE_LEASE_MS) },
  });
  return r.count === 1;
}

/** Gia hạn làn đang thuê. false = làn không còn là của mình (hết hạn, bị tiến trình khác nhận). */
export async function renewInvoiceLane(ownerId: string, by: string = workerId, now = new Date()): Promise<boolean> {
  const r = await prisma.invoiceLane.updateMany({
    where: { ownerId, leasedBy: by, leasedUntil: { gte: now } },
    data: { leasedUntil: new Date(now.getTime() + LANE_LEASE_MS) },
  });
  return r.count === 1;
}

/** Hẹn lượt kế rồi trả làn. Chỉ ghi khi làn còn là của `by` (mất làn thì bên kia đã hẹn). */
export async function releaseInvoiceLane(
  ownerId: string,
  next: { nextRunAt: Date; transientStreak: number },
  by: string = workerId
): Promise<boolean> {
  const r = await prisma.invoiceLane.updateMany({
    where: { ownerId, leasedBy: by },
    data: { leasedBy: null, leasedUntil: null, lastRunAt: new Date(), ...next },
  });
  return r.count === 1;
}

/** Lịch lượt kế theo kết cục — hàm thuần, có test. */
export function scheduleAfter(
  outcome: AutoIssueOutcome,
  prevTransientStreak: number,
  now: Date,
  opts: { interrupted?: boolean; idleMs?: number } = {}
): { nextRunAt: Date; transientStreak: number } {
  const idle = opts.idleMs ?? idleDelayMs();
  if (opts.interrupted) return { nextRunAt: now, transientStreak: prevTransientStreak };
  switch (outcome) {
    case "BACKLOG":
      return { nextRunAt: new Date(now.getTime() + BACKLOG_DELAY_MS), transientStreak: 0 };
    case "TRANSIENT": {
      const streak = prevTransientStreak + 1;
      const delay = TRANSIENT_BACKOFF_MS[Math.min(streak, TRANSIENT_BACKOFF_MS.length) - 1];
      return { nextRunAt: new Date(now.getTime() + delay), transientStreak: streak };
    }
    case "PAUSED":
    case "IDLE":
    case "DONE":
    default:
      return { nextRunAt: new Date(now.getTime() + idle), transientStreak: 0 };
  }
}

/**
 * Gộp kết cục phần yêu cầu bấm tay và phần tự phát hành thành kết cục của lượt —
 * hàm thuần, có test. Lỗi tạm / ngắt mạch thắng; rồi tới còn tồn; rồi đã làm; rồi rỗng.
 */
export function mergeLaneOutcome(req: RequestRunOutcome, auto: AutoIssueOutcome | null): AutoIssueOutcome {
  if (req === "TRANSIENT" || auto === "TRANSIENT") return "TRANSIENT";
  if (auto === "PAUSED") return "PAUSED";
  if (req === "BACKLOG" || auto === "BACKLOG") return "BACKLOG";
  if (req === "DONE" || req === "ABORTED" || auto === "DONE") return "DONE";
  return "IDLE";
}

export interface LaneRunOptions {
  /**
   * true = lượt do YÊU CẦU BẤM TAY gọi (tín hiệu invoice.issue / lưới quét yêu cầu):
   * thuê làn không xét nextRunAt. Phần tự phát hành chỉ chạy kèm khi làn cũng đã tới
   * giờ theo lịch; chưa tới giờ thì lịch tự phát hành giữ nguyên.
   */
  forRequests?: boolean;
}

/**
 * MỘT LƯỢT của một shop qua làn: thuê → yêu cầu bấm tay → tự phát hành → hẹn → trả.
 * Trả về kết cục, hoặc null khi không thuê được (shop đang có tiến trình khác, hoặc
 * chưa tới giờ).
 */
export async function runInvoiceLaneOnce(ownerId: string, opts: LaneRunOptions = {}): Promise<AutoIssueOutcome | null> {
  const claimedAt = new Date();
  if (!(await claimInvoiceLane(ownerId, workerId, claimedAt, { ignoreSchedule: opts.forRequests }))) return null;
  const lane = await prisma.invoiceLane.findUnique({
    where: { ownerId },
    select: { transientStreak: true, nextRunAt: true },
  });
  const prevStreak = lane?.transientStreak ?? 0;
  // Thuê thường (không forRequests) chỉ thành công khi đã tới giờ.
  const autoDue = lane ? lane.nextRunAt.getTime() <= claimedAt.getTime() : false;
  let interrupted = false;
  let outcome: AutoIssueOutcome = "IDLE";
  let lastRenew = Date.now();
  const shouldStop = async (): Promise<boolean> => {
    if (stopping) {
      interrupted = true;
      return true;
    }
    if (Date.now() - lastRenew >= LANE_RENEW_EVERY_MS) {
      const ok = await renewInvoiceLane(ownerId);
      lastRenew = Date.now();
      if (!ok) {
        console.warn(`[Invoice-lanes] Shop ${ownerId}: làn không còn là của tiến trình này — dừng lượt`);
        interrupted = true;
        return true;
      }
    }
    return false;
  };
  try {
    // 1. Yêu cầu bấm tay, cũ trước (lát 9). Không xét công tắc tự phát hành lẫn ngắt
    //    mạch: chủ shop bấm tay là có chủ đích; nhà cung cấp tự chặn nếu chưa được phép.
    const req = await runIssueRequestsForShop(ownerId, { budget: MAX_PER_OWNER_PER_RUN, shouldStop });
    // 2. Phần còn lại của lượt cho tự phát hành. Bỏ qua khi phần trên vừa dừng vì nhà
    //    cung cấp lỗi tạm / lỗi tài khoản (gọi tiếp chỉ lặp lại đúng lỗi đó).
    let auto: AutoIssueOutcome | null = null;
    const remaining = MAX_PER_OWNER_PER_RUN - req.processed;
    const reqStopped = req.outcome === "TRANSIENT" || req.outcome === "ABORTED" || req.interrupted;
    if (!reqStopped && autoDue && remaining > 0 && invoiceMode() === "lanes" && isPublishAllowed()) {
      const cfg = await prisma.invoiceConfig.findFirst({
        where: { ownerId, ...ACTIVE_CONFIG },
        select: AUTO_ISSUE_CONFIG_SELECT,
      });
      // Shop tắt công tắc / ngắt mạch / thiếu tài khoản: không gọi nhà cung cấp, coi như lượt rỗng.
      if (cfg && !autoIssueSkipReason(cfg)) {
        const result = await runAutoIssueForShop(cfg, { transientBlocks: false, take: remaining, shouldStop });
        auto = result.outcome;
      }
    }
    outcome = mergeLaneOutcome(req.outcome, auto);
    return outcome;
  } finally {
    // Lượt chỉ vì yêu cầu bấm tay mà làn chưa tới giờ: lịch tự phát hành giữ nguyên.
    const next =
      autoDue || !lane
        ? scheduleAfter(outcome, prevStreak, new Date(), { interrupted })
        : { nextRunAt: lane.nextRunAt, transientStreak: prevStreak };
    await releaseInvoiceLane(ownerId, next);
  }
}

function pump(due: string[], opts: LaneRunOptions = {}): void {
  const max = invoiceLaneConcurrency();
  for (const ownerId of due) {
    if (stopping || running.size >= max) return;
    if (running.has(ownerId)) continue;
    const turn = runInvoiceLaneOnce(ownerId, opts)
      .catch((err) => {
        // Lỗi ngoài dự kiến (database): làn hết hạn sau 300 giây rồi lưới quét gọi lại.
        console.error(`[Invoice-lanes] Shop ${ownerId}: lượt lỗi —`, (err as Error).message);
      })
      .then(() => undefined)
      .finally(() => {
        running.delete(ownerId);
      });
    running.set(ownerId, turn);
  }
}

/**
 * Lưới quét: tạo làn còn thiếu, rồi nhận các shop tới giờ chưa ai thuê. Trả về số
 * shop vừa được gọi. Hai worker cùng quét không sao: thuê là UPDATE có điều kiện.
 */
export async function sweepInvoiceLanes(now = new Date(), opts: SweepOptions = {}): Promise<number> {
  if (stopping) return 0;
  // Chốt an toàn tổng của đường cũ giữ nguyên: chưa được phép phát hành thì không làm gì.
  if (!isPublishAllowed()) return 0;
  await ensureInvoiceLanes(opts);
  const free = invoiceLaneConcurrency() - running.size;
  if (free <= 0) return 0;
  const due = await prisma.invoiceLane.findMany({
    where: {
      nextRunAt: { lte: now },
      OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
      owner: { invoiceConfigs: { some: ACTIVE_CONFIG } },
      ...(opts.onlyOwnerIds ? { ownerId: { in: opts.onlyOwnerIds } } : {}),
    },
    orderBy: { nextRunAt: "asc" },
    take: free * 2,
    select: { ownerId: true },
  });
  const before = running.size;
  pump(due.map((d) => d.ownerId));
  return running.size - before;
}

/**
 * Lưới quét YÊU CẦU BẤM TAY (lát 9): shop có dòng invoice_requests chờ đã tới hạn →
 * gọi làn của shop đó. Câu đọc đi theo chỉ mục riêng phần chỉ chứa dòng chờ
 * (invoice_requests_due_idx), bình thường rỗng. Trả về số shop vừa được gọi.
 */
export async function sweepInvoiceRequests(now = new Date(), opts: SweepOptions = {}): Promise<number> {
  if (stopping) return 0;
  const free = invoiceLaneConcurrency() - running.size;
  if (free <= 0) return 0;
  const nowIso = now.toISOString();
  // Lấy dư để còn chọn được sau khi bỏ shop đang chạy ở tiến trình này.
  const limit = (free + running.size) * 4;
  const rows = await prisma.$queryRaw<{ ownerId: string }[]>`
    SELECT "ownerId" FROM "invoice_requests"
    WHERE "status" = 'PENDING' AND "nextRetryAt" <= (${nowIso}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY "ownerId"
    ORDER BY min("nextRetryAt")
    LIMIT ${limit}`;
  const owners = rows
    .map((r) => r.ownerId)
    .filter((id) => !running.has(id) && (!opts.onlyOwnerIds || opts.onlyOwnerIds.includes(id)));
  const before = running.size;
  pump(owners, { forRequests: true });
  return running.size - before;
}

/** Việc invoice.issue: chỉ là tín hiệu → gọi làn của shop rồi trả về ngay (việc phải ngắn). */
export async function runInvoiceIssueSignal(job: InvoiceIssueSignal): Promise<void> {
  // Hết chỗ chạy thì thôi: lưới quét yêu cầu nhặt ở nhịp kế.
  pump([job.ownerId], { forRequests: true });
}

/**
 * Đăng ký worker nhận tín hiệu invoice.issue. Gọi SAU khi startQueue() sẵn sàng; ở
 * vai web tự bỏ qua. Đăng ký ở mọi chế độ: worker bản này nhận tín hiệu dù web chưa
 * gửi (quy tắc đưa lên hai lần).
 */
export async function registerInvoiceQueueWorkers(): Promise<void> {
  await registerWorker<InvoiceIssueSignal>(
    QUEUES.invoiceIssue,
    { concurrency: 2, pollSeconds: 0.5 },
    (job) => runInvoiceIssueSignal(job.data)
  );
}

/**
 * Khởi động lưới quét yêu cầu bấm tay — gọi một lần từ workers/index.ts, ở MỌI
 * INVOICE_MODE. KHÔNG phụ thuộc pg-boss đã lên hay chưa.
 */
export function startInvoiceRequestScheduler(): void {
  if (requestSweepTimer) return;
  const seconds = invoiceRequestSweepSeconds();
  let sweeping = false;
  const tick = async () => {
    if (sweeping || stopping) return;
    sweeping = true;
    try {
      await sweepInvoiceRequests();
    } catch (err) {
      console.error("[Invoice-requests] Lỗi lưới quét:", (err as Error).message);
    } finally {
      sweeping = false;
    }
  };
  requestSweepTimer = setInterval(() => void tick(), seconds * 1000);
  requestSweepTimer.unref();
  console.log(
    `[Invoice-requests] BẬT — yêu cầu xuất hóa đơn bấm tay chạy qua làn của shop: lưới quét mỗi ${seconds} giây, ` +
      `mỗi lượt tối đa ${MAX_PER_OWNER_PER_RUN} tờ, tối đa ${invoiceLaneConcurrency()} shop cùng lúc`
  );
}

/** Cho test: chờ tới khi không còn shop nào đang chạy. */
export async function whenInvoiceLanesIdle(): Promise<void> {
  while (running.size > 0) await Promise.allSettled([...running.values()]);
}

/** Cho test: về trạng thái chưa dừng. */
export function resumeInvoiceLanes(): void {
  stopping = false;
}

/**
 * Dừng êm lúc tiến trình tắt (SIGTERM khi deploy): thôi nhận shop mới, lượt đang
 * chạy dừng sau tờ đang dở, hẹn lại ngay và trả làn. Chờ tối đa `timeoutMs`; quá
 * hạn thì làn nằm ở trạng thái thuê tới khi hết hạn 300 giây.
 */
export async function stopInvoiceLanes(timeoutMs: number): Promise<void> {
  stopping = true;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  if (requestSweepTimer) clearInterval(requestSweepTimer);
  requestSweepTimer = null;
  if (running.size === 0) return;
  await Promise.race([
    Promise.allSettled([...running.values()]),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref()),
  ]);
}

/** Khởi động lưới quét — gọi một lần từ workers/index.ts khi INVOICE_MODE=lanes. */
export function startInvoiceLaneScheduler(): void {
  const minutes = Number(process.env.INVOICE_AUTO_ISSUE_MINUTES ?? DEFAULT_IDLE_MINUTES);
  if (Number.isFinite(minutes) && minutes <= 0) {
    console.log("[Invoice-lanes] TẮT (INVOICE_AUTO_ISSUE_MINUTES=0)");
    return;
  }
  const seconds = sweepSeconds();
  const tick = async () => {
    try {
      await sweepInvoiceLanes();
    } catch (err) {
      console.error("[Invoice-lanes] Lỗi lưới quét:", (err as Error).message);
    }
  };
  // Lượt đầu chờ 1 phút cho server ấm máy (đường cũ chờ 3 phút; làn chỉ chạy shop tới giờ).
  setTimeout(() => void tick(), 60_000).unref();
  sweepTimer = setInterval(() => void tick(), seconds * 1000);
  sweepTimer.unref();
  console.log(
    `[Invoice-lanes] BẬT — tự phát hành theo làn từng shop: tối đa ${invoiceLaneConcurrency()} shop cùng lúc, ` +
      `lưới quét mỗi ${seconds} giây, hết đơn nghỉ ${idleDelayMs() / 60_000} phút, còn tồn 1 phút, hạn thuê ${LANE_LEASE_MS / 1000} giây`
  );
}
