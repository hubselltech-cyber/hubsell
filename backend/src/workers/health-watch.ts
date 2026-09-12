// ============================================================
// SỨC KHỎE HQ — worker chụp số (docs/HQ-SUC-KHOE.md, 12/09/2026)
//
// Anh Trung chốt 12/09 khuya: KHÔNG email, KHÔNG chuông — mọi thứ hiện trên
// trang HQ → Sức khỏe, vượt ngưỡng thì trang tự đỏ. Worker chỉ làm 2 việc để
// trang có dữ liệu theo thời gian:
//   · 2 lần/ngày (anh Trung: "ngày 2 lần là được cho nhẹ"): chụp snapshot
//     (xu hướng 30 ngày + dự báo ngày chạm mốc);
//   · cùng lúc: mốc timeline vừa chạm → ghi reachedAt (hiện "Đã chạm, chưa làm").
// Tắt bằng HEALTH_WATCH_OFF=1.
// ============================================================

import { prisma } from "../lib/prisma";
import { buildTimeline, collectHealth, saveSnapshot } from "../services/platform-health";

const SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000;

let started = false;
let running = false;

export function startHealthWatchWorker(): void {
  if (started) return;
  started = true;
  if (process.env.HEALTH_WATCH_OFF === "1") {
    console.log("[Health] TẮT (HEALTH_WATCH_OFF=1)");
    return;
  }
  setTimeout(() => void runHealthWatch(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runHealthWatch(), SNAPSHOT_INTERVAL_MS).unref();
  console.log(`[Health] BẬT — snapshot + kiểm mốc mỗi ${SNAPSHOT_INTERVAL_MS / 3600000}h (2 lần/ngày, chỉ ghi DB, trang HQ tự đỏ khi vượt ngưỡng)`);
}

/** Một lượt: snapshot + đánh dấu mốc vừa chạm. Export để chạy tay. */
export async function runHealthWatch(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const metrics = await collectHealth();
    await saveSnapshot(metrics);
    const tl = await buildTimeline(metrics);
    const now = new Date();
    for (const m of tl.milestones) {
      if (!m.reached || m.reachedAt || m.milestone.key === "M0") continue;
      await prisma.platformCapacityMilestone.upsert({
        where: { key: m.milestone.key },
        update: { reachedAt: now },
        create: { key: m.milestone.key, reachedAt: now },
      });
      console.warn(`[Health] Chạm mốc ${m.milestone.key}: ${m.milestone.title}`);
    }
  } catch (err) {
    console.error("[Health] Lỗi vòng quét:", (err as Error).message);
  } finally {
    running = false;
  }
}
