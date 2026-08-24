/**
 * LẬP HÓA ĐƠN ĐIỀU CHỈNH GIẢM khi khách TRẢ HÀNG HOÀN TIỀN (24/08/2026 khuya).
 *
 * Pháp lý: điểm c khoản 5 Điều 10 TT 91/2026/TT-BTC (+ NĐ 254/2026) — khách
 * trả một phần/toàn bộ hàng thì NGƯỜI BÁN lập hóa đơn ĐIỀU CHỈNH ghi số ÂM;
 * không hủy, không thay thế, không gửi 04/SS (trả hàng không phải "sai sót");
 * khách cá nhân không cần văn bản thỏa thuận; kê khai vào kỳ lập hóa đơn
 * điều chỉnh. Verify sandbox: HĐ 00000067 điều chỉnh 00000066, âm toàn tuyến.
 *
 * Dữ liệu: dòng hàng ÂM lấy từ SNAPSHOT InvoiceLog.lines của hóa đơn gốc
 * (đúng số ĐÃ XUẤT — không dựng lại từ đơn kẻo lệch khi thuế suất/voucher đổi
 * sau này); log gốc thiếu snapshot (đời cũ) thì chịu, trả lỗi hướng dẫn làm
 * tay trên meInvoice. Luồng hoàn 2 công đoạn của Hubsell là dữ liệu MỨC ĐƠN
 * (hoàn toàn bộ) nên tự động = điều chỉnh giảm TOÀN BỘ; điều chỉnh một phần
 * để nhịp sau khi có dữ liệu dòng hàng hoàn.
 *
 * Hai cửa gọi:
 *   · MANUAL — POST /api/tax/invoices/:id/adjust (id = InvoiceLog gốc);
 *   · AUTO   — maybeAutoAdjustOnReturn() bắn từ orders.ts khi đơn hoàn chuyển
 *     RECEIVED_INTACT (nhập kho), shop bật autoAdjustEnabled. Fire-and-forget,
 *     lỗi chỉ ghi log server — không được chặn luồng nhập kho của thủ kho.
 */

import { InvoiceLogStatus, Prisma } from "@prisma/client";

import { prisma } from "../../prisma";
import { getInvoiceProvider } from "./index";
import { resolveInvoiceBuyer, type IssueOrderResult } from "./issue-order";
import { isPublishAllowed } from "./misa-safety";
import type { InvoiceLine } from "./types";

/** Ngày yyyy-MM-dd theo giờ VN — định dạng OrgInvDate meInvoice yêu cầu. */
function vnDate(d: Date): string {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Đảo dấu dòng hàng đã phát hành → dòng điều chỉnh giảm (đơn giá giữ dương). */
function negateLines(lines: InvoiceLine[]): InvoiceLine[] {
  return lines.map((l) => ({
    ...l,
    quantity: -l.quantity,
    amountWithoutVat: -l.amountWithoutVat,
    vatAmount: -l.vatAmount,
  }));
}

/**
 * Lập hóa đơn điều chỉnh GIẢM TOÀN BỘ cho hóa đơn gốc của một đơn hàng.
 * Trả IssueOrderResult như issue-order để route/hook dùng chung cách xử lý.
 */
export async function issueAdjustmentForOrder(
  ownerId: string,
  channelWhere: Prisma.ChannelWhereInput,
  originalLogId: string,
  reason: string
): Promise<IssueOrderResult> {
  const original = await prisma.invoiceLog.findFirst({
    where: { id: originalLogId, ownerId },
    include: {
      order: {
        select: {
          id: true,
          channelId: true,
          invoiceRequestType: true,
          buyerInvoiceInfo: true,
        },
      },
    },
  });
  if (!original) {
    return { ok: false, httpStatus: 404, error: "Không tìm thấy hóa đơn gốc" };
  }
  // Phạm vi gian hàng của người gọi — nhân viên bị giới hạn kênh không được
  // điều chỉnh hóa đơn của kênh khác.
  if (original.orderId) {
    const inScope = await prisma.order.findFirst({
      where: { id: original.orderId, channel: channelWhere },
      select: { id: true },
    });
    if (!inScope) {
      return { ok: false, httpStatus: 404, error: "Đơn của hóa đơn này ngoài phạm vi của bạn" };
    }
  }
  if (original.status !== InvoiceLogStatus.ISSUED) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Chỉ điều chỉnh được hóa đơn ĐÃ PHÁT HÀNH (trạng thái hiện tại không phải Đã phát hành).",
    };
  }
  if (original.adjustmentForLogId) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Đây đã là hóa đơn điều chỉnh — không điều chỉnh chồng lên hóa đơn điều chỉnh.",
    };
  }
  if (!original.invoiceNo || !original.issuedAt) {
    return { ok: false, httpStatus: 400, error: "Hóa đơn gốc thiếu số hóa đơn/ngày phát hành." };
  }

  // Chống điều chỉnh trùng: đã có hóa đơn điều chỉnh đang chờ/đã phát hành.
  const existing = await prisma.invoiceLog.findFirst({
    where: {
      adjustmentForLogId: original.id,
      status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] },
    },
    select: { invoiceNo: true, status: true },
  });
  if (existing) {
    return {
      ok: false,
      httpStatus: 409,
      error:
        existing.status === InvoiceLogStatus.ISSUED
          ? `Hóa đơn gốc đã được điều chỉnh bởi hóa đơn số ${existing.invoiceNo ?? "?"}.`
          : "Đang có yêu cầu điều chỉnh chờ xử lý cho hóa đơn này.",
    };
  }

  const snapshot = original.lines as unknown as InvoiceLine[] | null;
  if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        "Hóa đơn gốc phát hành trước bản cập nhật này nên thiếu dữ liệu dòng hàng — vui lòng lập hóa đơn điều chỉnh trực tiếp trên meInvoice (app3.meinvoice.vn).",
    };
  }
  // Ký hiệu hóa đơn GỐC: ưu tiên cột lưu lúc phát hành; đời cũ rơi về ký hiệu
  // hiện tại của shop (rủi ro nếu shop đã đổi ký hiệu — log gốc mới đều có).
  const cfg = await prisma.invoiceConfig.findFirst({
    where: { ownerId, channelId: null },
    select: { invoiceSeries: true },
  });
  const orgSeries = original.invoiceSeries ?? cfg?.invoiceSeries ?? null;
  if (!orgSeries) {
    return { ok: false, httpStatus: 400, error: "Không xác định được ký hiệu hóa đơn gốc." };
  }

  const provider = await getInvoiceProvider(ownerId, original.order?.channelId ?? undefined);
  if (!provider) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Chưa cấu hình nhà cung cấp hóa đơn — vào Kết nối & Xuất hóa đơn trước.",
    };
  }

  const lines = negateLines(snapshot);
  const vatTotal = lines.reduce((s, l) => s + l.vatAmount, 0);
  const totalAmount = lines.reduce((s, l) => s + l.amountWithoutVat + l.vatAmount, 0);

  // RefID mới cho mỗi lượt điều chỉnh (kể cả lượt trước FAILED) — RefID là
  // khóa chống trùng phía MISA, dùng lại là bị chặn.
  const priorAttempts = await prisma.invoiceLog.count({
    where: { adjustmentForLogId: original.id },
  });
  const refId = `${original.orderCode}-DC${priorAttempts + 1}`;

  const log = await prisma.invoiceLog.create({
    data: {
      ownerId,
      orderId: original.orderId,
      orderCode: original.orderCode,
      provider: provider.name,
      status: InvoiceLogStatus.PENDING,
      totalAmount, // số ÂM — báo cáo cộng dồn tự trừ phần đã hoàn
      vatAmount: vatTotal,
      invoiceSeries: cfg?.invoiceSeries ?? orgSeries,
      lines: lines as unknown as Prisma.InputJsonValue,
      adjustmentForLogId: original.id,
    },
  });

  // Người mua in lại đúng như hóa đơn gốc (thông tin khách yêu cầu xuất HĐ có
  // thể đã bị cron BVDLCN xóa sau 30/90 ngày — khi đó rơi về "Bán cho người
  // tiêu dùng", chấp nhận được vì hóa đơn điều chỉnh tham chiếu số HĐ gốc).
  const buyer = original.order
    ? resolveInvoiceBuyer(original.order)
    : { buyerName: "Bán cho người tiêu dùng" };

  const result = await provider.createInvoice({
    orderCode: refId,
    ...buyer,
    lines,
    totalAmount,
    adjustment: {
      orgInvNo: original.invoiceNo,
      orgInvSeries: orgSeries,
      orgInvDate: vnDate(original.issuedAt),
      reason,
    },
  });

  const issued = result.status === InvoiceLogStatus.ISSUED;
  const [updated] = await prisma.$transaction([
    prisma.invoiceLog.update({
      where: { id: log.id },
      data: {
        status: result.status,
        invoiceNo: result.invoiceNo ?? null,
        transactionId: result.transactionId ?? null,
        vatAmount: result.vatAmount ?? vatTotal,
        errorMessage: result.errorMessage ?? null,
        issuedAt: issued ? new Date() : null,
      },
    }),
    prisma.invoiceStatusHistory.create({
      data: {
        invoiceLogId: log.id,
        orderCode: original.orderCode,
        fromStatus: InvoiceLogStatus.PENDING,
        toStatus: result.status,
        source: "HUBSELL",
        note: issued
          ? `Điều chỉnh GIẢM cho HĐ ${original.invoiceNo} (${reason}): số ${result.invoiceNo ?? "?"}, mã tra cứu ${result.transactionId ?? "?"}`
          : (result.errorMessage ?? null),
      },
    }),
  ]);

  return {
    ok: issued,
    httpStatus: issued ? 201 : 502,
    error: issued ? undefined : (result.errorMessage ?? "NCC từ chối phát hành hóa đơn điều chỉnh"),
    log: {
      ...updated,
      totalAmount: Number(updated.totalAmount),
      vatAmount: Number(updated.vatAmount),
      platformTaxWithheld: Number(updated.platformTaxWithheld),
    },
  };
}

/**
 * Hook TỰ ĐỘNG từ luồng hoàn: gọi khi một đơn hoàn vừa chuyển RECEIVED_INTACT
 * (đã nhập kho). Fire-and-forget — nơi gọi KHÔNG await, lỗi chỉ log server.
 */
export function maybeAutoAdjustOnReturn(ownerId: string, orderId: string): void {
  void (async () => {
    if (!isPublishAllowed()) return; // chốt an toàn tổng — như worker auto-issue
    const cfg = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId: null },
      select: { autoAdjustEnabled: true },
    });
    if (!cfg?.autoAdjustEnabled) return;
    const original = await prisma.invoiceLog.findFirst({
      where: {
        ownerId,
        orderId,
        status: InvoiceLogStatus.ISSUED,
        adjustmentForLogId: null,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, orderCode: true },
    });
    if (!original) return; // đơn chưa từng xuất hóa đơn — không có gì để điều chỉnh
    const r = await issueAdjustmentForOrder(
      ownerId,
      { userId: ownerId }, // hook chạy danh nghĩa chủ shop — toàn phạm vi
      original.id,
      "Khách trả hàng hoàn tiền (hàng hoàn đã nhập kho)"
    );
    if (!r.ok && r.httpStatus !== 409) {
      // 409 = đã điều chỉnh rồi (bấm nhập kho lại) — im lặng là đúng.
      console.error(
        `[auto-adjust] Đơn ${original.orderCode}: ${r.error ?? "lỗi không xác định"}`
      );
    }
  })().catch((err) => {
    console.error("[auto-adjust] Lỗi không bắt được:", err);
  });
}
