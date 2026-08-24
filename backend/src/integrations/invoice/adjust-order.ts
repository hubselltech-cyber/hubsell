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
import {
  allocateOrderDiscount,
  resolveInvoiceBuyer,
  type IssueOrderResult,
} from "./issue-order";
import { isPublishAllowed } from "./misa-safety";
import type { InvoiceLine } from "./types";

/** Ngày yyyy-MM-dd theo giờ VN — định dạng OrgInvDate meInvoice yêu cầu. */
function vnDate(d: Date): string {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * PHẠM VI điều chỉnh giảm (25/08 rạng sáng — anh Trung chốt trigger THEO SÀN,
 * kho vật lý chỉ kiểm soát hàng; sàn lại báo đủ dữ liệu nên làm được cả 3 mức):
 *   · FULL   — trả toàn bộ: âm nguyên hóa đơn.
 *   · ITEMS  — trả MỘT PHẦN theo dòng (Shopee item[] của yêu cầu hoàn): âm đúng
 *     dòng + số lượng khách trả.
 *   · AMOUNT — chỉ hoàn tiền một phần, khách giữ hàng (REFUND_ONLY): giảm giá
 *     trị phân bổ theo tỷ trọng dòng, số lượng để 0 (hướng dẫn meInvoice: điều
 *     chỉnh giá trị không ghi số lượng).
 */
export type AdjustmentScope =
  | { kind: "FULL" }
  | { kind: "ITEMS"; bySku: ReadonlyMap<string, number> }
  | { kind: "AMOUNT"; amount: number };

/** Bóc ngược VAT cho một phần gross bị trả — cùng công thức buildInvoiceLines. */
function splitVat(gross: number, vatRate: number): { net: number; vat: number } {
  const net = Math.round((gross * 100) / (100 + vatRate));
  return { net, vat: gross - net };
}

/**
 * Dựng dòng ĐIỀU CHỈNH (số âm) từ snapshot dòng đã phát hành theo phạm vi.
 * Hàm thuần có test riêng. Trả [] khi phạm vi không khớp dòng nào — nơi gọi
 * phải coi là lỗi dữ liệu, không được lặng lẽ điều chỉnh toàn bộ.
 */
export function buildAdjustmentLines(
  snapshot: InvoiceLine[],
  scope: AdjustmentScope
): InvoiceLine[] {
  if (scope.kind === "FULL") {
    return snapshot.map((l) => ({
      ...l,
      quantity: -l.quantity,
      amountWithoutVat: -l.amountWithoutVat,
      vatAmount: -l.vatAmount,
    }));
  }
  if (scope.kind === "ITEMS") {
    const out: InvoiceLine[] = [];
    for (const l of snapshot) {
      const retQty = scope.bySku.get(l.sku) ?? 0;
      if (retQty <= 0) continue;
      if (retQty >= l.quantity) {
        out.push({
          ...l,
          quantity: -l.quantity,
          amountWithoutVat: -l.amountWithoutVat,
          vatAmount: -l.vatAmount,
        });
        continue;
      }
      // Trả một phần dòng: gross phần trả chia theo tỷ lệ số lượng rồi bóc
      // ngược VAT lại — tổng dòng âm luôn khớp đúng phần gross bị trả.
      const gross = l.amountWithoutVat + l.vatAmount;
      const grossRet = Math.round((gross * retQty) / l.quantity);
      const { net, vat } = splitVat(grossRet, l.vatRate);
      out.push({
        ...l,
        quantity: -retQty,
        amountWithoutVat: -net,
        vatAmount: -vat,
      });
    }
    return out;
  }
  // AMOUNT — giảm giá trị (khách giữ hàng): phân bổ số tiền lên các dòng theo
  // tỷ trọng gross (largest-first phần dư — cùng allocateOrderDiscount của
  // luồng voucher), kẹp trần bằng tổng hóa đơn.
  const grosses = snapshot.map((l) => l.amountWithoutVat + l.vatAmount);
  const cuts = allocateOrderDiscount(grosses, scope.amount);
  const out: InvoiceLine[] = [];
  for (let i = 0; i < snapshot.length; i++) {
    if (cuts[i] <= 0) continue;
    const l = snapshot[i];
    const { net, vat } = splitVat(cuts[i], l.vatRate);
    out.push({
      ...l,
      quantity: 0, // điều chỉnh giá trị — không ghi số lượng
      unitPrice: 0,
      amountWithoutVat: -net,
      vatAmount: -vat,
    });
  }
  return out;
}

/**
 * Lập hóa đơn điều chỉnh GIẢM TOÀN BỘ cho hóa đơn gốc của một đơn hàng.
 * Trả IssueOrderResult như issue-order để route/hook dùng chung cách xử lý.
 */
export async function issueAdjustmentForOrder(
  ownerId: string,
  channelWhere: Prisma.ChannelWhereInput,
  originalLogId: string,
  reason: string,
  scope: AdjustmentScope = { kind: "FULL" }
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

  const lines = buildAdjustmentLines(snapshot, scope);
  if (lines.length === 0) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        "Không khớp được phần hàng/tiền bị trả với dòng hàng trên hóa đơn gốc — lập hóa đơn điều chỉnh thủ công trên meInvoice hoặc dùng điều chỉnh toàn bộ.",
    };
  }
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
 * Trạng thái yêu cầu hoàn PHÍA SÀN được coi là "hoàn đã chốt" — mốc kích hoạt
 * tự động điều chỉnh (25/08 rạng sáng, anh Trung chốt: theo SÀN là chính, kho
 * vật lý chỉ kiểm soát hàng). Hai họ giá trị không trùng nhau nên gộp một tập:
 *   · SHOPEE (Returns API status): ACCEPTED nằm trong tập vì đây là lúc tiền
 *     hoàn đã vào sao kê (seller_return_refund — returns-sync tự chữa
 *     refundedAmount ở đúng mốc này); REFUND_PAID/COMPLETED là mốc muộn hơn.
 *   · LAZADA (reverse_status, bảng webhook Reverse Order docs 25/08):
 *     REFUND_SUCCESS = "Refund Issued" luồng chỉ-hoàn-tiền;
 *     CANCEL_REFUND_ISSUED = hủy đơn đã hoàn tiền. Luồng TRẢ HÀNG (RTM_*)
 *     docs KHÔNG có mốc đã-hoàn-tiền riêng → ca đó do LƯỚI VÉT nhập kho gánh.
 */
export const PLATFORM_RETURN_DONE_STATUSES = new Set([
  // Shopee
  "ACCEPTED",
  "REFUND_PAID",
  "REFUND_COMPLETED",
  "COMPLETED",
  // Lazada — 25/08 anh Trung nhắc lần 2: THUẦN THEO SÀN, kho vật lý không dính
  // gì (lưới vét nhập kho đã GỠ). Luồng trả hàng lấy mốc SÀN ghi nhận:
  // RTM_RECEIVE_ITEM = sàn xác nhận kiện hoàn đã giao về seller;
  // RTW_REFUND_PENDING = "Return Processed" — hàng về kho sàn, chờ nhả tiền.
  "REFUND_SUCCESS",
  "CANCEL_REFUND_ISSUED",
  "RTM_RECEIVE_ITEM",
  "RTW_REFUND_PENDING",
]);

/**
 * CHỌN PHẠM VI điều chỉnh từ dữ liệu hoàn SÀN BÁO của một đơn (dùng chung cho
 * hook tự động lẫn nút tay chế độ "Theo dữ liệu sàn"):
 *   · sàn báo dòng hàng trả (returnedQuantity) → THEO DÒNG (một phần chính
 *     xác — hơn Salework, họ bắt làm tay); mọi dòng trả đủ → toàn bộ;
 *   · chỉ hoàn tiền (khách giữ hàng): tiền hoàn ≥ tổng hóa đơn → toàn bộ,
 *     nhỏ hơn → giảm giá trị phân bổ theo tỷ trọng.
 * Trả null khi sàn CHƯA báo được gì (chưa có dòng trả lẫn số tiền).
 */
export async function decideScopeFromPlatformReturn(
  orderId: string,
  originalTotalAmount: number
): Promise<{ scope: AdjustmentScope; reason: string } | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      platformRefundAmount: true,
      items: {
        select: {
          channelSku: true,
          quantity: true,
          returnedQuantity: true,
          product: { select: { skuCode: true } },
        },
      },
    },
  });
  if (!order) return null;

  // SKU trên hóa đơn = SKU kho nếu đã liên kết (cùng quy ước issue-order).
  const returnedLines = order.items.filter((it) => (it.returnedQuantity ?? 0) > 0);
  if (returnedLines.length > 0) {
    const fullReturn = order.items.every((it) => (it.returnedQuantity ?? 0) >= it.quantity);
    return fullReturn
      ? {
          scope: { kind: "FULL" },
          reason: "Khách trả hàng hoàn tiền toàn bộ (sàn xác nhận hoàn tất)",
        }
      : {
          scope: {
            kind: "ITEMS",
            bySku: new Map(
              returnedLines.map((it) => [
                it.product?.skuCode ?? it.channelSku,
                it.returnedQuantity ?? 0,
              ])
            ),
          },
          reason: "Khách trả một phần hàng hoàn tiền (sàn xác nhận hoàn tất)",
        };
  }
  const refund = Number(order.platformRefundAmount ?? 0);
  if (refund <= 0) return null; // sàn chưa báo gì — không tự bịa phạm vi
  return refund >= originalTotalAmount
    ? {
        scope: { kind: "FULL" },
        reason: "Sàn hoàn toàn bộ tiền cho khách (khách giữ hàng)",
      }
    : {
        scope: { kind: "AMOUNT", amount: refund },
        reason: `Sàn hoàn ${refund.toLocaleString("vi-VN")}đ cho khách (khách giữ hàng)`,
      };
}

/**
 * Hook TỰ ĐỘNG THEO SÀN — gọi khi returns-sync thấy trạng thái yêu cầu hoàn
 * chuyển VÀO tập PLATFORM_RETURN_DONE_STATUSES. Fire-and-forget — không được
 * chặn vòng sync.
 */
export function maybeAutoAdjustOnPlatformReturn(ownerId: string, orderId: string): void {
  void (async () => {
    if (!isPublishAllowed()) return;
    const cfg = await prisma.invoiceConfig.findFirst({
      where: { ownerId, channelId: null },
      select: { autoAdjustEnabled: true },
    });
    if (!cfg?.autoAdjustEnabled) return;
    const original = await prisma.invoiceLog.findFirst({
      where: { ownerId, orderId, status: InvoiceLogStatus.ISSUED, adjustmentForLogId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, orderCode: true, totalAmount: true },
    });
    if (!original) return; // đơn chưa từng xuất hóa đơn

    const decided = await decideScopeFromPlatformReturn(orderId, Number(original.totalAmount));
    if (!decided) return; // sàn chưa báo số — lượt quét sau tính tiếp

    const r = await issueAdjustmentForOrder(
      ownerId,
      { userId: ownerId },
      original.id,
      decided.reason,
      decided.scope
    );
    if (!r.ok && r.httpStatus !== 409) {
      console.error(
        `[auto-adjust/sàn] Đơn ${original.orderCode}: ${r.error ?? "lỗi không xác định"}`
      );
    }
  })().catch((err) => {
    console.error("[auto-adjust/sàn] Lỗi không bắt được:", err);
  });
}

// LƯU Ý LỊCH SỬ (25/08 rạng sáng): từng có hook "lưới vét" bắn từ luồng kho
// nhập hàng hoàn (RECEIVED_INTACT) — ĐÃ GỠ theo chỉ đạo anh Trung nhắc lần 2:
// hóa đơn điều chỉnh THUẦN THEO API SÀN, kho vật lý chỉ kiểm soát nội bộ +
// tăng giảm tồn đẩy lên sàn, không dính gì tới chứng từ thuế. ĐỪNG cắm lại
// hook vào orders.ts — mốc sàn đã phủ đủ (PLATFORM_RETURN_DONE_STATUSES).
