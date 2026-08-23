// ============================================================
// WORKER TỰ ĐỘNG PHÁT HÀNH HÓA ĐƠN (23/08 — học theo Salework)
//
// Nhịp 15 phút: với mỗi shop đã BẬT autoIssueEnabled (trang Kết nối & Xuất
// hóa đơn), tự phát hành hóa đơn cho đơn đủ điều kiện:
//
//   • shippingStatus = DELIVERED (đã giao thành công) VÀ isSettled = true
//     (sàn đã đối soát — số liệu doanh thu/phí đã chốt, không xuất non).
//   • Chưa có hóa đơn PENDING/ISSUED, và KHÔNG có bản ghi hóa đơn nào trong
//     24h gần nhất — đơn vừa FAILED sẽ được thử lại tối đa 1 lần/ngày thay vì
//     spam NCC mỗi 15 phút.
//
// AN TOÀN nhiều lớp (hóa đơn là chứng từ CQT, không xóa được):
//   • MISA_ALLOW_PUBLISH chưa bật → worker NGỦ HOÀN TOÀN (không tạo log FAILED).
//   • Giai đoạn thí điểm: chỉ chạy cho shop có email trong TAX_PILOT_EMAILS.
//   • Shop cấu hình MST sandbox mà không phải tài khoản thí điểm → bỏ qua.
//   • Trần 20 hóa đơn/shop/lượt — sự cố cấu hình không thể xả trăm hóa đơn.
//   • Xử lý TUẦN TỰ từng đơn (MISA cấp số liên tục theo ký hiệu).
//
// Cấu hình: INVOICE_AUTO_ISSUE_MINUTES (mặc định 15; "0" = tắt worker).
// ============================================================

import { InvoiceLogStatus, ShippingStatus } from "@prisma/client";

import { issueInvoiceForOrder } from "./integrations/invoice/issue-order";
import { isPublishAllowed } from "./integrations/invoice/misa-safety";
import { notify } from "./notifications";
import { prisma } from "./prisma";
import { isTaxPilotUser, MISA_SANDBOX_TAX_CODE } from "./tax-pilot";

const DEFAULT_INTERVAL_MINUTES = 15;
/** Trần hóa đơn mỗi shop mỗi lượt quét — chống xả hàng loạt khi cấu hình sai. */
const MAX_PER_OWNER_PER_RUN = 20;
/** Đơn có bản ghi hóa đơn (kể cả FAILED) mới hơn cửa sổ này thì chưa thử lại. */
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

let running = false;

export async function runInvoiceAutoIssueOnce(): Promise<void> {
  if (running) return; // lượt trước chưa xong (NCC chậm) — bỏ lượt này
  running = true;
  try {
    // Chốt an toàn tổng: chưa được phép phát hành thì không làm gì cả —
    // kể cả ghi log FAILED (sẽ thành rác lặp vô hạn).
    if (!isPublishAllowed()) return;

    const configs = await prisma.invoiceConfig.findMany({
      where: { channelId: null, autoIssueEnabled: true, provider: "MISA" },
      select: {
        ownerId: true,
        taxCode: true,
        meinvoiceUsername: true,
        meinvoicePassword: true,
        owner: { select: { email: true } },
      },
    });

    for (const cfg of configs) {
      // Thí điểm: chỉ chạy cho tài khoản trong danh sách (gỡ khi thương mại).
      if (!isTaxPilotUser(cfg.owner.email)) continue;
      // Thiếu tài khoản meInvoice → phát hành chắc chắn fail, khỏi thử.
      if (!cfg.meinvoiceUsername || !cfg.meinvoicePassword) continue;
      // Khách thường trỏ MST sandbox → bỏ qua (cùng luật với route).
      if (cfg.taxCode === MISA_SANDBOX_TAX_CODE && !isTaxPilotUser(cfg.owner.email)) {
        continue;
      }

      const retryCutoff = new Date(Date.now() - RETRY_WINDOW_MS);
      const orders = await prisma.order.findMany({
        where: {
          channel: { userId: cfg.ownerId },
          shippingStatus: ShippingStatus.DELIVERED,
          isSettled: true,
          items: { some: {} },
          invoiceLogs: {
            none: {
              OR: [
                { status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] } },
                { createdAt: { gt: retryCutoff } },
              ],
            },
          },
        },
        orderBy: { createdAt: "asc" }, // đơn cũ trước — hạn "ngày làm việc tiếp theo"
        take: MAX_PER_OWNER_PER_RUN,
        select: { orderCode: true },
      });
      if (orders.length === 0) continue;

      let issued = 0;
      let failed = 0;
      for (const o of orders) {
        // TUẦN TỰ — MISA cấp số hóa đơn liên tục theo ký hiệu.
        const r = await issueInvoiceForOrder(
          cfg.ownerId,
          { userId: cfg.ownerId },
          o.orderCode
        );
        if (r.ok) issued += 1;
        else failed += 1;
      }
      console.log(
        `[Auto-issue] Shop ${cfg.ownerId}: phát hành ${issued} hóa đơn` +
          (failed > 0 ? `, ${failed} lỗi (xem Nhật ký hóa đơn)` : "")
      );
      if (issued > 0 || failed > 0) {
        await notify(cfg.ownerId, {
          type: "INVOICE_AUTO_ISSUE",
          title: `Tự động phát hành ${issued} hóa đơn điện tử`,
          body:
            failed > 0
              ? `${issued} hóa đơn phát hành thành công, ${failed} đơn lỗi — xem chi tiết tại Lịch sử & Báo cáo thuế.`
              : `Các đơn đã giao & đã đối soát được xuất hóa đơn tự động.`,
          link: "/invoicing/history",
        });
      }
    }
  } catch (err) {
    console.error("[Auto-issue] Lỗi lượt quét:", (err as Error).message);
  } finally {
    running = false;
  }
}

/** Khởi động worker theo nhịp — gọi một lần từ index.ts. */
export function startInvoiceAutoIssueWorker(): void {
  const minutes = Number(process.env.INVOICE_AUTO_ISSUE_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log("[Auto-issue] Worker TẮT (INVOICE_AUTO_ISSUE_MINUTES=0)");
    return;
  }
  // Lượt đầu chờ 3 phút cho server ấm máy (tránh dồn API call lúc boot).
  setTimeout(() => void runInvoiceAutoIssueOnce(), 3 * 60 * 1000);
  setInterval(() => void runInvoiceAutoIssueOnce(), minutes * 60 * 1000);
  console.log(`[Auto-issue] Worker chạy nhịp ${minutes} phút`);
}
