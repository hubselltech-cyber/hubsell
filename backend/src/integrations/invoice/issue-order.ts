/**
 * LÕI PHÁT HÀNH HÓA ĐƠN CHO ĐƠN HÀNG — dùng chung cho mọi cửa (bấm một đơn, lô bấm
 * tay, tự phát hành theo lịch) qua làn của shop (services/invoice-requests.ts,
 * workers/invoice-auto-issue.ts). Từ 10/10/2026 có issueInvoicesForOrders gom nhiều
 * đơn một lệnh nhà cung cấp (tờ nháp MISA 20 tờ/lệnh); issueInvoiceForOrder giữ cho
 * một đơn.
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

import { prisma } from "../../lib/prisma";
import { SecretBoxError } from "../../lib/secret-box";
import { autoRetryExhausted, nextOrderErrorCount } from "./auto-issue-policy";
import { cqtNextOnWrite } from "./cqt-follow";
import { AWAITING_SIGNATURE_CODE, DRAFT_FIRST_CHECK_MS, NUMBER_PENDING_CODE } from "./draft-signing";
import { getInvoiceProvider } from "./index";
import type { InvoiceErrorScope } from "./invoice-errors";
import { isSalesInvoiceSeries } from "./misa-einvoice";
import type { CreateInvoiceInput, InvoiceLine, InvoiceProvider, InvoiceResult } from "./types";
import { canRecheckLater, keptPendingMessage, OUTCOME_UNKNOWN_CODE, recheckInProgressMessage } from "./unknown-outcome";

/** Khoảng nghỉ nhà cung cấp yêu cầu giữa hai lệnh phát hành; undefined khi không yêu cầu. */
export function publishGapOf(provider: InvoiceProvider): number | undefined {
  const ms = provider.capabilities.publishGapMs;
  return ms > 0 ? ms : undefined;
}

export interface IssueOrderResult {
  ok: boolean;
  /** Mã HTTP gợi ý cho route: 201/400/404/409/502. */
  httpStatus: number;
  error?: string;
  /** Mã lỗi NCC + tầm ảnh hưởng (invoice-errors.ts) — worker tự động dùng để ngắt mạch. */
  errorCode?: string;
  errorScope?: InvoiceErrorScope;
  /**
   * true = NCC CHƯA trả lời rõ tờ này đã lập hay chưa (InvoiceResult.outcomeUnknown).
   * Dòng nhật ký vẫn ghi FAILED; người gọi không được coi là "chắc chắn chưa lập".
   */
  outcomeUnknown?: boolean;
  /**
   * true = nhà cung cấp đã nhận TỜ NHÁP, chủ shop phải ký trên web của họ (lát T1
   * tenant, 08/10/2026). Dòng nhật ký PENDING + awaitingSignatureAt; `ok` vẫn false
   * (chưa có số) nhưng KHÔNG phải lỗi: `error` trống, `message` là câu hướng dẫn chỗ ký,
   * httpStatus 202. Nơi lặp nhiều tờ không đếm vào chuỗi lỗi (isDeferredAtProvider).
   */
  awaitingSignature?: true;
  /** Câu cho người bấm khi httpStatus 202 (chờ ký / chờ cấp số) — không phải lỗi. */
  message?: string;
  /**
   * Có mặt khi lệnh đã đi tới nhà cung cấp: người gọi đang lặp qua nhiều tờ phải
   * chờ đủ số ms này trước tờ kế (ProviderCapabilities.publishGapMs — MISA 02/10:
   * mỗi lệnh cách nhau 1–3 giây). Không có = chưa gọi nhà cung cấp, không cần nghỉ.
   */
  pauseBeforeNextMs?: number;
  /**
   * Số lượt lỗi RIÊNG ĐƠN (tầm ORDER) của hóa đơn gốc này tính cả lượt vừa rồi
   * (InvoiceLog.orderErrorCount — bước 5 lát 7). Chỉ có khi lượt này ghi FAILED.
   */
  orderErrorCount?: number;
  /**
   * true = lượt này vừa đưa đơn tới mức dừng tự thử (orderErrorCount vừa chạm
   * INVOICE_AUTO_ISSUE_MAX_ATTEMPTS): worker dùng để reo chuông đúng một lần cho
   * đơn đó. Lượt sau đó (bấm tay rồi vẫn hỏng) không mang cờ này nữa.
   */
  autoRetryJustStopped?: boolean;
  /**
   * Khi Hubsell CHỦ ĐỘNG KHÔNG LẬP (vd không xác nhận được hóa đơn gốc trước khi
   * điều chỉnh): chuyện gì đang xảy ra + việc chủ shop nên làm, tách riêng để giao
   * diện trình bày. `error` vẫn mang cả hai, gộp thành một câu.
   */
  reason?: string;
  suggestion?: string;
  /**
   * Có mặt khi bị chặn vì đơn ĐÃ có hóa đơn gốc đang mở (409): ISSUED = đã phát hành;
   * PENDING = đang có lượt chờ kết quả (đang gọi dở, hoặc vòng quét đang kiểm lại).
   * Làn xử lý yêu cầu bấm tay (lát 9) dùng để đóng yêu cầu đúng nghĩa.
   */
  conflict?: "ISSUED" | "PENDING";
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

/**
 * MST / số định danh NGƯỜI MUA do khách tự gõ trên sàn — chuẩn hóa (bỏ khoảng
 * trắng, dấu chấm) rồi kiểm dạng TRƯỚC khi gửi NCC: 10 số (DN) · 10-3 / 13 số
 * (đơn vị phụ thuộc) · 12 số (hộ KD, căn cước). Sai dạng thì NCC hoặc CQT sẽ từ
 * chối sau khi đã đốt một số hóa đơn, nên chặn sớm với lời nhắn rõ.
 * Trả chuỗi đã chuẩn hóa, hoặc null khi không hợp lệ.
 */
export function normalizeBuyerTaxCode(raw: string): string | null {
  const v = raw.replace(/[\s.]/g, "");
  return /^\d{10}(-?\d{3})?$|^\d{12}$/.test(v) ? v : null;
}

/** Đầu vào tối thiểu để dựng một dòng hóa đơn từ OrderItem. */
export interface InvoiceLineSource {
  name: string;
  sku: string;
  quantity: number;
  /** Đơn giá BÁN trên sàn (ĐÃ gồm thuế GTGT). */
  price: number;
  /** Thuế suất khai riêng ở SKU kho — null/0 = dùng defaultVatRate của shop. */
  vatRate: number | null;
  /** Đơn vị tính khai riêng ở SKU kho — null/rỗng = dùng defaultUnitName của shop. */
  unitName?: string | null;
}

export interface InvoiceLineOptions {
  /** Đơn vị tính mặc định của shop (InvoiceConfig.defaultUnitName). */
  defaultUnitName?: string | null;
  /**
   * HÓA ĐƠN BÁN HÀNG (ký hiệu đầu 2 — hộ/cá nhân KD): KHÔNG có thuế suất, thành
   * tiền = đúng giá bán. Bật cờ này thì MỌI thuế suất (mặc định shop lẫn khai ở
   * SKU) bị bỏ qua — shop lỡ để 8% mà xuất mẫu 2 sẽ không bị bóc ngược ra một
   * khoản "thuế" vô nghĩa làm thành tiền in trên hóa đơn thấp hơn giá bán.
   */
  salesInvoice?: boolean;
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
 * cùng cách này, chuẩn kế toán TMĐT yêu cầu tổng hóa đơn = đúng TỔNG GIÁ TRỊ
 * SẢN PHẨM của đơn — tiền HÀNG sau giảm giá người bán, KHÔNG phải "số khách
 * thanh toán" vốn gồm cả ship thu hộ/voucher sàn (anh chỉnh chữ 25/08);
 * giá niêm yết sàn theo Luật Giá là giá đã gồm thuế):
 *   · gross (giá bán dòng hàng) = price × quantity, làm tròn VND, TRỪ phần
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
  orderDiscount = 0,
  opts: InvoiceLineOptions = {}
): InvoiceLine[] {
  const grosses = items.map((it) => Math.round(it.price * it.quantity));
  const cuts = allocateOrderDiscount(grosses, orderDiscount);
  const defaultUnit = opts.defaultUnitName?.trim() ?? "";
  return items.map((it, i) => {
    const vatRate = opts.salesInvoice ? 0 : it.vatRate ? it.vatRate : defaultVatRate;
    const unitName = it.unitName?.trim() || defaultUnit;
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
      ...(unitName ? { unitName } : {}),
      // Giá bán 0đ = quà tặng kèm đơn (xét giá GỐC của dòng, không xét sau khi
      // trừ voucher — dòng bị voucher ăn hết vẫn là hàng bán, không phải quà).
      ...(grosses[i] === 0 && it.quantity > 0 ? { promotion: true } : {}),
      quantity: it.quantity,
      unitPrice,
      vatRate,
      amountWithoutVat,
      vatAmount,
    };
  });
}

/**
 * Bí mật NCC đã lưu KHÔNG GIẢI MÃ ĐƯỢC (khóa máy chủ bị đổi/mất, hoặc dữ liệu bị
 * can thiệp) → kết quả chặn dùng chung cho phát hành lẫn điều chỉnh. Đơn nào
 * cũng sẽ lỗi y hệt nên xếp tầm TÀI KHOẢN (worker tự ngắt mạch); chặn TRƯỚC khi
 * ghi sổ, không gọi NCC. Chi tiết kỹ thuật chỉ vào log máy chủ — câu trả cho
 * chủ shop chỉ nói việc cần làm. Trả null nếu `err` không phải lỗi giải mã.
 */
export function secretUnreadableResult(ownerId: string, err: unknown): IssueOrderResult | null {
  if (!(err instanceof SecretBoxError)) return null;
  console.error(`[SecretBox] Shop ${ownerId}: ${err.code} — ${err.message}`);
  return {
    ok: false,
    httpStatus: 500,
    error:
      "Hubsell không đọc được mật khẩu nhà cung cấp hóa đơn đã lưu — nhập lại mật khẩu tại Kết nối & Xuất hóa đơn → Cấu hình kết nối rồi Lưu. Nếu vẫn lỗi, báo Hubsell.",
    errorCode: "HUBSELL_SECRET_UNREADABLE",
    errorScope: "ACCOUNT",
  };
}

/** Database từ chối vì đụng chỉ mục duy nhất (Prisma P2002)? */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Đơn này đã có hóa đơn đang chờ / đã phát hành chưa? Có thì trả kết quả 409
 * kèm lời nhắn; chưa thì null. Dùng ở hai chỗ: kiểm sớm trước khi dựng hóa đơn,
 * và dựng lời nhắn khi database từ chối dòng PENDING thứ hai.
 */
async function openInvoiceConflict(ownerId: string, orderCode: string): Promise<IssueOrderResult | null> {
  const existing = await prisma.invoiceLog.findFirst({
    where: {
      ownerId,
      orderCode,
      status: { in: [InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED] },
    },
    select: {
      status: true,
      invoiceNo: true,
      transactionId: true,
      errorMessage: true,
      provider: true,
      awaitingSignatureAt: true,
    },
  });
  if (!existing) return null;
  // Tờ nháp đang chờ chủ shop ký trên web nhà cung cấp (lát T1 tenant) — không phải lỗi,
  // không phải "đang kiểm lại": nói rõ việc cần làm.
  const awaitingSignature = existing.status === InvoiceLogStatus.PENDING && !!existing.awaitingSignatureAt;
  // Dòng đang chờ, chưa có mã tra cứu mà đã mang lời nhắn = lượt trước chưa rõ kết quả,
  // vòng quét đang kiểm lại (unknown-outcome.ts).
  const rechecking =
    existing.status === InvoiceLogStatus.PENDING &&
    !existing.transactionId &&
    !awaitingSignature &&
    !!existing.errorMessage;
  return {
    ok: false,
    httpStatus: 409,
    conflict: existing.status === InvoiceLogStatus.ISSUED ? "ISSUED" : "PENDING",
    error:
      existing.status === InvoiceLogStatus.ISSUED
        ? `Đơn này đã có hóa đơn số ${existing.invoiceNo ?? "?"} — muốn phát hành lại phải hủy/thay thế trước.`
        : awaitingSignature
          ? "Đơn này đã có tờ nháp đang chờ bạn ký trên web nhà cung cấp — ký xong Hubsell tự nhận số, không cần xuất lại."
          : rechecking
            ? recheckInProgressMessage(existing.provider)
            : "Đơn này đang có yêu cầu phát hành chờ xử lý.",
  };
}

// ============================================================
// LÕI TÁCH BA BƯỚC (10/10/2026, gom lô 20 tờ một lệnh — anh Trung chốt):
//   loadIssue     tải đơn + adapter + dựng dòng hàng, KHÔNG ghi gì (lỗi sớm trả kết quả ngay)
//   claimIssue    ghi dòng PENDING = VÉ của đơn (chỉ mục duy nhất chặn trùng)
//   finalizeIssue áp kết quả nhà cung cấp: cập nhật dòng + lịch sử + đơn trong MỘT giao dịch
// issueInvoiceForOrder = ba bước cho một đơn (hợp đồng cũ, không đổi hành vi).
// issueInvoicesForOrders = tải tất cả → gom theo adapter → mỗi lô: đặt vé → MỘT lệnh
// createInvoices → chốt sổ từng tờ → báo kết quả qua onResult.
// ============================================================

/** Đơn đã tải xong, chưa đặt vé — đủ dữ kiện để gọi nhà cung cấp. */
interface LoadedIssue {
  orderCode: string;
  orderId: string;
  channelId: string | null;
  provider: InvoiceProvider;
  invoiceSeries: string | null;
  lines: InvoiceLine[];
  vatTotal: number;
  totalAmount: number;
  buyer: ResolvedInvoiceBuyer;
  /** Mã số thuế người mua sai dạng: KHÔNG gọi nhà cung cấp, ghi sổ FAILED tầm ORDER. */
  buyerTaxCodeError: string | null;
}

type LoadOutcome = { kind: "done"; result: IssueOrderResult } | { kind: "ready"; issue: LoadedIssue };

type ClaimedLog = Awaited<ReturnType<typeof prisma.invoiceLog.create>>;

/**
 * @param channelWhere Phạm vi gian hàng của người gọi — route truyền
 *        channelScope(req) (đã gồm giới hạn nhân viên), worker truyền
 *        {userId: ownerId} (toàn shop).
 */
async function loadIssue(
  ownerId: string,
  channelWhere: Prisma.ChannelWhereInput,
  orderCode: string
): Promise<LoadOutcome> {
  const done = (result: IssueOrderResult): LoadOutcome => ({ kind: "done", result });
  const order = await prisma.order.findFirst({
    where: { orderCode, channel: channelWhere },
    include: {
      items: {
        include: {
          product: { select: { skuCode: true, taxName: true, vatRate: true, unitName: true } },
        },
      },
    },
  });
  if (!order) {
    return done({
      ok: false,
      httpStatus: 404,
      error: `Không tìm thấy đơn ${orderCode} trong phạm vi của bạn`,
    });
  }
  if (order.shippingStatus === ShippingStatus.CANCELLED) {
    return done({ ok: false, httpStatus: 400, error: "Đơn đã hủy — không phát hành hóa đơn" });
  }
  if (order.items.length === 0) {
    return done({ ok: false, httpStatus: 400, error: "Đơn không có dòng hàng nào để lên hóa đơn" });
  }

  // Chống phát hành trùng, lớp 1: đơn đã có hóa đơn đang chờ/đã phát hành thì
  // dừng sớm với thông điệp rõ. Lớp 2 (chốt thật) là chỉ mục duy nhất ở database,
  // bắt ở chỗ ghi dòng PENDING (claimIssue).
  const conflict = await openInvoiceConflict(ownerId, orderCode);
  if (conflict) return done(conflict);

  let provider: Awaited<ReturnType<typeof getInvoiceProvider>>;
  try {
    provider = await getInvoiceProvider(ownerId, order.channelId);
  } catch (err) {
    const blocked = secretUnreadableResult(ownerId, err);
    if (!blocked) throw err;
    return done(blocked);
  }
  if (!provider) {
    return done({
      ok: false,
      httpStatus: 400,
      error:
        "Chưa cấu hình nhà cung cấp hóa đơn (hoặc NCC chưa được hỗ trợ) — vào Kết nối & Xuất hóa đơn trước.",
    });
  }

  // THUẾ SUẤT MẶC ĐỊNH của shop (24/08 — kho vật lý chỉ quản số lượng, không
  // bắt liên kết SKU): dòng hàng có Product.vatRate > 0 dùng số khai riêng;
  // còn lại (chưa liên kết, hoặc liên kết nhưng chưa khai) dùng mức mặc định.
  const cfg = await prisma.invoiceConfig.findFirst({
    where: { ownerId, channelId: null },
    select: { defaultVatRate: true, defaultUnitName: true, invoiceSeries: true },
  });
  const defaultVatRate = cfg?.defaultVatRate ?? 0;

  // Dòng hàng: giá bán sàn = giá ĐÃ GỒM thuế → bóc ngược (buildInvoiceLines);
  // tổng hóa đơn vì thế luôn khớp đúng TIỀN HÀNG của đơn (không ship thu hộ). Voucher
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
        unitName: it.product?.unitName ?? null,
      };
    }),
    defaultVatRate,
    Number(order.sellerDiscountVoucher),
    {
      defaultUnitName: cfg?.defaultUnitName,
      salesInvoice: isSalesInvoiceSeries(cfg?.invoiceSeries),
    }
  );
  const vatTotal = lines.reduce((s, l) => s + l.vatAmount, 0);
  const totalAmount = lines.reduce((s, l) => s + l.amountWithoutVat + l.vatAmount, 0);
  const buyer = resolveInvoiceBuyer(order);
  let buyerTaxCodeError: string | null = null;
  if (buyer.buyerTaxCode) {
    const normalized = normalizeBuyerTaxCode(buyer.buyerTaxCode);
    if (normalized) buyer.buyerTaxCode = normalized;
    else {
      buyerTaxCodeError = `Mã số thuế / số định danh người mua "${buyer.buyerTaxCode}" không đúng định dạng (khách điền sai trên sàn) — liên hệ khách lấy số đúng rồi lập hóa đơn cho đơn này trực tiếp trên meInvoice.`;
    }
  }
  return {
    kind: "ready",
    issue: {
      orderCode,
      orderId: order.id,
      channelId: order.channelId,
      provider,
      invoiceSeries: cfg?.invoiceSeries ?? null,
      lines,
      vatTotal,
      totalAmount,
      buyer,
      buyerTaxCodeError,
    },
  };
}

/**
 * Dòng PENDING là VÉ của đơn này: database chỉ cho MỘT hóa đơn gốc đang chờ /
 * đã phát hành cho mỗi (shop, mã đơn) — chỉ mục InvoiceLog_open_original_key.
 * Hai luồng cùng qua được lớp kiểm ở loadIssue thì luồng ghi sau bị từ chối ở đây,
 * TRƯỚC khi gọi nhà cung cấp.
 */
async function claimIssue(
  ownerId: string,
  issue: LoadedIssue
): Promise<{ log: ClaimedLog; conflict?: undefined } | { log?: undefined; conflict: IssueOrderResult }> {
  try {
    const log = await prisma.invoiceLog.create({
      data: {
        ownerId,
        orderId: issue.orderId,
        orderCode: issue.orderCode,
        provider: issue.provider.name,
        // Mã tham chiếu gửi NCC của hóa đơn gốc luôn là mã đơn (xem createInvoice).
        providerRef: issue.orderCode,
        status: InvoiceLogStatus.PENDING,
        totalAmount: issue.totalAmount,
        vatAmount: issue.vatTotal,
        // Ký hiệu + snapshot dòng hàng LÚC PHÁT HÀNH — hóa đơn điều chỉnh sau
        // này (khách trả hàng) ghi ÂM đúng số đã xuất, không dựng lại từ đơn.
        invoiceSeries: issue.invoiceSeries,
        lines: issue.lines as unknown as Prisma.InputJsonValue,
        // Snapshot người mua — bảng kê bán ra tự đủ dữ liệu sau khi cron BVDLCN
        // xóa Order.buyerInvoiceInfo.
        buyerName: issue.buyer.buyerName,
        buyerTaxCode: issue.buyer.buyerTaxCode ?? null,
      },
    });
    return { log };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return {
      conflict: (await openInvoiceConflict(ownerId, issue.orderCode)) ?? {
        ok: false,
        httpStatus: 409,
        conflict: "PENDING",
        error: "Đơn này đang có yêu cầu phát hành chờ xử lý.",
      },
    };
  }
}

/** Dữ liệu gửi nhà cung cấp cho một đơn đã tải. */
function createInputOf(issue: LoadedIssue): CreateInvoiceInput {
  return { orderCode: issue.orderCode, ...issue.buyer, lines: issue.lines, totalAmount: issue.totalAmount };
}

/**
 * MST người mua sai dạng → KHÔNG gọi NCC (khỏi đốt số hóa đơn cho một tờ chắc
 * chắn bị từ chối) nhưng vẫn ghi sổ FAILED: seller thấy lý do ở Lịch sử, và
 * worker tự động chỉ thử lại 1 lần/ngày thay vì mỗi 15 phút.
 */
function buyerTaxCodeFailed(message: string): InvoiceResult {
  return {
    status: InvoiceLogStatus.FAILED,
    errorMessage: message,
    errorCode: "HUBSELL_BUYER_TAXCODE_INVALID",
    errorScope: "ORDER",
  };
}

/** Adapter ném thay vì trả kết quả (trái hợp đồng): coi là lỗi TẠM để vé không treo. */
function providerThrew(err: unknown): InvoiceResult {
  return {
    status: InvoiceLogStatus.FAILED,
    errorScope: "TRANSIENT",
    errorCode: "HUBSELL_PROVIDER_THREW",
    errorMessage: `Nhà cung cấp hóa đơn trả lỗi bất thường: ${(err as Error)?.message ?? String(err)}`,
  };
}

/** Áp kết quả nhà cung cấp lên vé: dòng nhật ký + lịch sử + đơn trong MỘT giao dịch. */
async function finalizeIssue(
  issue: LoadedIssue,
  log: ClaimedLog,
  result: InvoiceResult,
  pauseBeforeNextMs: number | undefined
): Promise<IssueOrderResult> {
  const { provider, orderCode } = issue;
  const now = new Date();
  const issued = result.status === InvoiceLogStatus.ISSUED;
  // TỜ NHÁP CHỜ KÝ (lát T1 tenant, 08/10/2026): nhà cung cấp đã nhận tờ nháp, chủ shop
  // ký trên web của họ. Dòng giữ PENDING làm vé của đơn, cột awaitingSignatureAt đánh
  // dấu, vòng hỏi theo giờ (invoice-cqt-follow) tra theo mã tham chiếu rồi nối số.
  // KHÔNG phải lỗi: không đếm lượt lỗi, không ngắt mạch.
  const awaiting = !issued && result.awaitingSignature === true;
  // Nhà cung cấp trả "đang chờ" KÈM mã tra cứu (tờ đã ký, số cấp trễ): vòng hỏi trạng
  // thái theo tiếp như tờ HSM cấp số trễ.
  const settling = !issued && !awaiting && result.status === InvoiceLogStatus.PENDING && !!result.transactionId;
  // CHƯA RÕ KẾT QUẢ mà nhà cung cấp tra ngược được (lát 6b): GIỮ dòng đang chờ. Dòng
  // vẫn là vé của đơn nên không ai xuất trùng được; vòng quét invoice-unknown-recheck
  // tra lại rồi nối số / trả đơn về hàng chờ. Nhà cung cấp không tra ngược được thì
  // ghi hỏng như lát 5, lời nhắn của adapter bảo chủ shop tự kiểm.
  const keepPending =
    !issued && !awaiting && !settling && result.outcomeUnknown === true && canRecheckLater(provider);
  const finalStatus = keepPending || awaiting || settling ? InvoiceLogStatus.PENDING : result.status;
  const errorMessage = keepPending ? keptPendingMessage(provider.name) : (result.errorMessage ?? null);
  const deferred = awaiting || settling;

  // LƯỢT LỖI RIÊNG ĐƠN (bước 5 lát 7): dòng FAILED ghi tầm lỗi + số lượt lỗi tầm
  // ORDER của hóa đơn gốc này tính tới giờ. Số cũ đọc từ các dòng FAILED trước của
  // cùng đơn (chỉ mục orderId, vài dòng). Lỗi tầm ACCOUNT / TRANSIENT chép lại số
  // cũ, không cộng — xem auto-issue-policy.ts. Dòng giữ "đang chờ" không đếm.
  const failedNow = finalStatus === InvoiceLogStatus.FAILED;
  const failScope: InvoiceErrorScope | undefined = failedNow ? (result.errorScope ?? "ORDER") : undefined;
  let orderErrorCount: number | undefined;
  let autoRetryJustStopped = false;
  if (failedNow) {
    const prev = await prisma.invoiceLog.aggregate({
      where: {
        orderId: issue.orderId,
        adjustmentForLogId: null,
        status: InvoiceLogStatus.FAILED,
        id: { not: log.id },
      },
      _max: { orderErrorCount: true },
    });
    const previous = prev._max.orderErrorCount;
    orderErrorCount = nextOrderErrorCount(previous, failScope);
    autoRetryJustStopped = autoRetryExhausted(orderErrorCount) && !autoRetryExhausted(previous);
  }

  const [updated] = await prisma.$transaction([
    prisma.invoiceLog.update({
      where: { id: log.id },
      data: {
        status: finalStatus,
        invoiceNo: result.invoiceNo ?? null,
        transactionId: result.transactionId ?? null,
        vatAmount: result.vatAmount ?? issue.vatTotal,
        errorMessage,
        errorScope: failScope ?? null,
        orderErrorCount: orderErrorCount ?? null,
        issuedAt: issued ? now : null,
        // Tờ nháp chờ ký: đánh dấu + hẹn vòng hỏi tờ nháp. Tờ có mã tra cứu: hẹn giờ hỏi
        // trạng thái cơ quan thuế (lát 12).
        awaitingSignatureAt: awaiting ? now : null,
        cqtNextCheckAt: awaiting
          ? new Date(now.getTime() + DRAFT_FIRST_CHECK_MS)
          : cqtNextOnWrite(finalStatus, result.transactionId, now),
      },
    }),
    prisma.invoiceStatusHistory.create({
      data: {
        invoiceLogId: log.id,
        orderCode,
        fromStatus: InvoiceLogStatus.PENDING,
        toStatus: finalStatus,
        source: "HUBSELL",
        note: issued
          ? `Phát hành qua ${provider.name}: số ${result.invoiceNo ?? "?"}, mã tra cứu ${result.transactionId ?? "?"}`
          : awaiting
            ? `Đã lập tờ nháp trên ${provider.name} theo mã tham chiếu ${orderCode}, chờ chủ shop ký trên web.`
            : settling
              ? `${provider.name} đã nhận hóa đơn (mã tra cứu ${result.transactionId}), chờ cấp số.`
              : keepPending
                ? `Chưa rõ kết quả, giữ đang chờ để tự kiểm lại theo mã tham chiếu ${orderCode}. Nhà cung cấp báo: ${result.errorMessage ?? "?"}`
                : (result.errorMessage ?? null),
      },
    }),
    prisma.order.update({
      where: { id: issue.orderId },
      data: { einvoiceStatus: finalStatus },
    }),
  ]);

  return {
    ok: issued,
    httpStatus: issued ? 201 : deferred ? 202 : 502,
    error: issued || deferred ? undefined : (errorMessage ?? "NCC từ chối phát hành"),
    errorCode: issued
      ? undefined
      : keepPending
        ? OUTCOME_UNKNOWN_CODE
        : awaiting
          ? AWAITING_SIGNATURE_CODE
          : settling
            ? NUMBER_PENDING_CODE
            : result.errorCode,
    errorScope: issued || deferred ? undefined : (result.errorScope ?? "ORDER"),
    outcomeUnknown: !issued && result.outcomeUnknown ? true : undefined,
    awaitingSignature: awaiting ? true : undefined,
    message: deferred ? (errorMessage ?? undefined) : undefined,
    pauseBeforeNextMs,
    orderErrorCount,
    autoRetryJustStopped: autoRetryJustStopped ? true : undefined,
    log: {
      ...updated,
      totalAmount: Number(updated.totalAmount),
      vatAmount: Number(updated.vatAmount),
      platformTaxWithheld: Number(updated.platformTaxWithheld),
    },
  };
}

/**
 * Phát hành cho MỘT đơn (một lệnh nhà cung cấp). Hợp đồng giữ nguyên từ 23/08.
 * @param channelWhere Phạm vi gian hàng của người gọi — route truyền
 *        channelScope(req) (đã gồm giới hạn nhân viên), worker truyền
 *        {userId: ownerId} (toàn shop).
 */
export async function issueInvoiceForOrder(
  ownerId: string,
  channelWhere: Prisma.ChannelWhereInput,
  orderCode: string
): Promise<IssueOrderResult> {
  const loaded = await loadIssue(ownerId, channelWhere, orderCode);
  if (loaded.kind === "done") return loaded.result;
  const { issue } = loaded;
  const claim = await claimIssue(ownerId, issue);
  if (claim.conflict) return claim.conflict;
  let result: InvoiceResult;
  if (issue.buyerTaxCodeError) result = buyerTaxCodeFailed(issue.buyerTaxCodeError);
  else {
    try {
      result = await issue.provider.createInvoice(createInputOf(issue));
    } catch (err) {
      result = providerThrew(err);
    }
  }
  return finalizeIssue(issue, claim.log, result, issue.buyerTaxCodeError ? undefined : publishGapOf(issue.provider));
}

export interface IssueManyOptions {
  /** Hỏi trước mỗi lệnh nhà cung cấp; true = dừng êm (các đơn chưa đặt vé để lại nguyên). */
  shouldStop?: () => boolean | Promise<boolean>;
  /** Hỏi ngay trước khi đặt vé một đơn; false = bỏ qua đơn đó (không báo onResult). */
  stillWanted?: (orderCode: string) => Promise<boolean>;
  /**
   * Nhận kết quả từng đơn (thứ tự: đơn lỗi sớm trước, rồi theo lô). Trả "STOP" để không
   * gọi nhà cung cấp thêm lệnh nào (các kết quả còn lại của CÙNG lô vẫn được báo đủ, vì
   * lô đã gửi).
   */
  onResult: (orderCode: string, r: IssueOrderResult) => Promise<"CONTINUE" | "STOP">;
}

export interface IssueManyOutcome {
  /** Số đơn đã báo qua onResult. */
  processed: number;
  /** shouldStop trả true — phần chưa đặt vé để lại cho lượt sau. */
  interrupted: boolean;
  /** onResult trả STOP. */
  stopped: boolean;
  /** Khoảng nghỉ nhà cung cấp đòi trước lệnh kế (nếu lượt này đã gọi nhà cung cấp). */
  pauseBeforeNextMs?: number;
}

/**
 * Phát hành cho NHIỀU đơn, gom theo lô của nhà cung cấp (capabilities.createBatchSize —
 * tờ nháp MISA 20 tờ một lệnh; cổng HSM 1). Thứ tự làm: tải mọi đơn (không ghi) → báo
 * ngay các đơn lỗi sớm (không thấy / đã hủy / đã có hóa đơn / chưa cấu hình) → gom đơn
 * sẵn sàng theo adapter (adapter dựng mới mỗi lần nhưng cùng cấu hình → gom theo tên +
 * gian) → mỗi lô: đặt vé từng đơn (trùng → báo 409), MỘT lệnh createInvoices, chốt sổ
 * từng tờ, báo onResult. Khoảng nghỉ publishGapMs áp GIỮA HAI LỆNH ngay tại đây; lệnh
 * cuối ghi pauseBeforeNextMs để nơi gọi nghỉ trước lệnh kế của chính nó.
 * Vé đã đặt thì luôn được gửi và chốt sổ — STOP / dừng êm chỉ có hiệu lực giữa hai lô.
 */
export async function issueInvoicesForOrders(
  ownerId: string,
  channelWhere: Prisma.ChannelWhereInput,
  orderCodes: string[],
  opts: IssueManyOptions
): Promise<IssueManyOutcome> {
  const out: IssueManyOutcome = { processed: 0, interrupted: false, stopped: false };
  const deliver = async (orderCode: string, r: IssueOrderResult): Promise<void> => {
    out.processed += 1;
    if ((await opts.onResult(orderCode, r)) === "STOP") out.stopped = true;
  };

  interface Group {
    provider: InvoiceProvider;
    issues: LoadedIssue[];
  }
  const groups = new Map<string, Group>();
  for (const orderCode of orderCodes) {
    const loaded = await loadIssue(ownerId, channelWhere, orderCode);
    if (loaded.kind === "done") {
      await deliver(orderCode, loaded.result);
      continue;
    }
    const key = `${loaded.issue.provider.name}:${loaded.issue.channelId ?? "shop"}`;
    const g = groups.get(key);
    if (g) g.issues.push(loaded.issue);
    else groups.set(key, { provider: loaded.issue.provider, issues: [loaded.issue] });
  }
  if (out.stopped) return out;

  let calledProvider = false;
  for (const group of groups.values()) {
    const { provider } = group;
    const cap = provider.capabilities.createBatchSize;
    const size = typeof provider.createInvoices === "function" && cap > 1 ? cap : 1;
    const gap = publishGapOf(provider);
    for (let at = 0; at < group.issues.length; at += size) {
      if (opts.shouldStop && (await opts.shouldStop())) {
        out.interrupted = true;
        return out;
      }
      // Đặt vé cho cả lô trước, rồi mới gọi — vé đã đặt là phải gửi.
      const chunk = group.issues.slice(at, at + size);
      const results: Array<{ orderCode: string; r: IssueOrderResult }> = [];
      const claimed: Array<{ issue: LoadedIssue; log: ClaimedLog }> = [];
      for (const issue of chunk) {
        if (opts.stillWanted && !(await opts.stillWanted(issue.orderCode))) continue;
        const claim = await claimIssue(ownerId, issue);
        if (claim.conflict) results.push({ orderCode: issue.orderCode, r: claim.conflict });
        else claimed.push({ issue, log: claim.log });
      }
      const toSend = claimed.filter((c) => !c.issue.buyerTaxCodeError);
      let provided: InvoiceResult[] = [];
      if (toSend.length > 0) {
        // Nghỉ giữa hai LỆNH theo bảng khả năng (MISA 02/10: mỗi lệnh cách 1–3 giây).
        if (calledProvider && gap) await new Promise<void>((r) => setTimeout(r, gap));
        calledProvider = true;
        const inputs = toSend.map((c) => createInputOf(c.issue));
        try {
          provided =
            size > 1 && provider.createInvoices
              ? await provider.createInvoices(inputs)
              : [await provider.createInvoice(inputs[0])];
        } catch (err) {
          provided = inputs.map(() => providerThrew(err));
        }
        if (provided.length !== inputs.length) {
          const bad = providerThrew(new Error(`adapter trả ${provided.length} kết quả cho ${inputs.length} tờ`));
          provided = inputs.map(() => ({ ...bad }));
        }
      }
      let k = 0;
      for (const c of claimed) {
        const result = c.issue.buyerTaxCodeError ? buyerTaxCodeFailed(c.issue.buyerTaxCodeError) : provided[k++];
        const r = await finalizeIssue(c.issue, c.log, result, c.issue.buyerTaxCodeError ? undefined : gap);
        results.push({ orderCode: c.issue.orderCode, r });
      }
      if (toSend.length > 0) out.pauseBeforeNextMs = gap;
      for (const { orderCode, r } of results) await deliver(orderCode, r);
      if (out.stopped) return out;
    }
  }
  return out;
}
