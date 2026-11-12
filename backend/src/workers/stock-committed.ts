// ============================================================
// WORKER BỘ ĐẾM "ĐANG GIỮ CHO ĐƠN" — kho chuẩn quốc tế, LÁT 1 CHẠY BÓNG (12/11/2026)
// Thiết kế: docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 13. Phần SQL ở services/stock-committed.ts.
//
// Mỗi nhịp làm ba việc theo thứ tự:
//   1. NGÀY CHUYỂN (một lần, nhớ ở maintenance_jobs "stock-committed-cutover"): đưa các đơn đang
//      chờ giao vào bộ đếm. Xong rồi thì mỗi nhịp chỉ đọc một dòng.
//   2. QUÉT BÙ: đơn đã sang Đang giao / Đã giao qua đường không đụng kho (quét lô, làn đọc con
//      trỏ, sửa tay) và đơn của gian mất kết nối / ngủ đông → ra khỏi bộ đếm.
//   3. ĐỐI CHIẾU mỗi ngày một lần: ba phép so, ghi maintenance_jobs "stock-committed-check" +
//      một dòng log. Lệch thì BÁO, không tự sửa.
//
// CHẠY BÓNG: không màn nào đọc bộ đếm, số đẩy sàn không dùng. Mọi con số dưới đây là mặc định
// TỰ CHỌN, chỉnh bằng env không cần deploy lại mã:
//   STOCK_COMMITTED_OFF=1            tắt hẳn (cả các chỗ ghi trong webhook)
//   STOCK_COMMITTED_SWEEP_MS=120000  nhịp quét bù (2 phút)
//   STOCK_COMMITTED_BATCH=200        số đơn mỗi lô (1–1000)
//   STOCK_COMMITTED_CHECK_HOURS=24   nhịp đối chiếu; 0 = không đối chiếu
// Việc lặp theo nhịp nên KHÔNG qua pg-boss (bẫy stately). Lỗi một nhịp → nhịp sau làm lại.
// ============================================================
import { prisma } from "../lib/prisma";
import { stockCommittedOn } from "../services/stock-ledger";
import { CHECK_JOB_KEY, runCommittedCheck, runCutoverIfNeeded, sweepShipped } from "../services/stock-committed";

const TAG = "[stock-committed]";
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
/** Trần số lô mỗi nhịp — nhịp sau làm tiếp, không chiếm database quá lâu một lượt. */
const MAX_BATCHES_PER_TICK = 20;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
}

let running = false;

async function checkIfDue(checkHours: number): Promise<void> {
  if (checkHours <= 0) return;
  const last = await prisma.maintenanceJob.findUnique({ where: { key: CHECK_JOB_KEY }, select: { updatedAt: true } });
  if (last && Date.now() - last.updatedAt.getTime() < checkHours * 3_600_000) return;
  const c = await runCommittedCheck();
  const hard = c.counterMismatch + c.levelMismatch;
  const line =
    `${TAG} đối chiếu: ${c.committedOrders} đơn đang giữ, bộ đếm ${c.counterTotal}, tính lại từ đơn ${c.ordersTotal} ` +
    `(lệch ${c.counterMismatch} mã, ${c.levelMismatch} vị trí); theo "Chờ giao" ${c.awaitingTotal} (lệch ${c.awaitingMismatch} mã); ` +
    `đơn đã hủy còn giữ ${c.cancelledStillCommitted}; giữ lâu nhất ${c.oldestHours} giờ`;
  if (hard > 0) console.error(`${line} — LỆCH CỨNG, cần soi`);
  else console.log(line);
}

export async function runStockCommittedTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const batch = envInt("STOCK_COMMITTED_BATCH", 200, 1, 1000);
    const cut = await runCutoverIfNeeded(batch);
    if (!cut.alreadyDone) console.log(`${TAG} ngày chuyển XONG: đưa ${cut.orders} đơn đang chờ giao vào bộ đếm`);
    const s = await sweepShipped({ batch, maxBatches: MAX_BATCHES_PER_TICK });
    if (s.platform + s.channelInactive > 0) {
      console.log(
        `${TAG} quét bù: ${s.platform} đơn sàn đã giao, ${s.channelInactive} đơn của gian không còn hoạt động, ${s.quantity} sản phẩm ra khỏi bộ đếm`
      );
    }
    await checkIfDue(envInt("STOCK_COMMITTED_CHECK_HOURS", 24, 0, 720));
  } catch (err) {
    console.error(`${TAG} lỗi một nhịp, nhịp sau làm lại: ${(err as Error).message}`);
  } finally {
    running = false;
  }
}

export function startStockCommittedWorker(): void {
  if (!stockCommittedOn()) {
    console.log(`${TAG} tắt bằng STOCK_COMMITTED_OFF=1`);
    return;
  }
  const sweepMs = envInt("STOCK_COMMITTED_SWEEP_MS", 120_000, 10_000, 3_600_000);
  setTimeout(() => {
    void runStockCommittedTick();
    setInterval(() => void runStockCommittedTick(), sweepMs).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
