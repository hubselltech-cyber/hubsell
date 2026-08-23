/**
 * LÕI PHÁT HÀNH HÓA ĐƠN CHO MỘT ĐƠN HÀNG — dùng chung cho 3 cửa:
 *   · POST /api/tax/invoices        (xuất tay 1 đơn)
 *   · POST /api/tax/invoices/bulk   (xuất hàng loạt từ hàng chờ)
 *   · worker invoice-auto-issue     (tự động xuất theo lịch)
 *
 * Quy ước như route gốc 23/08: dòng hàng theo InvoiceLine (đơn giá CHƯA thuế,
 * % từ Product.vatRate, tên in ưu tiên taxName); ghi InvoiceLog PENDING → kết
 * quả + audit InvoiceStatusHistory (source HUBSELL) + Order.einvoiceStatus
 * trong MỘT transaction; NCC từ chối vẫn ghi sổ FAILED. KHÔNG ném lỗi nghiệp
 * vụ — trả {ok, httpStatus, error} để nơi gọi tự quyết cách hiển thị.
 *
 * MISA yêu cầu xử lý TUẦN TỰ theo từng ký hiệu — nơi gọi hàng loạt phải await
 * từng đơn một, không Promise.all.
 */

import { InvoiceLogStatus, Prisma, ShippingStatus } from "@prisma/client";

import { prisma } from "../../prisma";
import { getInvoiceProvider } from "./index";
import type { InvoiceLine } from "./types";

export interface IssueOrderResult {
  ok: boolean;
  /** Mã HTTP gợi ý cho route: 201/400/404/409/502. */
  httpStatus: number;
  error?: string;
  /** Row InvoiceLog sau cùng (đã cập nhật kết quả) — null khi chặn trước khi ghi sổ. */
  log?: {
    id: string;
    orderCode: string;
    provider: string;
    invoiceNo: string | null;
    transactionId: string | null;
    status: InvoiceLogStatus;
    totalAmount: number;
    vatAmount: number;
    platformTaxWithheld: number;
    errorMessage: string | null;
    issuedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * @param channelWhere Phạm vi gian hàng của người gọi — route truyền
 *        channelScope(req) (đã gồm giới hạn nhân viên), worker truyền
 *        {userId: ownerId} (toàn shop).
 */
export async function issueInvoiceForOrder(
  ownerId: string,
  channelWhere: Prisma.ChannelWhereInput,
  orderCode: string
): Promise<IssueOrderResult> {
  const order = await prisma.order.findFirst({
    where: { orderCode, channel: channelWhere },
    include: {
      items: {
        include: {
          product: { select: { skuCode: true, taxName: true, vatRate: true } },
        },
      },
    },
  });
  if (!order) {
    return {
      ok: false,
      httpStatus: 404,
      error: `Không tìm thấy đơn ${orderCode} trong phạm vi của bạn`,
    };
  }
  if (order.shippingStatus === ShippingStatus.CANCELLED) {
    return { ok: false, httpStatus: 400, error: "Đơn đã hủy — không phát hành hóa đơn" };
  }
  if (order.items.length === 0) {
    return { ok: false, httpStatus: 400, error: "Đơn không có dòng hàng nào để lên hóa đơn" };
  }

  // Chống phát hành trùng: đơn đã có hóa đơn đang chờ/đã phát hành thì dừng
  // (RefID phía MISA cũng chặn trùng, nhưng chặn sớm cho thông điệp rõ hơn).
  const existing = await prisma.invoiceLog.findFirst({
    where: {
      ownerId,
      orderCode,
      status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] },
    },
    select: { status: true, invoiceNo: true },
  });
  if (existing) {
    return {
      ok: false,
      httpStatus: 409,
      error:
        existing.status === InvoiceLogStatus.ISSUED
          ? `Đơn này đã có hóa đơn số ${existing.invoiceNo ?? "?"} — muốn phát hành lại phải hủy/thay thế trước.`
          : "Đơn này đang có yêu cầu phát hành chờ xử lý.",
    };
  }

  const provider = await getInvoiceProvider(ownerId, order.channelId);
  if (!provider) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        "Chưa cấu hình nhà cung cấp hóa đơn (hoặc NCC chưa được hỗ trợ) — vào Kết nối & Xuất hóa đơn trước.",
    };
  }

  // Dòng hàng theo quy ước InvoiceLine: unitPrice CHƯA thuế GTGT.
  const lines: InvoiceLine[] = order.items.map((it) => ({
    name: it.product?.taxName?.trim() || it.productName,
    sku: it.product?.skuCode ?? it.channelSku,
    quantity: it.quantity,
    unitPrice: Number(it.price),
    vatRate: it.product?.vatRate ?? 0,
  }));
  const vatTotal = lines.reduce(
    (s, l) => s + Math.round((l.unitPrice * l.quantity * l.vatRate) / 100),
    0
  );
  const totalAmount = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) + vatTotal;

  const log = await prisma.invoiceLog.create({
    data: {
      ownerId,
      orderId: order.id,
      orderCode,
      provider: provider.name,
      status: InvoiceLogStatus.PENDING,
      totalAmount,
      vatAmount: vatTotal,
    },
  });

  const result = await provider.createInvoice({
    orderCode,
    buyerName: order.customerName,
    lines,
    totalAmount,
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
        orderCode,
        fromStatus: InvoiceLogStatus.PENDING,
        toStatus: result.status,
        source: "HUBSELL",
        note: issued
          ? `Phát hành qua ${provider.name}: số ${result.invoiceNo ?? "?"}, mã tra cứu ${result.transactionId ?? "?"}`
          : (result.errorMessage ?? null),
      },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: { einvoiceStatus: result.status },
    }),
  ]);

  return {
    ok: issued,
    httpStatus: issued ? 201 : 502,
    error: issued ? undefined : (result.errorMessage ?? "NCC từ chối phát hành"),
    log: {
      ...updated,
      totalAmount: Number(updated.totalAmount),
      vatAmount: Number(updated.vatAmount),
      platformTaxWithheld: Number(updated.platformTaxWithheld),
    },
  };
}
