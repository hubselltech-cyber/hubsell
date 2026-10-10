// ============================================================
// TỰ ĐỘNG TRẢ LỜI ĐÁNH GIÁ — WORKER MỖI NGÀY MỘT LẦN / SHOP (10/10/2026)
//
// Lõi ở services/review-auto-reply.ts. Worker chỉ lo lịch:
//   · Poll 1 phút: nhặt tối đa CLAIM_BATCH dòng review_auto_reply_config có
//     nextRunAt ≤ now (chỉ mục nextRunAt), chạy song song tối đa CONCURRENCY shop.
//   · Giành lượt bằng updateMany có điều kiện (đẩy nextRunAt ra CLAIM_MS) →
//     hai worker không chạy trùng một shop.
//   · Xong → lastRun* + nextRunAt = khung giờ cố định của shop NGÀY MAI
//     (08:00–20:00 giờ VN, rải theo ownerId).
//   · Mỗi giờ dọn sổ review_auto_replies cũ hơn RETENTION_DAYS (đánh giá đó đã
//     có trả lời trên sàn nên không còn lọt vào lượt quét).
// KHÔNG dùng pg-boss: một lượt shop nhiều gian Lazada chạy cả phút, sẽ chặn
// hàng đợi (gotcha pg-boss stately).
// Tắt: REVIEW_AUTO_REPLY_OFF=1.
// ============================================================

import { prisma } from "../lib/prisma";
import { nextDailySlot, runReviewAutoReplyForOwner } from "../services/review-auto-reply";

const POLL_MS = 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000;
const CLAIM_BATCH = 40;
const CONCURRENCY = 8;
/** Giành lượt = đẩy lịch ra 2 giờ; tiến trình chết giữa chừng thì 2 giờ sau chạy lại. */
const CLAIM_MS = 2 * 60 * 60 * 1000;
const RETENTION_DAYS = 180;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;

let started = false;
let running = false;
let lastCleanupAt = 0;

export function startReviewAutoReplyWorker(): void {
  if (started) return;
  started = true;
  if (process.env.REVIEW_AUTO_REPLY_OFF === "1") {
    console.log("[Review-auto-reply] TẮT (REVIEW_AUTO_REPLY_OFF=1)");
    return;
  }
  setTimeout(() => void runReviewAutoReplyCycle(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runReviewAutoReplyCycle(), POLL_MS).unref();
  console.log(
    `[Review-auto-reply] BẬT — mỗi shop 1 lần/ngày (08:00–20:00 VN), poll ${POLL_MS / 1000}s, ${CONCURRENCY} shop song song`
  );
}

async function runOne(id: string, ownerId: string, nextRunAt: Date): Promise<void> {
  const now = new Date();
  const claimed = await prisma.reviewAutoReplyConfig.updateMany({
    where: { id, nextRunAt },
    data: { nextRunAt: new Date(now.getTime() + CLAIM_MS) },
  });
  if (claimed.count === 0) return;
  const cfg = await prisma.reviewAutoReplyConfig.findUnique({ where: { id } });
  if (!cfg) return;
  if (cfg.enabledStars.length === 0) {
    // Chủ shop vừa tắt hết đúng lúc giành lượt → bỏ lịch, đừng nhặt lại mỗi 2 giờ.
    await prisma.reviewAutoReplyConfig.updateMany({
      where: { id, enabledStars: { isEmpty: true } },
      data: { nextRunAt: null },
    });
    return;
  }

  try {
    const r = await runReviewAutoReplyForOwner(cfg, now);
    // Chủ shop có thể vừa tắt hết trong lúc chạy → chỉ ghi lịch khi còn bật.
    await prisma.reviewAutoReplyConfig.updateMany({
      where: { id, enabledStars: { isEmpty: false } },
      data: {
        lastRunAt: now,
        lastRunReplied: r.replied,
        lastRunFailed: r.failed,
        lastRunError: r.firstError?.slice(0, 500) ?? null,
        nextRunAt: nextDailySlot(now, ownerId),
      },
    });
    if (r.replied > 0 || r.failed > 0) {
      console.log(
        `[Review-auto-reply] owner ${ownerId}: trả lời ${r.replied}, lỗi ${r.failed}${r.firstError ? ` — ${r.firstError}` : ""}`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Review-auto-reply] owner ${ownerId} lỗi:`, msg);
    await prisma.reviewAutoReplyConfig
      .updateMany({
        where: { id, enabledStars: { isEmpty: false } },
        data: { lastRunAt: now, lastRunError: msg.slice(0, 500), nextRunAt: nextDailySlot(now, ownerId) },
      })
      .catch(() => {});
  }
}

/** Một lượt poll. Export để chạy tay / test. */
export async function runReviewAutoReplyCycle(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const due = await prisma.reviewAutoReplyConfig.findMany({
      where: { nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: "asc" },
      take: CLAIM_BATCH,
      select: { id: true, ownerId: true, nextRunAt: true },
    });
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      await Promise.all(
        due
          .slice(i, i + CONCURRENCY)
          .map((d) => runOne(d.id, d.ownerId, d.nextRunAt!).catch(() => {}))
      );
    }
    if (Date.now() - lastCleanupAt > CLEANUP_EVERY_MS) {
      lastCleanupAt = Date.now();
      await prisma.reviewAutoReply
        .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } } })
        .catch(() => {});
    }
    return due.length;
  } catch (e) {
    console.error("[Review-auto-reply] lượt poll lỗi:", e instanceof Error ? e.message : e);
    return 0;
  } finally {
    running = false;
  }
}
