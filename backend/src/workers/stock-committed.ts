// ============================================================
// WORKER BỘ ĐẾM "ĐANG GIỮ CHO ĐƠN" — kho chuẩn quốc tế, LÁT 1 CHẠY BÓNG
// Thiết kế: docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 13 (12/11/2026) + mục 14 (thiết kế lại 19/11/2026).
// Phần SQL ở services/stock-committed.ts.
//
// HAI NHỊP RIÊNG, mỗi việc một `try` riêng — việc này lỗi không chặn việc kia (bản 12/11 gộp một
// `try`: quét bù lỗi suốt 5 ngày làm đối chiếu không chạy được, chuỗi 7 lần dừng ở 3):
//   NHỊP BẢO TRÌ (mặc định 1 giờ):
//     1. NGÀY CHUYỂN (một lần, nhớ ở maintenance_jobs "stock-committed-cutover").
//     2. GỠ DẤU CÒN SÓT của bản hai cột (một lần, "stock-committed-single-mark").
//     3. QUÉT BÙ — LƯỚI AN TOÀN: đơn rời kho đã được ghi ngay tại chỗ ghi trạng thái (webhook,
//        quét lô, làn đọc con trỏ, sửa tay, Biên bản bàn giao). Quét bù chỉ còn bắt đơn lọt và
//        đơn của gian mất kết nối / ngủ đông. Bắt được đơn "sàn đã giao" = CÒN MỘT ĐƯỜNG GHI CHƯA
//        GỌI RỜI KHO → log mức cảnh báo + cộng dồn ở maintenance_jobs "stock-committed-sweep".
//   NHỊP ĐỐI CHIẾU (hỏi 10 phút một lần "tới hạn chưa", chỉ đọc một dòng):
//     ba phép so + chuỗi tự đếm, ghi maintenance_jobs "stock-committed-check" + một dòng log.
//     Lệch thì BÁO, không tự sửa.
//
// CHẠY BÓNG: không màn nào đọc bộ đếm, số đẩy sàn không dùng. Mọi con số dưới đây là mặc định
// TỰ CHỌN, chỉnh bằng env không cần deploy lại mã:
//   STOCK_COMMITTED_OFF=1             tắt hẳn (cả các chỗ ghi trong webhook)
//   STOCK_COMMITTED_SWEEP_MS=3600000  nhịp bảo trì (1 giờ; 10 giây – 24 giờ)
//   STOCK_COMMITTED_BATCH=200         số đơn mỗi lô (1–1000)
//   STOCK_COMMITTED_CHECK_HOURS=24    nhịp đối chiếu; 0 = không đối chiếu
// Việc lặp theo nhịp nên KHÔNG qua pg-boss (bẫy stately). Lỗi một nhịp → nhịp sau làm lại.
// ============================================================
import { prisma } from "../lib/prisma";
import { stockCommittedOn } from "../services/stock-ledger";
import {
  CHECK_JOB_KEY,
  SWEEP_JOB_KEY,
  hardMismatch,
  runCommittedCheck,
  runCutoverIfNeeded,
  runSingleMarkIfNeeded,
  sweepShipped,
} from "../services/stock-committed";

const TAG = "[stock-committed]";
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
/** Trần số lô mỗi nhịp — nhịp sau làm tiếp, không chiếm database quá lâu một lượt. */
const MAX_BATCHES_PER_TICK = 20;
/** Nhịp hỏi "đối chiếu tới hạn chưa". Mỗi lần chỉ đọc một dòng maintenance_jobs. */
const CHECK_POLL_MS = 10 * 60 * 1000;
/**
 * Coi là tới hạn sớm hơn chừng này: lần trước ghi mốc SAU khi chạy xong, nên nếu so đúng 24 giờ
 * thì lượt hỏi trùng giờ hôm sau luôn hụt vài giây và giờ đối chiếu trôi muộn dần mỗi ngày.
 */
const CHECK_EARLY_MS = 5 * 60 * 1000;


function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
}

/** Nội dung cột cursor của dòng "stock-committed-sweep" — để soi sức khỏe nhịp bảo trì bằng một câu SELECT. */
interface SweepRecord {
  at: string;
  /** Thời gian chạy của nhịp gần nhất (ms). */
  ms: number;
  platform: number;
  channelInactive: number;
  /** Số nhịp lỗi LIÊN TIẾP tính tới nhịp này (0 = nhịp này chạy xong). */
  failStreak: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

async function readSweepRecord(): Promise<Partial<SweepRecord>> {
  const row = await prisma.maintenanceJob.findUnique({ where: { key: SWEEP_JOB_KEY }, select: { cursor: true } });
  try {
    return row?.cursor ? (JSON.parse(row.cursor) as Partial<SweepRecord>) : {};
  } catch {
    return {};
  }
}

/** Ghi kết quả một nhịp bảo trì. `processed` cộng dồn số đơn "sàn đã giao" mà quét bù phải bắt. */
async function writeSweepRecord(rec: SweepRecord): Promise<void> {
  const cursor = JSON.stringify(rec);
  await prisma.maintenanceJob.upsert({
    where: { key: SWEEP_JOB_KEY },
    create: { key: SWEEP_JOB_KEY, cursor, processed: rec.platform },
    update: { cursor, processed: { increment: rec.platform }, updatedAt: new Date() },
  });
}

let running = false;

/** MỘT NHỊP BẢO TRÌ: ngày chuyển → gỡ dấu còn sót → quét bù. Mỗi bước một `try` riêng. */
export async function runStockCommittedTick(): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  const batch = envInt("STOCK_COMMITTED_BATCH", 200, 1, 1000);
  const errors: string[] = [];
  let platform = 0;
  let channelInactive = 0;
  try {
    // Hai việc một lần phải xong TRƯỚC khi quét bù: quét bù trên bộ đếm chưa dựng xong là vô nghĩa.
    let ready = true;
    try {
      const cut = await runCutoverIfNeeded(batch);
      if (!cut.alreadyDone && cut.done) console.log(`${TAG} ngày chuyển XONG: đưa ${cut.orders} đơn đang chờ giao vào bộ đếm`);
      ready = cut.done;
    } catch (err) {
      ready = false;
      errors.push(`ngày chuyển: ${(err as Error).message}`);
    }
    if (ready) {
      try {
        const single = await runSingleMarkIfNeeded();
        if (!single.alreadyDone) console.log(`${TAG} chuyển sang một dấu XONG: gỡ dấu giữ còn sót của ${single.cleared} đơn đã rời kho`);
      } catch (err) {
        ready = false;
        errors.push(`gỡ dấu còn sót: ${(err as Error).message}`);
      }
    }
    if (ready) {
      try {
        const s = await sweepShipped({ batch, maxBatches: MAX_BATCHES_PER_TICK });
        platform = s.platform;
        channelInactive = s.channelInactive;
        if (s.platform > 0) {
          console.warn(
            `${TAG} quét bù BẮT ĐƯỢC ${s.platform} đơn sàn đã giao mà chưa qua đường rời kho theo sự kiện — còn một đường ghi trạng thái chưa gọi rời kho`
          );
        }
        if (s.channelInactive > 0) {
          console.log(`${TAG} quét bù: ${s.channelInactive} đơn của gian không còn hoạt động ra khỏi bộ đếm (${s.quantity} sản phẩm cả hai nhánh)`);
        }
      } catch (err) {
        errors.push(`quét bù: ${(err as Error).message}`);
      }
    }
    for (const e of errors) console.error(`${TAG} lỗi một nhịp, nhịp sau làm lại — ${e}`);
    try {
      const prev = errors.length ? await readSweepRecord() : {};
      const now = new Date().toISOString();
      await writeSweepRecord({
        at: now,
        ms: Date.now() - startedAt,
        platform,
        channelInactive,
        failStreak: errors.length ? (prev.failStreak ?? 0) + 1 : 0,
        lastError: errors.length ? errors.join(" | ").slice(0, 500) : null,
        lastErrorAt: errors.length ? now : null,
      });
    } catch (err) {
      console.error(`${TAG} không ghi được sổ nhịp bảo trì: ${(err as Error).message}`);
    }
  } finally {
    running = false;
  }
}

let checking = false;

/** Đối chiếu nếu đã tới hạn. `try` riêng, lịch riêng — không phụ thuộc quét bù. */
export async function runStockCommittedCheckTick(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const checkHours = envInt("STOCK_COMMITTED_CHECK_HOURS", 24, 0, 720);
    if (checkHours <= 0) return;
    const last = await prisma.maintenanceJob.findUnique({ where: { key: CHECK_JOB_KEY }, select: { updatedAt: true } });
    if (last && Date.now() - last.updatedAt.getTime() < checkHours * 3_600_000 - CHECK_EARLY_MS) return;
    const c = await runCommittedCheck(checkHours);
    const hard = hardMismatch(c);
    const line =
      `${TAG} đối chiếu: ${c.committedOrders} đơn đang giữ, bộ đếm ${c.counterTotal}, tính lại từ đơn ${c.ordersTotal} ` +
      `(lệch ${c.counterMismatch} mã, ${c.levelMismatch} vị trí, ${c.shippedStillMarked} đơn đã rời kho còn dấu); ` +
      `theo "Chờ giao" ${c.awaitingTotal} (lệch ${c.awaitingMismatch} mã); ` +
      `đơn đã hủy còn giữ ${c.cancelledStillCommitted}; giữ lâu nhất ${c.oldestHours} giờ; chuỗi lệch 0 liên tiếp ${c.streak}`;
    if (hard > 0) console.error(`${line} — LỆCH CỨNG, cần soi`);
    else console.log(line);
  } catch (err) {
    console.error(`${TAG} đối chiếu lỗi, lượt hỏi sau làm lại: ${(err as Error).message}`);
  } finally {
    checking = false;
  }
}

export function startStockCommittedWorker(): void {
  if (!stockCommittedOn()) {
    console.log(`${TAG} tắt bằng STOCK_COMMITTED_OFF=1`);
    return;
  }
  const sweepMs = envInt("STOCK_COMMITTED_SWEEP_MS", 3_600_000, 10_000, 86_400_000);
  setTimeout(() => {
    // Lượt đầu: bảo trì xong (ngày chuyển + gỡ dấu còn sót) rồi mới hỏi đối chiếu, để lần đối
    // chiếu đầu tiên sau khi lên bản mới không đếm oan các dấu chưa kịp gỡ.
    void runStockCommittedTick().then(() => runStockCommittedCheckTick());
    setInterval(() => void runStockCommittedTick(), sweepMs).unref();
    setInterval(() => void runStockCommittedCheckTick(), CHECK_POLL_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
