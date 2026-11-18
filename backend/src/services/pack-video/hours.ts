// ============================================================
// VIDEO ĐÓNG HÀNG — SỐ GIỜ QUAY: đã mua · đã quay · còn lại · sổ mua · chặn khi hết giờ
// (16/11/2026 mục 11; 18/11/2026 mục 19 của docs/VIDEO-DONG-HANG-THIET-KE.md)
//
// Anh Trung 16/11: "thiếu thống kê số giờ còn lại (ví dụ khách mua 1000 giờ, đã quay 400 thì còn
// lại 600)"; "khách mua bao nhiêu thì hệ thống cộng vào tài khoản của khách bấy nhiêu, mình thu trước".
//
//   đã mua   = Σ seconds của sổ pack_hour_grants (chỉ chèn, không sửa — dựng lại được từ đầu)
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
  PACK_VIDEO_HOUR_MAX_PURCHASE,
  PACK_VIDEO_HOUR_MIN_PURCHASE,
  PACK_VIDEO_HOUR_PRESETS,
  PACK_VIDEO_HOUR_PRICE_VND,
  PACK_VIDEO_OVERRUN_LOOKBACK_SEC,
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

export async function getHoursBalance(ownerId: string): Promise<HoursBalance> {
  const [granted, used] = await Promise.all([
    prisma.packHourGrant.aggregate({ where: { ownerId }, _sum: { seconds: true } }),
    usedSecondsOf(ownerId),
  ]);
  return computeBalance(granted._sum.seconds ?? 0, used);
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
  const refs = rows.map((r) => r.paymentRef).filter((x): x is string => !!x);
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
): Promise<{ ok: true } | { ok: false; remainingSeconds: number }> {
  const balance = await getHoursBalance(ownerId);
  if (balance.remainingSeconds > 0) return { ok: true };

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
    if (atStart > 0) return { ok: true };
  }
  return { ok: false, remainingSeconds: balance.remainingSeconds };
}
