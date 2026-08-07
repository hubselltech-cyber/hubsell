/**
 * MISA meInvoice — HÓA ĐƠN ĐẦU VÀO (dịch vụ "Xử lý hóa đơn đầu vào", nội bộ
 * MISA gọi là Inbot).
 *
 * KHÁC HẲN bộ API hóa đơn ĐẦU RA đang có (misa-auth.ts / misa-provider.ts,
 * base /api/v3): Inbot dùng CẶP base URL riêng + auth 2 BƯỚC riêng — đừng gộp
 * hai luồng token vào nhau.
 *
 * Auth 2 bước (tài liệu Open API meInvoice Đầu vào):
 *   1. POST {MISA_INBOT_API_BASE}/validateUser
 *      header AppID / CompanyTaxCode / UserName, body { PassWord }
 *      → SecureToken.
 *   2. POST {MISA_INBOT_API_BASE}/auth/jwttoken
 *      header như trên + securetoken → AccessToken (JWT, Bearer).
 *
 * API nghiệp vụ (base MISA_INBOT_APP_BASE, prefix
 * /inbot/api/{subscriberId}/{organizationId}, header ClientId + Bearer):
 *   GET /invoices/v2/modified?from&to&take&skip — hóa đơn phát sinh/cập nhật
 *       trong kỳ (take tối đa 100 → PHẢI phân trang bằng skip).
 *   GET /invoices/{invoiceId}                   — chi tiết một hóa đơn.
 *
 * Inbot KHÔNG có webhook → luồng về DB là POLLING: gọi syncInputInvoicesToDb
 * theo kỳ (cron sẽ nối vào worker auto-sync sau khi sandbox thông). Idempotent
 * nhờ unique (ownerId, misaInvoiceId).
 *
 * LƯU Ý SANDBOX: tên trường PascalCase trong response giữa các bản tài liệu
 * không thống nhất — mọi chỗ đọc field đều qua pick() thử nhiều biến thể, và
 * rawPayload luôn được lưu nguyên văn để đối chiếu khi cần chỉnh map.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";

const TOKEN_SAFETY_MS = 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000;
/** take tối đa theo tài liệu; cũng là bước nhảy skip khi phân trang. */
const PAGE_SIZE = 100;
/** Chặn vòng lặp phân trang chạy mãi khi sandbox trả dữ liệu lạ. */
const MAX_PAGES_PER_SYNC = 20;

// ---------- Cấu hình từ env ----------

export interface InbotConfig {
  /** Base API nghiệp vụ (testapp.meinvoice.vn khi sandbox). */
  appBase: string;
  /** Base API auth (testapi.meinvoice.vn/api2 khi sandbox). */
  apiBase: string;
  appId: string;
  clientId: string;
  taxCode: string;
  username: string;
  password: string;
  subscriberId: string;
  organizationId: string;
}

/**
 * Đọc đủ bộ cấu hình Inbot từ env — trả về danh sách env CÒN THIẾU thay vì ném
 * lỗi ngay, để endpoint test liệt kê được một lượt cho dễ điền.
 */
export function inbotConfigFromEnv():
  | { ok: true; config: InbotConfig }
  | { ok: false; missing: string[] } {
  const read = (key: string) => process.env[key]?.trim() || "";
  const values = {
    appBase:
      read("MISA_INBOT_APP_BASE").replace(/\/+$/, "") ||
      "https://testapp.meinvoice.vn",
    apiBase:
      read("MISA_INBOT_API_BASE").replace(/\/+$/, "") ||
      "https://testapi.meinvoice.vn/api2",
    appId: read("MISA_INBOT_APP_ID"),
    clientId: read("MISA_INBOT_CLIENT_ID"),
    taxCode: read("MISA_INBOT_TAX_CODE"),
    username: read("MISA_INBOT_USERNAME"),
    password: read("MISA_INBOT_PASSWORD"),
    subscriberId: read("MISA_INBOT_SUBSCRIBER_ID"),
    organizationId: read("MISA_INBOT_ORG_ID"),
  };
  const required: Array<[keyof typeof values, string]> = [
    ["appId", "MISA_INBOT_APP_ID"],
    ["clientId", "MISA_INBOT_CLIENT_ID"],
    ["taxCode", "MISA_INBOT_TAX_CODE"],
    ["username", "MISA_INBOT_USERNAME"],
    ["password", "MISA_INBOT_PASSWORD"],
    ["subscriberId", "MISA_INBOT_SUBSCRIBER_ID"],
    ["organizationId", "MISA_INBOT_ORG_ID"],
  ];
  const missing = required.filter(([k]) => !values[k]).map(([, env]) => env);
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, config: values };
}

function requireConfig(): InbotConfig {
  const r = inbotConfigFromEnv();
  if (!r.ok) {
    throw new Error(
      `Chưa cấu hình đủ env MISA Hóa đơn đầu vào — còn thiếu: ${r.missing.join(", ")} ` +
        "(điền vào backend/.env theo kit sandbox MISA gửi)."
    );
  }
  return r.config;
}

// ---------- Helpers đọc payload PascalCase "mềm" ----------

type AnyObj = Record<string, unknown>;

/** Lấy giá trị đầu tiên khớp một trong các tên trường (thử nguyên văn trước,
 * rồi so không phân biệt hoa thường) — chống lệch PascalCase/camelCase. */
export function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as AnyObj;
  for (const k of keys) if (o[k] !== undefined) return o[k];
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real !== undefined && o[real] !== undefined) return o[real];
  }
  return undefined;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/** Số tiền: nhận number hoặc chuỗi (kể cả kiểu VN "1.208,50") → number. */
function asAmount(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    let s = v.trim();
    if (!s) return 0;
    // "1.208,50" (VN) → "1208.50"; "1,208.50" (EN) → "1208.50"
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Bóc envelope {Success, ErrorCode, Data} (PascalCase lẫn lowercase). */
function unwrapEnvelope(text: string, context: string): unknown {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${context}: MISA trả body không phải JSON: ${text.slice(0, 300)}`);
  }
  const success = pick(json, "Success", "success");
  if (success === false) {
    const code = asString(pick(json, "ErrorCode", "errorCode")) ?? "?";
    const msg = asString(pick(json, "ErrorMessage", "Message", "message")) ?? "";
    throw new Error(`${context}: MISA từ chối (ErrorCode=${code}${msg ? ` — ${msg}` : ""})`);
  }
  // Có envelope thì trả Data; API trả thẳng mảng/object thì trả nguyên json.
  const data = pick(json, "Data", "data");
  return data !== undefined ? data : json;
}

// ---------- Auth 2 bước + cache token ----------

interface CachedToken {
  token: string;
  expiresAt: number;
  /** Đổi tài khoản/MST là phải đăng nhập lại. */
  cacheKey: string;
}

let cachedInbot: CachedToken | null = null;

function authHeaders(cfg: InbotConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AppID: cfg.appId,
    CompanyTaxCode: cfg.taxCode,
    UserName: cfg.username,
  };
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  context: string
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    throw new Error(`${context}: không gọi được ${url} — ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${context}: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  return text;
}

/** Đăng nhập 2 bước lấy AccessToken (có cache ~30', làm mới sớm 60s). */
export async function getInbotAccessToken(): Promise<string> {
  const cfg = requireConfig();
  const cacheKey = `${cfg.taxCode}:${cfg.username}`;
  if (
    cachedInbot &&
    cachedInbot.cacheKey === cacheKey &&
    Date.now() < cachedInbot.expiresAt - TOKEN_SAFETY_MS
  ) {
    return cachedInbot.token;
  }

  // Bước 1 — SecureToken
  const step1 = unwrapEnvelope(
    await postJson(
      `${cfg.apiBase}/validateUser`,
      authHeaders(cfg),
      { PassWord: cfg.password },
      "validateUser"
    ),
    "validateUser"
  );
  const secureToken =
    typeof step1 === "string" ? step1 : asString(pick(step1, "SecureToken", "securetoken", "Token"));
  if (!secureToken) {
    throw new Error(
      `validateUser: không thấy SecureToken trong response: ${JSON.stringify(step1).slice(0, 300)}`
    );
  }

  // Bước 2 — JWT AccessToken
  const step2 = unwrapEnvelope(
    await postJson(
      `${cfg.apiBase}/auth/jwttoken`,
      { ...authHeaders(cfg), securetoken: secureToken },
      {},
      "auth/jwttoken"
    ),
    "auth/jwttoken"
  );
  let token: string | null = null;
  let ttlMs = DEFAULT_TOKEN_TTL_MS;
  if (typeof step2 === "string") token = step2;
  else {
    token = asString(pick(step2, "AccessToken", "access_token", "Token"));
    const exp = pick(step2, "ExpiresIn", "expires_in");
    if (typeof exp === "number" && exp > 0) ttlMs = exp * 1000;
  }
  if (!token) {
    throw new Error(
      `auth/jwttoken: không thấy AccessToken trong response: ${JSON.stringify(step2).slice(0, 300)}`
    );
  }

  cachedInbot = { token, cacheKey, expiresAt: Date.now() + ttlMs };
  return token;
}

export function clearInbotTokenCache(): void {
  cachedInbot = null;
}

// ---------- API nghiệp vụ ----------

async function inbotGet(path: string, query?: Record<string, string | number>): Promise<unknown> {
  const cfg = requireConfig();
  const token = await getInbotAccessToken();
  const url = new URL(
    `${cfg.appBase}/inbot/api/${cfg.subscriberId}/${cfg.organizationId}${path}`
  );
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { ClientId: cfg.clientId, Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new Error(`Inbot GET ${path}: không gọi được — ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Inbot GET ${path}: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  return unwrapEnvelope(text, `Inbot GET ${path}`);
}

export interface ListInputInvoicesParams {
  /** Đầu kỳ (yyyy-MM-dd). */
  from: string;
  /** Cuối kỳ (yyyy-MM-dd). */
  to: string;
  take?: number;
  skip?: number;
  /** true = lọc theo NGÀY HÓA ĐƠN thay vì ngày cập nhật. */
  filterByInvoiceDate?: boolean;
}

/** Một trang hóa đơn phát sinh/cập nhật trong kỳ (mảng bản ghi thô của MISA). */
export async function listModifiedInputInvoices(
  params: ListInputInvoicesParams
): Promise<unknown[]> {
  const data = await inbotGet("/invoices/v2/modified", {
    from: params.from,
    to: params.to,
    take: Math.min(params.take ?? PAGE_SIZE, PAGE_SIZE),
    skip: params.skip ?? 0,
    IsFilterInvDate: params.filterByInvoiceDate ? "true" : "false",
  });
  if (Array.isArray(data)) return data;
  // Một số bản tài liệu bọc thêm một lớp { Invoices: [...] } / { Items: [...] }
  const inner = pick(data, "Invoices", "Items", "List", "Result");
  if (Array.isArray(inner)) return inner;
  throw new Error(
    `Inbot /invoices/v2/modified: response không phải mảng: ${JSON.stringify(data).slice(0, 300)}`
  );
}

/** Chi tiết một hóa đơn đầu vào theo InvoiceID phía MISA. */
export async function getInputInvoiceDetail(invoiceId: string): Promise<unknown> {
  return inbotGet(`/invoices/${encodeURIComponent(invoiceId)}`);
}

// ---------- Đồng bộ về DB ----------

export interface SyncInputInvoicesResult {
  fetched: number;
  created: number;
  updated: number;
  /** Bản ghi bị bỏ qua vì không tìm thấy InvoiceID (kèm mẫu để soi). */
  skipped: number;
  sampleSkipped?: unknown;
}

/** Map một bản ghi thô của MISA → dữ liệu cột InputInvoice. */
function mapInvoice(raw: unknown) {
  const misaInvoiceId = asString(
    pick(raw, "InvoiceID", "InvoiceId", "ID", "Id", "InvID")
  );
  return {
    misaInvoiceId,
    invoiceNo: asString(pick(raw, "InvNo", "InvoiceNo", "InvoiceNumber", "No")),
    invoiceSerial: asString(pick(raw, "InvSeries", "InvoiceSeries", "SerialNo", "Serial", "InvSerial")),
    sellerTaxCode: asString(pick(raw, "SellerTaxCode", "TaxCode", "SellerTaxcode")),
    sellerName: asString(pick(raw, "SellerLegalName", "SellerName", "SellerCompanyName")),
    invoiceDate: asDate(pick(raw, "InvDate", "InvoiceDate", "IssueDate")),
    totalAmount: asAmount(pick(raw, "TotalAmount", "TotalPayment", "Amount", "TotalMoney")),
    vatAmount: asAmount(pick(raw, "VATAmount", "AmountVAT", "TaxAmount", "TotalVATAmount")),
    statusRaw: asString(pick(raw, "InvoiceStatus", "Status", "StatusName", "ProcessStatus")),
  };
}

/**
 * Kéo toàn bộ hóa đơn đầu vào phát sinh/cập nhật trong kỳ về bảng
 * input_invoices của một chủ shop (upsert idempotent). Đây là hàm cron sẽ gọi
 * định kỳ sau khi sandbox thông — hiện trigger tay qua /api/test/misa-sandbox.
 */
export async function syncInputInvoicesToDb(
  ownerId: string,
  params: Omit<ListInputInvoicesParams, "take" | "skip">
): Promise<SyncInputInvoicesResult> {
  const result: SyncInputInvoicesResult = { fetched: 0, created: 0, updated: 0, skipped: 0 };

  for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
    const batch = await listModifiedInputInvoices({ ...params, take: PAGE_SIZE, skip: page * PAGE_SIZE });
    result.fetched += batch.length;

    for (const raw of batch) {
      const mapped = mapInvoice(raw);
      if (!mapped.misaInvoiceId) {
        result.skipped++;
        result.sampleSkipped ??= raw;
        continue;
      }
      const data = {
        invoiceNo: mapped.invoiceNo,
        invoiceSerial: mapped.invoiceSerial,
        sellerTaxCode: mapped.sellerTaxCode,
        sellerName: mapped.sellerName,
        invoiceDate: mapped.invoiceDate,
        totalAmount: new Prisma.Decimal(mapped.totalAmount),
        vatAmount: new Prisma.Decimal(mapped.vatAmount),
        statusRaw: mapped.statusRaw,
        rawPayload: JSON.stringify(raw),
        syncedAt: new Date(),
      };
      const existing = await prisma.inputInvoice.findUnique({
        where: { ownerId_misaInvoiceId: { ownerId, misaInvoiceId: mapped.misaInvoiceId } },
        select: { id: true },
      });
      await prisma.inputInvoice.upsert({
        where: { ownerId_misaInvoiceId: { ownerId, misaInvoiceId: mapped.misaInvoiceId } },
        create: { ownerId, misaInvoiceId: mapped.misaInvoiceId, ...data },
        update: data,
      });
      if (existing) result.updated++;
      else result.created++;
    }

    if (batch.length < PAGE_SIZE) break; // trang cuối
  }
  return result;
}
