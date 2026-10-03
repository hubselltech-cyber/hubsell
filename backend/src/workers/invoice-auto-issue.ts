// ============================================================
// WORKER TỰ ĐỘNG PHÁT HÀNH HÓA ĐƠN (23/08 — học theo Salework)
//
// Nhịp 15 phút: với mỗi shop đã BẬT autoIssueEnabled (trang Kết nối & Xuất
// hóa đơn), tự phát hành hóa đơn cho đơn đủ điều kiện:
//
//   • shippingStatus = DELIVERED (đã giao thành công). MỐC XUẤT theo shop chọn
//     (InvoiceConfig.autoIssueTrigger — 19/09): DELIVERED = xuất ngay, SETTLED =
//     chờ thêm isSettled. Căn cứ + đánh đổi của hai mốc: xem AutoIssueTrigger ở
//     integrations/invoice/auto-issue-policy.ts.
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
//   • KHÔNG có dòng FAILED mang orderErrorCount ≥ INVOICE_AUTO_ISSUE_MAX_ATTEMPTS
//     (bước 5 lát 7, 03/10): đơn bị từ chối vì dữ liệu của chính nó 3 lượt thì
//     máy dừng, đơn ở lại Hàng chờ với nhãn "Máy đã ngừng thử" cho chủ shop xuất
//     tay. Luật ở auto-issue-policy.ts (autoRetryExhausted), số đếm ghi ở
//     issue-order.ts.
//
// AN TOÀN nhiều lớp (hóa đơn là chứng từ CQT, không xóa được):
//   • MISA_ALLOW_PUBLISH chưa bật → worker NGỦ HOÀN TOÀN (không tạo log FAILED).
//   • 24/08 tối MỞ THƯƠNG MẠI: hết lọc thí điểm — mọi shop bật công tắc đều chạy;
//     shop cấu hình MST sandbox mà không phải tài khoản nội bộ → bỏ qua.
//   • Trần 20 hóa đơn/shop/lượt — sự cố cấu hình không thể xả trăm hóa đơn.
//   • Xử lý TUẦN TỰ từng đơn (MISA cấp số liên tục theo ký hiệu).
//   • NGẮT MẠCH (19/09) — luật ở integrations/invoice/auto-issue-policy.ts
//     (decideAfterFailure): worker này chỉ quét + gọi, mọi quyết định là hàm
//     thuần có test ở đó.
//
// Cấu hình: INVOICE_AUTO_ISSUE_MINUTES (mặc định 15; "0" = tắt worker).
// ============================================================

import { InvoiceLogStatus, type Prisma, ShippingStatus } from "@prisma/client";

import {
  type AutoIssueTrigger,
  decideAfterFailure,
  maxAutoIssueAttempts,
  normalizeAutoIssueTrigger,
  vnStartOfDay,
} from "../integrations/invoice/auto-issue-policy";
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

let running = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface AutoIssueCandidateInput {
  ownerId: string;
  trigger: AutoIssueTrigger;
  /** Mốc bật công tắc — chỉ xét đơn giao từ 0h giờ VN của ngày này. null = không giới hạn. */
  autoIssueEnabledAt: Date | null;
}

/**
 * Điều kiện "đơn đủ điều kiện tự phát hành" — tách riêng để test được trên database
 * và để lát 8 (làn theo shop) dùng lại. Mọi điều kiện về hóa đơn nằm trong MỘT
 * `invoiceLogs.none` (Prisma sinh một NOT EXISTS theo chỉ mục orderId):
 *   · đã có hóa đơn đang chờ / đã phát hành / đã hủy → không;
 *   · có dòng nhật ký (kể cả FAILED) mới hơn 24 giờ → chưa (thử lại 1 lần/ngày);
 *   · có dòng FAILED mang orderErrorCount ≥ mức dừng → KHÔNG BAO GIỜ nữa (lát 7),
 *     trừ khi mức dừng = 0 (tắt).
 */
export function autoIssueCandidateWhere(
  cfg: AutoIssueCandidateInput,
  now: Date,
  maxAttempts: number = maxAutoIssueAttempts()
): Prisma.OrderWhereInput {
  const retryCutoff = new Date(now.getTime() - RETRY_WINDOW_MS);
  const blockingLogs: Prisma.InvoiceLogWhereInput[] = [
    {
      status: {
        in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED, InvoiceLogStatus.CANCELLED],
      },
    },
    { createdAt: { gt: retryCutoff } },
  ];
  if (maxAttempts > 0) {
    blockingLogs.push({
      status: InvoiceLogStatus.FAILED,
      orderErrorCount: { gte: maxAttempts },
    });
  }
  return {
    channel: { userId: cfg.ownerId },
    shippingStatus: ShippingStatus.DELIVERED,
    ...(cfg.trigger === "SETTLED" ? { isSettled: true } : {}),
    ...(cfg.autoIssueEnabledAt
      ? { deliveredAt: { gte: vnStartOfDay(cfg.autoIssueEnabledAt) } }
      : {}),
    items: { some: {} },
    invoiceLogs: { none: { OR: blockingLogs } },
  };
}

/** Mã các đơn một shop sẽ tự phát hành ở lượt này — đơn cũ trước, tối đa `take`. */
export async function findAutoIssueCandidates(
  cfg: AutoIssueCandidateInput,
  now: Date = new Date(),
  take: number = MAX_PER_OWNER_PER_RUN
): Promise<string[]> {
  const orders = await prisma.order.findMany({
    where: autoIssueCandidateWhere(cfg, now),
    orderBy: { createdAt: "asc" }, // đơn cũ trước — đơn giao lâu nhất trễ mốc luật nhất
    take,
    select: { orderCode: true },
  });
  return orders.map((o) => o.orderCode);
}

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
      const orders = await findAutoIssueCandidates({
        ownerId: cfg.ownerId,
        trigger,
        autoIssueEnabledAt: cfg.autoIssueEnabledAt,
      });
      if (orders.length === 0) continue;

      let issued = 0;
      let failed = 0;
      /** Đơn vừa chạm mức dừng tự thử ở lượt này — một chuông gom cho cả lượt. */
      const stopped: string[] = [];
      let streakCode: string | null = null;
      let streak = 0;
      let pauseReason: string | null = null;
      for (const [i, orderCode] of orders.entries()) {
        // TUẦN TỰ — MISA cấp số hóa đơn liên tục theo ký hiệu.
        const r = await issueInvoiceForOrder(cfg.ownerId, { userId: cfg.ownerId }, orderCode);
        // Nghỉ giữa hai lệnh phát hành theo bảng khả năng của nhà cung cấp (MISA trả
        // lời ticket 02/10/2026: mỗi lệnh cách nhau 1–3 giây). Tờ cuối không nghỉ.
        const pauseMs = i < orders.length - 1 ? (r.pauseBeforeNextMs ?? 0) : 0;
        if (r.ok) {
          issued += 1;
          streakCode = null;
          streak = 0;
          if (pauseMs > 0) await sleep(pauseMs);
          continue;
        }
        failed += 1;
        if (r.autoRetryJustStopped) stopped.push(orderCode);
        const code = r.errorCode ?? r.error ?? "?";
        streak = code === streakCode ? streak + 1 : 1;
        streakCode = code;
        const decision = decideAfterFailure(r.errorScope, streak);
        if (decision === "PAUSE") {
          pauseReason = r.error ?? "NCC từ chối phát hành";
          break;
        }
        if (decision === "STOP_RUN") break;
        if (pauseMs > 0) await sleep(pauseMs);
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
          (stopped.length > 0
            ? `, ${stopped.length} đơn máy ngừng tự thử sau ${maxAutoIssueAttempts()} lượt: ${stopped.join(", ")}`
            : "") +
          (pauseReason ? ` — NGẮT MẠCH: ${pauseReason}` : "")
      );
      if (stopped.length > 0) {
        // Chuông reo ĐÚNG MỘT LẦN cho mỗi đơn (lúc nó chạm mức), gom theo lượt chạy.
        // Chuông "n đơn lỗi" bên dưới sẽ tự im khi các đơn này không còn được chọn.
        const max = maxAutoIssueAttempts();
        await notify(cfg.ownerId, {
          type: "INVOICE_AUTO_ISSUE_STOPPED",
          title: `${stopped.length} đơn máy đã ngừng tự thử xuất hóa đơn`,
          body:
            `Nhà cung cấp từ chối ${max} lượt vì dữ liệu của chính đơn (${stopped.slice(0, 3).join(", ")}${stopped.length > 3 ? "…" : ""}). ` +
            `Sửa dữ liệu rồi tick đơn bấm Xuất hóa đơn ở Hàng chờ, hoặc lập trực tiếp trên nhà cung cấp.`,
          link: "/invoicing/connect?queue=stopped",
        });
      }
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
