// ============================================================
// XÓA HẲN MỘT GIAN HÀNG — theo LÔ, chịu được gian hàng trăm nghìn đơn
// (anh Trung chốt 30/09/2026 tối: "làm cho xong khi còn ít người dùng").
//
// Trước đây route gọi thẳng prisma.channel.delete: MỘT câu lệnh, một giao dịch,
// kéo theo mọi đơn + dòng hàng + sổ cái của gian. Gian lớn thì giao dịch đó kéo
// dài nhiều phút, giữ khóa và dồn ghi vào database trong suốt thời gian ấy.
// Ở đây đơn được xóa từng lô nhỏ (mỗi lô một câu lệnh ngắn, có nhịp nghỉ), xong
// mới xóa dòng gian — phần còn lại treo vào gian (sản phẩm sàn, quảng cáo, nhật
// ký đồng bộ…) đi theo khóa ngoại ON DELETE CASCADE như cũ.
//
//   · Dừng giữa chừng (deploy, tiến trình tắt) KHÔNG hỏng gì: gian vẫn ở trạng
//     thái đã ngắt với số đơn còn lại, bấm Xóa lần nữa là chạy tiếp.
//   · Mỗi lô kiểm lại trạng thái: gian được NỐI LẠI trong lúc đang xóa thì dừng
//     ngay, không xóa gian đang hoạt động.
//   · Trong một tiến trình, một gian chỉ có một lượt xóa chạy (bấm hai lần dùng
//     chung lượt đang chạy).
//
// Số đo trên DB dev 30/09/2026 (gian thử 300.000 đơn, sau khi bỏ khóa ngoại
// order_line_ledger.orderItemId): 1.000 đơn ≈ 0,6 giây, 5.000 đơn ≈ 3 giây.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** Số đơn mỗi câu DELETE. 1.000 là mặc định tự chọn theo số đo trên: mỗi câu dưới ~1 giây. */
export const CHANNEL_DELETE_BATCH = 1000;
/** Nghỉ giữa hai lô — nhường database cho luồng đơn của các shop khác (mặc định tự chọn). */
export const CHANNEL_DELETE_PAUSE_MS = 100;
/**
 * Route chờ tối đa bấy lâu rồi trả lời "đang xóa nốt ở nền". 20 giây là mặc định
 * tự chọn: theo số đo trên thì gian tới khoảng 25.000 đơn xong ngay trong lượt
 * bấm; gian lớn hơn không bắt trình duyệt treo tới khi bị cắt kết nối.
 */
export const CHANNEL_DELETE_INLINE_BUDGET_MS = 20_000;

export interface ChannelDeleteOutcome {
  /** deleted = đã xóa xong; reconnected = gian đang hoạt động (được nối lại) nên dừng; gone = gian không còn. */
  status: "deleted" | "reconnected" | "gone";
  deletedOrders: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running = new Map<string, Promise<ChannelDeleteOutcome>>();

async function run(
  channelId: string,
  opts: { batch: number; pauseMs: number }
): Promise<ChannelDeleteOutcome> {
  let deletedOrders = 0;
  for (;;) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { status: true } });
    if (!channel) return { status: "gone", deletedOrders };
    if (channel.status === "ACTIVE") return { status: "reconnected", deletedOrders };
    const n = await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "Order"
      WHERE "id" IN (SELECT "id" FROM "Order" WHERE "channelId" = ${channelId} LIMIT ${opts.batch}::int)
    `);
    deletedOrders += n;
    if (n < opts.batch) break;
    if (opts.pauseMs > 0) await sleep(opts.pauseMs);
  }
  // Xóa dòng gian CHỈ KHI vẫn chưa hoạt động lại (điều kiện nằm ngay trong câu lệnh).
  const removed = await prisma.channel.deleteMany({ where: { id: channelId, status: { not: "ACTIVE" } } });
  if (removed.count === 1) return { status: "deleted", deletedOrders };
  const still = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true } });
  return { status: still ? "reconnected" : "gone", deletedOrders };
}

/** Bắt đầu (hoặc nhập vào) lượt xóa của một gian. Nơi gọi đã kiểm quyền và trạng thái đã ngắt. */
export function startChannelDelete(
  channelId: string,
  opts: { batch?: number; pauseMs?: number } = {}
): Promise<ChannelDeleteOutcome> {
  const existing = running.get(channelId);
  if (existing) return existing;
  const job = run(channelId, {
    batch: Math.max(1, Math.floor(opts.batch ?? CHANNEL_DELETE_BATCH)),
    pauseMs: Math.max(0, opts.pauseMs ?? CHANNEL_DELETE_PAUSE_MS),
  }).finally(() => running.delete(channelId));
  running.set(channelId, job);
  return job;
}

export type ChannelDeleteResult =
  | { pending: false; outcome: ChannelDeleteOutcome }
  /** Chưa xong trong thời gian chờ — `job` vẫn chạy tiếp ở nền. */
  | { pending: true; job: Promise<ChannelDeleteOutcome> };

/** Xóa gian, chờ tối đa `budgetMs`; quá thì trả về lượt đang chạy để nơi gọi theo dõi tiếp. */
export async function deleteChannelWithin(
  channelId: string,
  budgetMs: number = CHANNEL_DELETE_INLINE_BUDGET_MS,
  opts: { batch?: number; pauseMs?: number } = {}
): Promise<ChannelDeleteResult> {
  const job = startChannelDelete(channelId, opts);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, budgetMs));
  });
  try {
    const first = await Promise.race([job, timeout]);
    return first === "timeout" ? { pending: true, job } : { pending: false, outcome: first };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
