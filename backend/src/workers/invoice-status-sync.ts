// ============================================================
// WORKER ĐỒNG BỘ TRẠNG THÁI HÓA ĐƠN VỚI NCC (03/09 — công cụ kiểm chứng)
//
// meInvoice KHÔNG có webhook (tài liệu chỉ có /invoice/status để polling),
// nên trước worker này Hubsell KHÔNG BIẾT hóa đơn đã ký có được CQT cấp mã
// hay bị từ chối, và không biết seller đã hủy/xóa tờ nào trên meInvoice.
// Hệ quả kế toán: tờ bị CQT từ chối vẫn nằm ISSUED → VAT đầu ra đếm cả tờ
// vô hiệu; tờ đã xóa bên NCC vẫn tính vào báo cáo.
//
// Nhịp 12 GIỜ (anh Trung chốt 03/09: không cấp thiết tới mức 30 phút — hóa đơn
// có mã rồi gần như không đổi; giãn nhịp để không đè DB/NCC), mỗi shop MISA có
// tài khoản meInvoice:
//   • Chọn log PENDING/ISSUED lập trong 30 ngày, chưa kiểm hoặc đến hạn kiểm
//     lại (ACCEPTED: chỉ kiểm lại trong 7 ngày đầu để bắt xóa muộn, sau đó
//     coi là chốt; còn lại: mỗi lượt tới khi có kết luận).
//   • Hỏi /invoice/status theo lô 50 (tách lô có mã / không mã vì cách đọc
//     SendTaxStatus khác nhau — xem cqt-status.ts).
//   • IsDelete=true          → status CANCELLED + audit + Order.einvoiceStatus.
//   • PENDING & PublishStatus=1 → ISSUED (webhook chưa về / không có webhook).
//   • SendTaxStatus          → InvoiceLog.cqtStatus (WAITING/SEND_ERROR/ACCEPTED/
//                              REJECTED); REJECTED → báo chuông seller đi sửa
//                              trên meInvoice (Hubsell không xây form thay thế —
//                              anh Trung chốt 03/09).
//
// Chỉ ĐỌC phía NCC — không đi qua chốt MISA_ALLOW_PUBLISH (không sinh chứng từ).
// Cấu hình: INVOICE_STATUS_SYNC_MINUTES (mặc định 720 = 12h; "0" = tắt worker).
// ============================================================

import { InvoiceLogStatus, type InvoiceConfig } from "@prisma/client";

import {
  CQT_ACCEPTED_WATCH_MS,
  CQT_RECHECK_MS,
  CQT_WATCH_WINDOW_MS,
  mapCqtStatus,
  seriesHasTaxCode,
} from "../integrations/invoice/cqt-status";
import {
  getInvoiceStatuses,
  type MisaInvoiceStatusItem,
  type StandardInvoiceConfig,
} from "../integrations/invoice/misa-einvoice";
import { prisma } from "../lib/prisma";
import { notify } from "../services/notifications";

const DEFAULT_INTERVAL_MINUTES = 12 * 60;
/** Trần log kiểm mỗi shop mỗi lượt — shop nghìn hóa đơn/ngày vẫn xoay hết trong vài nhịp. */
const MAX_PER_OWNER_PER_RUN = 200;
/** Cỡ lô gửi /invoice/status (body là mảng TransactionID). */
const BATCH_SIZE = 50;
/** Nguồn ghi audit InvoiceStatusHistory cho mọi thay đổi từ worker này. */
export const STATUS_SYNC_SOURCE = "MISA_STATUS_SYNC";

let running = false;

interface CandidateLog {
  id: string;
  orderId: string | null;
  orderCode: string;
  status: InvoiceLogStatus;
  cqtStatus: string | null;
  invoiceNo: string | null;
  transactionId: string | null;
  invoiceSeries: string | null;
}

interface ShopSyncStats {
  checked: number;
  issuedFixed: number;
  cancelled: number;
  rejected: number;
  cancelledNos: string[];
  rejectedNos: string[];
}

/**
 * Áp một kết quả trạng thái NCC lên một log — thuần logic chuyển trạng thái,
 * tách ra để đọc được luồng mà không lẫn với vòng lặp/lô.
 */
async function applyStatus(
  log: CandidateLog,
  item: MisaInvoiceStatusItem | undefined,
  withCode: boolean,
  stats: ShopSyncStats,
  now: Date
): Promise<void> {
  stats.checked += 1;
  // NCC không trả dòng cho mã này (chưa index xong / mã sai) — chỉ ghi nhận
  // đã hỏi, để nhịp sau hỏi lại; không suy diễn gì.
  if (!item) {
    await prisma.invoiceLog.update({
      where: { id: log.id },
      data: { cqtCheckedAt: now },
    });
    return;
  }

  // ---- 1. Hóa đơn bị xóa bỏ/hủy trên NCC → CANCELLED (không đảo ngược) ----
  if (item.isDeleted && log.status !== InvoiceLogStatus.CANCELLED) {
    await prisma.$transaction([
      prisma.invoiceLog.update({
        where: { id: log.id },
        data: { status: InvoiceLogStatus.CANCELLED, cqtCheckedAt: now },
      }),
      prisma.invoiceStatusHistory.create({
        data: {
          invoiceLogId: log.id,
          orderCode: log.orderCode,
          fromStatus: log.status,
          toStatus: InvoiceLogStatus.CANCELLED,
          source: STATUS_SYNC_SOURCE,
          note: "NCC báo hóa đơn đã bị xóa bỏ/hủy trên meInvoice (IsDelete) — loại khỏi báo cáo kỳ.",
        },
      }),
      ...(log.orderId
        ? [
            prisma.order.update({
              where: { id: log.orderId },
              data: { einvoiceStatus: InvoiceLogStatus.CANCELLED },
            }),
          ]
        : []),
    ]);
    stats.cancelled += 1;
    stats.cancelledNos.push(log.invoiceNo ?? log.orderCode);
    return;
  }

  // ---- 2. PENDING mà NCC đã phát hành → ISSUED (bù webhook không có) ----
  let nextStatus = log.status;
  let issuedNote: string | null = null;
  if (log.status === InvoiceLogStatus.PENDING && item.publishStatus === 1) {
    nextStatus = InvoiceLogStatus.ISSUED;
    issuedNote = `NCC xác nhận đã phát hành (tra trạng thái): số ${item.invoiceNo ?? log.invoiceNo ?? "?"}`;
    stats.issuedFixed += 1;
  }

  // ---- 3. Trạng thái CQT — null thì GIỮ giá trị cũ, không ghi đè ----
  const cqt = mapCqtStatus(item.sendTaxStatus, withCode) ?? log.cqtStatus;
  const newlyRejected = cqt === "REJECTED" && log.cqtStatus !== "REJECTED";
  if (newlyRejected) {
    stats.rejected += 1;
    stats.rejectedNos.push(log.invoiceNo ?? log.orderCode);
  }

  await prisma.$transaction([
    prisma.invoiceLog.update({
      where: { id: log.id },
      data: {
        status: nextStatus,
        cqtStatus: cqt,
        cqtCheckedAt: now,
        ...(nextStatus === InvoiceLogStatus.ISSUED && log.status === InvoiceLogStatus.PENDING
          ? { issuedAt: now, errorMessage: null }
          : {}),
        ...(item.invoiceNo && !log.invoiceNo ? { invoiceNo: item.invoiceNo } : {}),
      },
    }),
    // Audit: một dòng cho mỗi thay đổi có ý nghĩa (phát hành muộn / CQT từ chối).
    ...(issuedNote || newlyRejected
      ? [
          prisma.invoiceStatusHistory.create({
            data: {
              invoiceLogId: log.id,
              orderCode: log.orderCode,
              fromStatus: log.status,
              toStatus: nextStatus,
              source: STATUS_SYNC_SOURCE,
              note: [
                issuedNote,
                newlyRejected
                  ? "CƠ QUAN THUẾ TỪ CHỐI cấp mã/tiếp nhận — hóa đơn chưa hợp lệ, cần sửa và gửi lại trên meInvoice."
                  : null,
              ]
                .filter(Boolean)
                .join(" | "),
            },
          }),
        ]
      : []),
    ...(nextStatus !== log.status && log.orderId
      ? [
          prisma.order.update({
            where: { id: log.orderId },
            data: { einvoiceStatus: nextStatus },
          }),
        ]
      : []),
  ]);
}

/** Gọi NCC cho một nhóm log cùng loại ký hiệu (có mã / không mã). */
async function syncGroup(
  cfg: InvoiceConfig,
  logs: CandidateLog[],
  withCode: boolean,
  stats: ShopSyncStats,
  now: Date
): Promise<void> {
  for (let i = 0; i < logs.length; i += BATCH_SIZE) {
    const batch = logs.slice(i, i + BATCH_SIZE);
    const ids = batch.map((l) => l.transactionId!).filter(Boolean);
    // getInvoiceStatuses suy invoiceWithCode từ ký hiệu trong cfg — truyền ký
    // hiệu ĐẠI DIỆN của nhóm (shop có thể đã đổi ký hiệu sau khi phát hành).
    const groupCfg = {
      ...cfg,
      invoiceSeries: batch[0].invoiceSeries ?? cfg.invoiceSeries,
    } as unknown as StandardInvoiceConfig;
    const items = await getInvoiceStatuses(ids, groupCfg);
    const byId = new Map(items.filter((it) => it.transactionId).map((it) => [it.transactionId!, it]));
    for (const log of batch) {
      await applyStatus(log, byId.get(log.transactionId!), withCode, stats, now);
    }
  }
}

export async function runInvoiceStatusSyncOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const configs = await prisma.invoiceConfig.findMany({
      where: {
        channelId: null,
        provider: "MISA",
        meinvoiceUsername: { not: null },
        meinvoicePassword: { not: null },
      },
    });

    for (const cfg of configs) {
      const now = new Date();
      const t = now.getTime();
      let logs: CandidateLog[];
      try {
        logs = await prisma.invoiceLog.findMany({
          where: {
            ownerId: cfg.ownerId,
            provider: "MISA",
            transactionId: { not: null },
            status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] },
            createdAt: { gt: new Date(t - CQT_WATCH_WINDOW_MS) },
            OR: [
              { cqtCheckedAt: null },
              // Đã có mã: chỉ kiểm lại trong 7 ngày đầu (bắt xóa muộn), sau đó thôi.
              {
                cqtStatus: "ACCEPTED",
                cqtCheckedAt: { lt: new Date(t - CQT_RECHECK_MS.ACCEPTED) },
                createdAt: { gt: new Date(t - CQT_ACCEPTED_WATCH_MS) },
              },
              {
                cqtStatus: { not: "ACCEPTED" },
                cqtCheckedAt: { lt: new Date(t - CQT_RECHECK_MS.OTHER) },
              },
              { cqtStatus: null, cqtCheckedAt: { lt: new Date(t - CQT_RECHECK_MS.OTHER) } },
            ],
          },
          orderBy: { createdAt: "asc" },
          take: MAX_PER_OWNER_PER_RUN,
          select: {
            id: true,
            orderId: true,
            orderCode: true,
            status: true,
            cqtStatus: true,
            invoiceNo: true,
            transactionId: true,
            invoiceSeries: true,
          },
        });
      } catch (err) {
        console.error(`[CQT-sync] Shop ${cfg.ownerId}: lỗi đọc DB — ${(err as Error).message}`);
        continue;
      }
      if (logs.length === 0) continue;

      const stats: ShopSyncStats = {
        checked: 0,
        issuedFixed: 0,
        cancelled: 0,
        rejected: 0,
        cancelledNos: [],
        rejectedNos: [],
      };
      const withCodeLogs = logs.filter((l) =>
        seriesHasTaxCode(l.invoiceSeries ?? cfg.invoiceSeries)
      );
      const noCodeLogs = logs.filter(
        (l) => !seriesHasTaxCode(l.invoiceSeries ?? cfg.invoiceSeries)
      );
      try {
        if (withCodeLogs.length > 0) await syncGroup(cfg, withCodeLogs, true, stats, now);
        if (noCodeLogs.length > 0) await syncGroup(cfg, noCodeLogs, false, stats, now);
      } catch (err) {
        // Lỗi NCC (sai mật khẩu meInvoice, NCC bảo trì) — không đánh dấu gì,
        // nhịp sau thử lại; log để vận hành thấy shop nào đang kẹt.
        console.error(
          `[CQT-sync] Shop ${cfg.ownerId}: NCC trả lỗi — ${(err as Error).message}`
        );
      }

      console.log(
        `[CQT-sync] Shop ${cfg.ownerId}: kiểm ${stats.checked}/${logs.length} hóa đơn` +
          (stats.issuedFixed ? `, ${stats.issuedFixed} PENDING→ISSUED` : "") +
          (stats.cancelled ? `, ${stats.cancelled} đã hủy trên NCC` : "") +
          (stats.rejected ? `, ${stats.rejected} CQT TỪ CHỐI` : "")
      );

      if (stats.rejected > 0 || stats.cancelled > 0) {
        const parts: string[] = [];
        if (stats.rejected > 0) {
          parts.push(
            `${stats.rejected} hóa đơn bị Cơ quan Thuế từ chối (${stats.rejectedNos.slice(0, 3).join(", ")}${stats.rejectedNos.length > 3 ? "…" : ""}) — sửa và gửi lại trên meInvoice.`
          );
        }
        if (stats.cancelled > 0) {
          parts.push(
            `${stats.cancelled} hóa đơn đã bị hủy/xóa trên meInvoice (${stats.cancelledNos.slice(0, 3).join(", ")}${stats.cancelledNos.length > 3 ? "…" : ""}) — đã loại khỏi báo cáo, đơn quay lại hàng chờ nếu cần xuất lại.`
          );
        }
        await notify(cfg.ownerId, {
          type: "INVOICE_CQT_ALERT",
          title: "Hóa đơn cần xử lý với Cơ quan Thuế",
          body: parts.join(" "),
          link: "/invoicing/history",
        });
      }
    }
  } catch (err) {
    console.error("[CQT-sync] Lỗi lượt quét:", (err as Error).message);
  } finally {
    running = false;
  }
}

/** Khởi động worker theo nhịp — gọi một lần từ index.ts. */
export function startInvoiceStatusSyncWorker(): void {
  const minutes = Number(process.env.INVOICE_STATUS_SYNC_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("[CQT-sync] Worker TẮT (INVOICE_STATUS_SYNC_MINUTES=0)");
    return;
  }
  // Lượt đầu chờ 5 phút sau khi server lên (sau auto-issue 3 phút) — deploy
  // lại là có một lượt kiểm ngay, còn lại theo nhịp 12h.
  setTimeout(() => void runInvoiceStatusSyncOnce(), 5 * 60 * 1000);
  setInterval(() => void runInvoiceStatusSyncOnce(), minutes * 60 * 1000);
  console.log(`[CQT-sync] Worker chạy nhịp ${minutes} phút`);
}
