// ============================================================
// CRON DỌN LOG KỸ THUẬT — GIỮ DATABASE KHÔNG PHÌNH VÔ HẠN
//
// Các bảng log hạ tầng (hàng đợi webhook, nhật ký đẩy tồn) chỉ có giá trị
// PHÁP Y ngắn hạn: tra "đơn không về" / "tồn lệch" khi khách báo — thường
// trong vòng vài ngày. Không mang giá trị nghiệp vụ lâu dài nên xoay vòng:
//
//   • Job đã XONG (SUCCESS)      : giữ 7 ngày  — đủ cửa sổ khách báo trễ.
//   • Mọi trạng thái khác        : giữ 30 ngày — FAILED cần người xem lâu hơn;
//     PENDING/PROCESSING già hơn 30 ngày là job chết (restart giữa chừng),
//     đã có lưới order-auto-sync vét lại đơn nên xóa an toàn.
//   • Cảnh báo lệch tồn ĐÃ XỬ LÝ : giữ 30 ngày sau khi đóng. Cảnh báo còn
//     treo (resolvedAt NULL) KHÔNG bao giờ tự xóa — đó là việc chưa làm.
//
// KHÔNG đụng các bảng audit nghiệp vụ (InvoiceStatusHistory, InventoryLog,
// AdsActionLog, InvoiceLog...) — chúng là chứng cứ đối soát, chỉ insert.
//
// Xóa theo BATCH nhỏ tuần tự (không DELETE cả bảng một phát) — Supabase Free
// pool 5 kết nối, một câu DELETE triệu dòng sẽ giữ khóa + chiếm pool.
//
// Cấu hình: LOG_CLEANUP_HOURS (mặc định 24; "0" = tắt).
// ============================================================

import { InvoiceLogStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

const DEFAULT_INTERVAL_HOURS = 24;
/** Thông tin xuất hóa đơn của khách: xóa sau khi HĐ phát hành ngần này ngày. */
const BUYER_INFO_AFTER_ISSUED_DAYS = 30;
/** ...hoặc sau ngần này ngày kể từ khi kéo về mà KHÔNG phát hành hóa đơn. */
const BUYER_INFO_MAX_DAYS = 90;
/** Job SUCCESS giữ ngần này ngày rồi xóa. */
const RETENTION_DONE_DAYS = 7;
/** Mọi dòng (kể cả FAILED/kẹt) quá ngần này ngày thì xóa hẳn. */
const RETENTION_MAX_DAYS = 30;
/** Số dòng xóa mỗi nhát — nhỏ để không chiếm pool/khóa bảng lâu. */
const BATCH_SIZE = 500;
/** Nghỉ giữa hai nhát xóa liên tiếp. */
const BATCH_PAUSE_MS = 200;
/** Chạy lượt đầu sau boot vài phút — nhường webhook/sync nóng máy trước. */
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

let started = false;
let running = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** Khởi động worker (gọi 1 lần từ index.ts — KHÔNG gọi trong test). */
export function startLogCleanupWorker(): void {
  if (started) return;
  started = true;

  const hours = Number(process.env.LOG_CLEANUP_HOURS ?? DEFAULT_INTERVAL_HOURS);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.log("[Log-cleanup] TẮT (LOG_CLEANUP_HOURS=0)");
    return;
  }

  setTimeout(() => void runOnce(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runOnce(), hours * 60 * 60 * 1000).unref();
  console.log(
    `[Log-cleanup] BẬT — dọn log kỹ thuật mỗi ${hours} giờ (SUCCESS giữ ${RETENTION_DONE_DAYS} ngày, còn lại ${RETENTION_MAX_DAYS} ngày)`
  );
}

/**
 * Xóa dần theo batch: mỗi vòng lấy tối đa BATCH_SIZE id thỏa điều kiện rồi
 * xóa đúng các id đó — deleteMany theo where thẳng không giới hạn được số dòng.
 */
async function deleteInBatches(
  label: string,
  fetchIds: (take: number) => Promise<{ id: string }[]>,
  deleteByIds: (ids: string[]) => Promise<{ count: number }>
): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await fetchIds(BATCH_SIZE);
    if (rows.length === 0) break;
    const { count } = await deleteByIds(rows.map((r) => r.id));
    total += count;
    if (rows.length < BATCH_SIZE) break;
    await sleep(BATCH_PAUSE_MS);
  }
  if (total > 0) console.log(`[Log-cleanup] ${label}: đã xóa ${total} dòng`);
  return total;
}

/** Một lượt dọn. Chống chạy chồng bằng cờ `running` (giống order-auto-sync). */
export async function runOnce(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const doneBefore = daysAgo(RETENTION_DONE_DAYS);
    const maxBefore = daysAgo(RETENTION_MAX_DAYS);

    // Hàng đợi webhook Shopee/MISA — cùng cấu trúc, cùng chính sách.
    const webhookWhere = {
      OR: [
        { status: "SUCCESS" as const, createdAt: { lt: doneBefore } },
        { createdAt: { lt: maxBefore } },
      ],
    };
    await deleteInBatches(
      "shopee_webhook_logs",
      (take) =>
        prisma.shopeeWebhookLog.findMany({ where: webhookWhere, select: { id: true }, take }),
      (ids) => prisma.shopeeWebhookLog.deleteMany({ where: { id: { in: ids } } })
    );
    await deleteInBatches(
      "misa_webhook_logs",
      (take) =>
        prisma.misaWebhookLog.findMany({ where: webhookWhere, select: { id: true }, take }),
      (ids) => prisma.misaWebhookLog.deleteMany({ where: { id: { in: ids } } })
    );

    // Nhật ký đẩy tồn lên sàn: SUCCESS 7 ngày, FAILED 30 ngày.
    const syncLogWhere = {
      OR: [
        { status: "SUCCESS" as const, createdAt: { lt: doneBefore } },
        { createdAt: { lt: maxBefore } },
      ],
    };
    await deleteInBatches(
      "InventorySyncLog",
      (take) =>
        prisma.inventorySyncLog.findMany({ where: syncLogWhere, select: { id: true }, take }),
      (ids) => prisma.inventorySyncLog.deleteMany({ where: { id: { in: ids } } })
    );

    // Cảnh báo lệch tồn: chỉ dọn cái ĐÃ đóng quá 30 ngày; còn treo thì giữ.
    await deleteInBatches(
      "InventorySyncAlert (đã xử lý)",
      (take) =>
        prisma.inventorySyncAlert.findMany({
          where: { resolvedAt: { not: null, lt: maxBefore } },
          select: { id: true },
          take,
        }),
      (ids) => prisma.inventorySyncAlert.deleteMany({ where: { id: { in: ids } } })
    );

    // THÔNG TIN XUẤT HÓA ĐƠN của khách (Order.buyerInvoiceInfo — dữ liệu cá
    // nhân theo Luật BVDLCN, chỉ "ghé qua" Hubsell để phục vụ phát hành):
    //   · HĐ đã phát hành ≥30 ngày → bản đầy đủ đã nằm hợp pháp trên hóa đơn
    //     tại NCC/CQT, bản lưu local xóa được.
    //   · Kéo về ≥90 ngày mà không phát hành → hết giá trị sử dụng, xóa.
    // GIỮ invoiceRequestType (không phải dữ liệu cá nhân) — badge/lịch sử vẫn
    // biết đơn từng có yêu cầu. Xóa = set DbNull, tự rời khỏi filter nên vòng
    // dọn sau không quét lại.
    const buyerInfoWhere: Prisma.OrderWhereInput = {
      buyerInvoiceInfo: { not: Prisma.DbNull },
      OR: [
        {
          invoiceLogs: {
            some: {
              status: InvoiceLogStatus.ISSUED,
              issuedAt: { lt: daysAgo(BUYER_INFO_AFTER_ISSUED_DAYS) },
            },
          },
        },
        { buyerInvoiceFetchedAt: { lt: daysAgo(BUYER_INFO_MAX_DAYS) } },
      ],
    };
    let buyerInfoCleared = 0;
    for (;;) {
      const rows = await prisma.order.findMany({
        where: buyerInfoWhere,
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const { count } = await prisma.order.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { buyerInvoiceInfo: Prisma.DbNull },
      });
      buyerInfoCleared += count;
      if (rows.length < BATCH_SIZE) break;
      await sleep(BATCH_PAUSE_MS);
    }
    if (buyerInfoCleared > 0) {
      console.log(
        `[Log-cleanup] Thông tin xuất hóa đơn của khách: đã xóa ${buyerInfoCleared} đơn (HĐ phát hành ≥${BUYER_INFO_AFTER_ISSUED_DAYS} ngày hoặc quá ${BUYER_INFO_MAX_DAYS} ngày không dùng)`
      );
    }
  } catch (err) {
    console.error("[Log-cleanup] Lỗi vòng dọn:", err);
  } finally {
    running = false;
  }
}
