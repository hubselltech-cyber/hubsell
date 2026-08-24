/**
 * MISA meInvoice — PHÁT HÀNH HÓA ĐƠN ĐIỆN TỬ THÔNG THƯỜNG (luồng KÊ KHAI,
 * InvoiceType.STANDARD — tab 1 trang Kết nối & Xuất hóa đơn).
 *
 * Luồng chuẩn NĐ 123/2020 cho doanh nghiệp kê khai:
 *   1. Lấy Bearer token bằng cặp khóa meInvoice của SHOP (misa-auth.ts).
 *   2. Build payload hóa đơn: pháp nhân (MST/tên/địa chỉ) + MẪU SỐ + KÝ HIỆU
 *      đã đăng ký CQT + dòng hàng.
 *   3. KÝ SỐ từng hóa đơn: signMethod = ESIGN_CLOUD thì ký nền qua MISA eSign
 *      (misa-esign.ts) — không cần cắm USB; USB_TOKEN thì ký phía client.
 *   4. Gửi meInvoice phát hành → CHỜ CQT CẤP MÃ cho từng hóa đơn → nhận số
 *      hóa đơn + mã CQT.
 *
 * KHÁC misa-pos.ts (máy tính tiền): luồng này ký lẻ + đợi mã CQT theo từng
 * hóa đơn nên độ trễ tính bằng giây; đổi lại dùng được cho mọi loại hóa đơn
 * kê khai của doanh nghiệp.
 *
 * LƯU Ý SANDBOX: path phát hành có thể lệch giữa các bản tài liệu kit — chỉnh
 * MỘT chỗ ở ENDPOINTS dưới. Payload build "best effort" PascalCase v3; sandbox
 * chê trường nào thì sửa buildStandardInvoicePayload().
 */

import {
  getMisaAccessToken,
  misaApiBase,
  type MisaAuthCredentials,
} from "./misa-auth";
import { esignLogin } from "./misa-esign";
import { pick } from "./misa-inbot"; // helper đọc JSON PascalCase "mềm" dùng chung
import { assertPublishAllowed } from "./misa-safety";
import type { CreateInvoiceInput } from "./types";

/**
 * Path API (nối sau misaApiBase() = https://developer.misa.vn/apis/itg/meinvoice).
 * Lấy ĐÚNG từ tài liệu portal developer.misa.vn ngày 07/08/2026.
 */
const ENDPOINTS = {
  publish: "/invoice/publishing", // phát hành + xin cấp mã CQT
  templates: "/invoice/templates", // danh sách mẫu/ký hiệu đã đăng ký với CQT
  status: "/invoice/status", // tra trạng thái hóa đơn (body = mảng TransactionID)
  download: "/invoice/Download", // tải PDF/XML (body = mảng TransactionID) — chữ D hoa theo tài liệu
};

/**
 * SignType của meInvoice (tài liệu "Lưu ý khi bắt đầu"):
 *   1 = ký qua USB token / file mềm
 *   2 = ký qua HSM (ký số từ xa, có hiển thị CKS) ← MISA eSign
 *   5 = hóa đơn máy tính tiền, ký sau, không hiển thị CKS
 */
export const MISA_SIGN_TYPE = { USB_TOKEN: 1, ESIGN_CLOUD: 2, POS: 5 } as const;

/** Map signMethod của Hubsell → SignType meInvoice. */
export function misaSignType(signMethod: string): number {
  return signMethod === "ESIGN_CLOUD" ? MISA_SIGN_TYPE.ESIGN_CLOUD : MISA_SIGN_TYPE.USB_TOKEN;
}

// ============================================================
// VALIDATE THEO TT 78/2021 — nguồn regex DUY NHẤT, route + UI cùng dùng.
// ============================================================

/**
 * MST người bán: 10 số (doanh nghiệp), 12 số (hộ kinh doanh/cá nhân — VD MST
 * của HKD Hubsell 026093012010), hoặc 13 số / 10-3 số (đơn vị phụ thuộc).
 */
export const TAX_CODE_RE = /^\d{10}(-?\d{3})?$|^\d{12}$/;

/**
 * MẪU SỐ hóa đơn = KÝ TỰ ĐẦU của ký hiệu (tài liệu "Lưu ý khi bắt đầu"):
 *   1 = HĐ GTGT · 2 = HĐ bán hàng · 5 = vé điện tử · 6 = phiếu xuất kho
 */
export const INVOICE_PATTERN_RE = /^[1256]$/;

/**
 * KÝ HIỆU hóa đơn MISA — 7 KÝ TỰ, cấu trúc `XY##ZWW` (VD "1C26TAA"):
 *   X (1) : loại hóa đơn — 1/2/5/6 (khớp mẫu số)
 *   Y (2) : C = có mã CQT · K = không mã
 *   ## (3-4): 2 số cuối của năm
 *   Z (5) : T = hóa đơn thường · M = hóa đơn từ máy tính tiền
 *   WW (6-7): 2 ký tự do người bán tự đặt
 * MISA TỰ đổi số năm theo InvDate nên không cần sửa tay mỗi năm.
 */
export const INVOICE_SERIES_RE = /^[1256][CK]\d{2}T[A-Z0-9]{2}$/;

/** KÝ HIỆU hóa đơn MÁY TÍNH TIỀN: ký tự thứ 5 BẮT BUỘC là M, VD "1C26MAA". */
export const POS_SERIES_RE = /^[1256][CK]\d{2}M[A-Z0-9]{2}$/;

// ============================================================

/** Lát cắt InvoiceConfig cần cho luồng kê khai (truyền thẳng row Prisma). */
export interface StandardInvoiceConfig {
  taxCode: string | null;
  companyName: string | null;
  companyAddress: string | null;
  /**
   * Khóa tích hợp — MẶC ĐỊNH DÙNG CHUNG khóa app Hubsell từ env
   * (MISA_CLIENT_ID/SECRET); cột theo shop chỉ để override trường hợp đặc biệt.
   * Khách KHÔNG phải đăng ký gì trên developer.misa.vn.
   */
  clientId: string | null;
  secretKey: string | null;
  /**
   * TÀI KHOẢN meInvoice CỦA SHOP (multi-tenant 23/08): bộ {taxCode + username
   * + password} quyết định hóa đơn phát hành dưới pháp nhân nào — bắt buộc
   * theo shop, KHÔNG BAO GIỜ fallback env trong luồng phát hành (fallback là
   * xuất nhầm hóa đơn dưới pháp nhân khác).
   */
  meinvoiceUsername: string | null;
  meinvoicePassword: string | null;
  invoicePattern: string | null;
  invoiceSeries: string | null;
  signMethod: string;
  esignClientId: string | null;
  esignSecretKey: string | null;
  esignUsername: string | null;
  esignPassword: string | null;
  certSerial: string | null;
}

/** Những gì còn thiếu để phát hành được hóa đơn kê khai — [] = sẵn sàng. */
export function standardConfigMissing(cfg: StandardInvoiceConfig): string[] {
  const missing: string[] = [];
  if (!cfg.taxCode) missing.push("Mã số thuế (MST)");
  if (!cfg.companyName) missing.push("Tên pháp nhân");
  // Tài khoản meInvoice CỦA SHOP — bắt buộc, quyết định pháp nhân trên hóa đơn.
  if (!cfg.meinvoiceUsername || !cfg.meinvoicePassword) {
    missing.push("Tài khoản meInvoice của shop (email/SĐT + mật khẩu)");
  }
  // Client ID/Secret KHÔNG bắt buộc theo shop — mặc định dùng khóa app Hubsell
  // (env MISA_CLIENT_ID/SECRET); thiếu cả hai nơi thì getMisaAccessToken báo rõ.
  if (!cfg.invoicePattern) missing.push("Mẫu số hóa đơn (Pattern)");
  if (!cfg.invoiceSeries) missing.push("Ký hiệu hóa đơn (Serial)");
  // 23/08: KHÔNG đòi bộ khóa eSign nữa — SignType 2 (HSM) được meInvoice ký
  // nền server-side theo chứng thư gắn với tài khoản, đã xác nhận trên sandbox
  // (phát hành thành công không cần eSign). Bộ eSign chỉ dùng cho luồng ký
  // hash XML phía client (USB token/file) — nối sau nếu có shop cần.
  return missing;
}

/**
 * Bộ credentials từ cấu hình shop: khóa app fallback env (dùng chung toàn
 * Hubsell), còn bộ tài khoản {MST, username, password} lấy CHẶT từ shop —
 * chuỗi rỗng thay vì undefined để buildAuthBody KHÔNG rơi về env (env chỉ dành
 * cho script dev không truyền creds).
 */
function credsFromConfig(cfg: StandardInvoiceConfig): MisaAuthCredentials | undefined {
  const clientId = cfg.clientId ?? process.env.MISA_CLIENT_ID?.trim();
  const clientSecret = cfg.secretKey ?? process.env.MISA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined; // để getMisaAccessToken báo thiếu khóa
  return {
    clientId,
    clientSecret,
    taxCode: cfg.taxCode ?? "",
    username: cfg.meinvoiceUsername ?? "",
    password: cfg.meinvoicePassword ?? "",
  };
}

/**
 * Kiểm tra kết nối luồng kê khai: lấy token meInvoice. eSign chỉ thử đăng nhập
 * khi shop THỰC SỰ điền bộ khóa eSign (ký nền SignType 2 là HSM meInvoice ký
 * server-side, không bắt buộc eSign — xác nhận sandbox 23/08); điền dở dang
 * vẫn báo lỗi để không tưởng nhầm đã cấu hình xong.
 */
export async function testStandardConnection(cfg: StandardInvoiceConfig): Promise<{
  meinvoiceTokenLength: number;
  esignChecked: boolean;
}> {
  const token = await getMisaAccessToken(credsFromConfig(cfg));
  let esignChecked = false;
  const hasAnyEsign =
    cfg.esignClientId || cfg.esignSecretKey || cfg.esignUsername || cfg.esignPassword;
  if (cfg.signMethod === "ESIGN_CLOUD" && hasAnyEsign) {
    await esignLogin({
      clientId: cfg.esignClientId ?? undefined,
      clientKey: cfg.esignSecretKey ?? undefined,
      username: cfg.esignUsername ?? undefined,
      password: cfg.esignPassword ?? undefined,
    });
    esignChecked = true;
  }
  return { meinvoiceTokenLength: token.length, esignChecked };
}

/** Ngày phát hành theo giờ VN (UTC+7), định dạng yyyy-MM-dd MISA yêu cầu. */
function vnToday(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Payload phát hành ĐÚNG SPEC portal (API REFERENCE /invoice/publishing +
 * cURL mẫu, đọc ngày 23/08/2026):
 *
 *   { SignType, InvoiceData: [ {hóa đơn...} ] }   ← bọc mảng, tối đa 30 HĐ/request
 *
 * Mỗi hóa đơn KHÔNG mang thông tin người bán (meInvoice tự lấy theo tài khoản
 * của token); dòng hàng bắt buộc ItemType/SortOrder/LineNumber + bộ tiền OC
 * (nguyên tệ); thuế suất truyền dạng CHUỖI "10%" (VATRateName); hóa đơn GTGT
 * bắt buộc kèm khối tổng hợp TaxRateInfo gộp theo từng thuế suất.
 *
 * LƯU Ý: RefID là khóa chống trùng phía MISA — mỗi lần phát hành lại cùng đơn
 * phải là hóa đơn nghiệp vụ mới (hủy/thay thế), không phải retry mù.
 */
export function buildStandardInvoicePayload(
  input: CreateInvoiceInput,
  cfg: StandardInvoiceConfig
) {
  const details = input.lines.map((l, i) => {
    // Số tiền lấy THẲNG từ InvoiceLine (đã bóc ngược thuế từ giá bán ở
    // buildInvoiceLines — amountWithoutVat + vatAmount = đúng số khách trả);
    // KHÔNG nhân lại unitPrice × quantity kẻo lệch làm tròn.
    const amount = l.amountWithoutVat;
    return {
      ItemType: 1, // hàng hóa thường
      SortOrder: i + 1,
      LineNumber: i + 1,
      ItemCode: l.sku,
      ItemName: l.name,
      Quantity: l.quantity,
      UnitPrice: l.unitPrice, // đơn giá CHƯA thuế (chỉ để in — số pháp lý là amount/VAT)
      // Tiền VND, ExchangeRate = 1 → cột "quy đổi" (không hậu tố OC) bằng đúng
      // cột nguyên tệ. Sandbox VALIDATE đủ cả 2 bộ (Invalid_[Invoice.TotalSale
      // Amount] khi thiếu) dù cURL mẫu chỉ gửi bộ OC.
      AmountOC: amount,
      Amount: amount,
      DiscountRate: 0,
      DiscountAmountOC: 0,
      DiscountAmount: 0,
      AmountWithoutVATOC: amount,
      AmountWithoutVAT: amount,
      VATRateName: `${l.vatRate}%`,
      VATAmountOC: l.vatAmount,
      VATAmount: l.vatAmount,
    };
  });

  // Tổng hợp thuế suất — gộp các dòng cùng VATRateName (bắt buộc với HĐ GTGT).
  const byRate = new Map<string, { AmountWithoutVATOC: number; VATAmountOC: number }>();
  for (const d of details) {
    const agg = byRate.get(d.VATRateName) ?? { AmountWithoutVATOC: 0, VATAmountOC: 0 };
    agg.AmountWithoutVATOC += d.AmountWithoutVATOC;
    agg.VATAmountOC += d.VATAmountOC;
    byRate.set(d.VATRateName, agg);
  }

  const totalWithoutVat = details.reduce((s, d) => s + d.AmountWithoutVATOC, 0);
  const totalVat = details.reduce((s, d) => s + d.VATAmountOC, 0);

  // Người mua: có MST/số định danh → xuất theo đơn vị (BuyerLegalName kèm địa
  // chỉ); khách lẻ → chỉ họ tên. Địa chỉ/email khách cung cấp (từ 24/08 kéo
  // qua Shopee get_buyer_invoice_info) đính kèm khi có — BuyerEmail để
  // meInvoice gửi hóa đơn thẳng về hộp thư người mua.
  const buyer = {
    ...(input.buyerTaxCode
      ? { BuyerLegalName: input.buyerName, BuyerTaxCode: input.buyerTaxCode }
      : { BuyerFullName: input.buyerName }),
    ...(input.buyerAddress ? { BuyerAddress: input.buyerAddress } : {}),
    ...(input.buyerEmail ? { BuyerEmail: input.buyerEmail } : {}),
  };

  return {
    SignType: misaSignType(cfg.signMethod), // 2 = HSM ký nền · (1 = USB đi luồng khác)
    InvoiceData: [
      {
        RefID: input.orderCode, // khóa chống trùng + tham chiếu 2 chiều
        InvSeries: cfg.invoiceSeries,
        InvTemplateNo: cfg.invoicePattern,
        InvDate: vnToday(),
        CurrencyCode: "VND",
        ExchangeRate: 1,
        IsInvoiceSummary: false,
        PaymentMethodName: "TM/CK",
        ...buyer,
        TotalSaleAmountOC: totalWithoutVat,
        TotalSaleAmount: totalWithoutVat,
        TotalDiscountAmountOC: 0,
        TotalDiscountAmount: 0,
        TotalAmountWithoutVATOC: totalWithoutVat,
        TotalAmountWithoutVAT: totalWithoutVat,
        TotalVATAmountOC: totalVat,
        TotalVATAmount: totalVat,
        TotalAmountOC: totalWithoutVat + totalVat,
        TotalAmount: totalWithoutVat + totalVat,
        OriginalInvoiceDetail: details,
        TaxRateInfo: [...byRate.entries()].map(([rate, agg]) => ({
          VATRateName: rate,
          ...agg,
        })),
      },
    ],
  };
}

export interface StandardPublishResult {
  /** Số hóa đơn + mã CQT khi phát hành xong (sandbox có thể trả trễ qua webhook). */
  invoiceNo: string | null;
  transactionId: string | null;
  /** Response nguyên văn của MISA — giai đoạn sandbox luôn giữ lại để dò map. */
  raw: unknown;
}

/**
 * Phát hành một hóa đơn KÊ KHAI (SignType 2 — HSM, meInvoice ký nền server-side
 * theo chứng thư gắn với tài khoản; đã xác nhận trên sandbox 23/08, KHÔNG cần
 * gọi eSign ở bước này).
 */
export async function publishStandardInvoice(
  input: CreateInvoiceInput,
  cfg: StandardInvoiceConfig
): Promise<StandardPublishResult> {
  // Hàng rào ĐẦU TIÊN — chặn trước cả khi kiểm cấu hình, để không có đường
  // nào chạm tới API phát hành khi chưa được phép (xem misa-safety.ts).
  assertPublishAllowed("hóa đơn kê khai");

  const missing = standardConfigMissing(cfg);
  if (missing.length > 0) {
    throw new Error(`Chưa đủ cấu hình phát hành kê khai — thiếu: ${missing.join(", ")}`);
  }

  // Bộ khóa ĐÃ HÒA GIẢI (cột shop ?? khóa app env) — header ClientID phải dùng
  // đúng bộ này, lấy thẳng cfg.clientId sẽ rỗng với shop dùng khóa app chung.
  const creds = credsFromConfig(cfg);
  const token = await getMisaAccessToken(creds);
  const url = `${misaApiBase()}${ENDPOINTS.publish}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ClientID: creds?.clientId ?? "",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(buildStandardInvoicePayload(input, cfg)),
    });
  } catch (err) {
    throw new Error(`Không gọi được ${url}: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`meInvoice từ chối phát hành (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  if (pick(raw, "Success", "success") === false) {
    const code = pick(raw, "ErrorCode", "errorCode") ?? "?";
    throw new Error(`meInvoice từ chối phát hành: ErrorCode=${String(code)}`);
  }

  // Kết quả nằm ở publishInvoiceResult[] — MỖI hóa đơn một phần tử, thành công
  // khi ErrorCode của phần tử = null. GOTCHA sandbox: các khối dữ liệu lồng
  // (Data của /templates, publishInvoiceResult ở đây) có thể là JSON STRING
  // lồng trong JSON — phải parse thêm một lần.
  let results = pick(raw, "PublishInvoiceResult", "publishInvoiceResult");
  if (typeof results === "string") {
    try {
      results = JSON.parse(results);
    } catch {
      /* giữ nguyên — rơi xuống nhánh đọc mềm bên dưới */
    }
  }
  const first = Array.isArray(results) ? results[0] : results;
  const perInvoiceError = pick(first, "ErrorCode", "errorCode");
  if (perInvoiceError != null && perInvoiceError !== "") {
    throw new Error(
      `meInvoice từ chối phát hành hóa đơn (publishInvoiceResult): ErrorCode=${String(perInvoiceError)}`
    );
  }
  const invoiceNo = pick(first, "InvNo", "InvoiceNo", "InvoiceNumber");
  const transactionId = pick(first, "TransactionID", "TransactionId", "RefID");
  return {
    invoiceNo: invoiceNo != null ? String(invoiceNo) : null,
    transactionId: typeof transactionId === "string" ? transactionId : null,
    raw,
  };
}

// ============================================================
// TRA CỨU & TẢI HÓA ĐƠN (spec portal đọc 23/08/2026)
// ============================================================

/** Gỡ lớp "JSON string lồng trong JSON" mà meInvoice hay trả ở khối dữ liệu. */
function unwrapNestedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * POST authorized tới meInvoice, trả JSON đã bóc envelope thô. Ném lỗi khi
 * HTTP fail hoặc Success=false — thông điệp tiếng Việt cho nơi gọi hiển thị.
 */
async function misaPost(
  path: string,
  query: Record<string, string>,
  body: unknown,
  cfg?: StandardInvoiceConfig
): Promise<unknown> {
  const creds = cfg ? credsFromConfig(cfg) : undefined;
  const token = await getMisaAccessToken(creds);
  const clientId = creds?.clientId ?? process.env.MISA_CLIENT_ID ?? "";
  const qs = new URLSearchParams(query).toString();
  const url = `${misaApiBase()}${path}${qs ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ClientID: clientId,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Không gọi được ${url}: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`meInvoice trả HTTP ${res.status} cho ${path}: ${text.slice(0, 300)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  if (pick(raw, "Success", "success") === false) {
    const code = pick(raw, "ErrorCode", "errorCode") ?? "?";
    throw new Error(`meInvoice từ chối ${path}: ErrorCode=${String(code)}`);
  }
  return raw;
}

/** Một mẫu/ký hiệu hóa đơn shop đã đăng ký với CQT (từ /invoice/templates). */
export interface MisaTemplateItem {
  invSeries: string;
  invTemplateNo: string;
  templateName: string;
}

/**
 * Kéo danh sách ký hiệu hóa đơn đã đăng ký CQT của tài khoản meInvoice — nuôi
 * dropdown "chọn ký hiệu" trên UI (seller không phải gõ tay chuỗi TT78).
 * Lọc bỏ mẫu Inactive. GOTCHA: Data là JSON string lồng trong JSON.
 */
export async function listInvoiceTemplates(
  cfg?: StandardInvoiceConfig
): Promise<MisaTemplateItem[]> {
  const creds = cfg ? credsFromConfig(cfg) : undefined;
  const token = await getMisaAccessToken(creds);
  const clientId = creds?.clientId ?? process.env.MISA_CLIENT_ID ?? "";
  const url = `${misaApiBase()}${ENDPOINTS.templates}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ClientID: clientId,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    throw new Error(`Không gọi được ${url}: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`meInvoice trả HTTP ${res.status} khi lấy mẫu hóa đơn: ${text.slice(0, 300)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  if (pick(raw, "Success", "success") === false) {
    const code = pick(raw, "ErrorCode", "errorCode") ?? "?";
    throw new Error(`meInvoice từ chối trả mẫu hóa đơn: ErrorCode=${String(code)}`);
  }
  const data = unwrapNestedJson(pick(raw, "Data", "data"));
  const list = Array.isArray(data) ? data : [];
  return list
    .filter((t) => pick(t, "Inactive", "inactive") !== true)
    .map((t) => ({
      invSeries: String(pick(t, "InvSeries", "invSeries") ?? ""),
      invTemplateNo: String(pick(t, "InvTemplateNo", "invTemplateNo") ?? ""),
      templateName: String(pick(t, "TemplateName", "templateName") ?? ""),
    }))
    .filter((t) => t.invSeries !== "");
}

/** Trạng thái một hóa đơn từ /invoice/status — các trường đã đọc "mềm". */
export interface MisaInvoiceStatusItem {
  transactionId: string | null;
  /** 1 = đã phát hành (tài liệu InvoiceStatus.PublishStatus). */
  publishStatus: number | null;
  /**
   * Trạng thái gửi CQT — nghĩa KHÁC NHAU theo loại ký hiệu:
   * không mã: 0 chưa gửi · 1 đã gửi · 2 CQT tiếp nhận · 3 không tiếp nhận · 4 lỗi;
   * có mã   : 0 chờ cấp mã · 1 gửi lỗi · 2 đã cấp mã · 3 từ chối.
   */
  sendTaxStatus: number | null;
  /** Hóa đơn đã bị xóa bỏ/hủy trên meInvoice. */
  isDeleted: boolean;
  raw: unknown;
}

/**
 * Tra trạng thái theo danh sách TransactionID (mã tra cứu meInvoice trả khi
 * phát hành). Body là MẢNG TRẦN các mã — không bọc object (spec 23/08).
 */
export async function getInvoiceStatuses(
  transactionIds: string[],
  cfg?: StandardInvoiceConfig
): Promise<MisaInvoiceStatusItem[]> {
  // Ký hiệu ký tự 2 = C → hóa đơn CÓ MÃ CQT (đổi cách đọc SendTaxStatus).
  const withCode = cfg?.invoiceSeries?.charAt(1) === "C";
  const raw = await misaPost(
    ENDPOINTS.status,
    { inputType: "1", invoiceWithCode: String(withCode), invoiceCalcu: "false" },
    transactionIds,
    cfg
  );
  const data = unwrapNestedJson(pick(raw, "Data", "data"));
  const list = Array.isArray(data) ? data : data != null ? [data] : [];
  return list.map((item) => {
    const publishStatus = pick(item, "PublishStatus", "publishStatus");
    const sendTaxStatus = pick(item, "SendTaxStatus", "sendTaxStatus");
    const transactionId = pick(item, "TransactionID", "TransactionId");
    return {
      transactionId: typeof transactionId === "string" ? transactionId : null,
      publishStatus: typeof publishStatus === "number" ? publishStatus : null,
      sendTaxStatus: typeof sendTaxStatus === "number" ? sendTaxStatus : null,
      isDeleted: pick(item, "IsDelete", "isDelete", "IsDeleted") === true,
      raw: item,
    };
  });
}

/** Một file hóa đơn từ /invoice/Download. */
export interface MisaInvoiceFile {
  transactionId: string | null;
  /** PDF: chuỗi base64 · XML: nội dung XML thô. */
  data: string | null;
  errorCode: string | null;
}

/**
 * Tải file hóa đơn ĐÃ PHÁT HÀNH theo TransactionID. PDF từ HSM đã bao gồm
 * chữ ký số — dùng làm bản thể hiện gửi khách.
 */
export async function downloadInvoiceFiles(
  transactionIds: string[],
  dataType: "Pdf" | "Xml",
  cfg?: StandardInvoiceConfig
): Promise<MisaInvoiceFile[]> {
  const withCode = cfg?.invoiceSeries?.charAt(1) === "C";
  const raw = await misaPost(
    ENDPOINTS.download,
    {
      downloadDataType: dataType,
      invoiceWithCode: String(withCode),
      invoiceCalcu: "false",
    },
    transactionIds,
    cfg
  );
  const data = unwrapNestedJson(pick(raw, "Data", "data"));
  const list = Array.isArray(data) ? data : data != null ? [data] : [];
  return list.map((item) => {
    const transactionId = pick(item, "TransactionID", "TransactionId");
    const fileData = pick(item, "data", "Data", "FileData");
    const errorCode = pick(item, "ErrorCode", "errorCode");
    return {
      transactionId: typeof transactionId === "string" ? transactionId : null,
      data: typeof fileData === "string" ? fileData : null,
      errorCode:
        errorCode != null && errorCode !== "" ? String(errorCode) : null,
    };
  });
}
