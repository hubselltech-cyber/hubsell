/**
 * MOCK DATA — PAYLOAD GIẢ LẬP WEBHOOK MISA meInvoice (Sandbox).
 *
 * Dùng ở 2 chỗ:
 *   · Unit test (__tests__/misa-webhook-queue.test.ts) build payload theo dữ
 *     liệu fixture qua các hàm builder bên dưới.
 *   · Test tay khi chưa có MISA Sandbox bắn thật — copy JSON mẫu và curl:
 *
 *     curl -k -X POST https://localhost:4000/v1/webhooks/misa-meinvoice \
 *       -H "Content-Type: application/json" \
 *       -d @misa-published.json
 *
 * Các trường khớp hợp đồng MisaWebhookPayload trong misa-webhook.ts.
 */

import type { MisaWebhookItem, MisaWebhookPayload } from "./misa-webhook";

/** Sự kiện PHÁT HÀNH/KÝ SỐ thành công — kèm chi tiết dòng để đối soát thuế. */
export function buildPublishedPayload(opts: {
  transactionId: string;
  orderCode: string;
  invNo?: string;
  totalAmount?: number;
  totalVatAmount: number;
  items?: MisaWebhookItem[];
}): MisaWebhookPayload {
  return {
    EventType: "InvoicePublished",
    EventDate: new Date().toISOString(),
    Data: {
      TransactionID: opts.transactionId,
      InvNo: opts.invNo ?? `C26TAA-${String(Date.now()).slice(-8)}`,
      RefID: opts.orderCode,
      TotalAmount: opts.totalAmount,
      TotalVATAmount: opts.totalVatAmount,
      InvoiceItems: opts.items,
    },
  };
}

/** Sự kiện HỦY hóa đơn đã phát hành. */
export function buildCancelledPayload(opts: {
  transactionId: string;
  orderCode: string;
  reason?: string;
}): MisaWebhookPayload {
  return {
    EventType: "InvoiceCancelled",
    EventDate: new Date().toISOString(),
    Data: {
      TransactionID: opts.transactionId,
      RefID: opts.orderCode,
      Reason: opts.reason ?? "Người bán hủy hóa đơn (test sandbox)",
    },
  };
}
