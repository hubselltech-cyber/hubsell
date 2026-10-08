/**
 * MISA meInvoice — NHÓM "API WEB APP (HÓA ĐƠN NHÁP)" (tài liệu developer.misa.vn
 * → Open API → Hóa đơn điện tử → API REFERENCE → API WEB APP, đọc 07–08/10/2026;
 * thử trọn vòng đời trên sandbox 07/10 — docs/HOA-DON-HQ-KY-NEN-KHAO-SAT-07-10.md mục 12).
 *
 * VÌ SAO CÓ FILE NÀY: cổng phát hành /invoice/publishing chỉ ký nền được bằng
 * HSM (SignType 2); MISA eSign và USB token chỉ ký được TRÊN WEB meinvoice.vn.
 * Nhóm API này cho phần mềm bên ngoài (BigSeller, KiotViet… và nay Hubsell) đẩy
 * TỜ NHÁP đầy đủ dữ liệu lên web app meInvoice; chủ shop vào Hóa đơn → Chưa phát
 * hành → chọn lô → "Ký & phát hành" (eSign xác nhận trên điện thoại / USB cắm
 * máy) — một lần bấm cho tới 50 tờ. Sau khi ký, tờ mang số + TransactionID như
 * mọi hóa đơn khác → bước lấy số / tải PDF / gửi mail dùng lại cổng cũ.
 *
 * KHÁC cổng phát hành (misa-einvoice.ts):
 *   · Token RIÊNG: POST /invoiceweb/token (header ClientID+ClientSecret, body
 *     {taxcode, username, password}); Data là JSON STRING {access_token,
 *     expires_in, CompanyID…} — dùng nguyên chuỗi Data làm Bearer là 401.
 *   · Mọi lệnh sau kèm header TaxCode + query invoiceWithCode (true = ký hiệu
 *     có mã CQT, ký tự thứ 2 của ký hiệu là C).
 *   · Payload kiểu web: AccountObjectName/TaxCode/Address, ContactName,
 *     ReceiverEmail, InvoiceDetails[].Description, VATRate số nguyên
 *     (-1 KCT · -3 KKKNT · 0/5/8/10 · null = app tự tính), cần InvoiceTemplateID
 *     lấy từ /invoiceweb/templates, CreatedDate/ModifiedDate bắt buộc.
 *   · RefID kiểu GUID — Hubsell suy ra UUID v5 từ mã tham chiếu của mình
 *     (webRefIdFor) nên gọi lại bao nhiêu lần cũng ra cùng một RefID; MISA chặn
 *     trùng theo RefID ở phía họ.
 *
 * CHỈ ĐỌC vs SINH CHỨNG TỪ: insert tạo tờ nháp (chưa có số, chưa gửi CQT, xóa
 * được) nhưng nó nằm trên tài khoản THẬT và chủ shop có thể ký ngay — nên vẫn đi
 * qua chốt MISA_ALLOW_PUBLISH như lệnh phát hành.
 */

import { createHash } from "node:crypto";

import { InvoiceProviderError, providerErrorFromBody } from "./invoice-errors";
import { pick } from "./misa-inbot";
import { misaApiBase } from "./misa-auth";
import {
  isSalesInvoiceSeries,
  type StandardInvoiceConfig,
  standardConfigMissing,
} from "./misa-einvoice";
import { assertPublishAllowed } from "./misa-safety";
import { isProviderTimeout, providerFetch, readProviderBody } from "./provider-http";
import type { CreateInvoiceInput } from "./types";

const ENDPOINTS = {
  token: "/invoiceweb/token",
  templates: "/invoiceweb/templates",
  insert: "/invoiceweb/insert",
  getlist: "/invoiceweb/getlist",
  delete: "/invoiceweb/delete",
};

/** Tối đa tờ nháp một lệnh insert (tài liệu khuyến nghị) / RefID một lệnh getlist. */
export const WEB_INSERT_BATCH_MAX = 30;
export const WEB_GETLIST_BATCH_MAX = 50;

/** Trang web nơi chủ shop ký tờ nháp — dùng trong lời nhắn / thư nhắc. */
export const MEINVOICE_WEB_INVOICES_URL = "https://app3.meinvoice.vn/v3/hoa-don";

/**
 * Phương thức ký nào đi đường TỜ NHÁP (chủ shop ký trên web): MISA eSign (ESIGN_CLOUD)
 * và USB token — cổng phát hành không ký nền được với hai loại này (MISA ticket
 * 08/10/2026: SignType 2 chỉ HSM / "eSign nâng cao"). HSM giữ cổng phát hành.
 * Dùng chung cho HQ (hq-auto-invoice) và tenant (misa-provider).
 */
export function usesWebDraft(signMethod: string): boolean {
  return signMethod === "ESIGN_CLOUD" || signMethod === "USB_TOKEN";
}

// ============================================================
// RefID dạng GUID, suy ra ỔN ĐỊNH từ mã tham chiếu Hubsell
// ============================================================

/** Namespace UUID v5 riêng của Hubsell cho RefID tờ nháp meInvoice (cố định, đừng đổi). */
const HUBSELL_WEB_REFID_NAMESPACE = "6f1c2a3e-8b7d-4e5f-9a0b-1c2d3e4f5a6b";

/**
 * UUID v5 (SHA-1, RFC 4122) của `reference` trong namespace Hubsell. Cùng mã →
 * cùng RefID ở mọi lượt gọi, nên lượt làm lại không sinh tờ nháp thứ hai và tra
 * ngược theo RefID không cần lưu thêm cột.
 */
export function webRefIdFor(reference: string): string {
  const ns = Buffer.from(HUBSELL_WEB_REFID_NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(reference, "utf8").digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ============================================================
// Token web app (cache theo bộ định danh như misa-auth.ts)
// ============================================================

const TOKEN_SAFETY_MS = 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

interface WebCreds {
  clientId: string;
  clientSecret: string;
  taxCode: string;
  username: string;
  password: string;
}

function webCreds(cfg: StandardInvoiceConfig): WebCreds {
  const clientId = cfg.clientId ?? process.env.MISA_CLIENT_ID?.trim();
  const clientSecret = cfg.secretKey ?? process.env.MISA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Chưa cấu hình MISA_CLIENT_ID / MISA_CLIENT_SECRET (khóa app Hubsell trên developer.misa.vn)."
    );
  }
  return {
    clientId,
    clientSecret,
    taxCode: cfg.taxCode ?? "",
    username: cfg.meinvoiceUsername ?? "",
    password: cfg.meinvoicePassword ?? "",
  };
}

/** Ký hiệu có mã CQT (ký tự 2 = C) → invoiceWithCode=true. */
export function webInvoiceWithCode(cfg: Pick<StandardInvoiceConfig, "invoiceSeries">): boolean {
  return cfg.invoiceSeries?.charAt(1) === "C";
}

function parseJsonSoft(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Gỡ lớp "JSON string lồng trong JSON" ở khối Data của meInvoice. */
function unwrapData(raw: unknown): unknown {
  const data = pick(raw, "Data", "data");
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * Lấy access token của web app meInvoice (có cache). Lỗi đăng nhập ra
 * InvoiceProviderError để explainInvoiceError dịch được như cổng phát hành.
 */
export async function getWebAccessToken(cfg: StandardInvoiceConfig): Promise<string> {
  const creds = webCreds(cfg);
  const key = [creds.clientId, creds.taxCode, creds.username].join("|");
  const hit = tokenCache.get(key);
  if (hit && Date.now() < hit.expiresAt - TOKEN_SAFETY_MS) return hit.token;

  const url = `${misaApiBase()}${ENDPOINTS.token}`;
  let res: Response;
  try {
    res = await providerFetch("MISA", "webtoken", url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ClientID: creds.clientId,
        ClientSecret: creds.clientSecret,
      },
      body: JSON.stringify({
        taxcode: creds.taxCode,
        username: creds.username,
        password: creds.password,
      }),
    });
  } catch (err) {
    throw new InvoiceProviderError(`Không gọi được ${url}: ${(err as Error).message}`, {
      network: true,
      timedOut: isProviderTimeout(err),
    });
  }
  let text: string;
  try {
    text = await readProviderBody(res);
  } catch (err) {
    throw new InvoiceProviderError(`Không đọc được câu trả lời của ${url}: ${(err as Error).message}`, {
      network: true,
      timedOut: isProviderTimeout(err),
    });
  }
  if (!res.ok) throw providerErrorFromBody("meInvoice web từ chối cấp token", text, res.status);
  const raw = parseJsonSoft(text);
  if (pick(raw, "Success", "success") === false) {
    throw providerErrorFromBody("meInvoice web từ chối cấp token", text);
  }
  const data = unwrapData(raw);
  const token =
    typeof data === "string" ? data : (pick(data, "access_token", "token") as string | undefined);
  if (!token || typeof token !== "string") {
    throw new Error(`meInvoice web trả 200 nhưng không thấy access_token: ${text.slice(0, 300)}`);
  }
  const expiresIn = pick(data, "expires_in");
  const ttlMs = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn * 1000 : DEFAULT_TOKEN_TTL_MS;
  tokenCache.set(key, { token, expiresAt: Date.now() + ttlMs });
  return token;
}

/** Cho test/CLI: quên token để lượt sau đăng nhập lại. */
export function clearWebTokenCache(): void {
  tokenCache.clear();
  templateCache.clear();
}

/** POST có Bearer tới nhóm invoiceweb; trả JSON thô đã kiểm Success. */
async function webPost(
  path: string,
  query: Record<string, string>,
  body: unknown,
  cfg: StandardInvoiceConfig,
  opts: { method?: "POST" | "DELETE"; publishSent?: boolean } = {}
): Promise<unknown> {
  const creds = webCreds(cfg);
  const token = await getWebAccessToken(cfg);
  const qs = new URLSearchParams(query).toString();
  const url = `${misaApiBase()}${path}${qs ? `?${qs}` : ""}`;
  const operation = `web${(path.split("/").pop() ?? path).toLowerCase()}`;
  let res: Response;
  try {
    res = await providerFetch("MISA", operation, url, {
      method: opts.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ClientID: creds.clientId,
        Authorization: `Bearer ${token}`,
        TaxCode: creds.taxCode,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    throw new InvoiceProviderError(`Không gọi được ${url}: ${(err as Error).message}`, {
      network: true,
      publishSent: opts.publishSent,
      timedOut: isProviderTimeout(err),
    });
  }
  let text: string;
  try {
    text = await readProviderBody(res);
  } catch (err) {
    throw new InvoiceProviderError(`Không đọc được câu trả lời của ${url}: ${(err as Error).message}`, {
      network: true,
      httpStatus: res.status,
      publishSent: opts.publishSent,
      timedOut: isProviderTimeout(err),
    });
  }
  if (!res.ok) {
    throw providerErrorFromBody(`meInvoice web từ chối ${path}`, text, res.status, {
      publishSent: opts.publishSent,
    });
  }
  const raw = parseJsonSoft(text);
  if (pick(raw, "Success", "success") === false) {
    throw providerErrorFromBody(`meInvoice web từ chối ${path}`, text, undefined, {
      publishSent: opts.publishSent,
    });
  }
  return raw;
}

// ============================================================
// Mẫu hóa đơn trên web app (cần IPTemplateID cho insert)
// ============================================================

export interface MisaWebTemplate {
  templateId: string;
  invSeries: string;
  invTemplateNo: string;
  templateName: string;
  inactive: boolean;
}

const TEMPLATE_TTL_MS = 60 * 60 * 1000;
const templateCache = new Map<string, { list: MisaWebTemplate[]; expiresAt: number }>();

/**
 * Danh sách mẫu/ký hiệu của tài khoản trên web app. Lệnh này KHÔNG dùng Bearer:
 * gửi thẳng {TypeInvoice, TaxCode, UserName, Password} + header ClientID (tài liệu
 * + thử sandbox 07/10). TypeInvoice 0 = hóa đơn (sandbox trả cả 1K và 2K).
 */
export async function listWebTemplates(
  cfg: StandardInvoiceConfig,
  withCode = webInvoiceWithCode(cfg)
): Promise<MisaWebTemplate[]> {
  const creds = webCreds(cfg);
  const key = [creds.taxCode, creds.username, String(withCode)].join("|");
  const hit = templateCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.list;

  const url = `${misaApiBase()}${ENDPOINTS.templates}?invoiceWithCode=${String(withCode)}`;
  let res: Response;
  try {
    res = await providerFetch("MISA", "webtemplates", url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ClientID: creds.clientId },
      body: JSON.stringify({
        TypeInvoice: 0,
        TaxCode: creds.taxCode,
        UserName: creds.username,
        Password: creds.password,
      }),
    });
  } catch (err) {
    throw new InvoiceProviderError(`Không gọi được ${url}: ${(err as Error).message}`, {
      network: true,
      timedOut: isProviderTimeout(err),
    });
  }
  let text: string;
  try {
    text = await readProviderBody(res);
  } catch (err) {
    throw new InvoiceProviderError(`Không đọc được câu trả lời của ${url}: ${(err as Error).message}`, {
      network: true,
      timedOut: isProviderTimeout(err),
    });
  }
  if (!res.ok) throw providerErrorFromBody("meInvoice web không trả được mẫu hóa đơn", text, res.status);
  const raw = parseJsonSoft(text);
  if (pick(raw, "Success", "success") === false) {
    throw providerErrorFromBody("meInvoice web không trả được mẫu hóa đơn", text);
  }
  const data = unwrapData(raw);
  const list = (Array.isArray(data) ? data : []).map((t) => ({
    templateId: String(pick(t, "IPTemplateID", "ipTemplateID") ?? ""),
    invSeries: String(pick(t, "InvSeries", "invSeries") ?? ""),
    invTemplateNo: String(pick(t, "InvTemplateNo", "invTemplateNo") ?? ""),
    templateName: String(pick(t, "TemplateName", "templateName") ?? ""),
    inactive: pick(t, "Inactive", "inactive") === true,
  }));
  templateCache.set(key, { list, expiresAt: Date.now() + TEMPLATE_TTL_MS });
  return list;
}

/** Mẫu đang hoạt động khớp ký hiệu cấu hình — không có là lỗi cấu hình, nói rõ. */
export async function findWebTemplate(cfg: StandardInvoiceConfig): Promise<MisaWebTemplate> {
  const series = (cfg.invoiceSeries ?? "").trim().toUpperCase();
  const list = await listWebTemplates(cfg);
  const tpl = list.find((t) => t.invSeries.toUpperCase() === series && !t.inactive);
  if (!tpl) {
    const have = list.filter((t) => !t.inactive).map((t) => t.invSeries);
    templateCache.clear(); // lượt sau hỏi lại — có thể vừa đăng ký mẫu mới
    throw new Error(
      `meInvoice web không có mẫu đang hoạt động cho ký hiệu ${series || "(trống)"}` +
        (have.length ? ` — tài khoản này có: ${have.join(", ")}` : " — tài khoản này chưa có mẫu nào") +
        ". Kiểm lại ký hiệu trong cấu hình hoặc đăng ký mẫu trên meinvoice.vn."
    );
  }
  return tpl;
}

// ============================================================
// Payload tờ nháp (kiểu web app)
// ============================================================

/** Thời điểm hiện tại theo giờ VN, dạng "yyyy-MM-ddTHH:mm:ss+07:00" tài liệu dùng. */
function vnNowIso(d = new Date()): string {
  const t = new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 19);
  return `${t}+07:00`;
}
function vnTodayIso(d = new Date()): string {
  return `${vnNowIso(d).slice(0, 10)}T00:00:00+07:00`;
}

/**
 * VATRate của web app từ vatRate số của InvoiceLine: -1 KCT giữ nguyên; -2 (quy
 * ước KKKNT của Hubsell, xem misaVatRateName) → -3 của web; 0/5/8/10 giữ nguyên.
 */
export function webVatRate(vatRate: number): number {
  return vatRate === -2 ? -3 : vatRate;
}

/** ĐVT bắt buộc trên web app: dòng → mặc định shop → "Cái" (có ghi chú để shop sửa trên web trước khi ký). */
function webUnitName(line: string | undefined, fallback: string | null | undefined): string {
  return line?.trim() || fallback?.trim() || "Cái";
}

/**
 * Dựng MỘT phần tử của mảng gửi /invoiceweb/insert từ CreateInvoiceInput (số tiền
 * lấy THẲNG từ InvoiceLine đã bóc ngược, như buildStandardInvoicePayload).
 * Hàm thuần để test. `now` tiêm được để test ổn định.
 */
export function buildWebDraftPayload(
  input: CreateInvoiceInput,
  cfg: StandardInvoiceConfig,
  template: Pick<MisaWebTemplate, "templateId" | "invSeries">,
  now = new Date()
) {
  const salesInvoice = isSalesInvoiceSeries(template.invSeries);
  const details = input.lines.map((l, i) => {
    const amount = l.amountWithoutVat;
    const vat = {
      // Hóa đơn BÁN HÀNG (ký hiệu đầu 2) không có dòng thuế: không gửi VATRate,
      // tiền thuế 0. Hóa đơn GTGT gửi thuế suất số nguyên của web app.
      ...(salesInvoice ? {} : { VATRate: webVatRate(l.vatRate) }),
      VATAmountOC: salesInvoice ? 0 : l.vatAmount,
      VATAmount: salesInvoice ? 0 : l.vatAmount,
    };
    return {
      // 0 = hàng hóa/dịch vụ · 2 = khuyến mại (quà tặng 0đ); tờ điều chỉnh giữ 0 cho mọi dòng.
      InventoryItemType: l.promotion && !input.adjustment ? 2 : 0,
      SortOrder: i + 1,
      SortOrderView: i + 1,
      ItemCode: l.sku,
      Description: l.name,
      UnitName: webUnitName(l.unitName, cfg.defaultUnitName),
      Quantity: l.quantity,
      UnitPrice: l.unitPrice,
      AmountOC: amount,
      Amount: amount,
      DiscountRate: 0,
      DiscountAmountOC: 0,
      DiscountAmount: 0,
      ...vat,
    };
  });
  const totalSale = details
    .filter((d) => d.InventoryItemType === 0)
    .reduce((s, d) => s + d.AmountOC, 0);
  const totalVat = details.reduce((s, d) => s + d.VATAmountOC, 0);

  // Người mua: có MST → tờ theo ĐƠN VỊ (AccountObjectName + MST + địa chỉ, người
  // đặt hàng ở ContactName); khách lẻ → ContactName. Email để meInvoice gửi tờ.
  const buyer: { AccountObjectName?: string; AccountObjectTaxCode?: string; ContactName?: string } = input.buyerTaxCode
    ? {
        AccountObjectName: input.buyerName,
        AccountObjectTaxCode: input.buyerTaxCode,
        ...(input.buyerContactName ? { ContactName: input.buyerContactName } : {}),
      }
    : { ContactName: input.buyerName };

  const adj = input.adjustment;
  const adjustment: {
    EInvoiceStatus: number;
    OrgInvNo?: string;
    OrgInvTemplateNo?: string;
    OrgInvSeries?: string;
    OrgInvDate?: string;
    ChangeReason?: string;
  } = adj
    ? {
        EInvoiceStatus: 4, // 1 gốc · 3 thay thế · 4 điều chỉnh
        OrgInvNo: adj.orgInvNo,
        OrgInvTemplateNo: adj.orgInvSeries.charAt(0),
        OrgInvSeries: adj.orgInvSeries.slice(1),
        OrgInvDate: `${adj.orgInvDate}T00:00:00+07:00`,
        ChangeReason: adj.reason,
      }
    : { EInvoiceStatus: 1 };

  const stamp = vnNowIso(now);
  return {
    RefID: webRefIdFor(input.orderCode),
    InvoiceTemplateID: template.templateId,
    InvSeries: template.invSeries,
    InvDate: vnTodayIso(now),
    ...buyer,
    AccountObjectAddress: input.buyerAddress || undefined,
    // Số định danh cá nhân (NĐ 254/2026): khách lẻ cung cấp thì phải ghi.
    CitizenIDNumber: input.buyerIdNumber || undefined,
    // KHÔNG gửi ReceiverEmail (anh Trung 07/10 đêm, sau tờ thật 00000001): có email
    // thì hộp Phát hành của meInvoice tự tích "Gửi hóa đơn cho khách hàng" → khách
    // nhận hai thư (MISA không kèm PDF + Hubsell kèm PDF). Hubsell là bên gửi duy
    // nhất (hq-auto-invoice bước 3 / tenant); email khách vẫn lưu ở Hubsell.
    ReceiverMobile: input.buyerPhone || undefined,
    PaymentMethod: "TM/CK",
    CurrencyCode: "VND",
    ExchangeRate: 1,
    DiscountRate: 0,
    TotalSaleAmountOC: totalSale,
    TotalSaleAmount: totalSale,
    TotalDiscountAmountOC: 0,
    TotalDiscountAmount: 0,
    TotalVATAmountOC: totalVat,
    TotalVATAmount: totalVat,
    TotalAmountOC: totalSale + totalVat,
    TotalAmount: totalSale + totalVat,
    CreatedDate: stamp,
    ModifiedDate: stamp,
    ...adjustment,
    InvoiceDetails: details,
    // Mã tham chiếu Hubsell cho người đọc trên web (RefID là GUID, không đọc được).
    CustomField1: input.orderCode,
    CustomField2: "Hubsell",
  };
}

// ============================================================
// Đẩy nháp · tra theo RefID · xóa nháp
// ============================================================

export interface WebDraftResult {
  refId: string;
  invSeries: string;
  raw: unknown;
}

/**
 * Đẩy MỘT tờ nháp lên web app meInvoice. Lượt gọi lại cùng mã tham chiếu → cùng
 * RefID → MISA báo trùng (không ra tờ thứ hai); người gọi nên tra getWebInvoices
 * trước để khỏi ăn lỗi trùng.
 */
export async function insertWebDraft(
  input: CreateInvoiceInput,
  cfg: StandardInvoiceConfig
): Promise<WebDraftResult> {
  assertPublishAllowed("tờ nháp hóa đơn lên meinvoice.vn");
  const missing = standardConfigMissing(cfg);
  if (missing.length > 0) {
    throw new Error(`Chưa đủ cấu hình meInvoice — thiếu: ${missing.join(", ")}`);
  }
  const template = await findWebTemplate(cfg);
  const payload = buildWebDraftPayload(input, cfg, template);
  const raw = await webPost(
    ENDPOINTS.insert,
    { invoiceWithCode: String(webInvoiceWithCode(cfg)) },
    [payload],
    cfg,
    { publishSent: true }
  );
  // Data = [{RefID, InvSeries, InvDate, EInvoiceStatus}] khi nhận; lỗi từng tờ (nếu
  // MISA trả) nằm ở ErrorCode của phần tử.
  const data = unwrapData(raw);
  const first = Array.isArray(data) ? data[0] : data;
  const perItemError = pick(first, "ErrorCode", "errorCode");
  if (perItemError != null && perItemError !== "") {
    const desc = pick(first, "DescriptionErrorCode", "descriptionErrorCode");
    throw new InvoiceProviderError(
      `meInvoice web từ chối tờ nháp: ErrorCode=${String(perItemError)}`,
      { code: String(perItemError), description: typeof desc === "string" ? desc : null, publishSent: true }
    );
  }
  return { refId: payload.RefID, invSeries: template.invSeries, raw };
}

/** Một tờ trên web app đọc "mềm" từ /invoiceweb/getlist. */
export interface MisaWebInvoiceItem {
  refId: string;
  /** Số hóa đơn — null khi chưa cấp ("<Chưa cấp số>"). */
  invoiceNo: string | null;
  /** Mã tra cứu — chỉ có sau khi tờ được ký/phát hành trên web. */
  transactionId: string | null;
  /** 0 = chưa phát hành (nháp) · 1 = đã phát hành. */
  publishStatus: number | null;
  /** 1 gốc · 3 thay thế · 4 điều chỉnh (EInvoiceStatus). */
  eInvoiceStatus: number | null;
  /** Đã ký & phát hành trên web (có mã tra cứu + số, không còn là nháp). */
  issued: boolean;
  raw: unknown;
}

/**
 * Tra tờ theo RefID (≤ 50 mã/lệnh). RefID không có trên web → không có dòng
 * (tờ chưa đẩy, hoặc đã bị xóa nháp). Tờ đã ký trên web mang InvNo + TransactionID.
 */
export async function getWebInvoices(
  refIds: string[],
  cfg: StandardInvoiceConfig
): Promise<MisaWebInvoiceItem[]> {
  if (refIds.length === 0) return [];
  const raw = await webPost(
    ENDPOINTS.getlist,
    { invoiceWithCode: String(webInvoiceWithCode(cfg)) },
    refIds.slice(0, WEB_GETLIST_BATCH_MAX),
    cfg
  );
  const data = unwrapData(raw);
  const list = Array.isArray(data) ? data : data != null ? [data] : [];
  return list.map((item) => {
    const invNoRaw = pick(item, "InvNo", "invNo", "InvoiceNo");
    const invNo =
      typeof invNoRaw === "number"
        ? String(invNoRaw).padStart(8, "0")
        : typeof invNoRaw === "string" && /^\d+$/.test(invNoRaw.trim())
          ? invNoRaw.trim()
          : null;
    const tx = pick(item, "TransactionID", "TransactionId", "transactionID");
    const publishStatus = pick(item, "PublishStatus", "publishStatus");
    const eStatus = pick(item, "EInvoiceStatus", "eInvoiceStatus");
    const transactionId = typeof tx === "string" && tx.trim() ? tx.trim() : null;
    const ps = typeof publishStatus === "number" ? publishStatus : null;
    return {
      refId: String(pick(item, "RefID", "refID", "RefId") ?? ""),
      invoiceNo: invNo,
      transactionId,
      publishStatus: ps,
      eInvoiceStatus: typeof eStatus === "number" ? eStatus : null,
      issued: Boolean(invNo && transactionId) && ps !== 0,
      raw: item,
    };
  });
}

/** Xóa tờ nháp (chỉ tờ CHƯA phát hành). Tờ không có trên web → MISA vẫn trả thành công / báo lỗi tùy phiên bản — người gọi coi là best-effort. */
export async function deleteWebDraft(refId: string, cfg: StandardInvoiceConfig): Promise<void> {
  await webPost(
    ENDPOINTS.delete,
    { invoiceWithCode: String(webInvoiceWithCode(cfg)), refid: refId },
    undefined,
    cfg,
    { method: "DELETE" }
  );
}
