// ============================================================
// WORKER BÙ ID LÁ CHO DÒNG ĐƠN CŨ — Lát 2 (18/10/2026, docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 7.4)
//
// Một gian một lúc, lô 50 đơn, nghỉ 2 giây giữa hai lượt gọi sàn, trần 400 lượt
// mỗi lượt chạy (gian lớn chạy tiếp ở lượt sau nhờ cursor). Tiến độ ghi ở bảng
// order_line_id_backfill (resumable sau restart; đọc bằng SQL / HQ). Việc dài nên
// KHÔNG qua pg-boss (bẫy stately). Nhận gian bằng updateMany có điều kiện.
//   · Gian ACTIVE Shopee/TikTok, chưa ngủ đông: phase orphan → all (hỏi sàn).
//   · Gian DISCONNECTED: phase infer (suy luận hẹp mã ↔ đúng một lá), một lần.
//   · Lỗi (token, sàn, 429 đã qua cửa thử lại của client) → status error, thử lại sau 15'.
// Tắt: ORDER_LINE_ID_BACKFILL_OFF=1.
// ============================================================

import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { inferIdsByUniqueSku, runChannelBackfill } from "../services/order-line-id-backfill";

const POLL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
/** Nhận gian = đẩy nextRunAt ra xa để tiến trình khác không nhận trùng. */
const CLAIM_MS = 60 * 60 * 1000;
const TAG = "[line-id-backfill]";

let running = false;

/** Tạo dòng tiến độ cho gian chưa có (ACTIVE → orphan; DISCONNECTED → infer). Gian ngủ đông bỏ qua. */
export async function seedBackfillRows(): Promise<number> {
  const channels = await prisma.channel.findMany({
    where: {
      channelName: { in: [ChannelName.SHOPEE, ChannelName.TIKTOK] },
      status: { in: ["ACTIVE", "DISCONNECTED"] },
      hibernatedAt: null,
      lineIdBackfill: null,
    },
    select: { id: true, status: true },
  });
  if (channels.length === 0) return 0;
  await prisma.orderLineIdBackfill.createMany({
    data: channels.map((c) => ({ channelId: c.id, phase: c.status === "ACTIVE" ? "orphan" : "infer" })),
    skipDuplicates: true,
  });
  return channels.length;
}

/** Nhận MỘT gian tới hạn (pending / error đã qua giờ thử lại) — trả null nếu không có. */
async function claimOne(): Promise<{ channelId: string; phase: string; cursorAt: Date | null } | null> {
  const now = new Date();
  const cand = await prisma.orderLineIdBackfill.findFirst({
    where: { status: { in: ["pending", "error"] }, nextRunAt: { lte: now } },
    orderBy: [{ phase: "asc" }, { nextRunAt: "asc" }], // "all" < "infer" < "orphan" theo chữ — không quan trọng, chỉ cần ổn định
    select: { channelId: true, phase: true, cursorAt: true, status: true },
  });
  if (!cand) return null;
  const claimed = await prisma.orderLineIdBackfill.updateMany({
    where: { channelId: cand.channelId, status: cand.status, nextRunAt: cand.status === "pending" ? undefined : { lte: now } },
    data: { status: "running", startedAt: now, nextRunAt: new Date(now.getTime() + CLAIM_MS), updatedAt: now },
  });
  return claimed.count === 1 ? { channelId: cand.channelId, phase: cand.phase, cursorAt: cand.cursorAt } : null;
}

export async function runLineIdBackfillOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const seeded = await seedBackfillRows();
    if (seeded > 0) console.log(`${TAG} thêm ${seeded} gian vào hàng chờ bù id`);
    const job = await claimOne();
    if (!job) return;
    const channel = await prisma.channel.findUnique({ where: { id: job.channelId } });
    const now = new Date();
    if (!channel) return;
    try {
      if (job.phase === "infer" || channel.status !== "ACTIVE") {
        const n = await inferIdsByUniqueSku(channel.id);
        await prisma.orderLineIdBackfill.update({
          where: { channelId: channel.id },
          data: { status: "done", phase: "infer", linesSet: { increment: n }, finishedAt: new Date(), updatedAt: new Date() },
        });
        console.log(`${TAG} ${channel.channelName} ${channel.shopName}: suy luận hẹp ghi ${n} dòng (gian không gọi được sàn)`);
        return;
      }
      const r = await runChannelBackfill(channel, { phase: job.phase === "all" ? "all" : "orphan", cursorAt: job.cursorAt });
      const done = r.phase === "done";
      await prisma.orderLineIdBackfill.update({
        where: { channelId: channel.id },
        data: {
          status: done ? "done" : "pending",
          phase: done ? "all" : r.phase,
          cursorAt: r.cursorAt,
          ordersDone: { increment: r.ordersDone },
          linesSet: { increment: r.linesSet },
          linesSpu: { increment: r.linesSpu },
          linesSkipped: { increment: r.linesSkipped },
          apiCalls: { increment: r.apiCalls },
          lastError: null,
          nextRunAt: new Date(),
          finishedAt: done ? new Date() : null,
          updatedAt: new Date(),
        },
      });
      console.log(
        `${TAG} ${channel.channelName} ${channel.shopName}: ${r.ordersDone} đơn, ghi id ${r.linesSet}, ghi SPU ${r.linesSpu}, bỏ ${r.linesSkipped}, ${r.apiCalls} lượt gọi → ${done ? "XONG" : `còn tiếp (${r.phase})`}`
      );
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await prisma.orderLineIdBackfill.update({
        where: { channelId: channel.id },
        data: { status: "error", lastError: msg, nextRunAt: new Date(now.getTime() + RETRY_MS), updatedAt: new Date() },
      });
      console.error(`${TAG} ${channel.channelName} ${channel.shopName}: LỖI, thử lại sau 15': ${msg}`);
    }
  } catch (err) {
    console.error(`${TAG} lượt chạy lỗi:`, err);
  } finally {
    running = false;
  }
}

export function startLineIdBackfillWorker(): void {
  if (process.env.ORDER_LINE_ID_BACKFILL_OFF === "1") {
    console.log(`${TAG} TẮT (ORDER_LINE_ID_BACKFILL_OFF=1)`);
    return;
  }
  setTimeout(() => void runLineIdBackfillOnce(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runLineIdBackfillOnce(), POLL_MS).unref();
  console.log(`${TAG} bật — nhịp ${POLL_MS / 60_000}', lô 50 đơn, nghỉ 2 s giữa hai lượt gọi sàn`);
}
