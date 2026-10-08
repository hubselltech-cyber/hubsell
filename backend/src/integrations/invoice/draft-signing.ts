// ============================================================
// TỜ NHÁP CHỜ CHỦ SHOP KÝ TRÊN WEB CỦA NHÀ CUNG CẤP — lát T1 luồng tenant (08/10/2026,
// docs/HOA-DON-HQ-KY-NEN-KHAO-SAT-07-10.md mục 18). Phần LÕI, chung mọi nhà cung cấp.
//
// VÌ SAO CÓ: chữ ký số từ xa (MISA eSign) và USB token KHÔNG ký nền được qua cổng
// phát hành (MISA trả lời ticket 08/10/2026: ký nền SignType 2 đòi HSM / "eSign nâng
// cao"). Với hai phương thức này Hubsell ĐẨY TỜ NHÁP đầy đủ dữ liệu lên web của nhà
// cung cấp (adapter: InvoiceResult.awaitingSignature), chủ shop vào web ký theo lô
// (một lần xác nhận cho tới 50 tờ), máy tra lại theo mã tham chiếu rồi nối số.
//
// DÒNG NHẬT KÝ khi đó: status PENDING, transactionId NULL, awaitingSignatureAt = lúc đẩy.
// Nó vẫn là VÉ của đơn (chỉ mục duy nhất) nên không ai xuất trùng. Khác "tờ chưa rõ kết
// quả" (unknown-outcome.ts — PENDING, không mã, awaitingSignatureAt NULL): vòng quét tờ
// chưa rõ BỎ QUA dòng chờ ký, vòng hỏi theo giờ (workers/invoice-cqt-follow.ts) hỏi
// adapter.findDrafts theo lô rồi áp kế hoạch ở đây.
//
// NGHIỆP VỤ THUẾ (NĐ 254/2026, hiệu lực 01/07/2026): hóa đơn lập tại thời điểm giao
// hàng (Điều 9); ngày ký số được khác ngày lập nhưng CHẬM NHẤT LÀ NGÀY LÀM VIỆC TIẾP
// THEO kể từ ngày lập. Tờ nháp mang ngày lập = ngày đẩy, nên chủ shop phải ký trong
// ngày hoặc ngày làm việc kế — signDeadline() tính mốc này để giao diện nhắc.
// ============================================================

import { InvoiceLogStatus } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { cqtNextOnWrite } from "./cqt-follow";
import { getProviderEntry } from "./provider-registry";
import type { DraftLookup, InvoiceProvider } from "./types";

/** Mã Hubsell trả cho người gọi khi tờ nháp đã lên web, chờ chủ shop ký. */
export const AWAITING_SIGNATURE_CODE = "HUBSELL_AWAITING_SIGNATURE";
/** Mã khi nhà cung cấp đã nhận tờ (có mã tra cứu) nhưng chưa cấp số — vòng hỏi trạng thái theo tiếp. */
export const NUMBER_PENDING_CODE = "HUBSELL_NUMBER_PENDING";

/**
 * Nhịp hỏi tờ nháp. MẶC ĐỊNH TỰ CHỌN (08/10/2026, chưa có số đo chủ shop ký sau bao lâu):
 * lần đầu 10 phút sau khi đẩy; còn chờ thì 30 phút một lần trong 2 ngày đầu, sau đó 6 giờ
 * một lần, không điểm dừng (tờ nháp không ăn số, để lâu không hại gì ngoài việc trễ ký).
 * Người bấm "Tôi đã ký, kiểm ngay" được hỏi ngay, không chờ nhịp.
 */
export const DRAFT_FIRST_CHECK_MS = 10 * 60_000;
export const DRAFT_RECHECK_MS = 30 * 60_000;
export const DRAFT_WATCH_WINDOW_MS = 2 * 24 * 60 * 60_000;
export const DRAFT_RECHECK_OLD_MS = 6 * 60 * 60_000;
/**
 * Web không thấy tờ nháp mới đẩy dưới mức này thì CHƯA kết luận "đã bị xóa" (tự chọn 10
 * phút: lớn hơn độ trễ hiển thị đã thấy trên sandbox 07/10, cỡ vài trăm ms).
 */
export const DRAFT_GONE_MIN_AGE_MS = 10 * 60_000;

/** Giờ hỏi kế của một tờ nháp còn chờ ký. */
export function draftNextCheckAt(awaitingSince: Date, now: Date): Date {
  const age = now.getTime() - awaitingSince.getTime();
  return new Date(now.getTime() + (age < DRAFT_WATCH_WINDOW_MS ? DRAFT_RECHECK_MS : DRAFT_RECHECK_OLD_MS));
}

type DraftCapable = InvoiceProvider & { findDrafts: NonNullable<InvoiceProvider["findDrafts"]> };

/** Nhà cung cấp này nhận tờ nháp chờ ký và tra lại được (bảng khả năng + có cài hàm). */
export function canFollowDrafts(provider: InvoiceProvider): provider is DraftCapable {
  return provider.capabilities.draftSigning.supported && typeof provider.findDrafts === "function";
}

/** Trang web nơi chủ shop ký tờ nháp của nhà cung cấp này; null khi không có luồng nháp. */
export function draftSignUrl(provider: Pick<InvoiceProvider, "capabilities">): string | null {
  const cap = provider.capabilities.draftSigning;
  return cap.supported ? cap.signUrl : null;
}

function label(providerName: string): string {
  return getProviderEntry(providerName)?.label ?? providerName;
}

/**
 * Câu ghi vào dòng nhật ký + trả cho người bấm khi tờ nháp chờ ký. `pushedNow` = lượt
 * này vừa đẩy (khác lượt chỉ thấy tờ cũ còn chờ).
 */
export function awaitingSignatureMessage(providerName: string, signUrl: string, pushedNow: boolean): string {
  const l = label(providerName);
  const head = pushedNow
    ? `Hubsell đã lập tờ nháp đầy đủ dữ liệu trên ${l}`
    : `Tờ nháp của đơn này đang chờ ký trên ${l}`;
  return (
    `Chờ bạn ký: ${head}. Vào ${signUrl} → lọc Chưa phát hành → chọn các tờ → Ký & phát hành ` +
    `(một lần xác nhận chữ ký số cho cả lô). Ký xong Hubsell tự nhận số hóa đơn, không cần nhập tay. ` +
    `Nên ký trong ngày: theo NĐ 254/2026, ngày ký số chậm nhất là ngày làm việc tiếp theo kể từ ngày lập.`
  );
}

/** Câu khi nhà cung cấp đã nhận tờ (có mã tra cứu) nhưng chưa cấp số. */
export function numberPendingMessage(providerName: string): string {
  return `${label(providerName)} đã nhận hóa đơn này (có mã tra cứu) nhưng chưa cấp số — Hubsell tự cập nhật số khi có, xem tại Lịch sử hóa đơn.`;
}

/**
 * Kết quả xuất "ĐÃ GIAO CHO NHÀ CUNG CẤP, CHƯA XONG VỀ PHÍA HỌ" (chờ ký / chờ số): không
 * phải thành công (chưa có số) nhưng cũng không phải lỗi — nơi lặp qua nhiều tờ không đếm
 * vào chuỗi lỗi, làn đóng yêu cầu, vòng hỏi lo phần còn lại.
 */
export function isDeferredAtProvider(r: { awaitingSignature?: boolean; errorCode?: string }): boolean {
  return r.awaitingSignature === true || r.errorCode === NUMBER_PENDING_CODE;
}

const VN_OFFSET_MS = 7 * 60 * 60_000;

/**
 * HẠN KÝ của một tờ nháp đẩy lúc `pushedAt`: hết NGÀY LÀM VIỆC TIẾP THEO (giờ VN) kể từ
 * ngày lập = ngày đẩy. Thứ Hai–Năm → hôm sau; Thứ Sáu → Thứ Hai; Thứ Bảy → Thứ Hai;
 * Chủ nhật → Thứ Hai. Ngày lễ KHÔNG tính (tự chọn — giao diện chỉ nhắc, không khóa).
 */
export function signDeadline(pushedAt: Date): Date {
  const vn = new Date(pushedAt.getTime() + VN_OFFSET_MS); // các getter UTC của `vn` = giờ VN
  const dow = vn.getUTCDay(); // 0 CN … 6 T7
  const add = dow === 5 ? 3 : dow === 6 ? 2 : 1;
  const endVn = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + add + 1) - 1;
  return new Date(endVn - VN_OFFSET_MS);
}

export function isSignOverdue(pushedAt: Date, now: Date): boolean {
  return now.getTime() > signDeadline(pushedAt).getTime();
}

/** Dòng nhật ký tờ nháp mà vòng hỏi đang giữ. */
export interface DraftFollowLog {
  id: string;
  ownerId: string;
  orderId: string | null;
  orderCode: string;
  provider: string;
  providerRef: string;
  adjustmentForLogId: string | null;
  awaitingSignatureAt: Date;
  createdAt: Date;
}

export type DraftPlan =
  /** Tờ đã ký trên web: nối số + mã tra cứu; chưa có số thì giữ đang chờ, vòng hỏi trạng thái theo tiếp. */
  | { kind: "SIGNED"; status: InvoiceLogStatus; invoiceNo: string | null; transactionId: string; next: Date | null }
  /** Còn chờ ký: hẹn hỏi lại. */
  | { kind: "WAIT"; next: Date }
  /** Tờ nháp không còn bên nhà cung cấp (chủ shop xóa nháp / hủy): không có hóa đơn, đơn quay lại hàng chờ. */
  | { kind: "GONE"; deletedAtProvider: boolean };

/**
 * `lookup` vắng mặt = adapter không trả gì cho mã này: KHÔNG suy diễn, hẹn hỏi lại.
 * "Không thấy" chỉ được tin khi tờ đã đẩy đủ lâu (DRAFT_GONE_MIN_AGE_MS).
 */
export function planDraftFollow(log: DraftFollowLog, lookup: DraftLookup | undefined, now: Date): DraftPlan {
  const wait = (): DraftPlan => ({ kind: "WAIT", next: draftNextCheckAt(log.awaitingSignatureAt, now) });
  if (!lookup) return wait();
  switch (lookup.state) {
    case "SIGNED": {
      const status = lookup.invoiceNo ? InvoiceLogStatus.ISSUED : InvoiceLogStatus.PENDING;
      return {
        kind: "SIGNED",
        status,
        invoiceNo: lookup.invoiceNo,
        transactionId: lookup.transactionId,
        // Tờ vừa ký là vừa gửi cơ quan thuế: giờ hỏi trạng thái tính từ lúc này.
        next: cqtNextOnWrite(status, lookup.transactionId, now),
      };
    }
    case "WAITING":
      return wait();
    case "DELETED":
      return { kind: "GONE", deletedAtProvider: true };
    case "GONE":
      return now.getTime() - log.awaitingSignatureAt.getTime() < DRAFT_GONE_MIN_AGE_MS
        ? wait()
        : { kind: "GONE", deletedAtProvider: false };
  }
}

/** Điều kiện của mọi lượt ghi: dòng vẫn là tờ nháp đang chờ ký. */
const stillAwaiting = (id: string) => ({
  id,
  status: InvoiceLogStatus.PENDING,
  transactionId: null,
  awaitingSignatureAt: { not: null },
});

/**
 * Ghi kế hoạch cho MỘT dòng. false = dòng đã bị tiến trình khác đổi (ký xong ở lượt
 * khác, chủ shop làm tay…) — bỏ, không ghi đè. Trạng thái hóa đơn của ĐƠN chỉ đi theo
 * hóa đơn gốc, không theo tờ điều chỉnh (như cqt-follow / unknown-outcome).
 */
export async function applyDraftPlan(log: DraftFollowLog, plan: DraftPlan, now: Date): Promise<boolean> {
  const l = label(log.provider);
  if (plan.kind === "WAIT") {
    const r = await prisma.invoiceLog.updateMany({
      where: stillAwaiting(log.id),
      data: { cqtCheckedAt: now, cqtNextCheckAt: plan.next },
    });
    return r.count > 0;
  }
  const what = log.adjustmentForLogId ? "hóa đơn điều chỉnh" : "hóa đơn";
  return prisma.$transaction(async (tx) => {
    const data =
      plan.kind === "SIGNED"
        ? {
            status: plan.status,
            invoiceNo: plan.invoiceNo,
            transactionId: plan.transactionId,
            // Ngày lập trên tờ = ngày đẩy nháp (InvDate gửi lúc insert) — báo cáo kỳ đọc issuedAt.
            issuedAt: plan.status === InvoiceLogStatus.ISSUED ? log.createdAt : null,
            errorMessage: plan.status === InvoiceLogStatus.ISSUED ? null : numberPendingMessage(log.provider),
            awaitingSignatureAt: null,
            cqtCheckedAt: now,
            cqtNextCheckAt: plan.next,
          }
        : {
            status: InvoiceLogStatus.CANCELLED,
            awaitingSignatureAt: null,
            cqtCheckedAt: now,
            cqtNextCheckAt: null,
            errorMessage: plan.deletedAtProvider
              ? `${l} báo tờ này đã bị xóa bỏ / hủy — không có ${what} nào có hiệu lực. Đơn đã quay lại Hàng chờ; xuất lại sẽ lập tờ nháp mới.`
              : `Tờ nháp không còn trên ${l} (đã bị xóa trước khi ký) — không có ${what} nào được lập. Đơn đã quay lại Hàng chờ; xuất lại sẽ lập tờ nháp mới.`,
          };
    const updated = await tx.invoiceLog.updateMany({ where: stillAwaiting(log.id), data });
    if (updated.count === 0) return false;
    await tx.invoiceStatusHistory.create({
      data: {
        invoiceLogId: log.id,
        orderCode: log.orderCode,
        fromStatus: InvoiceLogStatus.PENDING,
        toStatus: data.status,
        source: "HUBSELL",
        note:
          plan.kind === "SIGNED"
            ? plan.status === InvoiceLogStatus.ISSUED
              ? `Chủ shop đã ký tờ nháp trên ${l} (mã tham chiếu ${log.providerRef}): số ${plan.invoiceNo}, mã tra cứu ${plan.transactionId}`
              : `Chủ shop đã ký tờ nháp trên ${l} (mã tham chiếu ${log.providerRef}): mã tra cứu ${plan.transactionId}, chờ cấp số`
            : (data.errorMessage ?? null),
      },
    });
    if (log.orderId && !log.adjustmentForLogId) {
      await tx.order.update({ where: { id: log.orderId }, data: { einvoiceStatus: data.status } });
    }
    return true;
  });
}
