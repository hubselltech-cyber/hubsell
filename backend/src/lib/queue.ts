// ============================================================
// HÀNG ĐỢI BỀN (giai đoạn 2 kiến trúc quy mô — docs/HANG-DOI-BEN.md)
//
// Lớp mỏng quanh pg-boss. Mã nghiệp vụ CHỈ gọi qua tệp này, không import
// pg-boss trực tiếp — đổi thư viện thì sửa một chỗ.
//
// Vai trò của pg-boss ở Hubsell là ĐIỀU PHỐI: ai nhận việc, hạn giữ, thử lại,
// hàng đợi lỗi, không chạy chồng một khóa trên nhiều máy. Trạng thái mà giao
// diện / HQ đọc vẫn nằm ở bảng nghiệp vụ (webhook_events, stock_push_jobs...).
//
// Ba điều đã đo ngày 01/10/2026 (scripts/pgboss-pooler-probe.mjs) quyết định
// cách viết ở đây:
//   · pg-boss không chạy hẳn trên kết nối của Prisma được, và instance chưa
//     start() thì không gửi được → mỗi tiến trình có một pool pg-boss nhỏ.
//   · GỬI việc thì đi qua Prisma (fromPrisma): chung giao dịch với dữ liệu
//     nghiệp vụ khi truyền `tx`, và dùng kết nối đang ấm của Prisma khi không.
//   · Lấy từng việc một chỉ được ~16 việc/giây; lấy theo lô và chạy liền khi lô
//     đầy thì ~2.000 việc/giây → worker luôn lấy theo lô.
//
// Ứng dụng chạy với migrate:false: schema "pgboss" và các hàng đợi do migration
// tạo. Hàng đợi hỏng KHÔNG được làm sập ứng dụng: startQueue không ném, chỉ ghi
// log; enqueue thì ném (việc phải ghi được hoặc nơi gọi phải biết là không ghi được).
// ============================================================

import type { Prisma } from "@prisma/client";
import { PgBoss, fromPrisma } from "pg-boss";

import type { HubsellRole } from "../workers";
import { prisma } from "./prisma";
import {
  ALL_QUEUES,
  QUEUE_SCHEMA,
  notifyPollSeconds,
  queueOptionsForRole,
  resolveQueueConnection,
  type QueueName,
} from "./queue-config";

export { QUEUES, type QueueName } from "./queue-config";

/** Ném khi gửi việc mà hàng đợi chưa sẵn sàng — nơi gọi quyết định trả lỗi hay thử lại. */
export class QueueUnavailableError extends Error {
  constructor(reason: string) {
    super(`Hàng đợi chưa sẵn sàng: ${reason}`);
    this.name = "QueueUnavailableError";
  }
}

let boss: PgBoss | null = null;
let ready = false;
let consumes = false;
let lastStartError: string | null = null;

/** Hàng đợi đã khởi động xong ở tiến trình này chưa. */
export function isQueueReady(): boolean {
  return ready;
}

/** Lý do lần khởi động gần nhất hỏng (cho HQ Sức khỏe); null = không hỏng / chưa gọi. */
export function queueStartError(): string | null {
  return lastStartError;
}

/**
 * Khởi động hàng đợi theo vai tiến trình. KHÔNG ném: hỏng thì ghi log và trả
 * false, ứng dụng vẫn chạy (những đường chưa dùng hàng đợi không bị ảnh hưởng).
 * Gọi lại khi đã sẵn sàng là vô hại.
 */
export async function startQueue(role: HubsellRole): Promise<boolean> {
  if (ready) return true;
  const conn = resolveQueueConnection();
  if (!conn) {
    lastStartError = "thiếu DATABASE_URL";
    console.error(`[Queue] KHÔNG khởi động: ${lastStartError}`);
    return false;
  }
  const opts = queueOptionsForRole(role);
  const instance = new PgBoss({
    connectionString: conn.connectionString,
    ssl: conn.ssl,
    application_name: `hubsell-queue-${role}`,
    schema: QUEUE_SCHEMA,
    max: opts.max,
    // Schema và hàng đợi do migration tạo; thư viện không được tự tạo / tự sửa bảng.
    migrate: false,
    createSchema: false,
    supervise: opts.supervise,
    // Lịch chạy định kỳ của pg-boss chưa dùng (và chưa thử trên Supabase).
    schedule: false,
    // Worker giữ thêm 1 kết nối LISTEN để được đánh thức ngay (08/10/2026, vì băng
    // thông Render — queue-config.ts phần "Nhịp hỏi việc"). Chỉ có tác dụng với hàng
    // đợi đã bật cờ notify (migration 20261008100000_queue_notify). Không lập được
    // listener thì thư viện báo warning và chỉ còn nhịp hỏi — không mất việc.
    useListenNotify: opts.listenNotify,
  });
  // Bắt buộc có listener "error": thiếu thì lỗi kết nối nền thành lỗi không bắt, sập tiến trình.
  instance.on("error", (err) => console.error("[Queue] Lỗi nền:", err.message));
  instance.on("warning", (w) => console.warn("[Queue] Cảnh báo:", w.message));
  try {
    await instance.start();
    const existing = new Set((await instance.getQueues()).map((q) => q.name));
    const missing = ALL_QUEUES.filter((name) => !existing.has(name));
    if (missing.length > 0) {
      throw new Error(`thiếu hàng đợi ${missing.join(", ")} — migration queue_foundation chưa áp?`);
    }
    boss = instance;
    consumes = opts.consumes;
    ready = true;
    lastStartError = null;
    console.log(
      `[Queue] Sẵn sàng — vai ${role}, ${existing.size} hàng đợi, pool ${opts.max} kết nối` +
        (opts.supervise ? ", có giám sát" : ", chỉ gửi") +
        (opts.listenNotify ? ", nghe NOTIFY" : "")
    );
    return true;
  } catch (err) {
    lastStartError = String((err as Error).message).split("\n")[0];
    console.error(`[Queue] KHÔNG khởi động được: ${lastStartError}`);
    await instance.stop({ graceful: false }).catch(() => undefined);
    return false;
  }
}

/**
 * Dừng êm (SIGTERM lúc deploy): chờ việc đang chạy xong tối đa `timeoutMs`. Việc
 * chưa xong không mất — hết hạn giữ thì pg-boss trả lại hàng chờ cho worker khác.
 */
export async function stopQueue(timeoutMs: number): Promise<void> {
  const instance = boss;
  boss = null;
  ready = false;
  if (!instance) return;
  try {
    await instance.stop({ graceful: true, timeout: timeoutMs });
  } catch (err) {
    console.error("[Queue] Dừng không êm:", (err as Error).message);
  }
}

export interface EnqueueOptions {
  /**
   * Khóa gộp việc. Với hàng đợi "gộp theo khóa": đã có việc CHỜ cùng khóa thì
   * việc mới không được tạo (queued = false) — việc đang chờ sẽ làm thay.
   */
  key?: string;
  /** Hẹn giờ: việc chỉ được nhận sau ngần này giây. */
  startAfterSeconds?: number;
  /**
   * Giao dịch Prisma đang mở. Truyền vào thì việc được xếp CHUNG giao dịch với
   * dữ liệu nghiệp vụ: rollback là việc biến mất, commit là việc chắc chắn có.
   */
  tx?: Prisma.TransactionClient;
}

export interface EnqueueResult {
  /** false = đã có việc chờ cùng khóa, không tạo việc mới. */
  queued: boolean;
  id: string | null;
}

/** Xếp một việc. Ném QueueUnavailableError khi hàng đợi chưa sẵn sàng. */
export async function enqueue<T extends object>(
  name: QueueName,
  data: T,
  opts: EnqueueOptions = {}
): Promise<EnqueueResult> {
  if (!boss || !ready) throw new QueueUnavailableError(lastStartError ?? "chưa khởi động");
  const id = await boss.send(name, data, {
    db: fromPrisma(opts.tx ?? prisma),
    ...(opts.key ? { singletonKey: opts.key } : {}),
    ...(opts.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
  });
  return { queued: id !== null, id };
}

/**
 * Ghi đè dữ liệu của việc ĐANG CHỜ cùng khóa (không có thì tạo mới). Dùng khi
 * sự kiện đến sau mang thông tin mà việc đang chờ chưa có (vd mã vận đơn Shopee).
 */
export async function upsertQueued<T extends object>(
  name: QueueName,
  data: T,
  key: string,
  tx?: Prisma.TransactionClient,
  /**
   * Hẹn giờ lại: việc đang chờ (hoặc việc mới tạo) chỉ được nhận sau ngần này
   * giây kể từ BÂY GIỜ. Dùng cho việc "làm sau lần đổi cuối cùng N giây" (đối
   * soát tồn sau khi đẩy): mỗi lần đổi dời giờ hẹn, vẫn chỉ một việc mỗi khóa.
   */
  startAfterSeconds?: number
): Promise<void> {
  if (!boss || !ready) throw new QueueUnavailableError(lastStartError ?? "chưa khởi động");
  await boss.upsert(name, data, {
    singletonKey: key,
    db: fromPrisma(tx ?? prisma),
    ...(startAfterSeconds ? { startAfter: startAfterSeconds } : {}),
  });
}

/**
 * Còn việc nào của khóa này đang chờ / chờ thử lại / đang chạy không.
 *
 * Cần cho hàng đợi "gộp theo khóa": mỗi khóa chỉ có MỘT chỗ "chờ thử lại". Việc
 * A đang chờ thử lại mà việc B (cùng khóa, do sự kiện đến sau tạo ra) cũng hỏng
 * thì B không còn chỗ chờ thử lại và bị chuyển thẳng sang hàng đợi lỗi — trong
 * khi A vẫn còn lượt. Nơi xử lý hàng đợi lỗi hỏi hàm này để không báo hỏng sớm.
 * (Gặp thật trên prod 01/10/2026, đơn TikTok lúc chuyển bản.)
 */
export async function hasLiveJob(name: QueueName, key: string): Promise<boolean> {
  if (!boss || !ready) throw new QueueUnavailableError(lastStartError ?? "chưa khởi động");
  const jobs = await boss.findJobs(name, { key });
  return jobs.some((j) => j.state === "created" || j.state === "retry" || j.state === "active");
}

export interface QueueJob<T> {
  id: string;
  data: T;
  /** 0 ở lượt đầu, tăng 1 mỗi lượt thử lại. */
  retryCount: number;
}

export interface WorkerOptions {
  /**
   * Số việc chạy cùng lúc ở tiến trình này. Lib chia thành tối đa 2 vòng lấy
   * việc, mỗi vòng lấy một lô và chạy song song các việc trong lô.
   */
  concurrency: number;
  /**
   * Nhịp hỏi việc khi hàng đợi trống, giây (thư viện cho thấp nhất 0,5). Khi hàng
   * đợi có LISTEN/NOTIFY đang hoạt động thì nhịp này không dùng: việc mới được
   * đánh thức ngay, còn hỏi việc chỉ là lưới đỡ theo QUEUE_NOTIFY_POLL_SECONDS.
   */
  pollSeconds: number;
}

/**
 * Đăng ký hàm xử lý cho một hàng đợi. Chỉ có tác dụng ở tiến trình nhận việc
 * (vai worker / all); ở vai web trả false và không làm gì.
 *
 * `handler` nhận MỘT việc. Ném lỗi = việc hỏng lượt này, pg-boss tự thử lại theo
 * cấu hình hàng đợi rồi chuyển sang hàng đợi lỗi; việc khác trong cùng lô không
 * bị ảnh hưởng.
 */
export async function registerWorker<T extends object>(
  name: QueueName,
  opts: WorkerOptions,
  handler: (job: QueueJob<T>) => Promise<void>
): Promise<boolean> {
  if (!boss || !ready) throw new QueueUnavailableError(lastStartError ?? "chưa khởi động");
  if (!consumes) return false;
  const concurrency = Math.max(1, Math.floor(opts.concurrency));
  const loops = Math.min(2, concurrency);
  const batchSize = Math.ceil(concurrency / loops);
  await boss.work<T>(
    name,
    {
      localConcurrency: loops,
      batchSize,
      pollingIntervalSeconds: Math.max(0.5, opts.pollSeconds),
      notifyPollingIntervalSeconds: notifyPollSeconds(),
      burstWhenBatchFull: batchSize > 1,
      perJobResults: true,
    },
    async (jobs) =>
      Promise.all(
        jobs.map(async (job) => {
          try {
            await handler({ id: job.id, data: job.data, retryCount: job.retryCount });
            return { id: job.id, status: "completed" as const };
          } catch (err) {
            const message = String((err as Error)?.message ?? err).slice(0, 2000);
            console.error(`[Queue] ${name} việc ${job.id} hỏng (lượt ${job.retryCount + 1}): ${message}`);
            return { id: job.id, status: "failed" as const, output: { message } };
          }
        })
      )
  );
  console.log(
    `[Queue] Nhận việc ${name}: ${loops} vòng × lô ${batchSize}, nhịp hỏi ${opts.pollSeconds} giây` +
      `, có NOTIFY thì ${notifyPollSeconds()} giây`
  );
  return true;
}

export interface QueueStat {
  name: string;
  /** Việc sẵn sàng chạy ngay (không tính việc hẹn giờ chưa tới). */
  ready: number;
  /** Việc hẹn giờ, chưa tới lúc chạy. */
  deferred: number;
  active: number;
  /** Việc hỏng còn giữ lại trong bảng (đã hết lượt thử). */
  failed: number;
}

/**
 * Số đếm từng hàng đợi cho HQ Sức khỏe. Số do phần giám sát của worker cập
 * nhật khoảng một phút một lần (đọc cột đếm sẵn, không quét bảng việc). Trả
 * null khi hàng đợi chưa sẵn sàng hoặc không đọc được.
 */
export async function queueStats(): Promise<QueueStat[] | null> {
  if (!boss || !ready) return null;
  try {
    const rows = await boss.getQueues();
    return rows
      .map((q) => ({
        name: q.name,
        ready: q.readyCount,
        deferred: q.deferredCount,
        active: q.activeCount,
        failed: q.failedCount,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn("[Queue] Không đọc được số đếm hàng đợi:", (err as Error).message);
    return null;
  }
}
