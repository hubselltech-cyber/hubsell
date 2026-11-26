// ============================================================
// WORKER CHI PHÍ ĐỊNH KỲ — mỗi giờ ghi các khoản chi tới hạn của mọi luật còn chạy
// (services/recurring-expense.ts: mỗi lô MỘT câu INSERT … SELECT, không vòng for từng
// chủ shop, không khóa trong RAM, không qua pg-boss).
//
// Vì sao mỗi giờ chứ không phải đúng 00:00: câu ghi đi theo MỐC generatedThrough của từng
// luật — lượt thừa không tìm thấy luật nào tới hạn nên gần như không tốn gì, còn worker có
// ngừng mấy ngày (deploy, sự cố) thì lượt đầu sau khi bật lại tự ghi bù đủ các ngày thiếu.
// Ngày mới (giờ VN) bắt đầu lúc 00:00 → khoản của ngày đó được ghi muộn nhất khoảng 01:00.
// Hai worker chạy song song vô hại: FOR UPDATE SKIP LOCKED + (recurringId, expenseDate)
// duy nhất.
// Tắt: env RECURRING_EXPENSE_OFF=1 (đường lui — các khoản đã ghi giữ nguyên; bật lại thì
// ghi bù).
// ============================================================

import { runRecurringExpenseSweep } from "../services/recurring-expense";

/** Lượt đầu sau boot — nhường webhook / đồng bộ đơn nóng máy trước. */
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;

let started = false;
let running = false;

export async function runRecurringExpenseWorker(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await runRecurringExpenseSweep();
    if (r.rules > 0) {
      console.log(`[recurring-expense] Ghi ${r.created} khoản chi định kỳ từ ${r.rules} luật (${r.batches} lô)`);
    }
  } catch (err) {
    console.error("[recurring-expense] Lỗi lượt ghi:", (err as Error).message);
  } finally {
    running = false;
  }
}

/** Khởi động worker (gọi 1 lần từ index.ts — KHÔNG gọi trong test). */
export function startRecurringExpenseWorker(): void {
  if (started) return;
  started = true;
  if (process.env.RECURRING_EXPENSE_OFF === "1") {
    console.log("[recurring-expense] TẮT ghi chi phí định kỳ (RECURRING_EXPENSE_OFF=1)");
    return;
  }
  setTimeout(() => void runRecurringExpenseWorker(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runRecurringExpenseWorker(), INTERVAL_MS).unref();
  console.log("[recurring-expense] BẬT — mỗi giờ ghi các khoản chi phí định kỳ tới hạn");
}
