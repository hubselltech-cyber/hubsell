// ============================================================
// TỜ HÓA ĐƠN "CHƯA RÕ KẾT QUẢ" — giữ ĐANG CHỜ rồi tra lại (bước 5, lát 6b —
// docs/HANG-DOI-BEN.md mục 4.6).
//
// Lệnh phát hành đã gửi sang nhà cung cấp mà không có câu trả lời rõ (lát 5), hoặc
// tiến trình chết giữa lúc gọi: tờ đó CÓ THỂ đã tồn tại bên nhà cung cấp. Trước lát
// này dòng nhật ký ghi "hỏng" (đơn quay lại hàng chờ, phải chờ người bấm lại hoặc
// tự phát hành thử lại sau 24 giờ), còn dòng của tiến trình chết thì kẹt "đang
// chờ" vĩnh viễn.
//
// Nay: dòng giữ PENDING (vẫn là VÉ của đơn — không ai xuất trùng được), và vòng
// quét workers/invoice-unknown-recheck.ts tra ngược theo mã tham chiếu đã gửi:
//
//   Thấy tờ đã phát hành           → nối số hóa đơn, ghi ĐÃ PHÁT HÀNH
//   Tờ đã bị xóa bên nhà cung cấp  → ĐÃ HỦY
//   Không có tờ nào                → HỎNG, đơn quay lại hàng chờ (không tự gửi lại
//                                    từ vòng quét — anh Trung chốt 02/10/2026)
//   Thấy tờ chưa phát hành xong    → giữ đang chờ; có mã tra cứu thì ghi mã để
//                                    vòng hỏi trạng thái theo tiếp
//   Không tra được                 → giữ đang chờ, thử lại sau
//
// "Không thấy" chỉ được tin sau khoảng chờ của nhà cung cấp (bảng khả năng:
// findByReference.settleSeconds) và không sớm hơn UNKNOWN_MIN_AGE_MS.
//
// File này là phần LÕI: không biết gì về MISA, chỉ đọc bảng khả năng. Mọi lượt
// ghi đều CÓ ĐIỀU KIỆN (dòng còn đang chờ và chưa có mã tra cứu) nên hai tiến
// trình cùng xử lý một dòng thì chỉ một bên ghi được — không cần khóa.
// ============================================================

import { InvoiceLogStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getProviderEntry } from "./provider-registry";
import type { InvoiceProvider, ReferenceLookup } from "./types";

/**
 * Tuổi tối thiểu của một dòng "đang chờ chưa có mã tra cứu" trước khi được tra
 * lại. MẶC ĐỊNH TỰ CHỌN 5 phút (anh Trung nhận 02/10/2026): lớn hơn thời gian tệ
 * nhất của một lượt phát hành còn đang chạy (242 giây sau lát 6a: token 60 + phát
 * hành 60 + nghỉ 2 + phát hành lại 60 + tra ngược 60), để không tra nhầm một
 * lệnh chưa xong.
 */
export const UNKNOWN_MIN_AGE_MS = 5 * 60_000;

/** Mã lỗi Hubsell trả cho người gọi khi tờ được giữ đang chờ để kiểm lại. */
export const OUTCOME_UNKNOWN_CODE = "HUBSELL_OUTCOME_UNKNOWN";

type LookupCapable = InvoiceProvider & { findByReference: (reference: string) => Promise<ReferenceLookup> };

/** Nhà cung cấp này tra ngược theo mã tham chiếu được không (bảng khả năng + có cài hàm). */
export function canRecheckLater(provider: InvoiceProvider): provider is LookupCapable {
  return provider.capabilities.findByReference.supported && typeof provider.findByReference === "function";
}

/** Tuổi tối thiểu trước khi tin kết quả "không thấy" của nhà cung cấp này. */
export function recheckMinAgeMs(provider: InvoiceProvider): number {
  const cap = provider.capabilities.findByReference;
  return Math.max(UNKNOWN_MIN_AGE_MS, cap.supported ? cap.settleSeconds * 1000 : 0);
}

function label(providerName: string): string {
  return getProviderEntry(providerName)?.label ?? providerName;
}

/** Câu ghi vào dòng nhật ký + trả cho người gọi khi tờ được giữ đang chờ. */
export function keptPendingMessage(providerName: string): string {
  const l = label(providerName);
  return (
    `Chưa rõ hóa đơn này đã lập hay chưa: ${l} không trả lời rõ sau khi nhận lệnh. ` +
    `Hubsell đang tự kiểm lại với ${l}, khoảng ${Math.round(UNKNOWN_MIN_AGE_MS / 60_000)} phút nữa có kết quả ở Lịch sử hóa đơn. ` +
    `ĐỪNG lập tay trên ${l} trong lúc này.`
  );
}

/** Câu trả lời khi có người bấm lại lúc dòng trước còn đang được kiểm. */
export function recheckInProgressMessage(providerName: string): string {
  return `Lượt trước chưa rõ kết quả, Hubsell đang kiểm lại với ${label(providerName)}. Vài phút nữa xem kết quả ở Lịch sử hóa đơn rồi hãy làm lại nếu cần.`;
}

/** Dòng nhật ký vòng quét cần để tra lại. */
export interface UnknownLog {
  id: string;
  ownerId: string;
  orderId: string | null;
  orderCode: string;
  provider: string;
  providerRef: string | null;
  adjustmentForLogId: string | null;
  createdAt: Date;
}

export type RecheckOutcome =
  /** Thấy tờ đã phát hành — đã nối số vào dòng. */
  | { kind: "LINKED"; invoiceNo: string | null; transactionId: string }
  /** Tờ đã bị xóa / hủy bên nhà cung cấp. */
  | { kind: "CANCELLED" }
  /** Nhà cung cấp không có tờ nào cho mã này — dòng chuyển HỎNG. */
  | { kind: "NOT_ISSUED" }
  /** Nhà cung cấp không tra ngược được — dòng chuyển HỎNG kèm lời nhắn kiểm bên họ. */
  | { kind: "CANNOT_VERIFY" }
  /** Chưa kết luận được — giữ đang chờ, thử lại sau. `lookupFailed` = hỏi không được. */
  | { kind: "KEPT"; lookupFailed: boolean; accountProblem: boolean; reason: string }
  /** Tiến trình khác đã xử lý dòng này trước. */
  | { kind: "SKIPPED" };

/** Điều kiện của mọi lượt ghi: dòng còn đang chờ và chưa có mã tra cứu. */
const stillUnknown = (id: string) => ({ id, status: InvoiceLogStatus.PENDING, transactionId: null });

/** Ghi kết luận cho một dòng; false = dòng đã bị tiến trình khác xử lý. */
async function conclude(
  log: UnknownLog,
  to: InvoiceLogStatus,
  data: {
    invoiceNo?: string | null;
    transactionId?: string | null;
    errorMessage: string | null;
    issuedAt?: Date | null;
    /** Tầm lỗi khi kết luận là hỏng (lát 7): kết luận của vòng quét là lỗi TẠM, không đếm lượt lỗi riêng đơn. */
    errorScope?: string;
  },
  note: string
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoiceLog.updateMany({
      where: stillUnknown(log.id),
      // cqtCheckedAt về null: tờ vừa nối số được vòng hỏi trạng thái cơ quan thuế xét ngay lượt kế.
      data: { status: to, ...data, cqtCheckedAt: null },
    });
    if (updated.count === 0) return false;
    await tx.invoiceStatusHistory.create({
      data: {
        invoiceLogId: log.id,
        orderCode: log.orderCode,
        fromStatus: InvoiceLogStatus.PENDING,
        toStatus: to,
        source: "HUBSELL",
        note,
      },
    });
    // Trạng thái hóa đơn của ĐƠN chỉ đi theo hóa đơn gốc, không theo tờ điều chỉnh.
    if (log.orderId && !log.adjustmentForLogId) {
      await tx.order.update({ where: { id: log.orderId }, data: { einvoiceStatus: to } });
    }
    return true;
  });
}

/** Hoãn một dòng: ghi mốc vừa hỏi (và lý do, nếu có) để vòng quét chưa hỏi lại ngay. */
export async function deferUnknownLog(logId: string, now: Date, errorMessage?: string): Promise<void> {
  await prisma.invoiceLog.updateMany({
    where: stillUnknown(logId),
    data: { cqtCheckedAt: now, ...(errorMessage ? { errorMessage } : {}) },
  });
}

/**
 * Tra lại MỘT dòng "đang chờ chưa có mã tra cứu" và ghi kết luận nếu có.
 * Nơi gọi bảo đảm dòng đã đủ tuổi (recheckMinAgeMs).
 */
export async function recheckUnknownLog(log: UnknownLog, provider: InvoiceProvider, now: Date): Promise<RecheckOutcome> {
  const l = label(provider.name);
  const what = log.adjustmentForLogId ? "hóa đơn điều chỉnh" : "hóa đơn";

  if (!canRecheckLater(provider) || !log.providerRef) {
    // Không có cách nào hỏi lại: không được đoán. Trả vé để chủ shop tự kiểm bên nhà cung cấp.
    const done = await conclude(
      log,
      InvoiceLogStatus.FAILED,
      {
        errorMessage: `Chưa rõ ${what} này đã lập hay chưa và Hubsell không tra lại được trên ${l}. Mở ${l} tìm theo mã đơn ${log.orderCode} TRƯỚC khi làm lại, để không lập hai tờ.`,
        errorScope: "TRANSIENT",
      },
      `Lượt gửi không rõ kết quả; ${l} không hỗ trợ tra ngược theo mã tham chiếu — trả về "hỏng" để chủ shop tự kiểm.`
    );
    return done ? { kind: "CANNOT_VERIFY" } : { kind: "SKIPPED" };
  }

  const found = await provider.findByReference(log.providerRef);

  if (found.state === "LOOKUP_FAILED") {
    const reason = `Chưa kiểm lại được với ${l}: ${found.message}`;
    await deferUnknownLog(log.id, now, `Chưa rõ ${what} này đã lập hay chưa. ${reason} Hubsell sẽ tự thử lại.`);
    return { kind: "KEPT", lookupFailed: true, accountProblem: found.accountProblem, reason };
  }

  if (found.state === "NOT_FOUND") {
    const done = await conclude(
      log,
      InvoiceLogStatus.FAILED,
      {
        errorMessage: log.adjustmentForLogId
          ? `Đã kiểm lại với ${l}: chưa có hóa đơn điều chỉnh nào được lập cho lượt này. Bấm Điều chỉnh để làm lại.`
          : `Đã kiểm lại với ${l}: chưa có hóa đơn nào được lập cho đơn này. Đơn đã quay lại Hàng chờ xuất hóa đơn.`,
        errorScope: "TRANSIENT",
      },
      `Kiểm lại theo mã tham chiếu ${log.providerRef}: ${l} không có tờ nào → lượt gửi này không lập hóa đơn.`
    );
    return done ? { kind: "NOT_ISSUED" } : { kind: "SKIPPED" };
  }

  if (found.matches > 1) {
    console.warn(`[Invoice-recheck] ${l} trả ${found.matches} tờ cho mã tham chiếu ${log.providerRef} (shop ${log.ownerId}) — cần người xem.`);
  }

  if (found.deleted) {
    const done = await conclude(
      log,
      InvoiceLogStatus.CANCELLED,
      { invoiceNo: found.invoiceNo, transactionId: found.transactionId, errorMessage: null },
      `Kiểm lại theo mã tham chiếu ${log.providerRef}: ${l} báo tờ này đã bị xóa bỏ / hủy.`
    );
    return done ? { kind: "CANCELLED" } : { kind: "SKIPPED" };
  }

  if (found.issued && found.transactionId) {
    const done = await conclude(
      log,
      InvoiceLogStatus.ISSUED,
      // Ngày phát hành = lúc Hubsell gửi lượt đó (như lát 3 khi nối lại tờ điều chỉnh).
      { invoiceNo: found.invoiceNo, transactionId: found.transactionId, errorMessage: null, issuedAt: log.createdAt },
      `Kiểm lại theo mã tham chiếu ${log.providerRef}: ${l} ĐÃ LẬP tờ này ở lượt gửi trước — nối lại số ${found.invoiceNo ?? "?"}, mã tra cứu ${found.transactionId}. Không lập thêm tờ nào.`
    );
    return done ? { kind: "LINKED", invoiceNo: found.invoiceNo, transactionId: found.transactionId } : { kind: "SKIPPED" };
  }

  // Có tờ nhưng chưa phát hành xong, hoặc đã phát hành mà chưa đọc được mã tra cứu.
  if (found.transactionId) {
    // Ghi mã tra cứu: dòng rời vòng quét này, vòng hỏi trạng thái (invoice-status-sync) theo tiếp.
    await prisma.invoiceLog.updateMany({
      where: stillUnknown(log.id),
      data: { transactionId: found.transactionId, invoiceNo: found.invoiceNo, cqtCheckedAt: null },
    });
    return { kind: "KEPT", lookupFailed: false, accountProblem: false, reason: `${l} đang giữ tờ này nhưng chưa phát hành xong` };
  }
  await deferUnknownLog(log.id, now);
  return { kind: "KEPT", lookupFailed: false, accountProblem: false, reason: `${l} có tờ này nhưng chưa trả mã tra cứu` };
}
