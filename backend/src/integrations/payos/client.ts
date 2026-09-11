// ============================================================
// payOS (Casso) — CỔNG THU TIỀN GÓI HUBSELL (09/09/2026, anh Trung chốt đổi từ
// SePay sang payOS; tài khoản nhận tiền: MB doanh nghiệp).
//
// Mô hình A2A: khách quét VietQR động → tiền về THẲNG tài khoản MB của Hubsell,
// payOS chỉ đọc giao dịch qua Open API ngân hàng và bắn webhook. payOS không
// giữ tiền — rủi ro duy nhất là mất tự động đối soát khi họ ngừng dịch vụ.
//
// Adapter MỎNG gọi REST trực tiếp (không kéo SDK @payos/node: API chỉ 4
// endpoint, giữ zero-dependency để đổi sang SePay/cổng khác chỉ cần viết lại
// file này + giữ nguyên gateway-checkout.ts).
//
// Tài liệu: https://payos.vn/docs/api/ — chữ ký HMAC-SHA256 với Checksum Key:
//   · Tạo link: chuỗi CỐ ĐỊNH "amount=&cancelUrl=&description=&orderCode=&returnUrl="
//   · Webhook:  sort key của `data` theo alphabet, nối "k=v&k=v", null → "",
//               mảng → JSON.stringify (mỗi phần tử sort key), hex digest.
//
// Cấu hình (Render): PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY
// (lấy ở my.payos.vn → Kênh thanh toán). Thiếu bất kỳ khóa nào = cổng TẮT:
// /me trả gateway=null, FE quay về luồng "Đăng ký mua → HQ liên hệ".
//
// TÁI DÙNG CHO SẢN PHẨM KHÁC (anh Trung chốt 11/09/2026 — vd Hubtax): file này
// KHÔNG chứa chữ nào riêng của Hubsell. Nhận diện sản phẩm nằm ở 2 chỗ env:
//   · Kênh thanh toán riêng trên my.payos.vn → bộ 3 khóa riêng (cách 1).
//   · PAYOS_TRANSFER_PREFIX ("HS" Hubsell, "HT" Hubtax…) in vào nội dung
//     chuyển khoản → lọc sao kê ngân hàng theo tiền tố (cách 2).
// Chép nguyên thư mục integrations/payos + đặt env là sản phẩm mới chạy.
// Checklist: docs/PAYOS-KENH-THANH-TOAN.md
// ============================================================

import { createHmac, timingSafeEqual } from "node:crypto";

const API_BASE = (process.env.PAYOS_API_BASE ?? "https://api-merchant.payos.vn").replace(
  /\/+$/,
  ""
);

export interface PayosConfig {
  clientId: string;
  apiKey: string;
  checksumKey: string;
  /** Mã đối tác chương trình "Đối tác tích hợp" (tùy chọn, 100đ/giao dịch cho dev). */
  partnerCode: string | null;
  /** Tiền tố nhận diện sản phẩm trong nội dung chuyển khoản (PAYOS_TRANSFER_PREFIX). */
  transferPrefix: string;
  /** Trần ký tự nội dung chuyển khoản: 9 khi TK chưa liên kết, 25 khi đã liên kết. */
  descriptionMaxLen: number;
}

/** Tùy chọn dựng nội dung chuyển khoản — đọc được cả khi cổng chưa có khóa. */
export interface PayosDescriptionOptions {
  prefix: string;
  maxLen: number;
}

export const PAYOS_DESCRIPTION_MIN = 9;
export const PAYOS_DESCRIPTION_MAX = 25;
const DEFAULT_TRANSFER_PREFIX = "HS";

/**
 * PAYOS_TRANSFER_PREFIX: 1-4 ký tự chữ/số không dấu (mặc định "HS").
 * PAYOS_DESCRIPTION_MAX: 9 (mặc định, an toàn với TK chưa liên kết) … 25 (TK
 * đã liên kết payOS) — giá trị ngoài khoảng bị kẹp về khoảng.
 */
export function getPayosDescriptionOptions(
  env: NodeJS.ProcessEnv = process.env
): PayosDescriptionOptions {
  const rawPrefix = (env.PAYOS_TRANSFER_PREFIX ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const prefix = rawPrefix ? rawPrefix.slice(0, 4) : DEFAULT_TRANSFER_PREFIX;
  const rawLen = Number.parseInt(env.PAYOS_DESCRIPTION_MAX ?? "", 10);
  const maxLen = Number.isFinite(rawLen)
    ? Math.min(PAYOS_DESCRIPTION_MAX, Math.max(PAYOS_DESCRIPTION_MIN, rawLen))
    : PAYOS_DESCRIPTION_MIN;
  return { prefix, maxLen };
}

export function getPayosConfig(): PayosConfig | null {
  const clientId = process.env.PAYOS_CLIENT_ID?.trim();
  const apiKey = process.env.PAYOS_API_KEY?.trim();
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();
  if (!clientId || !apiKey || !checksumKey) return null;
  const desc = getPayosDescriptionOptions();
  return {
    clientId,
    apiKey,
    checksumKey,
    partnerCode: process.env.PAYOS_PARTNER_CODE?.trim() || null,
    transferPrefix: desc.prefix,
    descriptionMaxLen: desc.maxLen,
  };
}

export function isPayosConfigured(): boolean {
  return getPayosConfig() !== null;
}

// ---------------- Chữ ký ----------------

/** Sort key alphabet (đệ quy cho object lồng) — đúng thuật toán SDK payOS. */
function sortObjDataByKey(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

/**
 * "k1=v1&k2=v2…" theo quy ước payOS: bỏ key undefined; null/"null"/"undefined"
 * → chuỗi rỗng; mảng → JSON.stringify sau khi sort key từng phần tử object.
 */
export function convertObjToQueryStr(obj: Record<string, unknown>): string {
  return Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .map((key) => {
      let value: unknown = obj[key];
      if (Array.isArray(value)) {
        value = JSON.stringify(
          value.map((v) =>
            v && typeof v === "object" && !Array.isArray(v)
              ? sortObjDataByKey(v as Record<string, unknown>)
              : v
          )
        );
      } else if (value && typeof value === "object") {
        value = JSON.stringify(sortObjDataByKey(value as Record<string, unknown>));
      }
      if (value === null || value === "null" || value === "undefined") value = "";
      return `${key}=${String(value)}`;
    })
    .join("&");
}

/** Chữ ký cho object bất kỳ (webhook `data`, response link) — sort key rồi HMAC. */
export function createSignatureFromObj(
  data: Record<string, unknown>,
  checksumKey: string
): string {
  const sorted = sortObjDataByKey(data);
  return createHmac("sha256", checksumKey).update(convertObjToQueryStr(sorted)).digest("hex");
}

/** Chữ ký body tạo link — 5 trường theo thứ tự cố định payOS quy định. */
export function createSignatureOfPaymentRequest(
  input: {
    amount: number;
    cancelUrl: string;
    description: string;
    orderCode: number;
    returnUrl: string;
  },
  checksumKey: string
): string {
  const str = `amount=${input.amount}&cancelUrl=${input.cancelUrl}&description=${input.description}&orderCode=${input.orderCode}&returnUrl=${input.returnUrl}`;
  return createHmac("sha256", checksumKey).update(str).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

// ---------------- Kiểu dữ liệu ----------------

export interface PayosWebhookData {
  orderCode: number;
  amount: number;
  description: string;
  accountNumber: string;
  reference: string;
  transactionDateTime: string;
  currency: string;
  paymentLinkId: string;
  /** "00" = giao dịch thành công. */
  code: string;
  desc: string;
  counterAccountBankId?: string | null;
  counterAccountBankName?: string | null;
  counterAccountName?: string | null;
  counterAccountNumber?: string | null;
  virtualAccountName?: string | null;
  virtualAccountNumber?: string | null;
}

export interface PayosWebhookBody {
  code: string;
  desc: string;
  success?: boolean;
  data: PayosWebhookData;
  signature: string;
}

export interface PayosPaymentLink {
  bin: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  description: string;
  orderCode: number;
  currency: string;
  paymentLinkId: string;
  status: "PENDING" | "PAID" | "CANCELLED" | "EXPIRED" | string;
  checkoutUrl: string;
  /** Chuỗi EMV VietQR — FE render thành ảnh QR. */
  qrCode: string;
}

export interface PayosPaymentLinkInfo {
  id: string;
  orderCode: number;
  amount: number;
  amountPaid: number;
  amountRemaining: number;
  status: "PENDING" | "PAID" | "CANCELLED" | "EXPIRED" | string;
  createdAt: string;
  canceledAt?: string | null;
  cancellationReason?: string | null;
  transactions: Array<{
    reference: string;
    amount: number;
    accountNumber: string;
    description: string;
    transactionDateTime: string;
    counterAccountBankId?: string | null;
    counterAccountBankName?: string | null;
    counterAccountName?: string | null;
    counterAccountNumber?: string | null;
  }>;
}

// ---------------- Xác thực webhook ----------------

/**
 * Kiểm chữ ký webhook: HMAC(data sort key) phải khớp `signature`. Không đúng
 * dạng / thiếu khóa → false (route trả 401, payOS sẽ retry — nếu là kẻ giả
 * mạo thì mặc kệ).
 */
export function verifyPayosWebhook(body: unknown, checksumKey: string): body is PayosWebhookBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<PayosWebhookBody>;
  if (!b.data || typeof b.data !== "object" || typeof b.signature !== "string") return false;
  const expected = createSignatureFromObj(b.data as unknown as Record<string, unknown>, checksumKey);
  return safeEqualHex(expected, b.signature);
}

// ---------------- Gọi API ----------------

export class PayosApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "PayosApiError";
  }
}

interface PayosEnvelope<T> {
  code: string;
  desc: string;
  data: T | null;
  signature?: string;
}

async function payosFetch<T>(
  cfg: PayosConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-client-id": cfg.clientId,
    "x-api-key": cfg.apiKey,
  };
  if (cfg.partnerCode) headers["x-partner-code"] = cfg.partnerCode;

  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
  let json: PayosEnvelope<T> | null = null;
  try {
    json = (await res.json()) as PayosEnvelope<T>;
  } catch {
    json = null;
  }
  if (!res.ok || !json) {
    throw new PayosApiError(
      `payOS trả HTTP ${res.status}${json?.desc ? ` — ${json.desc}` : ""}`,
      json?.code ?? null,
      res.status
    );
  }
  if (json.code !== "00" || json.data === null) {
    throw new PayosApiError(json.desc || `payOS từ chối (mã ${json.code})`, json.code, res.status);
  }
  return json.data;
}

/**
 * Tạo link thanh toán. `description` ≤ 25 ký tự với tài khoản đã liên kết
 * payOS (9 ký tự nếu chưa) — người gọi tự cắt (xem buildPayosDescription).
 * `expiredAt` là Unix giây.
 */
export async function createPayosPaymentLink(
  cfg: PayosConfig,
  input: {
    orderCode: number;
    amount: number;
    description: string;
    returnUrl: string;
    cancelUrl: string;
    expiredAt?: number;
    buyerName?: string;
    buyerEmail?: string;
    buyerPhone?: string;
    items?: Array<{ name: string; quantity: number; price: number }>;
  }
): Promise<PayosPaymentLink> {
  const signature = createSignatureOfPaymentRequest(
    {
      amount: input.amount,
      cancelUrl: input.cancelUrl,
      description: input.description,
      orderCode: input.orderCode,
      returnUrl: input.returnUrl,
    },
    cfg.checksumKey
  );
  const data = await payosFetch<PayosPaymentLink>(cfg, "/v2/payment-requests", {
    method: "POST",
    body: { ...input, signature },
  });
  return data;
}

export async function getPayosPaymentLink(
  cfg: PayosConfig,
  orderCodeOrLinkId: number | string
): Promise<PayosPaymentLinkInfo> {
  return payosFetch<PayosPaymentLinkInfo>(
    cfg,
    `/v2/payment-requests/${encodeURIComponent(String(orderCodeOrLinkId))}`,
    { method: "GET" }
  );
}

export async function cancelPayosPaymentLink(
  cfg: PayosConfig,
  orderCodeOrLinkId: number | string,
  reason?: string
): Promise<PayosPaymentLinkInfo> {
  return payosFetch<PayosPaymentLinkInfo>(
    cfg,
    `/v2/payment-requests/${encodeURIComponent(String(orderCodeOrLinkId))}/cancel`,
    { method: "POST", body: reason ? { cancellationReason: reason } : {} }
  );
}

/** Đăng ký URL webhook với payOS — họ gọi thử ngay (orderCode giả), phải trả 2xx. */
export async function confirmPayosWebhook(cfg: PayosConfig, webhookUrl: string): Promise<string> {
  return payosFetch<string>(cfg, "/confirm-webhook", {
    method: "POST",
    body: { webhookUrl },
  });
}

// ---------------- Tiện ích nghiệp vụ ----------------

/** Mã BIN Napas → tên ngân hàng (chỉ các ngân hàng payOS hỗ trợ + vài ngân hàng lớn). */
const BANK_BY_BIN: Record<string, string> = {
  "970422": "MB Bank",
  "970452": "KienlongBank",
  "970448": "OCB",
  "970418": "BIDV",
  "970416": "ACB",
  "970436": "Vietcombank",
  "970424": "Shinhan Bank",
  "970415": "VietinBank",
  "970407": "Techcombank",
  "970432": "VPBank",
  "970423": "TPBank",
  "970403": "Sacombank",
  "970426": "MSB",
};

export function bankNameFromBin(bin: string | null | undefined): string | null {
  if (!bin) return null;
  return BANK_BY_BIN[bin] ?? null;
}

/**
 * orderCode: số nguyên duy nhất, an toàn JSON (< 2^53). Dùng mili-giây hiện
 * tại × 1000 + 3 số ngẫu nhiên → 16 chữ số, tăng dần theo thời gian (dễ tra
 * trên my.payos.vn), va chạm chỉ khi 2 khách bấm cùng mili-giây và trúng số.
 * Bảng có unique — va chạm thì tạo lại.
 */
export function generateOrderCode(now: number = Date.now()): number {
  return now * 1000 + Math.floor(Math.random() * 1000);
}

/**
 * Nội dung chuyển khoản hiện trên app ngân hàng của khách. payOS tự ghép mã
 * nhận diện của họ phía trước; phần mình đặt = "<TIỀN TỐ> <MÃ GÓI> [<8 số cuối
 * mã đơn>]", không dấu, không ký tự đặc biệt, cắt về `maxLen`:
 *   · maxLen 9 (TK chưa liên kết): "HS GROWTH", "HS BUSINE" — chỉ tiền tố + gói.
 *   · maxLen 25 (TK đã liên kết): "HS BUSINESS 45678901" — thêm đuôi mã đơn
 *     để nhìn sao kê là biết đơn nào; đuôi chỉ ghép khi còn chỗ.
 * Tiền tố là thứ phân biệt sản phẩm trên sao kê khi nhiều sản phẩm cùng nhận
 * tiền vào một tài khoản (Hubsell "HS", Hubtax "HT"…).
 */
export function buildPayosDescription(
  planCode: string,
  opts: Partial<PayosDescriptionOptions> & { orderCode?: number | bigint | string } = {}
): string {
  const env = getPayosDescriptionOptions();
  const prefix = (opts.prefix ?? env.prefix).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const maxLen = Math.min(
    PAYOS_DESCRIPTION_MAX,
    Math.max(PAYOS_DESCRIPTION_MIN, opts.maxLen ?? env.maxLen)
  );
  const code = planCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const base = `${prefix} ${code}`.slice(0, maxLen).trim();
  if (opts.orderCode === undefined) return base;
  const tail = String(opts.orderCode).replace(/\D/g, "").slice(-8);
  const withTail = `${prefix} ${code} ${tail}`;
  return withTail.length <= maxLen && tail.length > 0 ? withTail : base;
}
