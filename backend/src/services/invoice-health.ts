// ============================================================
// SỨC KHỎE PHẦN HÓA ĐƠN — số đo + dấu hiệu "Hóa đơn" trên HQ Sức khỏe
// (hóa đơn bước 5, lát 14 — docs/HANG-DOI-BEN.md mục 4.6 U).
//
// Năm số đo, mỗi số trả lời "khâu nào của đường hóa đơn đang kẹt":
//   1. Yêu cầu bấm tay đã tới hạn mà chưa làm      → làn phát hành không chạy / quá tải
//   2. Tờ chưa rõ kết quả (đang chờ, chưa có mã)   → vòng tra lại kẹt / NCC không tra được
//   3. Tờ quá hạn hỏi cơ quan thuế                 → vòng hỏi trạng thái không chạy / còn tồn
//   4. Làn bị giữ quá hạn thuê, làn trễ lịch       → worker chết giữa lượt / lưới quét không chạy
//   5. Shop đang ngắt mạch tự phát hành            → lỗi tài khoản NCC phía shop
//
// QUY MÔ: bốn câu đầu đi theo chỉ mục riêng phần chỉ chứa dòng đang mở
// (invoice_requests_due_idx, InvoiceLog_unknown_pending_idx, InvoiceLog_cqt_due_idx,
// invoice_lanes_nextRunAt_idx); câu thứ năm đọc InvoiceConfig (một dòng mỗi shop).
// Điều kiện trạng thái viết thẳng trong câu để Postgres khớp chỉ mục riêng phần.
// ============================================================

import type { SignalLevel } from "../config/capacity-plan";
import { invoiceMode } from "../lib/queue-config";
import { prisma } from "../lib/prisma";

/**
 * NGƯỠNG — đều là MẶC ĐỊNH TỰ CHỌN, suy từ nhịp thiết kế (chưa có số đo thật: prod
 * 03/10/2026 chưa shop nào dùng hóa đơn). Có số thật thì chỉnh ở đây.
 */
export const INVOICE_HEALTH = {
  /** Lưới quét yêu cầu chạy mỗi 5 giây, web chờ một yêu cầu tối đa 25 giây → 5 phút là đã bất thường. */
  requestWarnMin: 5,
  requestCritMin: 30,
  /** Tờ chưa rõ được tra sau 5 phút, hoãn thì 15 phút hỏi lại → 30 phút = hai lượt hoãn. */
  unknownWarnMin: 30,
  /** Vòng hỏi cơ quan thuế quét 30 phút một lượt → quá hạn 1 giờ = lỡ hai lượt. */
  cqtOverdueMin: 60,
  /** Bằng nhịp hỏi lại của tờ chưa có kết luận (12 giờ): cả một chu kỳ không ai hỏi. */
  cqtCritMin: 12 * 60,
  /** Hạn thuê làn 300 giây, lưới quét 30 giây → 5 phút sau hạn mà chưa ai nhận lại. */
  laneLateMin: 5,
  /** Nhiều shop cùng ngắt mạch trong một ngày = nghi nhà cung cấp trục trặc, không phải lỗi riêng shop. */
  pausedWarn24h: 3,
} as const;

export interface InvoiceHealth {
  /** Yêu cầu bấm tay / tự điều chỉnh ĐÃ tới hạn mà chưa làm, và tuổi (phút) của cái tới hạn sớm nhất. */
  requestsDue: number;
  requestsOldestMin: number | null;
  /** Tờ đang chờ chưa có mã tra cứu (chưa rõ kết quả) và tuổi tờ cũ nhất. */
  unknownPending: number;
  unknownOldestMin: number | null;
  /** Tờ quá hạn hỏi trạng thái hơn INVOICE_HEALTH.cqtOverdueMin phút, và số phút quá hạn lớn nhất. */
  cqtOverdue: number;
  cqtOverdueMaxMin: number | null;
  /** Làn còn tên tiến trình giữ mà hạn thuê đã qua hơn laneLateMin phút. */
  lanesStale: number;
  /** Làn của shop đang bật tự phát hành (không ngắt mạch) trễ lịch hơn laneLateMin phút. Luôn 0 khi INVOICE_MODE=legacy. */
  lanesLate: number;
  /** Shop bật tự phát hành đang ngắt mạch; trong đó số shop ngắt trong 24 giờ qua. */
  pausedShops: number;
  pausedShops24h: number;
}

const minutesSince = (now: Date, d: Date | null | undefined): number | null =>
  d ? Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000)) : null;

/** Đọc năm số đo. Ném khi database lỗi — nơi gọi (platform-health) bọc để không vỡ trang. */
export async function collectInvoiceHealth(now: Date = new Date()): Promise<InvoiceHealth> {
  const ts = (d: Date) => d.toISOString();
  const nowTs = ts(now);
  const cqtBefore = ts(new Date(now.getTime() - INVOICE_HEALTH.cqtOverdueMin * 60_000));
  const laneBefore = ts(new Date(now.getTime() - INVOICE_HEALTH.laneLateMin * 60_000));
  const lanesOn = invoiceMode() === "lanes";

  const [requests, unknown, cqt, lanes, paused] = await Promise.all([
    prisma.$queryRaw<{ n: number; oldest: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MIN("nextRetryAt") AS oldest
      FROM "invoice_requests"
      WHERE "status" = 'PENDING' AND "nextRetryAt" <= ${nowTs}::timestamp`,
    prisma.$queryRaw<{ n: number; oldest: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MIN("createdAt") AS oldest
      FROM "InvoiceLog"
      WHERE "status" = 'PENDING' AND "transactionId" IS NULL`,
    prisma.$queryRaw<{ n: number; oldest: Date | null }[]>`
      SELECT COUNT(*)::int AS n, MIN("cqtNextCheckAt") AS oldest
      FROM "InvoiceLog"
      WHERE "cqtNextCheckAt" IS NOT NULL AND "cqtNextCheckAt" < ${cqtBefore}::timestamp`,
    prisma.$queryRaw<{ stale: number; late: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE l."leasedBy" IS NOT NULL AND l."leasedUntil" < ${laneBefore}::timestamp)::int AS stale,
        COUNT(*) FILTER (
          WHERE l."nextRunAt" < ${laneBefore}::timestamp
            AND (l."leasedUntil" IS NULL OR l."leasedUntil" < ${nowTs}::timestamp)
            AND c."autoIssueEnabled" AND c."autoIssuePausedAt" IS NULL
        )::int AS late
      FROM "invoice_lanes" l
      LEFT JOIN "InvoiceConfig" c ON c."ownerId" = l."ownerId" AND c."channelId" IS NULL
      WHERE l."nextRunAt" < ${laneBefore}::timestamp OR l."leasedBy" IS NOT NULL`,
    prisma.$queryRaw<{ n: number; recent: number }[]>`
      SELECT COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE "autoIssuePausedAt" > ${ts(new Date(now.getTime() - 24 * 60 * 60_000))}::timestamp)::int AS recent
      FROM "InvoiceConfig"
      WHERE "channelId" IS NULL AND "autoIssueEnabled" AND "autoIssuePausedAt" IS NOT NULL`,
  ]);

  return {
    requestsDue: requests[0]?.n ?? 0,
    requestsOldestMin: minutesSince(now, requests[0]?.oldest),
    unknownPending: unknown[0]?.n ?? 0,
    unknownOldestMin: minutesSince(now, unknown[0]?.oldest),
    cqtOverdue: cqt[0]?.n ?? 0,
    cqtOverdueMaxMin: minutesSince(now, cqt[0]?.oldest),
    lanesStale: lanes[0]?.stale ?? 0,
    lanesLate: lanesOn ? (lanes[0]?.late ?? 0) : 0,
    pausedShops: paused[0]?.n ?? 0,
    pausedShops24h: paused[0]?.recent ?? 0,
  };
}

const age = (min: number | null) => (min != null ? `, cũ nhất ${min}'` : "");

/** Dấu hiệu "Hóa đơn" — thuần tính toán, test đánh thẳng. `h` null = không đọc được. */
export function invoiceSignal(h: InvoiceHealth | null): [value: string, level: SignalLevel, hint: string] {
  if (!h) {
    return ["không đọc được", "warn", "Xem log [Health] trên web — bảng / chỉ mục hóa đơn của bước 5 đã áp đủ chưa?"];
  }
  const T = INVOICE_HEALTH;
  const value =
    `${h.requestsDue} yêu cầu tới hạn chưa làm${age(h.requestsDue ? h.requestsOldestMin : null)}` +
    ` · ${h.unknownPending} tờ chưa rõ kết quả${age(h.unknownPending ? h.unknownOldestMin : null)}` +
    ` · ${h.cqtOverdue} tờ quá hạn hỏi cơ quan thuế${h.cqtOverdue && h.cqtOverdueMaxMin != null ? ` (lâu nhất ${h.cqtOverdueMaxMin}')` : ""}` +
    ` · làn: ${h.lanesStale} bị bỏ dở, ${h.lanesLate} trễ lịch` +
    ` · ${h.pausedShops} shop ngắt mạch (${h.pausedShops24h} trong 24h)`;

  const problems: { level: SignalLevel; hint: string }[] = [];
  const reqMin = h.requestsDue > 0 ? (h.requestsOldestMin ?? 0) : 0;
  if (reqMin >= T.requestWarnMin) {
    problems.push({
      level: reqMin >= T.requestCritMin ? "crit" : "warn",
      hint: "Yêu cầu xuất hóa đơn không được làm — worker có chạy không? Xem log [Invoice-requests] / [Invoice-lanes]",
    });
  }
  const cqtMin = h.cqtOverdue > 0 ? (h.cqtOverdueMaxMin ?? 0) : 0;
  if (h.cqtOverdue > 0) {
    problems.push({
      level: cqtMin >= T.cqtCritMin ? "crit" : "warn",
      hint: "Vòng hỏi trạng thái cơ quan thuế không chạy hoặc còn tồn — xem log [CQT-follow] trên worker (dòng CÒN TỒN), INVOICE_CQT_MODE",
    });
  }
  if (h.lanesStale > 0 || h.lanesLate > 0) {
    problems.push({ level: "warn", hint: "Làn tự phát hành không được nhận lại — worker chết giữa lượt hoặc lưới quét [Invoice-lanes] không chạy" });
  }
  if (h.unknownPending > 0 && (h.unknownOldestMin ?? 0) >= T.unknownWarnMin) {
    problems.push({
      level: "warn",
      hint: "Tờ chưa rõ kết quả không được tra lại — xem log [Invoice-recheck]; nhà cung cấp có đang lỗi không?",
    });
  }
  if (h.pausedShops24h >= T.pausedWarn24h) {
    problems.push({ level: "warn", hint: "Nhiều shop cùng ngắt mạch tự phát hành trong 24 giờ — nghi nhà cung cấp trục trặc, xem lý do ngắt ở InvoiceConfig.autoIssuePauseReason" });
  }

  const worst = problems.find((p) => p.level === "crit") ?? problems[0];
  return [value, worst?.level ?? "ok", worst?.hint ?? "Đường hóa đơn chạy bình thường"];
}
