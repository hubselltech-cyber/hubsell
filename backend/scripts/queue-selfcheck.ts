// ============================================================
// TỰ KIỂM HÀNG ĐỢI BỀN (giai đoạn 2 — docs/HANG-DOI-BEN.md) trên database TẠM.
//
// Tạo database tạm "hubsell_queue_selfcheck" trên máy chủ Postgres của
// DATABASE_URL, áp migration 20261001200000_queue_foundation qua Prisma (đúng
// cách Render áp), chạy module lib/queue.ts thật, rồi XÓA database tạm.
// Không đụng database đang dùng. Từ chối chạy nếu DATABASE_URL không phải localhost.
//
//   npx tsx scripts/queue-selfcheck.ts
// ============================================================
import "dotenv/config";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const TEMP_DB = "hubsell_queue_selfcheck";
const MIGRATION = "prisma/migrations/20261001200000_queue_foundation/migration.sql";

const base = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  console.error("Chỉ chạy với database trên máy mình (DATABASE_URL phải là localhost).");
  process.exit(1);
}
const devUrl = base.toString();
const temp = new URL(devUrl);
temp.pathname = `/${TEMP_DB}`;
const tempUrl = temp.toString();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name: string, ok: boolean, detail: unknown = ""): void {
  if (!ok) failed += 1;
  console.log(`${ok ? "ĐẠT " : "HỎNG"} ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

async function main(): Promise<void> {
  const admin = new PrismaClient({ datasourceUrl: devUrl });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TEMP_DB}`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${TEMP_DB}`);
  const db = new PrismaClient({ datasourceUrl: tempUrl });
  try {
    // Phụ thuộc duy nhất của migration vào schema sẵn có.
    await db.$executeRawUnsafe(
      `CREATE TYPE "WebhookJobStatus" AS ENUM ('PENDING','PROCESSING','VERIFYING','SUCCESS','FAILED')`
    );

    // Nạp module SAU khi đặt biến môi trường: pool riêng của pg-boss trỏ vào database tạm.
    process.env.QUEUE_DATABASE_URL = tempUrl;
    // lib/prisma đọc DATABASE_URL lúc được nạp — trỏ luôn sang database tạm để
    // các module nghiệp vụ nạp bên dưới (webhook-inbox, event-queue) không chạm database đang dùng.
    process.env.DATABASE_URL = tempUrl;
    const q = await import("../src/lib/queue");

    // 1) Schema chưa cài: không ném, trả false, ứng dụng vẫn sống.
    const before = await q.startQueue("worker");
    check("schema chưa cài thì startQueue trả false, không ném", before === false, q.queueStartError() ?? "");

    execSync(`npx prisma db execute --file ${MIGRATION} --url "${tempUrl}"`, { stdio: "pipe" });
    // Chỉ ở database tạm: rút giãn cách thử lại của evt.order xuống 1 giây để mục 4
    // đi hết 3 lượt trong vài giây (cấu hình thật: 30–60 rồi 60–120 giây).
    await db.$executeRawUnsafe(`UPDATE pgboss.queue SET retry_delay = 1, retry_backoff = false WHERE name = 'evt.order'`);

    // 2) Vai web: chỉ gửi.
    check("vai web khởi động", await q.startQueue("web"));
    const webWorker = await q.registerWorker(q.QUEUES.evtAuth, { concurrency: 2, pollSeconds: 0.5 }, async () => undefined);
    check("vai web không nhận việc", webWorker === false);
    const key = "SHOPEE:123:ORDER-1";
    const a = await q.enqueue(q.QUEUES.evtOrder, { n: 1 }, { key, tx: db });
    const b = await q.enqueue(q.QUEUES.evtOrder, { n: 2 }, { key, tx: db });
    check("gộp theo khóa: việc thứ hai cùng khóa không được tạo", a.queued && !b.queued, { a: a.queued, b: b.queued });
    await q.upsertQueued(q.QUEUES.evtOrder, { n: 3, trackingNo: "VN123" }, key, db);

    await db
      .$transaction(async (tx) => {
        await q.enqueue(q.QUEUES.stockVerify, { rolledBack: true }, { tx });
        throw new Error("ROLLBACK");
      })
      .catch((e: Error) => {
        if (e.message !== "ROLLBACK") throw e;
      });
    await db.$transaction(async (tx) => {
      await q.enqueue(q.QUEUES.stockVerify, { committed: true }, { tx });
    });
    const verifyRows = await db.$queryRawUnsafe<{ data: { committed?: boolean } }[]>(
      `SELECT data FROM pgboss.job WHERE name = 'stock.verify'`
    );
    check(
      "chung giao dịch Prisma: rollback mất việc, commit có việc",
      verifyRows.length === 1 && verifyRows[0].data.committed === true,
      { rows: verifyRows.length }
    );
    await q.stopQueue(5000);
    let threw = false;
    try {
      await q.enqueue(q.QUEUES.evtAuth, {}, { tx: db });
    } catch (e) {
      threw = e instanceof q.QueueUnavailableError;
    }
    check("đã dừng thì enqueue ném QueueUnavailableError", threw && !q.isQueueReady());

    // 3) Vai worker: nhận việc, việc hỏng không kéo việc khác.
    check("vai worker khởi động", await q.startQueue("worker"));
    const seen: unknown[] = [];
    await q.registerWorker<{ n: number; trackingNo?: string }>(
      q.QUEUES.evtOrder,
      { concurrency: 4, pollSeconds: 0.5 },
      async (job) => {
        seen.push(job.data);
      }
    );
    let authRuns = 0;
    await q.registerWorker<{ fail?: boolean }>(
      q.QUEUES.evtAuth,
      { concurrency: 2, pollSeconds: 0.5 },
      async (job) => {
        authRuns += 1;
        if (job.data.fail) throw new Error("lỗi cố ý");
      }
    );
    await q.enqueue(q.QUEUES.evtAuth, { fail: true }, { tx: db });
    await q.enqueue(q.QUEUES.evtAuth, { fail: false }, { tx: db });
    for (let i = 0; i < 40 && (seen.length < 1 || authRuns < 2); i++) await sleep(250);
    check("việc đang chờ mang dữ liệu đã ghi đè (mã vận đơn)", JSON.stringify(seen) === JSON.stringify([{ n: 3, trackingNo: "VN123" }]), seen);
    await sleep(600);
    const authStates = await db.$queryRawUnsafe<{ state: string; fail: string | null }[]>(
      `SELECT state::text AS state, data->>'fail' AS fail FROM pgboss.job WHERE name = 'evt.auth' ORDER BY data->>'fail'`
    );
    check(
      "việc hỏng chờ thử lại, việc cùng lô vẫn xong",
      authStates.length === 2 && authStates[0].state === "completed" && authStates[1].state === "retry",
      authStates
    );

    // 4) Trọn đường hỏng: hộp thư đến → evt.order hỏng đủ 3 lượt → evt.dead → dòng FAILED.
    //    Database tạm không có bảng Channel nên handler Lazada ném lỗi ở mọi lượt.
    const inbox = await import("../src/services/webhook-inbox");
    const eq = await import("../src/workers/event-queue");
    // Khởi động lại để gỡ hai hàm xử lý thử của mục 3 (cùng nhận evt.order thì việc hỏng có thể rơi vào hàm thử và "xong").
    await q.stopQueue(5000);
    check("khởi động lại vai worker", await q.startQueue("worker"));
    await eq.registerEventQueueWorkers();
    const rec = await inbox.recordOrderEvent({
      source: "LAZADA",
      eventType: "0",
      shopId: "SELLER-X",
      orderId: "ORDER-DEAD",
      rawBody: "selfcheck-dead",
      payload: { selfcheck: true },
    });
    check("ghi hộp thư đến + xếp việc chung giao dịch", rec.queued && !rec.duplicate, rec);
    const dup = await inbox.recordOrderEvent({
      source: "LAZADA",
      eventType: "0",
      shopId: "SELLER-X",
      orderId: "ORDER-DEAD",
      rawBody: "selfcheck-dead",
      payload: { selfcheck: true },
    });
    check("gửi lại y nguyên bị chặn", dup.duplicate && !dup.queued, dup);
    type Ev = { status: string; attempts: number; lastError: string | null };
    let ev: Ev[] = [];
    for (let i = 0; i < 100; i++) {
      ev = await db.$queryRawUnsafe<Ev[]>(`SELECT status::text AS status, attempts, "lastError" FROM webhook_events WHERE "entityId" = 'ORDER-DEAD'`);
      if (ev[0]?.status === "FAILED") break;
      await sleep(250);
    }
    const deadJobs = await db.$queryRawUnsafe<{ state: string }[]>(`SELECT state::text AS state FROM pgboss.job WHERE name = 'evt.dead'`);
    check(
      "hỏng đủ 3 lượt → sang hàng đợi lỗi → dòng sự kiện FAILED",
      ev.length === 1 && ev[0].status === "FAILED" && ev[0].attempts === 3 && deadJobs.length === 1,
      {
        event: ev[0] ? { status: ev[0].status, attempts: ev[0].attempts } : null,
        deadJobs,
        orderJobs: await db.$queryRawUnsafe(
          `SELECT state::text AS state, retry_count, retry_limit, retry_delay, retry_backoff,
                  round(extract(epoch FROM (start_after - now())))::int AS due_in_s
           FROM pgboss.job WHERE name = 'evt.order' AND singleton_key LIKE 'LAZADA:SELLER-X:%'`
        ),
      }
    );

    const stats = await q.queueStats();
    check("đọc được số đếm 6 hàng đợi", stats?.length === 6, stats?.map((s) => s.name).join(", ") ?? "null");

    const t0 = Date.now();
    await q.stopQueue(10_000);
    check("dừng êm", !q.isQueueReady(), `${Date.now() - t0} ms`);
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TEMP_DB} WITH (FORCE)`);
    await admin.$disconnect();
  }
  console.log(failed === 0 ? "TẤT CẢ ĐẠT — đã xóa database tạm" : `${failed} MỤC HỎNG — đã xóa database tạm`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("TỰ KIỂM SẬP:", err);
  process.exit(2);
});
