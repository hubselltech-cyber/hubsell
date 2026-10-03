// ============================================================
// THEO TRẠNG THÁI HÓA ĐƠN PHÍA NHÀ CUNG CẤP + CƠ QUAN THUẾ TỚI KHI CÓ KẾT LUẬN
// (hóa đơn bước 5, lát 12 — docs/HANG-DOI-BEN.md mục 4.6 T). Phần LÕI, chung mọi NCC:
//
//   · Luật "giờ hỏi kế tiếp" (cột InvoiceLog.cqtNextCheckAt; NULL = không hỏi nữa).
//   · Áp MỘT kết quả đã chuẩn hóa của adapter lên MỘT dòng nhật ký, ghi có điều kiện.
//
// Vòng quét gọi lõi này nằm ở workers/invoice-cqt-follow.ts. Lõi không biết bảng mã
// của nhà cung cấp nào: adapter trả ProviderInvoiceStatus (types.ts).
// ============================================================

import { InvoiceLogStatus } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { CQT_ACCEPTED_WATCH_MS, CQT_RECHECK_MS, CQT_WATCH_WINDOW_MS } from "./cqt-status";
import { getProviderEntry } from "./provider-registry";
import type { ProviderInvoiceStatus } from "./types";

/**
 * Lần hỏi ĐẦU cách lúc tờ có mã tra cứu bấy lâu. MẶC ĐỊNH TỰ CHỌN 1 giờ (anh Trung
 * duyệt 03/10/2026); chưa có số đo cơ quan thuế trả lời sau bao lâu trên production.
 */
export const CQT_FIRST_CHECK_MS = 60 * 60_000;
/** Tờ CHƯA có kết luận, lập dưới 30 ngày: hỏi lại mỗi 12 giờ (giữ nhịp có từ 03/09/2026). */
export const CQT_RECHECK_PENDING_MS = 12 * 60 * 60_000;
/** Tờ chưa có kết luận quá 30 ngày: 24 giờ một lần, KHÔNG có điểm dừng (mục 4.6 D, tự chọn). */
export const CQT_RECHECK_OLD_MS = 24 * 60 * 60_000;

const FOLLOWED: readonly InvoiceLogStatus[] = [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED];

/**
 * Giờ hỏi cho một dòng VỪA được ghi mã tra cứu (phát hành xong, nối lại số, webhook).
 * Mọi chỗ ghi `transactionId` vào InvoiceLog phải đặt `cqtNextCheckAt` bằng hàm này —
 * sót một chỗ là tờ đó không bao giờ được hỏi. `base` = lúc tờ được lập phía NCC.
 */
export function cqtNextOnWrite(
  status: InvoiceLogStatus,
  transactionId: string | null | undefined,
  base: Date
): Date | null {
  if (!transactionId || !FOLLOWED.includes(status)) return null;
  return new Date(base.getTime() + CQT_FIRST_CHECK_MS);
}

/**
 * Giờ hỏi kế tiếp SAU một lượt hỏi. null = đã có kết luận, thôi hỏi:
 *   · dòng không còn "đang chờ" / "đã phát hành";
 *   · tờ đã phát hành, cơ quan thuế đã tiếp nhận, và đã qua 7 ngày kể từ lúc lập
 *     (trong 7 ngày đầu vẫn hỏi mỗi ngày).
 * Còn lại (chờ, gửi lỗi, bị từ chối, chưa có trạng thái): hỏi tiếp, không điểm dừng.
 */
export function nextCqtCheckAt(
  row: { status: InvoiceLogStatus; cqtStatus: string | null; createdAt: Date },
  now: Date
): Date | null {
  if (!FOLLOWED.includes(row.status)) return null;
  const age = now.getTime() - row.createdAt.getTime();
  if (row.status === InvoiceLogStatus.ISSUED && row.cqtStatus === "ACCEPTED") {
    return age < CQT_ACCEPTED_WATCH_MS ? new Date(now.getTime() + CQT_RECHECK_MS.ACCEPTED) : null;
  }
  return new Date(now.getTime() + (age < CQT_WATCH_WINDOW_MS ? CQT_RECHECK_PENDING_MS : CQT_RECHECK_OLD_MS));
}

/** Dòng nhật ký vòng quét đang giữ. */
export interface FollowLog {
  id: string;
  ownerId: string;
  orderId: string | null;
  orderCode: string;
  provider: string;
  status: InvoiceLogStatus;
  cqtStatus: string | null;
  invoiceNo: string | null;
  transactionId: string | null;
  invoiceSeries: string | null;
  adjustmentForLogId: string | null;
  createdAt: Date;
}

/** Dòng sẽ thành gì sau khi áp kết quả của nhà cung cấp — thuần tính toán, chưa ghi. */
export interface FollowPlan {
  status: InvoiceLogStatus;
  cqtStatus: string | null;
  invoiceNo: string | null;
  next: Date | null;
  /** Có gì khác so với dòng hiện tại (ngoài mốc đã hỏi). */
  changed: boolean;
  cancelled: boolean;
  issuedFixed: boolean;
  newlyRejected: boolean;
}

/**
 * `item` vắng mặt = nhà cung cấp không trả dòng cho mã này: KHÔNG suy diễn gì, chỉ
 * hẹn giờ hỏi lại theo nhịp thường.
 */
export function planFollow(log: FollowLog, item: ProviderInvoiceStatus | undefined, now: Date): FollowPlan {
  const same = { status: log.status, cqtStatus: log.cqtStatus, invoiceNo: log.invoiceNo };
  const flags = { cancelled: false, issuedFixed: false, newlyRejected: false };
  if (!item) return { ...same, ...flags, next: nextCqtCheckAt(log, now), changed: false };
  if (item.deleted) {
    return { ...same, ...flags, status: InvoiceLogStatus.CANCELLED, next: null, changed: true, cancelled: true };
  }
  const status = log.status === InvoiceLogStatus.PENDING && item.issued ? InvoiceLogStatus.ISSUED : log.status;
  // Trạng thái cơ quan thuế null thì GIỮ giá trị cũ, không ghi đè.
  const cqtStatus = item.taxStatus ?? log.cqtStatus;
  const invoiceNo = log.invoiceNo ?? item.invoiceNo;
  return {
    status,
    cqtStatus,
    invoiceNo,
    next: nextCqtCheckAt({ status, cqtStatus, createdAt: log.createdAt }, now),
    changed: status !== log.status || cqtStatus !== log.cqtStatus || invoiceNo !== log.invoiceNo,
    cancelled: false,
    issuedFixed: status !== log.status,
    newlyRejected: cqtStatus === "REJECTED" && log.cqtStatus !== "REJECTED",
  };
}

/** Nguồn ghi ở InvoiceStatusHistory; với MISA trùng giá trị vòng cũ đã ghi từ 03/09/2026. */
export function statusSyncSource(providerName: string): string {
  return `${providerName}_STATUS_SYNC`;
}

/**
 * Ghi một dòng CÓ THAY ĐỔI. Điều kiện ghi: dòng vẫn đúng trạng thái + trạng thái cơ
 * quan thuế lúc vòng quét đọc — tiến trình khác đã đổi dòng thì bỏ (false), không ghi
 * đè bằng số cũ. Trạng thái hóa đơn của ĐƠN chỉ đi theo hóa đơn gốc, không theo tờ
 * điều chỉnh (như unknown-outcome.ts).
 */
export async function applyFollowPlan(log: FollowLog, plan: FollowPlan, now: Date): Promise<boolean> {
  const l = getProviderEntry(log.provider)?.label ?? log.provider;
  const notes: string[] = [];
  if (plan.cancelled) notes.push(`${l} báo hóa đơn đã bị xóa bỏ / hủy — loại khỏi báo cáo kỳ.`);
  if (plan.issuedFixed) notes.push(`${l} xác nhận đã phát hành (tra trạng thái): số ${plan.invoiceNo ?? "?"}`);
  if (plan.newlyRejected) {
    notes.push(`CƠ QUAN THUẾ TỪ CHỐI cấp mã / tiếp nhận — hóa đơn chưa hợp lệ, cần sửa và gửi lại trên ${l}.`);
  }
  const statusChanged = plan.status !== log.status;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoiceLog.updateMany({
      where: { id: log.id, status: log.status, cqtStatus: log.cqtStatus },
      data: {
        status: plan.status,
        cqtStatus: plan.cqtStatus,
        invoiceNo: plan.invoiceNo,
        cqtCheckedAt: now,
        cqtNextCheckAt: plan.next,
        ...(plan.issuedFixed ? { issuedAt: now, errorMessage: null } : {}),
      },
    });
    if (updated.count === 0) return false;
    if (notes.length > 0) {
      await tx.invoiceStatusHistory.create({
        data: {
          invoiceLogId: log.id,
          orderCode: log.orderCode,
          fromStatus: log.status,
          toStatus: plan.status,
          source: statusSyncSource(log.provider),
          note: notes.join(" | "),
        },
      });
    }
    if (statusChanged && log.orderId && !log.adjustmentForLogId) {
      await tx.order.update({ where: { id: log.orderId }, data: { einvoiceStatus: plan.status } });
    }
    return true;
  });
}
