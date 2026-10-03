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
//
// BƯỚC 5 LÁT 8 (03/10): phần "một shop một lượt" tách thành runAutoIssueForShop
// để hai đường dùng chung — vòng chung ở tệp này (INVOICE_MODE=legacy) và làn theo
// shop ở workers/invoice-lanes.ts (INVOICE_MODE=lanes). Vòng chung giữ nguyên hành
// vi cũ (lỗi tạm vẫn chặn đơn 24 giờ); làn mới chỉ chặn 24 giờ với lỗi riêng đơn.
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
export interface AutoIssueCandidateOptions {
  /**
   * true (đường cũ): MỌI dòng nhật ký mới hơn 24 giờ đều chặn đơn, kể cả FAILED vì
   * lỗi tạm / lỗi tài khoản. false (làn theo shop, lát 8): chỉ FAILED tầm ORDER (và
   * dòng đời cũ không ghi tầm) mới chặn 24 giờ — lỗi tạm được làn thử lại theo nấc
   * lùi 1/5/15 phút, lỗi tài khoản được thử ngay sau khi chủ shop bấm Chạy lại.
   */
  transientBlocks: boolean;
}

export function autoIssueCandidateWhere(
  cfg: AutoIssueCandidateInput,
  now: Date,
  maxAttempts: number = maxAutoIssueAttempts(),
  opts: AutoIssueCandidateOptions = { transientBlocks: true }
): Prisma.OrderWhereInput {
  const retryCutoff = new Date(now.getTime() - RETRY_WINDOW_MS);
  const blockingLogs: Prisma.InvoiceLogWhereInput[] = [
    {
      status: {
        in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED, InvoiceLogStatus.CANCELLED],
      },
    },
    opts.transientBlocks
      ? { createdAt: { gt: retryCutoff } }
      : {
          createdAt: { gt: retryCutoff },
          OR: [{ errorScope: "ORDER" }, { errorScope: null }],
        },
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
  take: number = MAX_PER_OWNER_PER_RUN,
  opts: AutoIssueCandidateOptions = { transientBlocks: true }
): Promise<string[]> {
  const orders = await prisma.order.findMany({
    where: autoIssueCandidateWhere(cfg, now, maxAutoIssueAttempts(), opts),
    orderBy: { createdAt: "asc" }, // đơn cũ trước — đơn giao lâu nhất trễ mốc luật nhất
    take,
    select: { orderCode: true },
  });
  return orders.map((o) => o.orderCode);
}

/** Trường cấu hình shop mà một lượt tự phát hành cần — dùng chung hai đường. */
export const AUTO_ISSUE_CONFIG_SELECT = {
  id: true,
  ownerId: true,
  taxCode: true,
  meinvoiceUsername: true,
  meinvoicePassword: true,
  autoIssueTrigger: true,
  autoIssueEnabledAt: true,
  owner: { select: { email: true } },
} as const;

export type AutoIssueShopConfig = Prisma.InvoiceConfigGetPayload<{
  select: typeof AUTO_ISSUE_CONFIG_SELECT;
}>;

/** Lý do bỏ qua shop này mà không gọi nhà cung cấp; null = chạy được. */
export function autoIssueSkipReason(cfg: AutoIssueShopConfig): string | null {
  // Thiếu tài khoản meInvoice → phát hành chắc chắn fail, khỏi thử.
  if (!cfg.meinvoiceUsername || !cfg.meinvoicePassword) return "thiếu tài khoản meInvoice";
  // Khách thường trỏ MST sandbox → bỏ qua (cùng luật với route).
  if (cfg.taxCode === MISA_SANDBOX_TAX_CODE && !isTaxPilotUser(cfg.owner.email)) {
    return "MST sandbox ngoài tài khoản nội bộ";
  }
  return null;
}

/**
 * Kết cục một lượt của một shop — làn theo shop dùng để hẹn lượt kế:
 *   IDLE      không có đơn nào đủ điều kiện;
 *   DONE      đã đi hết các đơn lấy được (ít hơn một lô);
 *   BACKLOG   lô đầy (có thể còn đơn) hoặc bị dừng giữa chừng (tắt tiến trình / mất làn);
 *   TRANSIENT dừng vì lỗi tạm của nhà cung cấp;
 *   PAUSED    ngắt mạch vì lỗi tầm tài khoản (đã ghi autoIssuePausedAt).
 */
export type AutoIssueOutcome = "IDLE" | "DONE" | "BACKLOG" | "TRANSIENT" | "PAUSED";

export interface AutoIssueRunResult {
  outcome: AutoIssueOutcome;
  picked: number;
  issued: number;
  failed: number;
  /** Đơn vừa chạm mức dừng tự thử ở lượt này (lát 7). */
  stopped: string[];
  pauseReason: string | null;
  /** true = dừng giữa chừng vì shouldStop (tắt tiến trình / mất làn). */
  interrupted: boolean;
}

export interface AutoIssueRunOptions {
  /**
   * Hỏi TRƯỚC MỖI TỜ; trả true thì dừng lượt (tiến trình đang tắt, hoặc làn không còn
   * là của mình). Làn theo shop dùng chỗ này để gia hạn thuê.
   */
  shouldStop?: () => boolean | Promise<boolean>;
  /** Xem AutoIssueCandidateOptions. Đường cũ: true. Làn theo shop: false. */
  transientBlocks?: boolean;
}

/**
 * MỘT LƯỢT của MỘT SHOP: chọn tối đa 20 đơn, phát hành tuần tự, nghỉ theo bảng khả
 * năng, ngắt mạch theo luật, ghi tạm ngừng + reo chuông. Không ném lỗi nghiệp vụ;
 * lỗi database ném ra để nơi gọi ghi log. Nơi gọi tự bảo đảm một shop chỉ có một
 * lượt chạy tại một thời điểm (cờ RAM ở đường cũ, làn thuê ở database ở lát 8).
 */
export async function runAutoIssueForShop(
  cfg: AutoIssueShopConfig,
  opts: AutoIssueRunOptions = {}
): Promise<AutoIssueRunResult> {
  const transientBlocks = opts.transientBlocks ?? true;
  const trigger = normalizeAutoIssueTrigger(cfg.autoIssueTrigger);
  const orders = await findAutoIssueCandidates(
    { ownerId: cfg.ownerId, trigger, autoIssueEnabledAt: cfg.autoIssueEnabledAt },
    new Date(),
    MAX_PER_OWNER_PER_RUN,
    { transientBlocks }
  );
  if (orders.length === 0) {
    return { outcome: "IDLE", picked: 0, issued: 0, failed: 0, stopped: [], pauseReason: null, interrupted: false };
  }

  let issued = 0;
  let failed = 0;
  /** Đơn vừa chạm mức dừng tự thử ở lượt này — một chuông gom cho cả lượt. */
  const stopped: string[] = [];
  let streakCode: string | null = null;
  let streak = 0;
  let pauseReason: string | null = null;
  let transient = false;
  let interrupted = false;
  for (const [i, orderCode] of orders.entries()) {
    if (opts.shouldStop && (await opts.shouldStop())) {
      interrupted = true;
      break;
    }
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
    if (decision === "STOP_RUN") {
      transient = true;
      break;
    }
    if (pauseMs > 0) await sleep(pauseMs);
  }

  if (pauseReason) {
    await prisma.invoiceConfig.update({
      where: { id: cfg.id },
      data: { autoIssuePausedAt: new Date(), autoIssuePauseReason: pauseReason },
    });
  }
  const outcome: AutoIssueOutcome = pauseReason
    ? "PAUSED"
    : transient
      ? "TRANSIENT"
      : interrupted || orders.length >= MAX_PER_OWNER_PER_RUN
        ? "BACKLOG"
        : "DONE";
  console.log(
    `[Auto-issue] Shop ${cfg.ownerId} (${trigger}): phát hành ${issued} hóa đơn` +
      (failed > 0 ? `, ${failed} lỗi (xem Nhật ký hóa đơn)` : "") +
      (stopped.length > 0
        ? `, ${stopped.length} đơn máy ngừng tự thử sau ${maxAutoIssueAttempts()} lượt: ${stopped.join(", ")}`
        : "") +
      (pauseReason ? ` — NGẮT MẠCH: ${pauseReason}` : "") +
      (interrupted ? " — dừng giữa chừng, phần còn lại để lượt sau" : "")
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
  return { outcome, picked: orders.length, issued, failed, stopped, pauseReason, interrupted };
}

/** ĐƯỜNG CŨ (INVOICE_MODE=legacy): một vòng đi tuần tự qua mọi shop. */
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
      select: AUTO_ISSUE_CONFIG_SELECT,
    });

    for (const cfg of configs) {
      if (autoIssueSkipReason(cfg)) continue;
      await runAutoIssueForShop(cfg, { transientBlocks: true });
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
