// ============================================================
// WORKER TỰ ĐỘNG PHÁT HÀNH HÓA ĐƠN (23/08 — học theo Salework)
//
// Nhịp 15 phút: với mỗi shop đã BẬT autoIssueEnabled (trang Kết nối & Xuất
// hóa đơn), tự phát hành hóa đơn cho đơn đủ điều kiện:
//
//   • shippingStatus = DELIVERED (đã giao thành công). MỐC XUẤT theo shop chọn
//     (InvoiceConfig.autoIssueTrigger — 19/09):
//       DELIVERED — xuất ngay khi giao xong. Đúng Điều 9 NĐ 254/2026 (lập hóa
//                   đơn tại thời điểm chuyển giao quyền sở hữu); số tiền hóa đơn
//                   là TIỀN HÀNG, không phụ thuộc đối soát (đối soát chỉ chốt
//                   phí sàn). Mặc định cho shop bật mới.
//       SETTLED   — chờ thêm isSettled = true (luật cũ trước 19/09): ít hóa đơn
//                   điều chỉnh hơn vì đơn hoàn sớm chưa kịp xuất, đổi lại trễ
//                   vài ngày so với mốc luật.
//   • CHỈ đơn giao từ 0h (giờ VN) của NGÀY BẬT công tắc (autoIssueEnabledAt —
//     19/09): đơn cũ hơn có thể đã được chủ shop lập hóa đơn tay trên meInvoice
//     trước khi dùng Hubsell → tự xuất là trùng, mà hóa đơn đã gửi CQT thì
//     không xóa được. Đơn cũ vẫn nằm ở hàng chờ để xuất tay có chủ đích.
//   • Chưa có hóa đơn PENDING/ISSUED, và KHÔNG có bản ghi hóa đơn nào trong
//     24h gần nhất — đơn vừa FAILED sẽ được thử lại tối đa 1 lần/ngày thay vì
//     spam NCC mỗi 15 phút.
//   • KHÔNG có hóa đơn CANCELLED (03/09): seller đã chủ động hủy/xóa trên NCC
//     (worker invoice-status-sync phát hiện) — xuất lại hay không là quyết
//     định của seller (làm tay ở hàng chờ), máy không tự xuất đè.
//
// AN TOÀN nhiều lớp (hóa đơn là chứng từ CQT, không xóa được):
//   • MISA_ALLOW_PUBLISH chưa bật → worker NGỦ HOÀN TOÀN (không tạo log FAILED).
//   • 24/08 tối MỞ THƯƠNG MẠI: hết lọc thí điểm — mọi shop bật công tắc đều chạy;
//     shop cấu hình MST sandbox mà không phải tài khoản nội bộ → bỏ qua.
//   • Trần 20 hóa đơn/shop/lượt — sự cố cấu hình không thể xả trăm hóa đơn.
//   • Xử lý TUẦN TỰ từng đơn (MISA cấp số liên tục theo ký hiệu).
//   • NGẮT MẠCH (19/09) — xem decideAfterFailure bên dưới.
//
// Cấu hình: INVOICE_AUTO_ISSUE_MINUTES (mặc định 15; "0" = tắt worker).
// ============================================================

import { InvoiceLogStatus, ShippingStatus } from "@prisma/client";

import type { InvoiceErrorScope } from "../integrations/invoice/invoice-errors";
import { issueInvoiceForOrder } from "../integrations/invoice/issue-order";
import { isPublishAllowed } from "../integrations/invoice/misa-safety";
import { notify } from "../services/notifications";
import { prisma } from "../lib/prisma";
import { isTaxPilotUser, MISA_SANDBOX_TAX_CODE } from "../services/tax-pilot";

const DEFAULT_INTERVAL_MINUTES = 15;
/** Trần hóa đơn mỗi shop mỗi lượt quét — chống xả hàng loạt khi cấu hình sai. */
const MAX_PER_OWNER_PER_RUN = 20;
/** Đơn có bản ghi hóa đơn (kể cả FAILED) mới hơn cửa sổ này thì chưa thử lại. */
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Cùng MỘT mã lỗi lặp liên tiếp chừng này đơn trong một lượt → coi là lỗi hệ
 * thống đội lốt lỗi đơn lẻ (mã NCC chưa có trong bảng invoice-errors, VD hết
 * số hóa đơn đã mua) và ngắt mạch. Con số 3 là MẶC ĐỊNH TÙY Ý, không có nguồn:
 * đủ nhỏ để không đốt cả lô 20 đơn, đủ lớn để 2 đơn bẩn dữ liệu nằm cạnh nhau
 * không làm ngừng cả shop.
 */
const SAME_ERROR_STREAK_TO_PAUSE = 3;

export type AutoIssueTrigger = "DELIVERED" | "SETTLED";

export function normalizeAutoIssueTrigger(v: unknown): AutoIssueTrigger {
  return v === "SETTLED" ? "SETTLED" : "DELIVERED";
}

/** 0h giờ VN (UTC+7) của ngày chứa mốc `at` — trả về dạng Date UTC. */
export function vnStartOfDay(at: Date): Date {
  const VN = 7 * 3600 * 1000;
  const vn = new Date(at.getTime() + VN);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN);
}

export type FailureDecision = "CONTINUE" | "STOP_RUN" | "PAUSE";

/**
 * NGẮT MẠCH — quyết định sau MỖI đơn lỗi (hàm thuần, có test):
 *   · ACCOUNT   → PAUSE ngay: sai mật khẩu meInvoice / ký hiệu ngừng dùng / chứng
 *                 thư hết hạn thì đơn nào cũng lỗi y hệt; thử tiếp chỉ đẻ FAILED
 *                 rác và khóa các đơn đó 24h. Ngừng tới khi chủ shop sửa.
 *   · TRANSIENT → STOP_RUN: NCC bận / mạng chập chờn — bỏ phần còn lại của lượt,
 *                 15 phút sau quét lại (không đánh dấu tạm ngừng).
 *   · ORDER     → CONTINUE, trừ khi cùng mã lặp đủ SAME_ERROR_STREAK_TO_PAUSE.
 */
export function decideAfterFailure(
  scope: InvoiceErrorScope | undefined,
  sameCodeStreak: number
): FailureDecision {
  if (scope === "ACCOUNT") return "PAUSE";
  if (scope === "TRANSIENT") return "STOP_RUN";
  return sameCodeStreak >= SAME_ERROR_STREAK_TO_PAUSE ? "PAUSE" : "CONTINUE";
}

let running = false;

export async function runInvoiceAutoIssueOnce(): Promise<void> {
  if (running) return; // lượt trước chưa xong (NCC chậm) — bỏ lượt này
  running = true;
  try {
    // Chốt an toàn tổng: chưa được phép phát hành thì không làm gì cả —
    // kể cả ghi log FAILED (sẽ thành rác lặp vô hạn).
    if (!isPublishAllowed()) return;

    const configs = await prisma.invoiceConfig.findMany({
      where: {
        channelId: null,
        autoIssueEnabled: true,
        autoIssuePausedAt: null, // đang ngắt mạch — chờ chủ shop sửa rồi bật lại
        provider: "MISA",
      },
      select: {
        id: true,
        ownerId: true,
        taxCode: true,
        meinvoiceUsername: true,
        meinvoicePassword: true,
        autoIssueTrigger: true,
        autoIssueEnabledAt: true,
        owner: { select: { email: true } },
      },
    });

    for (const cfg of configs) {
      // Thiếu tài khoản meInvoice → phát hành chắc chắn fail, khỏi thử.
      if (!cfg.meinvoiceUsername || !cfg.meinvoicePassword) continue;
      // Khách thường trỏ MST sandbox → bỏ qua (cùng luật với route).
      if (cfg.taxCode === MISA_SANDBOX_TAX_CODE && !isTaxPilotUser(cfg.owner.email)) {
        continue;
      }

      const trigger = normalizeAutoIssueTrigger(cfg.autoIssueTrigger);
      const retryCutoff = new Date(Date.now() - RETRY_WINDOW_MS);
      const orders = await prisma.order.findMany({
        where: {
          channel: { userId: cfg.ownerId },
          shippingStatus: ShippingStatus.DELIVERED,
          ...(trigger === "SETTLED" ? { isSettled: true } : {}),
          ...(cfg.autoIssueEnabledAt
            ? { deliveredAt: { gte: vnStartOfDay(cfg.autoIssueEnabledAt) } }
            : {}),
          items: { some: {} },
          invoiceLogs: {
            none: {
              OR: [
                {
                  status: {
                    in: [
                      InvoiceLogStatus.PENDING,
                      InvoiceLogStatus.ISSUED,
                      InvoiceLogStatus.CANCELLED,
                    ],
                  },
                },
                { createdAt: { gt: retryCutoff } },
              ],
            },
          },
        },
        orderBy: { createdAt: "asc" }, // đơn cũ trước — đơn giao lâu nhất trễ mốc luật nhất
        take: MAX_PER_OWNER_PER_RUN,
        select: { orderCode: true },
      });
      if (orders.length === 0) continue;

      let issued = 0;
      let failed = 0;
      let streakCode: string | null = null;
      let streak = 0;
      let pauseReason: string | null = null;
      for (const o of orders) {
        // TUẦN TỰ — MISA cấp số hóa đơn liên tục theo ký hiệu.
        const r = await issueInvoiceForOrder(
          cfg.ownerId,
          { userId: cfg.ownerId },
          o.orderCode
        );
        if (r.ok) {
          issued += 1;
          streakCode = null;
          streak = 0;
          continue;
        }
        failed += 1;
        const code = r.errorCode ?? r.error ?? "?";
        streak = code === streakCode ? streak + 1 : 1;
        streakCode = code;
        const decision = decideAfterFailure(r.errorScope, streak);
        if (decision === "PAUSE") {
          pauseReason = r.error ?? "NCC từ chối phát hành";
          break;
        }
        if (decision === "STOP_RUN") break;
      }

      if (pauseReason) {
        await prisma.invoiceConfig.update({
          where: { id: cfg.id },
          data: { autoIssuePausedAt: new Date(), autoIssuePauseReason: pauseReason },
        });
      }
      console.log(
        `[Auto-issue] Shop ${cfg.ownerId} (${trigger}): phát hành ${issued} hóa đơn` +
          (failed > 0 ? `, ${failed} lỗi (xem Nhật ký hóa đơn)` : "") +
          (pauseReason ? ` — NGẮT MẠCH: ${pauseReason}` : "")
      );
      if (pauseReason) {
        // MỘT chuông nói rõ việc cần làm, thay vì chuông "n đơn lỗi" mỗi 15 phút.
        await notify(cfg.ownerId, {
          type: "INVOICE_AUTO_ISSUE_PAUSED",
          title: "Tự động phát hành hóa đơn đã TẠM NGỪNG",
          body:
            `${pauseReason} Sửa xong bấm "Chạy lại" ở trang Kết nối & Xuất hóa đơn` +
            (issued > 0 ? ` (lượt này đã kịp phát hành ${issued} hóa đơn).` : "."),
          link: "/invoicing/connect",
        });
      } else if (issued > 0 || failed > 0) {
        await notify(cfg.ownerId, {
          type: "INVOICE_AUTO_ISSUE",
          title: `Tự động phát hành ${issued} hóa đơn điện tử`,
          body:
            failed > 0
              ? `${issued} hóa đơn phát hành thành công, ${failed} đơn lỗi — xem chi tiết tại Lịch sử & Báo cáo thuế.`
              : trigger === "SETTLED"
                ? `Các đơn đã giao & đã đối soát được xuất hóa đơn tự động.`
                : `Các đơn đã giao thành công được xuất hóa đơn tự động.`,
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
