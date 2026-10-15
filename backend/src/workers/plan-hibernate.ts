// ============================================================
// WORKER NGỦ ĐÔNG GIAN HẾT GÓI — đặt cờ Channel.hibernatedAt cho gian của chủ shop
// hết gói quá ân hạn (services/plan-hibernation.ts, docs/GOI-NGU-DONG-GIAN-HET-HAN.md).
//
// Nhịp 6 giờ là MẶC ĐỊNH TỰ CHỌN: ân hạn tính theo ngày nên không cần quét dày;
// một lượt chỉ đọc thuê bao có currentPeriodEnd < mốc (chỉ mục sẵn) theo trang
// rồi một UPDATE theo lô. Lượt đầu 5 phút sau khi bật để không chen vào lúc
// khởi động. Đánh thức KHÔNG ở đây — nằm trong giao dịch ghi kỳ hạn mới.
// Tắt bằng env PLAN_HIBERNATE_OFF=1 (đường lui: gian đã ngủ vẫn ngủ cho tới
// khi chủ gia hạn; muốn thức hết thì UPDATE "Channel" SET "hibernatedAt"=NULL,
// "nextFastSyncAt"=now() ... như wakeChannelData).
// ============================================================

import { hibernateExpiredOwners } from "../services/plan-hibernation";

const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let started = false;
let running = false;

export async function runPlanHibernation(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await hibernateExpiredOwners(now);
    if (r.channels > 0) {
      console.log(`[plan-hibernation] Đặt ngủ đông ${r.channels} gian của ${r.owners} chủ shop hết gói quá ân hạn`);
    }
  } catch (err) {
    console.error("[plan-hibernation] Lỗi lượt quét:", (err as Error).message);
  } finally {
    running = false;
  }
}

export function startPlanHibernateWorker(): void {
  if (started) return;
  started = true;
  if (process.env.PLAN_HIBERNATE_OFF === "1") {
    console.log("[plan-hibernation] TẮT (PLAN_HIBERNATE_OFF=1) — gian hết gói vẫn được quét như trước 15/10");
    return;
  }
  setTimeout(() => void runPlanHibernation(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runPlanHibernation(), INTERVAL_MS).unref();
  console.log(`[plan-hibernation] BẬT — mỗi ${INTERVAL_MS / 3_600_000}h đặt ngủ đông gian của chủ shop hết gói quá ân hạn`);
}
