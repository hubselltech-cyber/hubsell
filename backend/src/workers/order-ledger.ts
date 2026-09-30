// ============================================================
// WORKER SỔ CÁI ĐƠN (docs/SO-CAI-DON.md) — giữ sổ luôn đúng trong vài giây
//
// Trigger ở database đánh dấu dòng cần tính lại (order_ledger.dirtyAt); worker
// này chỉ làm ba việc:
//   · Mỗi LEDGER_POLL_MS (mặc định 2s): nhặt tới LEDGER_BATCH dòng bẩn (cũ nhất
//     trước), đọc đơn gốc, ghi lại sổ. Chạy được nhiều bản song song (claim
//     bằng UPDATE ... FOR UPDATE SKIP LOCKED); dòng bị cầm quá 10 phút thì bản
//     khác nhặt lại (tiến trình chết giữa lô không kẹt việc).
//   · Lúc khởi động + mỗi đêm ~03:00 giờ VN: tạo sẵn phân mảnh 3 tháng tới,
//     đánh bẩn dòng còn mang phiên bản công thức cũ (tính lại nền), đối soát
//     mẫu sổ ↔ đơn gốc (ghi order_ledger_audit — trang HQ đọc).
//   · Không gửi mail/chuông: mọi dấu hiệu lên HQ Sức khỏe (ledgerStatus).
//
// Tắt bằng LEDGER_WORKER_OFF=1 (sổ vẫn được đánh dấu, chỉ không tính — báo cáo
// dùng sổ sẽ tự tính nốt phần bẩn của kỳ mình cần qua ensureLedgerFresh).
// ============================================================

import {
  auditLedger,
  drainLedgerOnce,
  ensureLedgerPartitions,
  markFormulaVersionStale,
} from "../services/order-ledger";

const POLL_MS = Math.max(500, Number(process.env.LEDGER_POLL_MS ?? 2000) || 2000);
/**
 * Số dòng nhặt mỗi lượt. Mặc định 200 (hạ từ 500 sau 30/09/2026: dựng sổ
 * 42.000 đơn prod làm pool 5 kết nối của worker cạn, hàng đợi webhook và đẩy
 * tồn timeout). Cùng với nghỉ 250ms giữa lô 100 (services/order-ledger.ts),
 * sổ cái nhường database cho luồng đơn của seller; backlog vẫn tiêu hết dần.
 */
const BATCH = Math.min(2000, Math.max(50, Number(process.env.LEDGER_BATCH ?? 100) || 100));
/** Một lượt drain chạy tối đa chừng này rồi nhả cho vòng poll sau (tránh ôm event loop). */
const DRAIN_BUDGET_MS = 20_000;
/** Giờ VN chạy bảo trì đêm. */
const NIGHTLY_HOUR_VN = 3;
const MAINTENANCE_CHECK_MS = 60_000;

let started = false;
let draining = false;
let maintaining = false;
let lastNightlyKey = "";
let consecutiveErrors = 0;

export function startOrderLedgerWorker(): void {
  if (started) return;
  started = true;
  // MẶC ĐỊNH TẮT (30/09/2026): dựng sổ 42.000 đơn trên Supabase compute NANO
  // làm database Unhealthy hai lần trong một giờ, kể cả sau khi hạ lô 100 +
  // nghỉ 500ms. Chỉ bật khi đặt LEDGER_WORKER_ON=1 (sau khi nâng compute hoặc
  // chạy lúc vắng khách). Trigger vẫn đánh dấu dòng bẩn; báo cáo dùng sổ tự
  // tính nốt phần của kỳ mình cần (ensureLedgerFresh); script drain chạy tay.
  if (process.env.LEDGER_WORKER_ON !== "1" || process.env.LEDGER_WORKER_OFF === "1") {
    console.log(
      "[Ledger] TẮT (mặc định; bật bằng LEDGER_WORKER_ON=1) — sổ vẫn được đánh dấu, báo cáo tự tính nốt phần cần"
    );
    return;
  }
  console.log(`[Ledger] BẬT — tính lại sổ cái đơn: lô ${BATCH}, nhịp ${POLL_MS}ms; bảo trì đêm ${NIGHTLY_HOUR_VN}h VN`);
  setTimeout(() => void runStartupMaintenance(), 15_000).unref();
  setInterval(() => void drain(), POLL_MS).unref();
  setInterval(() => void nightlyTick(), MAINTENANCE_CHECK_MS).unref();
}

/** Một lượt tiêu thụ hàng đợi bẩn — EXPORT để test/script gọi trực tiếp. */
export async function drain(): Promise<{ processed: number }> {
  if (draining) return { processed: 0 };
  draining = true;
  const t0 = Date.now();
  let processed = 0;
  try {
    for (;;) {
      const r = await drainLedgerOnce(BATCH);
      processed += r.claimed;
      if (r.claimed === 0) break;
      if (r.missing > 0) console.log(`[Ledger] ${r.missing} đơn đã bị xóa trong lúc chờ tính — bỏ qua`);
      if (Date.now() - t0 > DRAIN_BUDGET_MS) break;
    }
    if (processed > 0 && consecutiveErrors > 0) {
      console.log(`[Ledger] Đã hồi phục sau ${consecutiveErrors} lượt lỗi`);
    }
    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors += 1;
    // Lỗi lặp (DB rớt, thiếu bảng khi migration chưa chạy) — log thưa dần để
    // không ngập log; dòng bẩn vẫn nằm đó chờ lượt sau.
    if (consecutiveErrors <= 3 || consecutiveErrors % 30 === 0) {
      console.error(`[Ledger] Lỗi lượt tính lại (lần ${consecutiveErrors}):`, (err as Error).message);
    }
  } finally {
    draining = false;
  }
  return { processed };
}

async function runStartupMaintenance(): Promise<void> {
  try {
    const created = await ensureLedgerPartitions(3);
    if (created > 0) console.log(`[Ledger] Tạo ${created} phân mảnh tháng mới`);
    await sweepFormulaVersion();
  } catch (err) {
    console.error("[Ledger] Lỗi bảo trì lúc khởi động:", (err as Error).message);
  }
}

/** Đánh bẩn dần các dòng còn mang phiên bản công thức cũ (mỗi lô 5.000, nghỉ 2s). */
async function sweepFormulaVersion(): Promise<void> {
  let total = 0;
  for (;;) {
    const n = await markFormulaVersionStale(5000);
    total += n;
    if (n < 5000) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (total > 0) console.log(`[Ledger] Đánh dấu ${total} dòng phiên bản cũ để tính lại nền`);
}

function vnDateHourKey(now = new Date()): { key: string; hour: number } {
  const t = new Date(now.getTime() + 7 * 3_600_000);
  return { key: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

async function nightlyTick(): Promise<void> {
  const { key, hour } = vnDateHourKey();
  if (hour !== NIGHTLY_HOUR_VN || lastNightlyKey === key || maintaining) return;
  maintaining = true;
  lastNightlyKey = key;
  try {
    await runNightlyMaintenance();
  } finally {
    maintaining = false;
  }
}

/** Bảo trì đêm — EXPORT để chạy tay (script / route HQ). */
export async function runNightlyMaintenance(): Promise<void> {
  try {
    const created = await ensureLedgerPartitions(3);
    if (created > 0) console.log(`[Ledger] Tạo ${created} phân mảnh tháng mới`);
    await sweepFormulaVersion();
    const a = await auditLedger(Number(process.env.LEDGER_AUDIT_SAMPLE ?? 200) || 200);
    const level =
      a.mismatched > 0 || a.defaultRows > 0 || a.staleDirty > 0 || a.duplicateOrders > 0 ? "warn" : "log";
    console[level](
      `[Ledger] Đối soát đêm: mẫu ${a.sampled}, lệch ${a.mismatched}, dòng đôi ${a.duplicateOrders}, bẩn tồn ${a.dirtyBacklog} (quá hạn ${a.staleDirty}), mảnh DEFAULT ${a.defaultRows} dòng, ${a.durationMs}ms`
    );
  } catch (err) {
    console.error("[Ledger] Lỗi bảo trì đêm:", (err as Error).message);
  }
}
