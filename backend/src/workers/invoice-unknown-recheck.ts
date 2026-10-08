// ============================================================
// VÒNG QUÉT "TỜ HÓA ĐƠN CHƯA RÕ KẾT QUẢ" (bước 5, lát 6b — docs/HANG-DOI-BEN.md 4.6)
//
// Mỗi phút tìm các dòng nhật ký hóa đơn ĐANG CHỜ mà CHƯA có mã tra cứu của nhà
// cung cấp và đã đủ tuổi, rồi tra ngược với nhà cung cấp để có kết luận (luật ở
// integrations/invoice/unknown-outcome.ts). Hai loại dòng rơi vào đây:
//   · tờ gửi đi không nhận được câu trả lời rõ (lát 5 + 6a);
//   · tờ đang gửi thì tiến trình chết (deploy, hết bộ nhớ) — trước đây kẹt mãi.
//
// QUY MÔ: một câu đọc cho MỌI shop, đi theo chỉ mục riêng phần
// "InvoiceLog_unknown_pending_idx" (chỉ chứa đúng các dòng loại này, bình thường
// gần như rỗng), mỗi lượt tối đa BATCH dòng. Các shop xử lý song song có giới hạn;
// trong một shop thì lần lượt. Shop nào hỏi nhà cung cấp không được thì bỏ phần
// còn lại của shop đó trong lượt và hoãn — không dội lệnh vào một tài khoản đang lỗi.
//
// AN TOÀN: vòng quét CHỈ ĐỌC phía nhà cung cấp (không đi qua chốt cho phép phát
// hành, không sinh chứng từ). Không khóa trong bộ nhớ giữa các tiến trình: mọi
// lượt ghi có điều kiện, hai worker cùng quét thì mỗi dòng chỉ một bên ghi được.
//
// Cấu hình: INVOICE_UNKNOWN_RECHECK_SECONDS (mặc định 60; "0" = tắt vòng quét).
// ============================================================

import { Prisma } from "@prisma/client";

import { getInvoiceProvider } from "../integrations/invoice";
import {
  deferUnknownLog,
  recheckMinAgeMs,
  recheckUnknownLog,
  UNKNOWN_MIN_AGE_MS,
  type RecheckOutcome,
  type UnknownLog,
} from "../integrations/invoice/unknown-outcome";
import type { InvoiceProvider } from "../integrations/invoice/types";
import { prisma } from "../lib/prisma";
import { notify } from "../services/notifications";

/** Nhịp quét. MẶC ĐỊNH TỰ CHỌN 60 giây: câu đọc đi chỉ mục gần như rỗng nên rẻ. */
const DEFAULT_INTERVAL_SECONDS = 60;
/**
 * Dòng hỏi chưa ra kết luận thì bấy lâu sau mới hỏi lại. MẶC ĐỊNH TỰ CHỌN 15 phút:
 * đủ thưa để không dội vào nhà cung cấp đang lỗi, đủ dày để tự hồi trong buổi.
 */
export const RECHECK_RETRY_MS = 15 * 60_000;
/** Số dòng tối đa một lượt quét. */
const BATCH = 50;
/** Số shop xử lý cùng lúc trong một lượt. */
const OWNER_CONCURRENCY = 4;

let running = false;

export interface RecheckRunStats {
  scanned: number;
  linked: number;
  cancelled: number;
  notIssued: number;
  cannotVerify: number;
  kept: number;
}

/**
 * Các dòng tới lượt: đang chờ, chưa có mã tra cứu, đủ tuổi, chưa hỏi hoặc đã quá hạn hỏi lại.
 * BỎ QUA tờ nháp chờ chủ shop ký (awaitingSignatureAt khác NULL — lát T1 tenant): tờ đó
 * có chủ đích chưa có mã, vòng hỏi theo giờ (invoice-cqt-follow) lo; tra ngược ở đây
 * sẽ thấy "không có tờ nào" rồi ghi hỏng sai.
 */
async function loadDueLogs(now: Date, ownerId?: string): Promise<UnknownLog[]> {
  const oldEnough = new Date(now.getTime() - UNKNOWN_MIN_AGE_MS);
  const retryBefore = new Date(now.getTime() - RECHECK_RETRY_MS);
  // Chữ 'PENDING' và IS NULL viết thẳng trong câu để Postgres khớp được điều kiện của chỉ mục riêng phần.
  // Mốc thời gian gửi dạng chuỗi ép ::timestamp (giờ UTC, không phụ thuộc múi giờ của phiên) như order-ledger.ts.
  return prisma.$queryRaw<UnknownLog[]>`
    SELECT "id", "ownerId", "orderId", "orderCode", "provider", "providerRef", "adjustmentForLogId", "createdAt"
    FROM "InvoiceLog"
    WHERE "status" = 'PENDING' AND "transactionId" IS NULL
      AND "awaitingSignatureAt" IS NULL
      AND "createdAt" < ${oldEnough.toISOString()}::timestamp
      AND ("cqtCheckedAt" IS NULL OR "cqtCheckedAt" < ${retryBefore.toISOString()}::timestamp)
      ${ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty}
    ORDER BY "createdAt"
    LIMIT ${BATCH}`;
}

/** Xử lý các dòng của MỘT shop, lần lượt. Trả kết quả từng dòng đã có kết luận / giữ lại. */
async function recheckOwner(ownerId: string, logs: UnknownLog[], now: Date): Promise<RecheckOutcome[]> {
  const outcomes: RecheckOutcome[] = [];
  const providers = new Map<string, InvoiceProvider | null>();
  const channelOf = new Map<string, string | undefined>();
  const orderIds = logs.map((l) => l.orderId).filter((id): id is string => !!id);
  if (orderIds.length > 0) {
    const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, channelId: true } });
    for (const o of orders) channelOf.set(o.id, o.channelId);
  }

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const channelId = log.orderId ? channelOf.get(log.orderId) : undefined;
    const key = channelId ?? "";
    let provider: InvoiceProvider | null;
    try {
      if (!providers.has(key)) providers.set(key, await getInvoiceProvider(ownerId, channelId));
      provider = providers.get(key) ?? null;
    } catch (err) {
      // Không đọc được cấu hình / bí mật của shop: chưa kiểm được, hoãn cả shop trong lượt này.
      console.error(`[Invoice-recheck] Shop ${ownerId}: không dựng được kết nối nhà cung cấp — ${(err as Error).message}`);
      for (const rest of logs.slice(i)) await deferUnknownLog(rest.id, now);
      outcomes.push({ kind: "KEPT", lookupFailed: true, accountProblem: true, reason: "không đọc được cấu hình nhà cung cấp" });
      break;
    }
    if (!provider || provider.name !== log.provider) {
      // Shop đã gỡ cấu hình hoặc đổi nhà cung cấp: không còn hỏi được bên đã nhận lệnh. Giữ đang chờ, hoãn.
      await deferUnknownLog(log.id, now);
      outcomes.push({ kind: "KEPT", lookupFailed: true, accountProblem: true, reason: "shop không còn cấu hình nhà cung cấp đã nhận lệnh" });
      continue;
    }
    if (now.getTime() - log.createdAt.getTime() < recheckMinAgeMs(provider)) continue; // nhà cung cấp cần chờ lâu hơn mức chung

    const outcome = await recheckUnknownLog(log, provider, now);
    outcomes.push(outcome);
    if (outcome.kind === "KEPT" && outcome.lookupFailed) {
      // Hỏi không được: các dòng còn lại của shop này cũng sẽ vậy — hoãn hết, lượt sau thử lại.
      for (const rest of logs.slice(i + 1)) await deferUnknownLog(rest.id, now);
      break;
    }
  }
  return outcomes;
}

/**
 * Một lượt quét. `opts.ownerId` giới hạn lượt quét vào một shop (công cụ vận hành và test);
 * vòng quét thường không truyền.
 */
export async function runInvoiceUnknownRecheckOnce(
  now: Date = new Date(),
  opts: { ownerId?: string } = {}
): Promise<RecheckRunStats> {
  const stats: RecheckRunStats = { scanned: 0, linked: 0, cancelled: 0, notIssued: 0, cannotVerify: 0, kept: 0 };
  if (running) return stats; // lượt trước chưa xong (nhà cung cấp chậm) — bỏ lượt này
  running = true;
  try {
    const due = await loadDueLogs(now, opts.ownerId);
    if (due.length === 0) return stats;
    stats.scanned = due.length;

    const byOwner = new Map<string, UnknownLog[]>();
    for (const log of due) {
      const list = byOwner.get(log.ownerId);
      if (list) list.push(log);
      else byOwner.set(log.ownerId, [log]);
    }

    const owners = [...byOwner.entries()];
    for (let i = 0; i < owners.length; i += OWNER_CONCURRENCY) {
      await Promise.all(
        owners.slice(i, i + OWNER_CONCURRENCY).map(async ([ownerId, logs]) => {
          let outcomes: RecheckOutcome[] = [];
          try {
            outcomes = await recheckOwner(ownerId, logs, now);
          } catch (err) {
            console.error(`[Invoice-recheck] Shop ${ownerId}: lỗi khi kiểm lại — ${(err as Error).message}`);
            return;
          }
          const count = (kind: RecheckOutcome["kind"]) => outcomes.filter((o) => o.kind === kind).length;
          const linked = count("LINKED");
          const cancelled = count("CANCELLED");
          const notIssued = count("NOT_ISSUED");
          const cannotVerify = count("CANNOT_VERIFY");
          const kept = count("KEPT");
          stats.linked += linked;
          stats.cancelled += cancelled;
          stats.notIssued += notIssued;
          stats.cannotVerify += cannotVerify;
          stats.kept += kept;
          console.log(
            `[Invoice-recheck] Shop ${ownerId}: kiểm lại ${logs.length} tờ chưa rõ kết quả — ` +
              `nối số ${linked}, đã hủy ${cancelled}, không có tờ nào ${notIssued}, không tra được ${cannotVerify}, còn chờ ${kept}`
          );
          // Chuông chỉ khi có việc cần người làm: đơn quay lại hàng chờ, hoặc phải tự kiểm bên nhà cung cấp.
          if (notIssued + cannotVerify > 0) {
            await notify(ownerId, {
              type: "INVOICE_UNKNOWN_RESOLVED",
              title: "Có hóa đơn chưa được lập, cần làm lại",
              body:
                `${notIssued + cannotVerify} lượt xuất hóa đơn trước đó không có kết quả rõ ràng; Hubsell đã kiểm lại và ` +
                (cannotVerify > 0
                  ? "có lượt không tự kiểm được — xem lý do ở Lịch sử hóa đơn trước khi làm lại."
                  : "nhà cung cấp chưa lập tờ nào — xem ở Lịch sử hóa đơn rồi xuất lại."),
              link: "/invoicing/history",
            });
          }
        })
      );
    }
    return stats;
  } catch (err) {
    console.error("[Invoice-recheck] Lỗi lượt quét:", (err as Error).message);
    return stats;
  } finally {
    running = false;
  }
}

/** Khởi động vòng quét — gọi một lần từ workers/index.ts. */
export function startInvoiceUnknownRecheckWorker(): void {
  const seconds = Number(process.env.INVOICE_UNKNOWN_RECHECK_SECONDS ?? DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.log("[Invoice-recheck] Vòng quét TẮT (INVOICE_UNKNOWN_RECHECK_SECONDS=0)");
    return;
  }
  setInterval(() => void runInvoiceUnknownRecheckOnce(), seconds * 1000).unref();
  console.log(`[Invoice-recheck] Vòng quét tờ chưa rõ kết quả chạy nhịp ${seconds} giây`);
}
