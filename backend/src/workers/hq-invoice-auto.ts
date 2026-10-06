// ============================================================
// LƯỚI AN TOÀN TỰ XUẤT HĐĐT BÁN GÓI + GỬI EMAIL (06/10/2026)
//
// Luồng chính chạy NGAY sau khi ghi nhận thanh toán (kickHqAutoInvoice trong
// subscription-service). Worker này chỉ nhặt phần lỡ:
//   · web restart giữa chừng / MISA lỗi tạm → bút toán còn PENDING chưa có mã;
//   · meInvoice cấp số trễ → có mã mà chưa có số;
//   · có số mà email chưa gửi (SMTP lỗi, PDF chưa tải được).
// Mọi luật nằm ở integrations/invoice/hq-auto-invoice.ts (processHqLedgerInvoice
// idempotent + khóa theo bút toán) — worker chỉ QUÉT rồi gọi tuần tự.
//
// Điều kiện nhặt: công tắc HQ bật, bút toán thu phí gói phát sinh từ mốc bật,
// chưa chạm trần MAX_AUTO_ATTEMPTS, lượt thử gần nhất cách đây ≥ RETRY_GAP.
// Trần MAX_PER_RUN bút toán/lượt — sự cố cấu hình không xả hàng loạt.
// Cấu hình: HQ_INVOICE_AUTO_MINUTES (mặc định 30; "0" = tắt).
// ============================================================

import { LedgerDirection, LedgerInvoiceStatus } from "@prisma/client";

import {
  getPlatformInvoiceConfigRow,
  isSignSessionError,
  MAX_AUTO_ATTEMPTS,
  processHqLedgerInvoice,
} from "../integrations/invoice/hq-auto-invoice";
import { isPublishAllowed } from "../integrations/invoice/misa-safety";
import { prisma } from "../lib/prisma";
import { mailHq } from "../services/hq-mail";

const FRONTEND_URL = (process.env.APP_FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");
/** Nhắc HQ mở phiên ký eSign tối đa một lần mỗi chừng này khi còn hóa đơn chờ. */
export const SIGN_SESSION_REMIND_GAP_MS = 20 * 60 * 60 * 1000;
let lastSignSessionRemindAt = 0;

const DEFAULT_INTERVAL_MINUTES = 30;
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;
/** Bút toán vừa được thử (kể cả luồng tức thì) thì chưa thử lại ngay. */
export const RETRY_GAP_MS = 20 * 60 * 1000;
export const MAX_PER_RUN = 20;

let started = false;
let running = false;

export function startHqInvoiceAutoWorker(): void {
  if (started) return;
  started = true;
  const raw = process.env.HQ_INVOICE_AUTO_MINUTES?.trim();
  const minutes = raw ? Number(raw) : DEFAULT_INTERVAL_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("[HQ invoice] Worker lưới an toàn TẮT (HQ_INVOICE_AUTO_MINUTES=0)");
    return;
  }
  setTimeout(() => void runHqInvoiceAutoOnce(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runHqInvoiceAutoOnce(), minutes * 60 * 1000).unref();
  console.log(`[HQ invoice] Worker lưới an toàn BẬT — quét mỗi ${minutes} phút`);
}

/** Một lượt quét — export để test/gọi tay. Trả về số bút toán đã xử lý. */
export async function runHqInvoiceAutoOnce(now = new Date()): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const cfg = await getPlatformInvoiceConfigRow();
    if (!cfg.autoIssueEnabled) return 0;
    // Chốt MISA_ALLOW_PUBLISH tắt → không nhặt khoản CHƯA phát hành (mỗi lượt sẽ
    // chỉ ghi lỗi + đốt lượt thử); khoản đã có mã (chờ số / chờ mail) vẫn xử lý.
    const canPublish = isPublishAllowed();

    const retryBefore = new Date(now.getTime() - RETRY_GAP_MS);
    const candidates = await prisma.platformLedgerEntry.findMany({
      where: {
        direction: LedgerDirection.IN,
        packagePaymentId: { not: null },
        ...(cfg.autoIssueEnabledAt ? { occurredAt: { gte: cfg.autoIssueEnabledAt } } : {}),
        einvoiceAutoAttempts: { lt: MAX_AUTO_ATTEMPTS },
        AND: [
          { OR: [{ einvoiceAutoTriedAt: null }, { einvoiceAutoTriedAt: { lt: retryBefore } }] },
          {
            OR: [
              // Chưa phát hành / chưa có số.
              {
                invoiceStatus: LedgerInvoiceStatus.PENDING,
                ...(canPublish ? {} : { einvoiceTransactionId: { not: null } }),
              },
              // Có số qua API mà chưa gửi email (chỉ khi bật tự gửi).
              ...(cfg.autoEmailEnabled
                ? [
                    {
                      invoiceStatus: LedgerInvoiceStatus.ISSUED,
                      einvoiceTransactionId: { not: null },
                      invoiceEmailSentAt: null,
                    },
                  ]
                : []),
            ],
          },
        ],
      },
      select: { id: true },
      orderBy: { occurredAt: "asc" },
      take: MAX_PER_RUN,
    });

    let done = 0;
    let waitingSignSession = 0;
    for (const c of candidates) {
      const r = await processHqLedgerInvoice(c.id, { trigger: "worker" });
      done++;
      if (r.step === "failed" && isSignSessionError(r.error)) {
        waitingSignSession++;
      } else if (r.step === "failed") {
        console.warn(`[HQ invoice] Worker: bút toán ${c.id} lỗi — ${r.error}`);
      } else if (r.step !== "nothing" && r.step !== "locked") {
        console.log(`[HQ invoice] Worker: bút toán ${c.id} → ${r.step}${r.invoiceNo ? ` · số ${r.invoiceNo}` : ""}`);
      }
    }
    // Hóa đơn đang chờ phiên ký eSign: nhắc HQ mở app, nhiều nhất một thư/ngày.
    if (waitingSignSession > 0 && now.getTime() - lastSignSessionRemindAt > SIGN_SESSION_REMIND_GAP_MS) {
      lastSignSessionRemindAt = now.getTime();
      console.warn(`[HQ invoice] ${waitingSignSession} hóa đơn bán gói chờ phiên ký eSign`);
      void mailHq({
        subject: `[Hubsell] ${waitingSignSession} hóa đơn bán gói đang chờ phiên ký eSign`,
        html: `<p>Khách đã thanh toán nhưng meInvoice chưa ký được vì app MISA eSign chưa mở phiên ký.</p><p>Mở app MISA eSign → Thiết lập → bật <b>Ký phiên</b> (hiệu lực 24h). Máy tự thử lại mỗi 30 phút, hoặc vào <a href="${FRONTEND_URL}/admin/finance">Sổ quỹ HQ</a> bấm Thử lại.</p>`,
      });
    }
    return done;
  } catch (err) {
    console.error("[HQ invoice] Worker lỗi:", (err as Error).message);
    return 0;
  } finally {
    running = false;
  }
}
