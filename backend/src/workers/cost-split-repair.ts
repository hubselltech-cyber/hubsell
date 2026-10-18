// ============================================================
// WORKER SỬA MỘT LẦN GIÁ VỐN LÁ TÁCH 15/10 — Lát 3 (18/10/2026, docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 8)
//
// Chạy MỘT lượt sau khi worker khởi động (3'): một câu UPDATE toàn nền tảng + vá
// dòng đơn của các lá nhận giá. Idempotent và cửa sổ tạo lá cố định (15/10 → 19/10)
// nên mỗi lần khởi động chạy lại cũng vô hại — lượt đầu ghi ~740 lá / 11 gian (đo
// 18/10), các lượt sau 0. Không lịch, không lặp. Tắt: COST_SPLIT_REPAIR_OFF=1.
// ============================================================

import { repairSplitLeafCosts } from "../services/cost-split-repair";

const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;
const TAG = "[cost-split-repair]";

export async function runCostSplitRepairOnce(): Promise<void> {
  try {
    const r = await repairSplitLeafCosts();
    if (r.leaves === 0) {
      console.log(`${TAG} không còn lá tách 15/10 nào thiếu giá vốn có lịch sử — không ghi gì`);
      return;
    }
    console.log(`${TAG} trả lại giá vốn cho ${r.leaves} lá tách 15/10 ở ${r.channels} gian; vá ${r.orderLines} dòng đơn giá vốn 0`);
  } catch (err) {
    console.error(`${TAG} lỗi:`, err);
  }
}

export function startCostSplitRepairWorker(): void {
  if (process.env.COST_SPLIT_REPAIR_OFF === "1") {
    console.log(`${TAG} TẮT (COST_SPLIT_REPAIR_OFF=1)`);
    return;
  }
  setTimeout(() => void runCostSplitRepairOnce(), FIRST_RUN_DELAY_MS).unref();
}
