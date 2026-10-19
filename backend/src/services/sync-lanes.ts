// ============================================================
// LÀN + THUÊ BAO CÓ NHỊP TIM (N6) — Pha B "Nền" lát B3, docs/CUNG-HOA-LOP-GOI-SAN.md mục 5b
//
// Hàng việc = bảng `sync_cursors` (một dòng = một (gian, luồng)). Mỗi làn:
//   • nhặt việc tới hạn bằng FOR UPDATE SKIP LOCKED, `dueAt` sớm nhất trước —
//     lượt đọc bị ngân sách cắt (status "budget") đặt dueAt = now nên quay lại
//     ngay nhưng XẾP SAU gian đã chờ lâu hơn → chia đều theo độ trễ, gian nhỏ
//     không đói vì gian lớn;
//   • thuê bao `leaseUntil` thay khóa 15' cứng: nhịp tim gia hạn mỗi TTL/3;
//     tiến trình chết → hết hạn → tiến trình khác nhặt (không có khóa mồ côi);
//     mất thuê bao (bị nhặt lại) → báo hủy cho việc đang chạy, KHÔNG ghi đè;
//   • lấp suất ngay khi có suất trống (không chờ nhịp 20 s); không có việc mới ngủ.
// Mỗi làn một vòng chạy với số luồng riêng (bulkhead): làn kẹt không lan.
//
// CHƯA đăng ký worker — Pha C bật từng luồng theo cờ gian.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { LEASE, type SyncLane } from "../config/marketplace-read";

export interface LeaseItem {
  channelId: string;
  stream: string;
  lane: string;
}

export const leaseKey = (i: { channelId: string; stream: string }) => `${i.channelId}/${i.stream}`;

export interface LeaseStore {
  /** Nhặt tối đa n việc tới hạn của làn, cầm thuê bao `leaseMs`. */
  claim(lane: string, n: number, owner: string, leaseMs: number): Promise<LeaseItem[]>;
  /** Gia hạn; trả tập khóa VẪN đang cầm (thiếu = đã mất thuê bao). */
  heartbeat(items: LeaseItem[], owner: string, leaseMs: number): Promise<Set<string>>;
  /** Trả việc: hẹn lượt kế ở `dueAt`. Không còn cầm thì không làm gì. */
  release(item: LeaseItem, owner: string, dueAt: Date): Promise<void>;
}

/** Việc của một lượt: trả số ms tới lượt kế. `signal` hủy khi mất thuê bao hoặc dừng làn. */
export type LaneHandler = (item: LeaseItem, signal: AbortSignal) => Promise<number>;

export interface LaneOptions {
  lane: SyncLane | string;
  concurrency: number;
  owner: string;
  store: LeaseStore;
  handle: LaneHandler;
  stop: AbortSignal;
  leaseMs?: number;
  idlePollMs?: number;
  /** Việc ném lỗi → hẹn lại sau bao lâu (cổng đã ném GatewayDeferError thì handler tự trả waitMs). */
  errorRetryMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** Chạy một làn tới khi `stop` báo dừng; trả số lượt đã chạy (đo). */
export async function runLane(o: LaneOptions): Promise<{ runs: number; lost: number; errors: number }> {
  const leaseMs = o.leaseMs ?? LEASE.TTL_MS;
  const idleMs = o.idlePollMs ?? LEASE.IDLE_POLL_MS;
  const errorRetryMs = o.errorRetryMs ?? LEASE.ERROR_RETRY_MS;
  const active = new Map<string, { item: LeaseItem; ctl: AbortController; done: Promise<void> }>();
  const stats = { runs: 0, lost: 0, errors: 0 };
  // Đánh thức vòng nhặt khi một việc xong; cờ giữ tín hiệu nếu nó tới lúc vòng chưa kịp chờ.
  let signalled = false;
  let resolver: (() => void) | null = null;
  const wake = () => {
    signalled = true;
    resolver?.();
  };

  const beat = setInterval(async () => {
    const items = [...active.values()].map((a) => a.item);
    if (!items.length) return;
    try {
      const held = await o.store.heartbeat(items, o.owner, leaseMs);
      for (const it of items) {
        const k = leaseKey(it);
        if (!held.has(k) && active.has(k)) {
          stats.lost++;
          console.warn(`[lane ${o.lane}] mất thuê bao ${k} — hủy lượt, không ghi đè`);
          active.get(k)!.ctl.abort();
        }
      }
    } catch (err) {
      console.warn(`[lane ${o.lane}] nhịp tim lỗi: ${(err as Error).message}`);
    }
  }, Math.max(10, Math.floor(leaseMs / LEASE.HEARTBEAT_DIVISOR)));

  const start = (item: LeaseItem) => {
    const k = leaseKey(item);
    const ctl = new AbortController();
    const onStop = () => ctl.abort();
    o.stop.addEventListener("abort", onStop, { once: true });
    const done = (async () => {
      let nextMs = errorRetryMs;
      try {
        nextMs = await o.handle(item, ctl.signal);
      } catch (err) {
        stats.errors++;
        const w = (err as { waitMs?: unknown }).waitMs;
        nextMs = typeof w === "number" && w >= 0 ? w : errorRetryMs;
        console.warn(`[lane ${o.lane}] ${k}: ${(err as Error).message?.slice(0, 200)}`);
      } finally {
        stats.runs++;
        o.stop.removeEventListener("abort", onStop);
        active.delete(k);
        // Mất thuê bao thì release tự thành no-op (WHERE leaseOwner = mình).
        await o.store.release(item, o.owner, new Date(Date.now() + Math.max(0, nextMs))).catch((e) =>
          console.warn(`[lane ${o.lane}] trả việc ${k} lỗi: ${(e as Error).message}`)
        );
        wake();
      }
    })();
    active.set(k, { item, ctl, done });
  };

  try {
    while (!o.stop.aborted) {
      // Mỗi vòng nhường một nhịp vòng sự kiện: việc chỉ toàn microtask (sàn trả từ bộ đệm, test)
      // không được bỏ đói bộ hẹn giờ — nhịp tim thuê bao chạy bằng setInterval.
      await new Promise<void>((r) => setImmediate(r));
      const free = o.concurrency - active.size;
      let claimed = 0;
      if (free > 0) {
        try {
          const items = await o.store.claim(o.lane, free, o.owner, leaseMs);
          claimed = items.length;
          for (const it of items) start(it);
        } catch (err) {
          console.warn(`[lane ${o.lane}] nhặt việc lỗi: ${(err as Error).message}`);
        }
      }
      // Còn suất mà vừa nhặt đủ → nhặt tiếp ngay; hết suất hoặc hết việc → chờ một việc xong / nhịp hỏi lại.
      if (claimed > 0 && claimed === free) continue;
      if (!signalled) {
        await new Promise<void>((resolve) => {
          resolver = resolve;
          void sleep(idleMs, o.stop).then(resolve);
        });
        resolver = null;
      }
      signalled = false;
    }
  } finally {
    clearInterval(beat);
    await Promise.allSettled([...active.values()].map((a) => a.done));
  }
  return stats;
}

// ---------- Kho Postgres ----------
// Cột TIMESTAMP(3) KHÔNG múi giờ, Prisma ghi giờ UTC → mọi `now()` / tham số Date trong
// SQL thô phải quy về UTC tường minh, không thì lệch theo múi giờ phiên (DB dev +7).
const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

export const pgLeaseStore: LeaseStore = {
  async claim(lane, n, owner, leaseMs) {
    if (n <= 0) return [];
    return prisma.$queryRaw<LeaseItem[]>`
      UPDATE "sync_cursors" c
         SET "leaseOwner" = ${owner}, "leaseUntil" = ${NOW_UTC} + make_interval(secs => ${leaseMs / 1000}::double precision)
        FROM (
          SELECT "channelId", "stream" FROM "sync_cursors"
           WHERE "lane" = ${lane} AND "dueAt" <= ${NOW_UTC}
             AND ("leaseUntil" IS NULL OR "leaseUntil" < ${NOW_UTC})
           ORDER BY "dueAt"
           LIMIT ${n}
           FOR UPDATE SKIP LOCKED
        ) pick
       WHERE c."channelId" = pick."channelId" AND c."stream" = pick."stream"
      RETURNING c."channelId", c."stream", c."lane"`;
  },
  async heartbeat(items, owner, leaseMs) {
    if (!items.length) return new Set();
    const rows = await prisma.$queryRaw<{ channelId: string; stream: string }[]>`
      UPDATE "sync_cursors"
         SET "leaseUntil" = ${NOW_UTC} + make_interval(secs => ${leaseMs / 1000}::double precision)
       WHERE "leaseOwner" = ${owner}
         AND ("channelId", "stream") IN (
           SELECT * FROM unnest(${items.map((i) => i.channelId)}::text[], ${items.map((i) => i.stream)}::text[]))
      RETURNING "channelId", "stream"`;
    return new Set(rows.map(leaseKey));
  },
  async release(item, owner, dueAt) {
    await prisma.$executeRaw`
      UPDATE "sync_cursors" SET "leaseOwner" = NULL, "leaseUntil" = NULL, "dueAt" = (${dueAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')
       WHERE "channelId" = ${item.channelId} AND "stream" = ${item.stream} AND "leaseOwner" = ${owner}`;
  },
};

/**
 * Ghi danh một (gian, luồng) vào làn — Pha C gọi khi bật cờ gian. Đã có thì chỉ
 * đổi làn (con trỏ giữ nguyên). `initialCursorAt` = mốc bắt đầu đọc của gian mới.
 */
export async function enrollStream(channelId: string, stream: string, lane: SyncLane, initialCursorAt: Date, windowMs: number) {
  await prisma.syncCursor.upsert({
    where: { channelId_stream: { channelId, stream } },
    update: { lane },
    create: { channelId, stream, lane, cursorAt: initialCursorAt, windowMs, dueAt: new Date() },
  });
}
