// ============================================================
// VIDEO ĐÓNG HÀNG — SỐ GIỜ QUAY: đã mua · đã quay · còn lại · sổ mua · chặn khi hết giờ
// (16/11/2026 mục 11; 18/11/2026 mục 19 của docs/VIDEO-DONG-HANG-THIET-KE.md)
//
// Anh Trung 16/11: "thiếu thống kê số giờ còn lại (ví dụ khách mua 1000 giờ, đã quay 400 thì còn
// lại 600)"; "khách mua bao nhiêu thì hệ thống cộng vào tài khoản của khách bấy nhiêu, mình thu trước".
//
//   đã mua   = Σ seconds của sổ pack_hour_grants (chỉ chèn, không sửa — dựng lại được từ đầu); gồm cả giờ
//              MUA lẫn giờ Hubsell TẶNG (21/11/2026: mỗi chủ shop 2 giờ miễn phí — ensureWelcomeHours)
//   đã quay  = Σ thời lượng các video ĐÃ LƯU: STORED + DELETED (usage-daily.ts: bảng gộp theo ngày
//              + phần chưa gộp — số không tụt khi bỏ mảnh tháng cũ của pack_videos)
//   còn lại  = đã mua − đã quay   (ĐƯỢC ÂM: video quay dở lúc hết giờ vẫn quay nốt, phần lố trừ
//              vào lần mua sau — anh chốt 14/11)
//
// Vì sao tính cả DELETED: video hết hạn bị xóa thì giờ quay ĐÃ DÙNG vẫn là đã dùng. PENDING (quay
// xong chưa tải lên) và LOST chưa tính — giờ chỉ tính khi video nằm an toàn trên kho.
//
// MUA GIỜ: mỗi khoản đã thu = MỘT dòng PURCHASE mang `paymentRef` (chỉ mục duy nhất) → webhook bắn
// hai lần / poll đua webhook không bao giờ cộng giờ hai lần. Cổng payOS gọi hàm cộng giờ dưới đây trong
// cùng giao dịch với chứng từ + sổ quỹ: hours-payment.ts ← gateway-checkout.ts (mục 20, 18/11 tối).
// ============================================================

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  PACK_HOURS_CACHE_MAX,
  PACK_HOURS_CACHE_TTL_MS,
  PACK_VIDEO_HOUR_MAX_PURCHASE,
  PACK_VIDEO_HOUR_MIN_PURCHASE,
  PACK_VIDEO_HOUR_PRESETS,
  PACK_VIDEO_HOUR_PRICE_VND,
  PACK_VIDEO_OVERRUN_LOOKBACK_SEC,
  PACK_VIDEO_WELCOME_HOURS,
  packVideoHourSalesOpen,
} from "../../config/pack-video";
import { isPayosConfigured } from "../../integrations/payos/client";
import { amountMatchesHours, SECONDS_PER_HOUR } from "../../lib/pack-video-hour-pricing";
import { prisma } from "../../lib/prisma";
import { usedSecondsOf } from "./usage-daily";

export const HOUR_GRANT_KINDS = ["PURCHASE", "GRANT", "ADJUST"] as const;
export type HourGrantKind = (typeof HOUR_GRANT_KINDS)[number];

export interface HoursBalance {
  purchasedSeconds: number;
  usedSeconds: number;
  /** Có thể âm (xem chú thích đầu tệp). */
  remainingSeconds: number;
}

export interface HourLedgerRow {
  id: string;
  kind: HourGrantKind;
  /** Dương = cộng, âm = điều chỉnh giảm. */
  seconds: number;
  /** Số tiền đã thu (chỉ dòng PURCHASE). */
  amountVnd: number | null;
  note: string | null;
  createdAt: string;
  /** Số hóa đơn của dòng mua (null = chưa xuất / không phải dòng mua). */
  invoiceNo: string | null;
}

export interface HoursOverview extends HoursBalance {
  /** false = chưa mở thanh toán: hộp mua hiện giá + phép tính, nút thanh toán báo chưa mở. */
  salesOpen: boolean;
  pricing: { priceVnd: number; minHours: number; maxHours: number; presets: number[] };
  /** Sổ giờ: 50 dòng mới nhất (mua / tặng / điều chỉnh). */
  ledger: HourLedgerRow[];
}

/** Phép tính thuần — tách riêng để test không cần database. */
export function computeBalance(purchasedSeconds: number, usedSeconds: number): HoursBalance {
  return { purchasedSeconds, usedSeconds, remainingSeconds: purchasedSeconds - usedSeconds };
}

/** Số dư ĐỌC TƯƠI từ database (4 câu) — và làm mới đệm của tiến trình này. */
export async function getHoursBalance(ownerId: string): Promise<HoursBalance> {
  const [granted, used] = await Promise.all([
    prisma.packHourGrant.aggregate({ where: { ownerId }, _sum: { seconds: true } }),
    usedSecondsOf(ownerId),
  ]);
  const balance = computeBalance(granted._sum.seconds ?? 0, used);
  rememberBalance(ownerId, balance);
  return balance;
}

// ---------- ĐỆM SỐ DƯ theo chủ shop (M2.3, 26/11/2026 — thiết kế mục 29.4 + 38) ----------
//
// Mỗi clip trước đây tốn 4 câu chỉ để hỏi "còn giờ không" lúc xin vé tải, và thêm một lượt gọi /hours để vẽ lại số.
// Nay tiến trình web nhớ số dư của từng chủ shop PACK_HOURS_CACHE_TTL_MS (15 giây). Đây KHÔNG phải nguồn sự thật:
// số thật luôn là sổ trong database; đệm chỉ là lối tắt đọc. Nhiều máy web mỗi máy một đệm — lệch nhau tối đa bằng
// hạn đệm, tức vài giây quay, và luật 14/11 cho phép quay lố. Đệm báo HẾT giờ thì người gọi phải đọc tươi trước
// khi chặn (khách vừa mua giờ ở máy khác không bị chặn oan).

const balanceCache = new Map<string, { balance: HoursBalance; at: number }>();

function rememberBalance(ownerId: string, balance: HoursBalance): void {
  if (balanceCache.size >= PACK_HOURS_CACHE_MAX && !balanceCache.has(ownerId)) balanceCache.clear();
  balanceCache.set(ownerId, { balance, at: Date.now() });
}

/** Quên số dư đã nhớ: gọi khi sổ giờ vừa đổi (mua / tặng / điều chỉnh). Không truyền gì = quên hết (test). */
export function forgetHoursBalance(ownerId?: string): void {
  if (ownerId) balanceCache.delete(ownerId);
  else balanceCache.clear();
}

/** Số dư từ đệm nếu còn hạn, không thì đọc tươi. Dùng cho đường nóng; trang số giờ / sổ giờ vẫn đọc tươi. */
export async function getHoursBalanceCached(ownerId: string): Promise<HoursBalance> {
  const hit = balanceCache.get(ownerId);
  if (hit && Date.now() - hit.at < PACK_HOURS_CACHE_TTL_MS) return hit.balance;
  return getHoursBalance(ownerId);
}

/**
 * Một video vừa lên kho ở CHÍNH tiến trình này → cộng thời lượng vào số đã nhớ (không đọc database), để câu trả lời
 * "báo tải xong" mang số giờ mới và lượt xin vé kế tiếp thấy đúng số. Chưa nhớ gì thì thôi — lượt sau tự đọc tươi.
 */
export function noteUsedSeconds(ownerId: string, seconds: number): void {
  const hit = balanceCache.get(ownerId);
  if (!hit || !(seconds > 0)) return;
  hit.balance = computeBalance(hit.balance.purchasedSeconds, hit.balance.usedSeconds + seconds);
}

const LEDGER_LIMIT = 50;

export async function getHoursOverview(ownerId: string): Promise<HoursOverview> {
  const [balance, rows] = await Promise.all([
    getHoursBalance(ownerId),
    prisma.packHourGrant.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LEDGER_LIMIT,
      select: { id: true, kind: true, seconds: true, amountVnd: true, note: true, createdAt: true, paymentRef: true },
    }),
  ]);
  // Số hóa đơn của dòng mua: dòng giờ ↔ chứng từ nối nhau bằng CÙNG mã khoản tiền (paymentRef = externalRef).
  const refs = rows.map((r) => r.paymentRef).filter((x): x is string => !!x && !x.startsWith(WELCOME_REF_PREFIX));
  const invoiceByRef = new Map<string, string | null>();
  if (refs.length > 0) {
    const pays = await prisma.packagePayment.findMany({
      where: { externalRef: { in: refs }, userId: ownerId },
      select: { externalRef: true, ledgerEntry: { select: { invoiceNo: true } } },
    });
    for (const p of pays) if (p.externalRef) invoiceByRef.set(p.externalRef, p.ledgerEntry?.invoiceNo ?? null);
  }
  return {
    ...balance,
    // Mở bán = công tắc bật VÀ cổng thanh toán đã có khóa (thiếu khóa thì bấm cũng không ra mã).
    salesOpen: packVideoHourSalesOpen() && isPayosConfigured(),
    pricing: {
      priceVnd: PACK_VIDEO_HOUR_PRICE_VND,
      minHours: PACK_VIDEO_HOUR_MIN_PURCHASE,
      maxHours: PACK_VIDEO_HOUR_MAX_PURCHASE,
      presets: [...PACK_VIDEO_HOUR_PRESETS],
    },
    ledger: rows.map((r) => ({
      id: r.id,
      kind: r.kind as HourGrantKind,
      seconds: r.seconds,
      amountVnd: r.amountVnd,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      invoiceNo: r.paymentRef ? (invoiceByRef.get(r.paymentRef) ?? null) : null,
    })),
  };
}

// ---------- TẶNG GIỜ QUAY MIỄN PHÍ, một lần cho mỗi chủ shop (anh Trung 21/11/2026) ----------

/**
 * Khóa chống tặng trùng nằm ở cột `paymentRef` ("welcome:<id chủ shop>"): cột này đã có chỉ mục DUY NHẤT một phần
 * (migration 20261118200000) và ràng buộc CHECK chỉ bắt dòng PURCHASE phải có nó — dòng GRANT mang một khóa riêng
 * là hợp lệ. Nhờ vậy KHÔNG cần migration, và hai request tới cùng lúc / nhiều máy web cùng chạy vẫn chỉ ra MỘT dòng.
 */
const WELCOME_REF_PREFIX = "welcome:";
export const welcomeRefOf = (ownerId: string): string => `${WELCOME_REF_PREFIX}${ownerId}`;

/**
 * Chủ shop đã được máy NÀY hỏi rồi → khỏi gõ database mỗi request. Chỉ là lối tắt: đúng / sai do chỉ mục duy nhất
 * quyết định, quên sổ này (máy khởi động lại, máy web khác) thì cùng lắm thêm một câu INSERT không ra dòng nào.
 */
const welcomeAsked = new Set<string>();
const WELCOME_ASKED_MAX = 100_000;

/** Chỉ cho test: quên sổ "đã hỏi" để đi lại đường database. */
export function forgetWelcomeAsked(): void {
  welcomeAsked.clear();
}

/**
 * Bảo đảm chủ shop đã nhận giờ tặng. Trả true khi CHÍNH lượt gọi này vừa cộng giờ.
 * Gọi ở cửa /api/pack-videos (middleware/require-pack-video.ts) — tài khoản chạm vào tính năng lần đầu là có giờ.
 */
export async function ensureWelcomeHours(ownerId: string): Promise<boolean> {
  if (PACK_VIDEO_WELCOME_HOURS <= 0 || !ownerId || welcomeAsked.has(ownerId)) return false;
  const note = `Hubsell tặng ${PACK_VIDEO_WELCOME_HOURS.toLocaleString("vi-VN")} giờ quay miễn phí`;
  const inserted = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "pack_hour_grants" ("id", "ownerId", "seconds", "kind", "note", "paymentRef")
    VALUES (${randomUUID()}, ${ownerId}, ${PACK_VIDEO_WELCOME_HOURS * SECONDS_PER_HOUR}, 'GRANT', ${note}, ${welcomeRefOf(ownerId)})
    ON CONFLICT ("paymentRef") WHERE "paymentRef" IS NOT NULL DO NOTHING
    RETURNING "id"`);
  if (welcomeAsked.size >= WELCOME_ASKED_MAX) welcomeAsked.clear();
  welcomeAsked.add(ownerId);
  if (inserted.length === 1) forgetHoursBalance(ownerId);
  return inserted.length === 1;
}

export interface GrantHoursInput {
  ownerId: string;
  /** Dương = cộng giờ, âm = điều chỉnh giảm. Không nhận 0, không nhận số lẻ. */
  seconds: number;
  /** GRANT / ADJUST. Dòng PURCHASE chỉ đi qua grantPurchasedHoursTx. */
  kind: Exclude<HourGrantKind, "PURCHASE">;
  note?: string | null;
  createdById?: string | null;
}

/** Ghi MỘT dòng tặng / điều chỉnh. Chỉ chèn — sửa sai bằng một dòng ADJUST ngược dấu. */
export async function grantHours(input: GrantHoursInput): Promise<{ id: string }> {
  if (!Number.isInteger(input.seconds) || input.seconds === 0) {
    throw new Error("Số giây phải là số nguyên khác 0");
  }
  if (input.kind !== "GRANT" && input.kind !== "ADJUST") throw new Error(`Loại không hợp lệ: ${input.kind}`);
  forgetHoursBalance(input.ownerId);
  return prisma.packHourGrant.create({
    data: {
      id: randomUUID(),
      ownerId: input.ownerId,
      seconds: input.seconds,
      kind: input.kind,
      note: input.note?.trim() || null,
      createdById: input.createdById ?? null,
    },
    select: { id: true },
  });
}

/** Lỗi nói được với người dùng / HQ (số tiền lệch số giờ…). */
export class HourPurchaseError extends Error {}

export interface PurchaseHoursInput {
  ownerId: string;
  hours: number;
  /** Số tiền THỰC THU (đồng). Phải đúng bằng số giờ × đơn giá — lệch là không cộng giờ. */
  amountVnd: number;
  /** Mã khoản tiền (vd "payos:<mã GD>") — duy nhất. */
  paymentRef: string;
  note?: string | null;
  createdById?: string | null;
}

/**
 * CỘNG GIỜ cho MỘT khoản đã thu — chạy TRONG giao dịch của người gọi (cổng sẽ gắn cùng giao dịch với
 * chứng từ + sổ quỹ). Gọi lại cùng `paymentRef` trả đúng dòng cũ, KHÔNG cộng lần hai (`created: false`).
 * Chống lặp bằng chỉ mục duy nhất ở database, không bằng "đọc trước rồi ghi" (hai lượt đua vẫn đúng).
 */
export async function grantPurchasedHoursTx(
  tx: Prisma.TransactionClient,
  input: PurchaseHoursInput
): Promise<{ id: string; created: boolean }> {
  const ref = input.paymentRef.trim();
  if (!ref) throw new HourPurchaseError("Thiếu mã khoản thanh toán");
  if (!amountMatchesHours(input.amountVnd, input.hours)) {
    throw new HourPurchaseError(
      `Số tiền ${input.amountVnd.toLocaleString("vi-VN")} đ không khớp ${input.hours} giờ × ${PACK_VIDEO_HOUR_PRICE_VND.toLocaleString("vi-VN")} đ`
    );
  }
  const id = randomUUID();
  // ON CONFLICT trên chỉ mục một phần: lượt thua không ném lỗi (không làm hỏng giao dịch của người gọi).
  const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "pack_hour_grants" ("id", "ownerId", "seconds", "kind", "note", "createdById", "paymentRef", "amountVnd")
    VALUES (${id}, ${input.ownerId}, ${input.hours * SECONDS_PER_HOUR}, 'PURCHASE',
            ${input.note?.trim() || null}, ${input.createdById ?? null}, ${ref}, ${input.amountVnd})
    ON CONFLICT ("paymentRef") WHERE "paymentRef" IS NOT NULL DO NOTHING
    RETURNING "id"`);
  // Quên số dư đã nhớ ở tiến trình này. Giao dịch của người gọi chưa xong thì lượt đọc kế có thể nhớ lại số cũ thêm
  // tối đa một hạn đệm — khi đó đường "đệm báo hết giờ thì đọc tươi" vẫn không chặn oan người vừa mua.
  forgetHoursBalance(input.ownerId);
  if (inserted.length === 1) return { id: inserted[0].id, created: true };
  const existing = await tx.packHourGrant.findFirst({
    where: { paymentRef: ref },
    select: { id: true, ownerId: true },
  });
  if (!existing) throw new HourPurchaseError("Không ghi được dòng mua giờ");
  if (existing.ownerId !== input.ownerId) {
    throw new HourPurchaseError("Mã khoản thanh toán này đã dùng cho tài khoản khác");
  }
  return { id: existing.id, created: false };
}

/** Bản tự mở giao dịch (script / HQ ghi tay). */
export function grantPurchasedHours(input: PurchaseHoursInput) {
  return prisma.$transaction((tx) => grantPurchasedHoursTx(tx, input));
}

/**
 * HẾT GIỜ THÌ DỪNG (anh chốt 14/11) — có được mở MỘT video mới không.
 * · Số dư > 0 → được.
 * · Số dư ≤ 0 → vẫn được NẾU clip BẮT ĐẦU quay lúc còn giờ ("video đang quay dở vẫn quay nốt"). Số dư lúc
 *   bắt đầu = số dư bây giờ + giờ đã trừ từ lúc đó − giờ đã cộng từ lúc đó. Nhiều bàn quay cùng lúc thì
 *   mọi clip đã bắt đầu trước lúc hết giờ đều được tải lên; phần lố trừ vào lần mua sau.
 * · Giờ bắt đầu lùi xa hơn PACK_VIDEO_OVERRUN_LOOKBACK_SEC không được tính là "đang quay dở".
 */
export async function canOpenNewVideo(
  ownerId: string,
  recordedAt: Date,
  now: Date = new Date()
): Promise<{ ok: true; balance: HoursBalance } | { ok: false; remainingSeconds: number }> {
  // Đệm báo CÒN giờ → cho mở, không đọc database (M2.3). Đệm báo hết (hoặc chưa nhớ) → đọc tươi rồi mới xét.
  const cached = await getHoursBalanceCached(ownerId);
  if (cached.remainingSeconds > 0) return { ok: true, balance: cached };
  const balance = await getHoursBalance(ownerId);
  if (balance.remainingSeconds > 0) return { ok: true, balance };

  const earliest = new Date(now.getTime() - PACK_VIDEO_OVERRUN_LOOKBACK_SEC * 1000);
  if (recordedAt.getTime() >= earliest.getTime() && recordedAt.getTime() <= now.getTime()) {
    const [usedSince, grantedSince] = await Promise.all([
      prisma.$queryRaw<{ s: bigint | null }[]>(Prisma.sql`
        SELECT sum(v."durationSec")::bigint AS s
        FROM "pack_videos" v
        WHERE v."ownerId" = ${ownerId} AND v."status" IN ('STORED', 'DELETED')
          AND v."uploadedAt" >= ${recordedAt}
          AND v."recordedAt" >= ${new Date(earliest.getTime() - PACK_VIDEO_OVERRUN_LOOKBACK_SEC * 1000)}`),
      prisma.packHourGrant.aggregate({
        where: { ownerId, createdAt: { gte: recordedAt } },
        _sum: { seconds: true },
      }),
    ]);
    const atStart = balance.remainingSeconds + Number(usedSince[0]?.s ?? 0) - (grantedSince._sum.seconds ?? 0);
    if (atStart > 0) return { ok: true, balance };
  }
  return { ok: false, remainingSeconds: balance.remainingSeconds };
}
