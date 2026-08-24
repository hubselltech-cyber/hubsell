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

/** JSON Order.buyerInvoiceInfo (chuẩn hóa bởi shopee/buyer-invoice.ts). */
interface StoredBuyerInfo {
  name?: string;
  email?: string;
  taxId?: string;
  nationalId?: string;
  address?: string;
  companyName?: string;
  companyTaxId?: string;
  companyEmail?: string;
  companyAddress?: string;
}

export interface ResolvedInvoiceBuyer {
  buyerName: string;
  /** Người đặt hàng khi mua danh nghĩa công ty (dòng "Họ tên người mua hàng"). */
  buyerContactName?: string;
  buyerTaxCode?: string;
  buyerAddress?: string;
  buyerEmail?: string;
}

/**
 * NGƯỜI MUA trên hóa đơn (24/08 — nối thông tin khách yêu cầu xuất hóa đơn):
 *   · COMPANY   → tên công ty + MST công ty + địa chỉ/email công ty.
 *   · PERSONAL / HOUSEHOLD → tên khách + MST (hộ KD) hoặc số định danh (cá
 *     nhân — từ 07/2025 thay MST cá nhân) + địa chỉ/email khách điền.
 *   · Khách KHÔNG yêu cầu → "Bán cho người tiêu dùng" theo Khoản 4 Phụ lục
 *     NĐ 254/2026 (KHÔNG dùng customerName của sàn — tên bị che dạng "A**x",
 *     in lên chứng từ CQT vừa xấu vừa vô nghĩa); mã đơn đã nằm ở RefID phía
 *     NCC làm căn cứ giải trình.
 */
export function resolveInvoiceBuyer(order: {
  invoiceRequestType: string | null;
  buyerInvoiceInfo: unknown;
}): ResolvedInvoiceBuyer {
  const info = (order.buyerInvoiceInfo ?? {}) as StoredBuyerInfo;
  if (order.invoiceRequestType === "COMPANY" && info.companyName) {
    return {
      buyerName: info.companyName,
      buyerContactName: info.name,
      buyerTaxCode: info.companyTaxId,
      buyerAddress: info.companyAddress,
      buyerEmail: info.companyEmail,
    };
  }
  if (
    (order.invoiceRequestType === "PERSONAL" || order.invoiceRequestType === "HOUSEHOLD") &&
    info.name
  ) {
    return {
      buyerName: info.name,
      buyerTaxCode: info.taxId ?? info.nationalId,
      buyerAddress: info.address,
      buyerEmail: info.email,
    };
  }
  return { buyerName: "Bán cho người tiêu dùng" };
}

/** Đầu vào tối thiểu để dựng một dòng hóa đơn từ OrderItem. */
export interface InvoiceLineSource {
  name: string;
  sku: string;
  quantity: number;
  /** Đơn giá BÁN trên sàn (giá khách trả, ĐÃ gồm thuế GTGT). */
  price: number;
  /** Thuế suất khai riêng ở SKU kho — null/0 = dùng defaultVatRate của shop. */
  vatRate: number | null;
}

/**
 * TÊN HÀNG in trên hóa đơn — chặn dữ liệu bẩn từ sàn (24/08 tối, anh chốt):
 * ~22 OrderItem Lazada có productName là URL ảnh, in lên chứng từ CQT vừa xấu
 * vừa sai bản chất. Tên rỗng hoặc bắt đầu bằng http(s) → thay bằng
 * "Hàng hóa mã <SKU>"; seller muốn tên đẹp thì khai taxName ở SKU kho (ưu tiên
 * sẵn ở nơi gọi).
 */
export function invoiceLineName(rawName: string, sku: string): string {
  const name = rawName.trim();
  if (name === "" || /^https?:\/\//i.test(name)) return `Hàng hóa mã ${sku}`;
  return name;
}

/**
 * Phân bổ CHIẾT KHẤU cấp đơn (voucher người bán) vào từng dòng theo tỷ trọng
 * tiền dòng — largest-first cho phần dư làm tròn để Σ phần trừ = ĐÚNG số
 * chiết khấu (không lệch 1đ). Trả mảng số tiền trừ theo đúng thứ tự dòng.
 */
export function allocateOrderDiscount(
  grosses: number[],
  discount: number
): number[] {
  const totalGross = grosses.reduce((s, g) => s + g, 0);
  const d = Math.min(Math.max(0, Math.round(discount)), totalGross);
  if (d === 0 || totalGross === 0) return grosses.map(() => 0);
  const cuts = grosses.map((g) => Math.floor((d * g) / totalGross));
  let rem = d - cuts.reduce((s, c) => s + c, 0);
  // Dồn phần dư mỗi dòng 1đ, dòng tiền lớn nhận trước (ổn định, dễ giải trình).
  const byGrossDesc = grosses.map((g, i) => i).sort((a, b) => grosses[b] - grosses[a]);
  for (let k = 0; rem > 0; k = (k + 1) % byGrossDesc.length) {
    cuts[byGrossDesc[k]] += 1;
    rem -= 1;
  }
  return cuts;
}

/**
 * BÓC NGƯỢC thuế GTGT từ giá bán (24/08 — anh Trung chốt sau khảo sát: Salework
 * cùng cách này, chuẩn kế toán TMĐT yêu cầu tổng hóa đơn = đúng số khách trả;
 * giá niêm yết sàn theo Luật Giá là giá đã gồm thuế):
 *   · gross (giá khách trả dòng) = price × quantity, làm tròn VND, TRỪ phần
 *     chiết khấu cấp đơn được phân bổ (orderDiscount — voucher người bán Shopee;
 *     giảm giá bán theo TT 219, hóa đơn ghi giá đã giảm);
 *   · amountWithoutVat = round(gross × 100 / (100 + thuế suất));
 *   · vatAmount = gross − amountWithoutVat  →  cộng lại LUÔN đúng gross,
 *     không lệch 1đ kiểu tính thuế độc lập rồi cộng lên.
 * unitPrice chỉ để IN đơn giá chưa thuế: SL=1 lấy đúng amountWithoutVat, SL>1
 * chia đều làm tròn 2 số lẻ (con số pháp lý vẫn là cặp amount/vat).
 * ⚠️ Đối soát webhook (misa-webhook-service.reconcileTax) GỌI CHUNG hàm này —
 * đổi công thức ở đây là đổi cả hai đầu, đúng chủ đích.
 */
export function buildInvoiceLines(
  items: InvoiceLineSource[],
  defaultVatRate: number,
  orderDiscount = 0
): InvoiceLine[] {
  const grosses = items.map((it) => Math.round(it.price * it.quantity));
  const cuts = allocateOrderDiscount(grosses, orderDiscount);
  return items.map((it, i) => {
    const vatRate = it.vatRate ? it.vatRate : defaultVatRate;
    const gross = grosses[i] - cuts[i];
    const amountWithoutVat = Math.round((gross * 100) / (100 + vatRate));
    const vatAmount = gross - amountWithoutVat;
    const unitPrice =
      it.quantity === 1
        ? amountWithoutVat
        : Math.round((amountWithoutVat / it.quantity) * 100) / 100;
    return {
      name: it.name,
      sku: it.sku,
      quantity: it.quantity,
      unitPrice,
      vatRate,
      amountWithoutVat,
      vatAmount,
    };
  });
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

  // THUẾ SUẤT MẶC ĐỊNH của shop (24/08 — kho vật lý chỉ quản số lượng, không
  // bắt liên kết SKU): dòng hàng có Product.vatRate > 0 dùng số khai riêng;
  // còn lại (chưa liên kết, hoặc liên kết nhưng chưa khai) dùng mức mặc định.
  const cfg = await prisma.invoiceConfig.findFirst({
    where: { ownerId, channelId: null },
    select: { defaultVatRate: true },
  });
  const defaultVatRate = cfg?.defaultVatRate ?? 0;

  // Dòng hàng: giá bán sàn = giá ĐÃ GỒM thuế → bóc ngược (buildInvoiceLines);
  // tổng hóa đơn vì thế luôn khớp đúng số khách trả cho phần hàng. Voucher
  // NGƯỜI BÁN cấp đơn (sellerDiscountVoucher — Shopee, có cả số ước tính trước
  // đối soát) là chiết khấu thương mại: phân bổ trừ vào từng dòng, hóa đơn ghi
  // giá đã giảm đúng TT 219; tên dòng chặn dữ liệu bẩn qua invoiceLineName.
  const lines: InvoiceLine[] = buildInvoiceLines(
    order.items.map((it) => {
      const sku = it.product?.skuCode ?? it.channelSku;
      return {
        name: invoiceLineName(it.product?.taxName?.trim() || it.productName, sku),
        sku,
        quantity: it.quantity,
        price: Number(it.price),
        vatRate: it.product?.vatRate ?? null,
      };
    }),
    defaultVatRate,
    Number(order.sellerDiscountVoucher)
  );
  const vatTotal = lines.reduce((s, l) => s + l.vatAmount, 0);
  const totalAmount = lines.reduce((s, l) => s + l.amountWithoutVat + l.vatAmount, 0);

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
    ...resolveInvoiceBuyer(order),
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
