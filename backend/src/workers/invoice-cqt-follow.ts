// ============================================================
// VÒNG HỎI TRẠNG THÁI HÓA ĐƠN (nhà cung cấp + cơ quan thuế) THEO "GIỜ HỎI KẾ TIẾP"
// — hóa đơn bước 5, lát 12 (03/10/2026, docs/HANG-DOI-BEN.md mục 4.6 T). Thay vòng
// 12 giờ gọi thẳng MISA (workers/invoice-status-sync.ts, đã xóa ở bước 6c 10/10/2026).
//
//   Mỗi lượt:  NHẬN tối đa CLAIM_BATCH dòng tới hạn của MỌI shop bằng MỘT câu UPDATE
//              (dời cqtNextCheckAt về sau CQT_CLAIM_MS, FOR UPDATE SKIP LOCKED) → gom
//              theo shop → hỏi nhà cung cấp QUA ADAPTER theo lô (cỡ lô đọc ở bảng khả
//              năng) → áp kết quả bằng lõi integrations/invoice/cqt-follow.ts → hẹn giờ
//              hỏi kế. Còn dòng tới hạn thì nhận tiếp, tới khi hết hoặc hết quỹ giờ.
//
// VÌ SAO KHÔNG CHẠY TRONG LÀN CỦA SHOP (khác bản thiết kế mục 4.6 B, anh Trung duyệt
// 03/10): lệnh hỏi trạng thái chỉ đọc, không xin số hóa đơn, nên không cần xếp hàng
// với phát hành. Thứ cần chống là hai worker hỏi trùng và reo chuông đôi — việc đó do
// bước NHẬN lo: một dòng chỉ một tiến trình nhận được.
//
// QUY MÔ: câu nhận đi theo chỉ mục riêng phần "InvoiceLog_cqt_due_idx" (chỉ chứa tờ
// còn phải hỏi, xếp theo giờ hỏi). Không có trần số tờ mỗi shop; lượt nào hết quỹ giờ
// mà còn tồn thì in dòng "CÒN TỒN" để thấy, lượt sau làm tiếp.
//
// LỖI: hỏi nhà cung cấp không được (sai mật khẩu, bảo trì) → bỏ phần còn lại của shop
// đó trong lượt, các dòng đã nhận tự tới hạn lại sau CQT_CLAIM_MS. Worker chết giữa
// lượt cũng vậy. Nhà cung cấp không trả dòng cho một mã → không suy diễn, hẹn hỏi lại.
//
// TỜ NHÁP CHỜ KÝ (lát T1 tenant, 08/10/2026): dòng PENDING không có mã tra cứu nhưng có
// awaitingSignatureAt + providerRef cũng mang giờ hỏi kế và được NHẬN bằng cùng câu
// UPDATE; hỏi adapter.findDrafts theo mã tham chiếu (lô ≤ statusBatchSize), áp kế hoạch
// của integrations/invoice/draft-signing.ts: ký xong → nối số, chuông; nháp bị xóa →
// đơn về hàng chờ, chuông; còn chờ → hẹn lại.
//
// CHỈ ĐỌC phía nhà cung cấp — không đi qua chốt cho phép phát hành.
// Cấu hình: INVOICE_CQT_SWEEP_MINUTES (mặc định 30; "0" = tắt vòng quét).
// ============================================================

import { InvoiceLogStatus, Prisma } from "@prisma/client";

import { getInvoiceProvider } from "../integrations/invoice";
import {
  applyFollowPlan,
  nextCqtCheckAt,
  planFollow,
  type FollowLog,
} from "../integrations/invoice/cqt-follow";
import {
  applyDraftPlan,
  canFollowDrafts,
  draftNextCheckAt,
  planDraftFollow,
  type DraftFollowLog,
} from "../integrations/invoice/draft-signing";
import { getProviderEntry } from "../integrations/invoice/provider-registry";
import type { InvoiceProvider } from "../integrations/invoice/types";
import { prisma } from "../lib/prisma";
import { notify } from "../services/notifications";

/** Nhịp quét. MẶC ĐỊNH TỰ CHỌN 30 phút (anh Trung duyệt 03/10/2026). */
const DEFAULT_SWEEP_MINUTES = 30;
/** Số dòng nhận mỗi câu (giữ con số 200 của vòng cũ, nay tính chung mọi shop và nhận tiếp khi còn). */
const CLAIM_BATCH = 200;
/**
 * Dòng đã nhận mà chưa xử lý xong (nhà cung cấp lỗi, worker chết) tới hạn lại sau bấy
 * lâu. MẶC ĐỊNH TỰ CHỌN 15 phút: dài hơn hẳn thời gian hỏi + ghi một lô, bằng nhịp
 * hoãn của vòng quét tờ chưa rõ kết quả (lát 6b).
 */
export const CQT_CLAIM_MS = 15 * 60_000;
/** Số shop xử lý cùng lúc trong một lô đã nhận (như lát 6b). */
const OWNER_CONCURRENCY = 4;

let running = false;

export interface CqtFollowStats {
  claimed: number;
  /** Số tờ đã gửi đi hỏi và nhà cung cấp trả lời (kể cả tờ không có dòng trả về). */
  asked: number;
  noRow: number;
  issuedFixed: number;
  cancelled: number;
  rejected: number;
  /** Dòng bị tiến trình khác đổi giữa chừng — bỏ, không ghi đè. */
  skipped: number;
  /** Tờ không hỏi được vì shop không còn nhà cung cấp đó / nhà cung cấp không hỏi được theo lô. */
  unaskable: number;
  failedOwners: number;
  /** Hết quỹ giờ của lượt mà còn dòng tới hạn. */
  leftover: boolean;
  /** Tờ nháp chờ ký đã hỏi nhà cung cấp (lát T1 tenant). */
  draftsAsked: number;
  /** Tờ nháp chủ shop đã ký → nối số (hoặc mã tra cứu, chờ số). */
  draftsSigned: number;
  /** Tờ nháp không còn bên nhà cung cấp → đơn về hàng chờ. */
  draftsGone: number;
}

interface OwnerAlert {
  provider: string;
  rejectedNos: string[];
  cancelledNos: string[];
}

interface DraftAlert {
  provider: string;
  signedNos: string[];
  goneCodes: string[];
}

/** NHẬN dòng tới hạn: một câu UPDATE, hai tiến trình không nhận trùng một dòng. */
async function claimDue(now: Date, ownerId?: string): Promise<FollowLog[]> {
  const until = new Date(now.getTime() + CQT_CLAIM_MS);
  // IS NOT NULL viết thẳng trong câu để Postgres khớp điều kiện của chỉ mục riêng phần.
  // Mốc thời gian gửi dạng chuỗi ép ::timestamp (giờ UTC) như invoice-unknown-recheck.ts.
  return prisma.$queryRaw<FollowLog[]>`
    UPDATE "InvoiceLog" SET "cqtNextCheckAt" = ${until.toISOString()}::timestamp
    WHERE "id" IN (
      SELECT "id" FROM "InvoiceLog"
      WHERE "cqtNextCheckAt" IS NOT NULL AND "cqtNextCheckAt" <= ${now.toISOString()}::timestamp
        ${ownerId ? Prisma.sql`AND "ownerId" = ${ownerId}` : Prisma.empty}
      ORDER BY "cqtNextCheckAt"
      LIMIT ${CLAIM_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "ownerId", "orderId", "orderCode", "provider", "status"::text AS "status", "cqtStatus",
      "invoiceNo", "transactionId", "invoiceSeries", "adjustmentForLogId", "createdAt",
      "providerRef", "awaitingSignatureAt"`;
}

/** Dòng đã nhận là TỜ NHÁP CHỜ KÝ (lát T1 tenant)? Thu hẹp kiểu cho draft-signing.ts. */
function asDraftLog(l: FollowLog): DraftFollowLog | null {
  if (l.status !== InvoiceLogStatus.PENDING || l.transactionId || !l.awaitingSignatureAt || !l.providerRef) return null;
  return {
    id: l.id,
    ownerId: l.ownerId,
    orderId: l.orderId,
    orderCode: l.orderCode,
    provider: l.provider,
    providerRef: l.providerRef,
    adjustmentForLogId: l.adjustmentForLogId,
    awaitingSignatureAt: l.awaitingSignatureAt,
    createdAt: l.createdAt,
  };
}

/**
 * Xử lý các TỜ NHÁP CHỜ KÝ đã nhận của MỘT shop. Trả false khi hỏi nhà cung cấp không
 * được. Shop đổi nhà cung cấp / nhà cung cấp không có luồng nháp → không có cách hỏi:
 * giữ trong diện theo dõi, hẹn theo nhịp tờ nháp.
 */
async function followDraftsOwner(
  ownerId: string,
  logs: DraftFollowLog[],
  now: Date,
  stats: CqtFollowStats,
  alerts: Map<string, DraftAlert>
): Promise<boolean> {
  let provider: InvoiceProvider | null;
  try {
    provider = await getInvoiceProvider(ownerId);
  } catch (err) {
    console.error(`[CQT-follow] Shop ${ownerId}: không dựng được kết nối nhà cung cấp (tờ nháp) — ${(err as Error).message}`);
    return false;
  }
  const askable = logs.filter((l) => provider && provider.name === l.provider && canFollowDrafts(provider));
  const unaskable = logs.filter((l) => !askable.includes(l));
  if (unaskable.length > 0) {
    stats.unaskable += unaskable.length;
    for (const l of unaskable) {
      await prisma.invoiceLog.updateMany({
        where: { id: l.id, status: InvoiceLogStatus.PENDING, transactionId: null },
        data: { cqtNextCheckAt: draftNextCheckAt(l.awaitingSignatureAt, now) },
      });
    }
  }
  if (askable.length === 0 || !provider || !canFollowDrafts(provider)) return true;

  const size = Math.max(1, provider.capabilities.statusBatchSize);
  for (let i = 0; i < askable.length; i += size) {
    const chunk = askable.slice(i, i + size);
    const res = await provider.findDrafts(chunk.map((l) => l.providerRef));
    if (!res.ok) {
      console.error(
        `[CQT-follow] Shop ${ownerId}: hỏi tờ nháp ${provider.name} không được${res.accountProblem ? " (lỗi tài khoản / cấu hình)" : ""} — ${res.message}`
      );
      if (res.accountProblem) {
        const l = getProviderEntry(provider.name)?.label ?? provider.name;
        await notify(ownerId, {
          type: "INVOICE_STATUS_CHECK_BLOCKED",
          title: `Hubsell không kiểm tra được trạng thái hóa đơn với ${l}`,
          body: `${res.message} Trong lúc này Hubsell không biết tờ nháp nào bạn đã ký. Kiểm tra lại kết nối ở trang Kết nối & Xuất hóa đơn; sửa xong Hubsell tự kiểm lại.`,
          link: "/invoicing/connect",
        });
      }
      return false;
    }
    for (const log of chunk) {
      stats.draftsAsked += 1;
      const plan = planDraftFollow(log, res.found.get(log.providerRef), now);
      if (!(await applyDraftPlan(log, plan, now))) {
        stats.skipped += 1;
        continue;
      }
      if (plan.kind === "WAIT") continue;
      const alert = alerts.get(ownerId) ?? { provider: provider.name, signedNos: [], goneCodes: [] };
      alerts.set(ownerId, alert);
      if (plan.kind === "SIGNED") {
        stats.draftsSigned += 1;
        alert.signedNos.push(plan.invoiceNo ?? log.orderCode);
      } else {
        stats.draftsGone += 1;
        alert.goneCodes.push(log.orderCode);
      }
    }
  }
  return true;
}

/** Ghi "đã hỏi, không có gì đổi" cho nhiều dòng một lần, gom theo giờ hỏi kế. */
async function touchUnchanged(
  rows: { log: FollowLog; next: Date | null }[],
  now: Date,
  asked: boolean
): Promise<void> {
  const groups = new Map<string, { sample: FollowLog; next: Date | null; ids: string[] }>();
  for (const { log, next } of rows) {
    const key = `${log.status}|${log.cqtStatus ?? ""}|${next?.getTime() ?? ""}`;
    const g = groups.get(key);
    if (g) g.ids.push(log.id);
    else groups.set(key, { sample: log, next, ids: [log.id] });
  }
  for (const g of groups.values()) {
    await prisma.invoiceLog.updateMany({
      where: { id: { in: g.ids }, status: g.sample.status, cqtStatus: g.sample.cqtStatus },
      data: { cqtNextCheckAt: g.next, ...(asked ? { cqtCheckedAt: now } : {}) },
    });
  }
}

/** Xử lý các dòng đã nhận của MỘT shop. Trả false khi hỏi nhà cung cấp không được. */
async function followOwner(
  ownerId: string,
  logs: FollowLog[],
  now: Date,
  stats: CqtFollowStats,
  alerts: Map<string, OwnerAlert>
): Promise<boolean> {
  let provider: InvoiceProvider | null;
  try {
    provider = await getInvoiceProvider(ownerId);
  } catch (err) {
    console.error(`[CQT-follow] Shop ${ownerId}: không dựng được kết nối nhà cung cấp — ${(err as Error).message}`);
    return false;
  }

  // Shop đã gỡ cấu hình / đổi nhà cung cấp, hoặc nhà cung cấp không hỏi được theo lô:
  // không có cách hỏi. Giữ tờ trong diện theo dõi, hẹn theo nhịp thường (không ghi "đã hỏi").
  const askable = logs.filter((l) => provider && provider.name === l.provider && provider.checkStatuses);
  const unaskable = logs.filter((l) => !askable.includes(l));
  if (unaskable.length > 0) {
    stats.unaskable += unaskable.length;
    await touchUnchanged(unaskable.map((log) => ({ log, next: nextCqtCheckAt(log, now) })), now, false);
  }
  if (askable.length === 0 || !provider?.checkStatuses) return true;

  const size = Math.max(1, provider.capabilities.statusBatchSize);
  for (let i = 0; i < askable.length; i += size) {
    const chunk = askable.slice(i, i + size);
    const res = await provider.checkStatuses(
      chunk.map((l) => ({ transactionId: l.transactionId!, invoiceSeries: l.invoiceSeries }))
    );
    if (!res.ok) {
      console.error(
        `[CQT-follow] Shop ${ownerId}: hỏi ${provider.name} không được${res.accountProblem ? " (lỗi tài khoản / cấu hình)" : ""} — ${res.message}`
      );
      // Lỗi ở tài khoản / cấu hình của shop (sai mật khẩu, mất quyền): thử lại không tự
      // hết, người sửa được là chủ shop → một chuông (lát 14). notify tự bỏ qua khi
      // chuông cùng loại còn chưa đọc trong 24 giờ. Lỗi tạm (mạng, NCC bận) không báo.
      if (res.accountProblem) {
        const l = getProviderEntry(provider.name)?.label ?? provider.name;
        await notify(ownerId, {
          type: "INVOICE_STATUS_CHECK_BLOCKED",
          title: `Hubsell không kiểm tra được trạng thái hóa đơn với ${l}`,
          body: `${res.message} Trong lúc này Hubsell không biết hóa đơn nào bị Cơ quan Thuế từ chối. Kiểm tra lại kết nối ở trang Kết nối & Xuất hóa đơn; sửa xong Hubsell tự kiểm lại.`,
          link: "/invoicing/connect",
        });
      }
      return false;
    }
    const unchanged: { log: FollowLog; next: Date | null }[] = [];
    for (const log of chunk) {
      const item = res.found.get(log.transactionId!);
      stats.asked += 1;
      if (!item) stats.noRow += 1;
      const plan = planFollow(log, item, now);
      if (!plan.changed) {
        unchanged.push({ log, next: plan.next });
        continue;
      }
      if (!(await applyFollowPlan(log, plan, now))) {
        stats.skipped += 1;
        continue;
      }
      if (plan.issuedFixed) stats.issuedFixed += 1;
      if (plan.cancelled || plan.newlyRejected) {
        const alert = alerts.get(ownerId) ?? { provider: provider.name, rejectedNos: [], cancelledNos: [] };
        alerts.set(ownerId, alert);
        const no = plan.invoiceNo ?? log.orderCode;
        if (plan.cancelled) {
          stats.cancelled += 1;
          alert.cancelledNos.push(no);
        } else {
          stats.rejected += 1;
          alert.rejectedNos.push(no);
        }
      }
    }
    await touchUnchanged(unchanged, now, true);
  }
  return true;
}

const firstNos = (nos: string[]) => `${nos.slice(0, 3).join(", ")}${nos.length > 3 ? "…" : ""}`;

/**
 * Một lượt quét. `opts.ownerId` giới hạn vào một shop (công cụ vận hành và test);
 * `opts.budgetMs` là quỹ giờ của lượt (mặc định = nhịp quét).
 */
export async function runInvoiceCqtFollowOnce(
  now: Date = new Date(),
  opts: { ownerId?: string; budgetMs?: number } = {}
): Promise<CqtFollowStats> {
  const stats: CqtFollowStats = {
    claimed: 0,
    asked: 0,
    noRow: 0,
    issuedFixed: 0,
    cancelled: 0,
    rejected: 0,
    skipped: 0,
    unaskable: 0,
    failedOwners: 0,
    leftover: false,
    draftsAsked: 0,
    draftsSigned: 0,
    draftsGone: 0,
  };
  if (running) return stats; // lượt trước chưa xong — bỏ lượt này
  running = true;
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs ?? (sweepMinutes() || DEFAULT_SWEEP_MINUTES) * 60_000;
  const failedOwners = new Set<string>();
  const alerts = new Map<string, OwnerAlert>();
  const draftAlerts = new Map<string, DraftAlert>();
  try {
    for (;;) {
      const claimed = await claimDue(now, opts.ownerId);
      if (claimed.length === 0) break;
      stats.claimed += claimed.length;

      // Tờ nháp chờ ký (lát T1 tenant): không có mã tra cứu, hỏi theo mã tham chiếu.
      const drafts = claimed.map(asDraftLog).filter((d): d is DraftFollowLog => d !== null);
      const draftIds = new Set(drafts.map((d) => d.id));
      // Dòng mang giờ hỏi nhưng không còn thuộc diện theo dõi (đã hỏng / đã hủy, mất mã
      // tra cứu) — có thể sót lại từ lúc vòng cũ còn chạy: gỡ giờ hỏi, không hỏi.
      const followed = claimed.filter(
        (l) =>
          !draftIds.has(l.id) &&
          l.transactionId &&
          (l.status === InvoiceLogStatus.PENDING || l.status === InvoiceLogStatus.ISSUED)
      );
      const stale = claimed.filter((l) => !followed.includes(l) && !draftIds.has(l.id));
      if (stale.length > 0) {
        await prisma.invoiceLog.updateMany({
          where: { id: { in: stale.map((l) => l.id) } },
          data: { cqtNextCheckAt: null },
        });
      }

      const byOwner = new Map<string, FollowLog[]>();
      for (const log of followed) {
        if (failedOwners.has(log.ownerId)) continue; // đã hỏng trong lượt này: để dòng tự tới hạn lại
        const list = byOwner.get(log.ownerId);
        if (list) list.push(log);
        else byOwner.set(log.ownerId, [log]);
      }
      const owners = [...byOwner.entries()];
      for (let i = 0; i < owners.length; i += OWNER_CONCURRENCY) {
        await Promise.all(
          owners.slice(i, i + OWNER_CONCURRENCY).map(async ([ownerId, logs]) => {
            try {
              if (!(await followOwner(ownerId, logs, now, stats, alerts))) failedOwners.add(ownerId);
            } catch (err) {
              console.error(`[CQT-follow] Shop ${ownerId}: lỗi khi hỏi trạng thái — ${(err as Error).message}`);
              failedOwners.add(ownerId);
            }
          })
        );
      }

      const draftsByOwner = new Map<string, DraftFollowLog[]>();
      for (const d of drafts) {
        if (failedOwners.has(d.ownerId)) continue;
        const list = draftsByOwner.get(d.ownerId);
        if (list) list.push(d);
        else draftsByOwner.set(d.ownerId, [d]);
      }
      const draftOwners = [...draftsByOwner.entries()];
      for (let i = 0; i < draftOwners.length; i += OWNER_CONCURRENCY) {
        await Promise.all(
          draftOwners.slice(i, i + OWNER_CONCURRENCY).map(async ([ownerId, logs]) => {
            try {
              if (!(await followDraftsOwner(ownerId, logs, now, stats, draftAlerts))) failedOwners.add(ownerId);
            } catch (err) {
              console.error(`[CQT-follow] Shop ${ownerId}: lỗi khi hỏi tờ nháp — ${(err as Error).message}`);
              failedOwners.add(ownerId);
            }
          })
        );
      }

      if (claimed.length < CLAIM_BATCH) break;
      if (Date.now() - startedAt > budgetMs) {
        stats.leftover = true;
        break;
      }
    }

    // Chuông: MỘT cái cho mỗi shop mỗi lượt, chỉ khi có việc cần chủ shop làm.
    for (const [ownerId, alert] of alerts) {
      const l = getProviderEntry(alert.provider)?.label ?? alert.provider;
      const parts: string[] = [];
      if (alert.rejectedNos.length > 0) {
        parts.push(
          `${alert.rejectedNos.length} hóa đơn bị Cơ quan Thuế từ chối (${firstNos(alert.rejectedNos)}) — sửa và gửi lại trên ${l}.`
        );
      }
      if (alert.cancelledNos.length > 0) {
        parts.push(
          `${alert.cancelledNos.length} hóa đơn đã bị hủy/xóa trên ${l} (${firstNos(alert.cancelledNos)}) — đã loại khỏi báo cáo, đơn quay lại hàng chờ nếu cần xuất lại.`
        );
      }
      await notify(ownerId, {
        type: "INVOICE_CQT_ALERT",
        title: "Hóa đơn cần xử lý với Cơ quan Thuế",
        body: parts.join(" "),
        link: "/invoicing/history",
      });
    }

    // Chuông tờ nháp (lát T1 tenant): một cái cho mỗi việc mỗi shop mỗi lượt.
    for (const [ownerId, alert] of draftAlerts) {
      const l = getProviderEntry(alert.provider)?.label ?? alert.provider;
      if (alert.signedNos.length > 0) {
        await notify(ownerId, {
          type: "INVOICE_DRAFT_SIGNED",
          title: `Đã nhận ${alert.signedNos.length} hóa đơn bạn vừa ký trên ${l}`,
          body: `Số ${firstNos(alert.signedNos)}. Xem và tải PDF tại Lịch sử & Báo cáo thuế.`,
          link: "/invoicing/history",
        });
      }
      if (alert.goneCodes.length > 0) {
        await notify(ownerId, {
          type: "INVOICE_DRAFT_GONE",
          title: `${alert.goneCodes.length} tờ nháp đã bị xóa trên ${l} trước khi ký`,
          body: `Đơn ${firstNos(alert.goneCodes)} quay lại Hàng chờ xuất hóa đơn — xuất lại nếu vẫn cần hóa đơn.`,
          link: "/invoicing/connect",
        });
      }
    }

    stats.failedOwners = failedOwners.size;
    if (stats.claimed > 0) {
      console.log(
        `[CQT-follow] Nhận ${stats.claimed} tờ tới hạn: hỏi được ${stats.asked}` +
          (stats.noRow ? `, ${stats.noRow} nhà cung cấp không trả dòng` : "") +
          (stats.issuedFixed ? `, ${stats.issuedFixed} đang chờ → đã phát hành` : "") +
          (stats.cancelled ? `, ${stats.cancelled} đã hủy bên nhà cung cấp` : "") +
          (stats.rejected ? `, ${stats.rejected} CƠ QUAN THUẾ TỪ CHỐI` : "") +
          (stats.draftsAsked ? `, ${stats.draftsAsked} tờ nháp chờ ký đã hỏi` : "") +
          (stats.draftsSigned ? `, ${stats.draftsSigned} tờ nháp đã ký → nối số` : "") +
          (stats.draftsGone ? `, ${stats.draftsGone} tờ nháp đã bị xóa` : "") +
          (stats.unaskable ? `, ${stats.unaskable} không có cách hỏi` : "") +
          (stats.skipped ? `, ${stats.skipped} bị tiến trình khác đổi` : "") +
          (stats.failedOwners ? `, ${stats.failedOwners} shop hỏi không được` : "") +
          (stats.leftover ? " — CÒN TỒN, hết quỹ giờ của lượt" : "")
      );
    }
    return stats;
  } catch (err) {
    console.error("[CQT-follow] Lỗi lượt quét:", (err as Error).message);
    return stats;
  } finally {
    running = false;
  }
}

function sweepMinutes(): number {
  const raw = process.env.INVOICE_CQT_SWEEP_MINUTES;
  const n = raw === undefined || raw.trim() === "" ? DEFAULT_SWEEP_MINUTES : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SWEEP_MINUTES;
}

/** Khởi động vòng quét — gọi một lần từ workers/index.ts. */
export function startInvoiceCqtFollowWorker(): void {
  const minutes = sweepMinutes();
  if (minutes <= 0) {
    console.log("[CQT-follow] Vòng quét TẮT (INVOICE_CQT_SWEEP_MINUTES=0)");
    return;
  }
  // Lượt đầu 5 phút sau khi worker lên (như vòng cũ), rồi theo nhịp.
  setTimeout(() => void runInvoiceCqtFollowOnce(), 5 * 60_000).unref();
  setInterval(() => void runInvoiceCqtFollowOnce(), minutes * 60_000).unref();
  console.log(
    `[CQT-follow] BẬT — hỏi trạng thái hóa đơn theo giờ hỏi kế tiếp: quét mỗi ${minutes} phút, nhận ${CLAIM_BATCH} tờ mỗi câu, dòng dở tới hạn lại sau ${CQT_CLAIM_MS / 60_000} phút`
  );
}
