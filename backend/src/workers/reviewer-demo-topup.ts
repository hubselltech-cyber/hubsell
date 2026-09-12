// ============================================================
// WORKER "BỒI ĐƠN" CHO TÀI KHOẢN REVIEWER ISV — GIỮ TÀI KHOẢN TRIAL LUÔN SỐNG
//
// Bối cảnh: hồ sơ ISV Shopee (nộp 10/09/2026) khai tài khoản trial
// reviewer@hubsell.vn. Tài khoản này do scripts/seed-isv-reviewer.ts sinh:
// 2 gian Shopee + Lazada KHÔNG có token thật, 62 ngày đơn neo theo ngày chạy
// seed. Không ai bồi thì sau 2-3 ngày Tổng quan hiện "hôm nay 0 đơn", đơn
// cuối cách cả tuần — người duyệt (có thể mở bất kỳ lúc nào trong 10 ngày
// làm việc) nhìn như sản phẩm bỏ hoang, trái điều kiện "sản phẩm đang live".
//
// Worker này mỗi nhịp làm 2 việc, CHỈ trên gian của đúng email cấu hình và
// CHỈ khi gian đó không nối sàn thật (refreshToken/externalShopId đều trống):
//
//   1. GIÀ HÓA đơn cũ theo vòng đời thật của một đơn sàn:
//        PENDING ─3h─▶ PROCESSED ─10h─▶ SHIPPING (5% hủy) ─1,5-3,5 ngày─▶
//        DELIVERED ─1-2 ngày─▶ đối soát (phí sàn theo đúng công thức seed);
//        ~2,5% đơn đã giao phát sinh hoàn: AWAITING ─2-7 ngày─▶ về kho ở
//        đủ công đoạn (RECEIVED chờ nhập kho / nguyên vẹn / hư hỏng / khiếu nại).
//      Mọi quyết định ngẫu nhiên đều băm từ id đơn → chạy lại bao nhiêu lần
//      cũng ra đúng một kết quả, không "xóc lại xúc xắc" mỗi nhịp.
//
//   2. BỒI đơn hôm nay: mục tiêu ngày = trung bình 7 ngày trước × jitter theo
//      ngày (0,96-1,08, trôi tăng ~2%/tuần) × hệ số cuối tuần; đơn rải trong khung
//      7h30-22h30 giờ VN theo tỷ lệ thời gian đã trôi → đồ thị trong ngày đi
//      lên dần như shop thật, không nhảy một cục lúc nửa đêm. Ngày nào trong
//      7 ngày gần nhất TRỐNG hẳn (server ngủ, seed cũ) thì bồi bù trọn ngày rồi
//      để bước già hóa đưa về đúng trạng thái theo tuổi. Kèm chi phí ads trong
//      ngày (upsert, tăng dần theo giờ) và chi phí vận hành định kỳ.
//
// Không đụng tồn kho (giữ SKU "sắp hết" cố ý của seed), không xóa gì.
// Cấu hình: REVIEWER_DEMO_TOPUP_MINUTES (mặc định 30; "0" = tắt),
//           REVIEWER_DEMO_EMAIL (mặc định reviewer@hubsell.vn).
// Khi có kết quả ISV (duyệt hoặc từ chối) đặt REVIEWER_DEMO_TOPUP_MINUTES=0
// hoặc gỡ worker — tài khoản trial không cần sống mãi.
// ============================================================

import {
  Carrier,
  ChannelName,
  Prisma,
  ReturnSolution,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";

const DEFAULT_INTERVAL_MINUTES = 30;
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;
export const DEFAULT_REVIEWER_EMAIL = "reviewer@hubsell.vn";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const VN_OFFSET_MS = 7 * HOUR_MS;

/** Khung giờ đơn về trong ngày (giờ VN) — ngoài khung không bồi thêm. */
const WINDOW_START_H = 7.5;
const WINDOW_END_H = 22.5;

/** Ngưỡng già hóa từng bước (giờ / ngày). */
const PENDING_TO_PROCESSED_H = 3;
const PROCESSED_TO_SHIPPING_H = 10;
const TRANSIT_DAYS: [number, number] = [1.5, 3.5];
const SETTLE_DAYS = { SHOPEE: 1, LAZADA: 2 } as const;
const CANCEL_RATE = 0.05;
const RETURN_RATE = 0.025;
const RETURN_REQUEST_DAYS: [number, number] = [1, 3];
const RETURN_TRANSIT_DAYS: [number, number] = [2, 7];
/** Chỉ xét phát sinh hoàn cho đơn giao trong ngần này ngày (seed đã tự rải hoàn cho đơn cũ hơn). */
const RETURN_LOOKBACK_DAYS = 6;

/** Trần đơn tạo mỗi nhịp — server ngủ lâu thì bồi dần vài nhịp, không dội một cục. */
const MAX_CREATE_PER_RUN = 120;
/** Bồi bù ngày trống tối đa ngần này ngày về trước. */
const BACKFILL_DAYS = 7;
const MIN_DAILY_TARGET = 30;

const FIRST = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương"];
const LAST = ["Minh Anh", "Thu Hà", "Quốc Bảo", "Ngọc Lan", "Văn Hùng", "Thảo Vy", "Đức Long", "Kim Ngân", "Gia Hân", "Hải Yến", "Tuấn Kiệt", "Phương Linh", "Bảo Châu", "Anh Thư"];
const RETURN_NOTES = ["Khách đổi ý", "Sai size", "Không đúng mô tả", "Giao chậm, khách hủy nhận"];
const SHOPEE_CARRIERS: { carrier: Carrier; name: string }[] = [
  { carrier: Carrier.SPX, name: "SPX Express" },
  { carrier: Carrier.SPX, name: "SPX Express" },
  { carrier: Carrier.GHN, name: "Giao Hàng Nhanh" },
  { carrier: Carrier.JT, name: "J&T Express" },
];
const LAZADA_CARRIERS: { carrier: Carrier; name: string }[] = [
  { carrier: Carrier.NINJA_VAN, name: "Ninja Van" },
  { carrier: Carrier.GHN, name: "Giao Hàng Nhanh" },
  { carrier: Carrier.BEST, name: "BEST Express" },
];

// ---------- ngẫu nhiên tất định (băm chuỗi → [0,1)) ----------
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** Số [0,1) ổn định theo (khóa, nhãn) — cùng đơn cùng câu hỏi luôn cùng đáp án. */
export const hashUnit = (key: string, label: string) => fnv1a(`${label}:${key}`) / 4_294_967_296;
const hashBetween = (key: string, label: string, lo: number, hi: number) => lo + hashUnit(key, label) * (hi - lo);
const hashPick = <T,>(key: string, label: string, arr: readonly T[]) => arr[Math.floor(hashUnit(key, label) * arr.length)];
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

// ---------- lịch giờ VN ----------
/** 0h giờ VN của ngày chứa `at`, trả về mốc UTC. */
export function vnMidnightUtc(at: Date): Date {
  return new Date(Math.floor((at.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS);
}
export function vnDateKey(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}
/** Tỷ lệ [0,1] khung giờ bán hàng trong ngày đã trôi tới `at`. */
export function dayProgress(at: Date): number {
  const hours = (at.getTime() - vnMidnightUtc(at).getTime()) / HOUR_MS;
  return Math.min(1, Math.max(0, (hours - WINDOW_START_H) / (WINDOW_END_H - WINDOW_START_H)));
}

/**
 * Mục tiêu đơn cả ngày: nối tiếp nhịp 7 ngày trước (không neo hằng số để
 * seed đổi tham số worker vẫn khớp), jitter tất định theo ngày lệch dương
 * nhẹ. Trung bình tuần: (5×0,96 + 2×1,10)×1,02 / 7 ≈ 1,02 → trôi lên ~2%/tuần,
 * cuối tuần nhỉnh hơn; chờ duyệt cả tháng số đơn cũng không phình vô lý.
 */
export function dailyTarget(dateKey: string, avgLast7Days: number): number {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 1.1 : 0.96;
  const jitter = hashBetween(dateKey, "target", 0.96, 1.08);
  return Math.max(MIN_DAILY_TARGET, Math.round(avgLast7Days * jitter * weekend));
}

// ---------- phí sàn khi đối soát (cùng công thức seed-isv-reviewer.ts) ----------
export function settlementFees(orderId: string, channel: ChannelName, actualRevenue: number) {
  const isShopee = channel === ChannelName.SHOPEE;
  const fixedFee = Math.round(actualRevenue * (isShopee ? 0.04 : 0.03));
  const paymentFee = Math.round(actualRevenue * (isShopee ? 0.045 : 0.0245));
  const serviceFee = Math.round(actualRevenue * (isShopee ? 0.06 : 0.05));
  const sellerProtectionFee = isShopee ? Math.round(actualRevenue * 0.005) : 0;
  const affiliateFee = hashUnit(orderId, "aff") < 0.22 ? Math.round(actualRevenue * 0.03) : 0;
  const taxWithheld = Math.round(actualRevenue * 0.015);
  const shippingFeeQuoted = roundTo(hashBetween(orderId, "shipq", 16_500, 32_000), 500);
  const shippingFeeActual =
    shippingFeeQuoted + (hashUnit(orderId, "shipd") < 0.12 ? roundTo(hashBetween(orderId, "shipx", 2_000, 9_000), 500) : 0);
  const shippingFeeDiff = shippingFeeActual - shippingFeeQuoted;
  const platformSubsidy =
    hashUnit(orderId, "sub") < 0.35 ? roundTo(actualRevenue * hashBetween(orderId, "subr", 0.01, 0.03), 500) : 0;
  const actualPayout =
    actualRevenue - fixedFee - paymentFee - serviceFee - sellerProtectionFee - affiliateFee - taxWithheld - shippingFeeDiff;
  return {
    fixedFee, paymentFee, serviceFee, sellerProtectionFee, affiliateFee, taxWithheld,
    shippingFeeQuoted, shippingFeeActual, shippingFeeDiff, platformSubsidy, actualPayout,
  };
}

export interface TopupSummary {
  email: string;
  created: number;
  processed: number;
  shipped: number;
  cancelled: number;
  delivered: number;
  settled: number;
  returnsOpened: number;
  returnsClosed: number;
  dailyTarget: number;
  todayCount: number;
}

type DemoChannel = { id: string; channelName: ChannelName };
type DemoProduct = { id: string; skuCode: string; productName: string; sellingPrice: number; costPrice: number };

let started = false;
let running = false;

/** Khởi động worker (gọi 1 lần từ index.ts — KHÔNG gọi trong test). */
export function startReviewerDemoTopupWorker(): void {
  if (started) return;
  started = true;

  const minutes = Number(process.env.REVIEWER_DEMO_TOPUP_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("[Reviewer-demo] TẮT (REVIEWER_DEMO_TOPUP_MINUTES=0)");
    return;
  }
  const email = (process.env.REVIEWER_DEMO_EMAIL ?? DEFAULT_REVIEWER_EMAIL).toLowerCase();

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const s = await runReviewerDemoTopup({ email });
      if (s) {
        console.log(
          `[Reviewer-demo] ${s.email}: +${s.created} đơn (hôm nay ${s.todayCount}/${s.dailyTarget}) · ` +
            `xử lý ${s.processed} · giao ${s.shipped} · hủy ${s.cancelled} · đã giao ${s.delivered} · ` +
            `đối soát ${s.settled} · hoàn mở ${s.returnsOpened}/đóng ${s.returnsClosed}`
        );
      }
    } catch (e) {
      console.error("[Reviewer-demo] lỗi:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void tick(), minutes * 60 * 1000).unref();
  console.log(`[Reviewer-demo] BẬT — bồi đơn tài khoản ${email} mỗi ${minutes} phút`);
}

/**
 * Một lượt bồi. Trả về null khi tài khoản không tồn tại / không đủ điều kiện
 * (không có gian demo hoặc gian đã nối sàn thật) — worker im lặng bỏ qua.
 */
export async function runReviewerDemoTopup(opts: { email: string; now?: Date }): Promise<TopupSummary | null> {
  const now = opts.now ?? new Date();
  const email = opts.email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      isPlatformAdmin: true,
      ownerId: true,
      channels: {
        where: {
          channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
          // Chỉ gian DEMO: chưa từng ủy quyền sàn thật. Gian có refreshToken
          // hoặc externalShopId là gian thật → tuyệt đối không sinh đơn giả.
          refreshToken: null,
          externalShopId: null,
          status: "ACTIVE",
        },
        select: { id: true, channelName: true },
      },
    },
  });
  if (!user || user.isPlatformAdmin || user.ownerId || user.channels.length === 0) return null;

  const productRows = await prisma.product.findMany({
    where: { userId: user.id },
    select: { id: true, skuCode: true, productName: true, sellingPrice: true, costPrice: true },
  });
  if (productRows.length === 0) return null;
  const products: DemoProduct[] = productRows.map((p) => ({
    ...p, sellingPrice: num(p.sellingPrice), costPrice: num(p.costPrice),
  }));
  const channels: DemoChannel[] = user.channels;
  const channelIds = channels.map((c) => c.id);

  const summary: TopupSummary = {
    email, created: 0, processed: 0, shipped: 0, cancelled: 0, delivered: 0,
    settled: 0, returnsOpened: 0, returnsClosed: 0, dailyTarget: 0, todayCount: 0,
  };

  // Tạo TRƯỚC, già hóa SAU: đơn bù cho ngày trống được kéo ngay về đúng
  // trạng thái theo tuổi trong cùng lượt (mỗi bậc già hóa truy vấn lại DB).
  await topupOrders(channelIds, channels, products, now, summary);
  const payoutByChannel = new Map<string, number>();
  await ageOrders(channelIds, channels, now, summary, payoutByChannel);
  await upsertDailyCosts(user.id, channels, now);

  // Dấu vết "gian vẫn đang đồng bộ" + ví sàn cộng tiền đối soát vừa về.
  for (const ch of channels) {
    const payout = payoutByChannel.get(ch.id) ?? 0;
    await prisma.channel.update({
      where: { id: ch.id },
      data: {
        lastSyncAt: now,
        walletBalanceSyncedAt: now,
        ...(payout > 0 ? { walletBalance: { increment: payout } } : {}),
        ...(hashUnit(vnDateKey(now), ch.id) < 0.5 ? { lastStockReconcileAt: now } : {}),
      },
    });
  }
  return summary;
}

// ============================================================
// 1) GIÀ HÓA
// ============================================================
async function ageOrders(
  channelIds: string[],
  channels: DemoChannel[],
  now: Date,
  s: TopupSummary,
  payoutByChannel: Map<string, number>
) {
  const channelName = new Map(channels.map((c) => [c.id, c.channelName]));
  const isShopee = (channelId: string) => channelName.get(channelId) === ChannelName.SHOPEE;

  // PENDING → PROCESSED: đã đóng gói, có mã vận đơn.
  const pending = await prisma.order.findMany({
    where: { channelId: { in: channelIds }, shippingStatus: ShippingStatus.PENDING, createdAt: { lte: new Date(now.getTime() - PENDING_TO_PROCESSED_H * HOUR_MS) } },
    select: { id: true, channelId: true, createdAt: true, orderCode: true },
  });
  for (const o of pending) {
    const packedAt = new Date(Math.min(now.getTime(), o.createdAt.getTime() + hashBetween(o.id, "pack", 0.5, PENDING_TO_PROCESSED_H) * HOUR_MS));
    await prisma.order.update({
      where: { id: o.id },
      data: { shippingStatus: ShippingStatus.PROCESSED, packedAt, trackingCode: trackingCodeFor(o.id, isShopee(o.channelId)) },
    });
    s.processed++;
  }

  // PROCESSED → SHIPPING (đa số) / CANCELLED (5%): đã bàn giao ĐVVC.
  const processed = await prisma.order.findMany({
    where: { channelId: { in: channelIds }, shippingStatus: ShippingStatus.PROCESSED, packedAt: { lte: new Date(now.getTime() - PROCESSED_TO_SHIPPING_H * HOUR_MS) } },
    select: { id: true },
  });
  for (const o of processed) {
    if (hashUnit(o.id, "cancel") < CANCEL_RATE) {
      await prisma.order.update({
        where: { id: o.id },
        data: { shippingStatus: ShippingStatus.CANCELLED, paymentStatus: "UNPAID", actualPayout: 0, trackingCode: null },
      });
      s.cancelled++;
    } else {
      await prisma.order.update({ where: { id: o.id }, data: { shippingStatus: ShippingStatus.SHIPPING } });
      s.shipped++;
    }
  }

  // SHIPPING → DELIVERED: hết thời gian vận chuyển 1,5-3,5 ngày kể từ lúc đặt.
  const shipping = await prisma.order.findMany({
    where: { channelId: { in: channelIds }, shippingStatus: ShippingStatus.SHIPPING, createdAt: { lte: new Date(now.getTime() - TRANSIT_DAYS[0] * DAY_MS) } },
    select: { id: true, createdAt: true },
  });
  for (const o of shipping) {
    const deliveredAt = new Date(o.createdAt.getTime() + hashBetween(o.id, "transit", TRANSIT_DAYS[0], TRANSIT_DAYS[1]) * DAY_MS);
    if (deliveredAt > now) continue;
    await prisma.order.update({ where: { id: o.id }, data: { shippingStatus: ShippingStatus.DELIVERED, deliveredAt } });
    s.delivered++;
  }

  // DELIVERED chưa đối soát → sàn giải ngân sau 1 (Shopee) / 2 (Lazada) ngày.
  const unsettled = await prisma.order.findMany({
    where: { channelId: { in: channelIds }, shippingStatus: ShippingStatus.DELIVERED, isSettled: false, deliveredAt: { lte: new Date(now.getTime() - SETTLE_DAYS.SHOPEE * DAY_MS) } },
    select: { id: true, channelId: true, deliveredAt: true, totalAmount: true },
  });
  for (const o of unsettled) {
    const ch = isShopee(o.channelId) ? ChannelName.SHOPEE : ChannelName.LAZADA;
    const settledAt = new Date(o.deliveredAt!.getTime() + SETTLE_DAYS[ch] * DAY_MS);
    if (settledAt > now) continue;
    const fees = settlementFees(o.id, ch, num(o.totalAmount));
    await prisma.order.update({ where: { id: o.id }, data: { isSettled: true, settledAt, ...fees } });
    payoutByChannel.set(o.channelId, (payoutByChannel.get(o.channelId) ?? 0) + fees.actualPayout);
    s.settled++;
  }

  // Phát sinh hoàn (~2,5% đơn đã giao gần đây): sàn báo 1-3 ngày sau giao.
  const recentDelivered = await prisma.order.findMany({
    where: {
      channelId: { in: channelIds }, shippingStatus: ShippingStatus.DELIVERED, returnStatus: ReturnStatus.NONE,
      deliveredAt: { gte: new Date(now.getTime() - RETURN_LOOKBACK_DAYS * DAY_MS), lte: new Date(now.getTime() - RETURN_REQUEST_DAYS[0] * DAY_MS) },
    },
    select: { id: true, channelId: true, deliveredAt: true, totalAmount: true },
  });
  for (const o of recentDelivered) {
    if (hashUnit(o.id, "return") >= RETURN_RATE) continue;
    const returnRequestedAt = new Date(o.deliveredAt!.getTime() + hashBetween(o.id, "retreq", RETURN_REQUEST_DAYS[0], RETURN_REQUEST_DAYS[1]) * DAY_MS);
    if (returnRequestedAt > now) continue;
    const refund = num(o.totalAmount);
    await prisma.$transaction([
      prisma.order.update({
        where: { id: o.id },
        data: {
          returnStatus: ReturnStatus.AWAITING, returnSolution: ReturnSolution.RETURN_REFUND, returnRequestedAt,
          refundedAmount: refund, platformRefundAmount: refund,
          returnTrackingCode: `${isShopee(o.channelId) ? "SPXVN" : "LEXVN"}R${fnv1a(o.id).toString().slice(0, 9)}`,
          returnNote: hashPick(o.id, "retnote", RETURN_NOTES),
        },
      }),
      // returnedQuantity = quantity: SQL thuần vì Prisma không cho gán cột = cột khác.
      prisma.$executeRaw`UPDATE "OrderItem" SET "returnedQuantity" = "quantity" WHERE "orderId" = ${o.id}`,
    ]);
    s.returnsOpened++;
  }

  // Hoàn đang chờ → kiện về kho sau 2-7 ngày, rải đủ công đoạn.
  const awaiting = await prisma.order.findMany({
    where: { channelId: { in: channelIds }, returnStatus: ReturnStatus.AWAITING, returnRequestedAt: { lte: new Date(now.getTime() - RETURN_TRANSIT_DAYS[0] * DAY_MS) } },
    select: { id: true, returnRequestedAt: true },
  });
  for (const o of awaiting) {
    const returnedAt = new Date(o.returnRequestedAt!.getTime() + hashBetween(o.id, "rettransit", RETURN_TRANSIT_DAYS[0], RETURN_TRANSIT_DAYS[1]) * DAY_MS);
    if (returnedAt > now) continue;
    const rr = hashUnit(o.id, "retoutcome");
    // 40% dừng ở RECEIVED (đã quét nhận, chờ "Nhập kho tất cả") — để người
    // duyệt có việc bấm thật trên màn Hoàn; phần còn lại đã chốt xong.
    const returnStatus =
      rr < 0.4 ? ReturnStatus.RECEIVED
      : rr < 0.75 ? ReturnStatus.RECEIVED_INTACT
      : rr < 0.9 ? ReturnStatus.DAMAGED
      : rr < 0.97 ? ReturnStatus.CLAIM_SETTLED
      : ReturnStatus.WRITTEN_OFF;
    await prisma.$transaction([
      prisma.order.update({ where: { id: o.id }, data: { returnStatus, returnedAt } }),
      ...(returnStatus === ReturnStatus.RECEIVED_INTACT
        ? [prisma.orderItem.updateMany({ where: { orderId: o.id }, data: { returnRestocked: true } })]
        : []),
    ]);
    s.returnsClosed++;
  }
}

function trackingCodeFor(orderId: string, isShopee: boolean): string {
  return `${isShopee ? "SPXVN0" : "LEXVN0"}${fnv1a(orderId).toString().padStart(10, "0")}`;
}

// ============================================================
// 2) BỒI ĐƠN — bù ngày trống + hôm nay theo giờ đã trôi
// ============================================================
async function topupOrders(
  channelIds: string[],
  channels: DemoChannel[],
  products: DemoProduct[],
  now: Date,
  s: TopupSummary
) {
  const todayStart = vnMidnightUtc(now);
  const rangeStart = new Date(todayStart.getTime() - BACKFILL_DAYS * DAY_MS);

  // Số đơn từng ngày (giờ VN) trong cửa sổ bù + hôm nay, một câu SQL.
  const rows = await prisma.$queryRaw<{ d: string; n: bigint }[]>`
    SELECT to_char("createdAt" + interval '7 hour', 'YYYY-MM-DD') AS d, count(*) AS n
    FROM "Order" WHERE "channelId" = ANY(${channelIds}) AND "createdAt" >= ${rangeStart}
    GROUP BY 1`;
  const perDay = new Map(rows.map((r) => [r.d, Number(r.n)]));
  const first = await prisma.order.findFirst({ where: { channelId: { in: channelIds } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  if (!first) return; // tài khoản chưa seed đơn nào → không tự bịa lịch sử

  // Nhịp nền = trung bình các ngày CÓ đơn trong cửa sổ (ngày trống không kéo tụt).
  let sum = 0, days = 0;
  for (let d = BACKFILL_DAYS; d >= 1; d--) {
    const n = perDay.get(vnDateKey(new Date(todayStart.getTime() - d * DAY_MS))) ?? 0;
    if (n > 0) { sum += n; days++; }
  }
  const avg = days > 0 ? sum / days : 0;

  let budget = MAX_CREATE_PER_RUN;

  // a) Bù trọn các ngày trống (sau ngày có đơn đầu tiên).
  for (let d = BACKFILL_DAYS; d >= 1 && budget > 0; d--) {
    const dayStart = new Date(todayStart.getTime() - d * DAY_MS);
    if (dayStart < vnMidnightUtc(first.createdAt)) continue;
    const dateKey = vnDateKey(dayStart);
    if ((perDay.get(dateKey) ?? 0) > 0) continue;
    const target = dailyTarget(dateKey, avg);
    const n = Math.min(budget, target);
    await createOrdersForDay(channels, products, dateKey, 0, n, dayStart.getTime() + WINDOW_START_H * HOUR_MS, dayStart.getTime() + WINDOW_END_H * HOUR_MS, s);
    budget -= n;
  }

  // b) Hôm nay theo tỷ lệ giờ đã trôi.
  const dateKey = vnDateKey(now);
  const todayCount = perDay.get(dateKey) ?? 0;
  const target = dailyTarget(dateKey, avg);
  s.dailyTarget = target;
  s.todayCount = todayCount;
  const toCreate = Math.min(budget, Math.round(target * dayProgress(now)) - todayCount);
  if (toCreate <= 0) return;

  const lastToday = await prisma.order.findFirst({ where: { channelId: { in: channelIds }, createdAt: { gte: todayStart } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const windowStart = todayStart.getTime() + WINDOW_START_H * HOUR_MS;
  const from = Math.max(windowStart, lastToday ? lastToday.createdAt.getTime() + 60_000 : 0);
  await createOrdersForDay(channels, products, dateKey, todayCount, toCreate, from, now.getTime(), s);
  s.todayCount += toCreate;
}

/** Tạo `count` đơn PENDING rải đều (có jitter) trong [fromMs, toMs]; khóa băm = ngày#thứ tự. */
async function createOrdersForDay(
  channels: DemoChannel[],
  products: DemoProduct[],
  dateKey: string,
  seqOffset: number,
  count: number,
  fromMs: number,
  toMs: number,
  s: TopupSummary
) {
  const span = Math.max(60_000, toMs - fromMs);
  const shopee = channels.find((c) => c.channelName === ChannelName.SHOPEE);
  const lazada = channels.find((c) => c.channelName === ChannelName.LAZADA);

  for (let i = 0; i < count; i++) {
    const key = `${dateKey}#${seqOffset + i}`;
    const useShopee = lazada == null || (shopee != null && hashUnit(key, "chan") < 0.64);
    const channel = (useShopee ? shopee : lazada)!;
    const isShopee = channel.channelName === ChannelName.SHOPEE;

    const slot = (i + hashUnit(key, "slot")) / count;
    const createdAt = new Date(Math.min(toMs, fromMs + slot * span));

    const lineCount = hashUnit(key, "lines") < 0.7 ? 1 : hashUnit(key, "lines2") < 0.8 ? 2 : 3;
    const lines: { p: DemoProduct; qty: number }[] = [];
    for (let l = 0; l < lineCount; l++) {
      lines.push({ p: hashPick(key, `p${l}`, products), qty: hashUnit(key, `q${l}`) < 0.85 ? 1 : 2 });
    }
    const gross = lines.reduce((sum, l) => sum + l.p.sellingPrice * l.qty, 0);
    const sellerVoucher = hashUnit(key, "voucher") < 0.3 ? roundTo(gross * hashBetween(key, "voucherr", 0.02, 0.06), 500) : 0;
    const carrierPick = hashPick(key, "carrier", isShopee ? SHOPEE_CARRIERS : LAZADA_CARRIERS);

    await prisma.order.create({
      data: {
        channelId: channel.id,
        orderCode: orderCodeFor(key, createdAt, isShopee),
        customerName: `${hashPick(key, "first", FIRST)} ${hashPick(key, "last", LAST)}`,
        customerPhone: `09${Math.floor(hashBetween(key, "phone", 10_000_000, 99_999_999))}`,
        totalAmount: gross - sellerVoucher,
        sellerVoucher,
        paymentStatus: "PAID",
        shippingStatus: ShippingStatus.PENDING,
        itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
        createdAt,
        carrier: carrierPick.carrier,
        shippingCarrierName: carrierPick.name,
        items: {
          create: lines.map((l) => ({
            productId: l.p.id,
            channelSku: l.p.skuCode,
            productName: l.p.productName,
            quantity: l.qty,
            price: l.p.sellingPrice,
            costPriceAtSale: l.p.costPrice,
          })),
        },
      },
    });
    s.created++;
  }
}

/** Mã đơn giống sàn thật: Shopee yymmdd + 8 ký tự; Lazada dãy 15 số. */
function orderCodeFor(key: string, createdAt: Date, isShopee: boolean): string {
  const h1 = fnv1a(`${key}:a`), h2 = fnv1a(`${key}:b`);
  if (isShopee) {
    const yymmdd = vnDateKey(createdAt).replace(/-/g, "").slice(2);
    const alpha = "0123456789ABCDEFGHJKMNPQRSTUVWXYZ";
    let tail = "";
    let v = h1 * 4_294_967_296 + h2;
    for (let i = 0; i < 8; i++) { tail += alpha[Math.floor(v % alpha.length)]; v = Math.floor(v / alpha.length); }
    return `${yymmdd}${tail}`;
  }
  return `${(h1 % 900_000 + 100_000)}${String(h2).padStart(9, "0").slice(0, 9)}`;
}

// ============================================================
// 3) CHI PHÍ TRONG NGÀY
// ============================================================
async function upsertDailyCosts(userId: string, channels: DemoChannel[], now: Date) {
  const todayStart = vnMidnightUtc(now);
  const dateKey = vnDateKey(now);
  const progress = Math.max(0.05, dayProgress(now));

  // Ads tiêu dần theo giờ trong ngày (upsert → mỗi nhịp số nhích lên).
  for (const ch of channels) {
    const [lo, hi] = ch.channelName === ChannelName.SHOPEE ? [650_000, 1_150_000] : [250_000, 480_000];
    const fullDay = roundTo(hashBetween(`${dateKey}:${ch.id}`, "ads", lo, hi), 1000);
    const amount = roundTo(fullDay * progress, 1000);
    await prisma.adSpend.upsert({
      where: { channelId_date: { channelId: ch.id, date: todayStart } },
      create: { channelId: ch.id, date: todayStart, amount },
      update: { amount },
    });
  }

  const dayEnd = new Date(todayStart.getTime() + DAY_MS);
  const vnDate = new Date(now.getTime() + VN_OFFSET_MS).getUTCDate();
  const dayIndex = Math.floor(todayStart.getTime() / DAY_MS);

  // Vật tư đóng gói mỗi 5 ngày.
  if (dayIndex % 5 === 0) {
    const has = await prisma.operatingExpense.count({ where: { userId, category: "PACKAGING", expenseDate: { gte: todayStart, lt: dayEnd } } });
    if (has === 0) {
      await prisma.operatingExpense.create({
        data: {
          userId, name: "Vật tư đóng gói (túi, băng keo, tem)", category: "PACKAGING", type: "VARIABLE",
          amount: roundTo(hashBetween(dateKey, "packaging", 320_000, 520_000), 1000),
          expenseDate: new Date(todayStart.getTime() + 10 * HOUR_MS),
        },
      });
    }
  }
  // Khoản cố định đầu tháng.
  if (vnDate === 1) {
    const has = await prisma.operatingExpense.count({ where: { userId, type: "FIXED", expenseDate: { gte: todayStart, lt: dayEnd } } });
    if (has === 0) {
      const at = new Date(todayStart.getTime() + 9 * HOUR_MS);
      await prisma.operatingExpense.createMany({
        data: [
          { userId, name: "Lương nhân viên kho + đóng gói", category: "SALARY", type: "FIXED", amount: 9_500_000, expenseDate: at },
          { userId, name: "Thuê kho 40m²", category: "RENT", type: "FIXED", amount: 4_000_000, expenseDate: at },
          { userId, name: "Phần mềm & tiện ích", category: "OTHER", type: "FIXED", amount: 1_200_000, expenseDate: at },
        ],
      });
    }
  }
}
