// ============================================================
// WORKER HẾT GÓI QUÁ ÂN HẠN — mỗi 6 giờ làm hai việc cùng mốc ân hạn:
//   1. NGỦ ĐÔNG gian: đặt cờ Channel.hibernatedAt cho gian của chủ shop hết gói
//      quá ân hạn (services/plan-hibernation.ts, docs/GOI-NGU-DONG-GIAN-HET-HAN.md).
//   2. CRM HQ: hồ sơ chăm sóc của chủ ấy chuyển "Đã rời bỏ" (services/
//      care-auto-status.ts, docs/HQ-CRM-TU-CHUYEN-TRANG-THAI.md, 22/10/2026).
//
// Nhịp 6 giờ là MẶC ĐỊNH TỰ CHỌN: ân hạn tính theo ngày nên không cần quét dày;
// một lượt chỉ đọc thuê bao có currentPeriodEnd < mốc (chỉ mục sẵn) theo trang
// rồi UPDATE theo lô. Lượt đầu 5 phút sau khi bật để không chen vào lúc
// khởi động. Đánh thức gian + chuyển "Đang dùng ổn định" KHÔNG ở đây — nằm
// trong giao dịch ghi kỳ hạn mới (recordPackagePaymentTx).
// Tắt bằng env PLAN_HIBERNATE_OFF=1: chỉ tắt bước ngủ đông (đường lui 15/10:
// gian đã ngủ vẫn ngủ cho tới khi chủ gia hạn; muốn thức hết thì UPDATE
// "Channel" SET "hibernatedAt"=NULL, "nextFastSyncAt"=now() ... như
// wakeChannelData); bước CRM vẫn chạy. CARE_AUTO_CHURN_OFF=1 tắt bước CRM.
// ============================================================

import { hibernateExpiredOwners } from "../services/plan-hibernation";
import { churnExpiredOwners } from "../services/care-auto-status";

const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let started = false;
let running = false;

const hibernateOff = () => process.env.PLAN_HIBERNATE_OFF === "1";
const careChurnOff = () => process.env.CARE_AUTO_CHURN_OFF === "1";

export async function runPlanHibernation(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!hibernateOff()) {
      const r = await hibernateExpiredOwners(now);
      // Log cả lượt 0 gian (4 dòng/ngày) — kiểm prod 15/10 không phân biệt được
      // "chưa chạy" với "không có gì để ngủ" khi chỉ log lúc có gian.
      console.log(`[plan-hibernation] Lượt quét: đặt ngủ đông ${r.channels} gian của ${r.owners} chủ shop hết gói quá ân hạn`);
    }
  } catch (err) {
    console.error("[plan-hibernation] Lỗi lượt quét:", (err as Error).message);
  }
  try {
    if (!careChurnOff()) {
      const c = await churnExpiredOwners(now);
      console.log(
        `[care-auto] Lượt quét CRM: ${c.churned} chủ shop hết gói quá ân hạn → Đã rời bỏ (đọc ${c.scanned}, giữ ${c.keptManual} do Sale đặt tay sau hết gói)`
      );
    }
  } catch (err) {
    console.error("[care-auto] Lỗi lượt quét CRM:", (err as Error).message);
  } finally {
    running = false;
  }
}

export function startPlanHibernateWorker(): void {
  if (started) return;
  started = true;
  if (hibernateOff()) {
    console.log("[plan-hibernation] TẮT bước ngủ đông (PLAN_HIBERNATE_OFF=1) — gian hết gói vẫn được quét như trước 15/10");
  }
  if (careChurnOff()) {
    console.log("[care-auto] TẮT bước CRM (CARE_AUTO_CHURN_OFF=1) — trạng thái chăm sóc không tự chuyển Đã rời bỏ");
  }
  if (hibernateOff() && careChurnOff()) return;
  setTimeout(() => void runPlanHibernation(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runPlanHibernation(), INTERVAL_MS).unref();
  console.log(
    `[plan-hibernation] BẬT — mỗi ${INTERVAL_MS / 3_600_000}h: ${hibernateOff() ? "" : "ngủ đông gian"}${!hibernateOff() && !careChurnOff() ? " + " : ""}${careChurnOff() ? "" : "CRM → Đã rời bỏ"} cho chủ shop hết gói quá ân hạn`
  );
}
