/**
 * LẤY ACCESS TOKEN TỪ MISA meInvoice (Sandbox) bằng cặp Client ID / Secret.
 *
 * MISA cấp token có hạn dùng — mọi lời gọi API nghiệp vụ (phát hành, hủy, tra
 * trạng thái) phải kèm token này. Module giữ MỘT cache token trong process:
 * gọi getMisaAccessToken() bao nhiêu lần cũng chỉ đăng nhập lại khi token sắp
 * hết hạn (chừa 60s an toàn), tránh spam endpoint auth của sandbox.
 *
 * Nguồn credentials, ưu tiên từ trên xuống:
 *   1. Tham số truyền vào (đọc từ InvoiceConfig của shop — luồng multi-vendor,
 *      mỗi shop một cặp khóa riêng khi lên production).
 *   2. Env MISA_CLIENT_ID / MISA_CLIENT_SECRET — cặp khóa sandbox dùng chung
 *      khi test thông luồng local.
 *
 * LƯU Ý SANDBOX: tên trường trong body auth (appid/clientid…) giữa các bản tài
 * liệu meInvoice không thống nhất — nếu sandbox trả 400, đối chiếu lại đúng
 * tài liệu tích hợp kèm hợp đồng và chỉ cần sửa MỘT chỗ buildAuthBody() dưới.
 */

const TOKEN_SAFETY_MS = 60 * 1000; // làm mới sớm 60s trước khi token hết hạn
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000; // MISA không trả expires_in thì coi như 30 phút

export interface MisaAuthCredentials {
  clientId: string;
  clientSecret: string;
  /** MST + tài khoản meInvoice — truyền theo SHOP (InvoiceConfig) sẽ ghi đè
   * bộ env sandbox dùng chung; thiếu thì buildAuthBody fallback env. */
  taxCode?: string;
  username?: string;
  password?: string;
}

interface CachedToken {
  token: string;
  /** Epoch ms — sau mốc này phải đăng nhập lại. */
  expiresAt: number;
}

/**
 * Cache token THEO TỪNG BỘ ĐỊNH DANH (23/08 — multi-tenant): mọi shop dùng
 * chung Client ID app Hubsell nhưng mỗi shop một tài khoản meInvoice riêng,
 * nên khóa cache phải gồm cả MST + username — một ô duy nhất như bản cũ sẽ
 * khiến hai shop giẫm token của nhau. Token MISA sống 14 ngày; TTL mặc định
 * 30' là dè dặt nhưng an toàn khi response không nói hạn.
 */
const cache = new Map<string, CachedToken>();

function cacheKey(creds: MisaAuthCredentials): string {
  return [
    creds.clientId,
    creds.taxCode ?? process.env.MISA_TAX_CODE ?? "",
    creds.username ?? process.env.MISA_USERNAME ?? "",
  ].join("|");
}

/**
 * Base URL API meInvoice.
 *
 * ĐÚNG THEO TÀI LIỆU PORTAL (developer.misa.vn → Open API → Hóa đơn điện tử,
 * đọc ngày 07/08/2026): mọi lời gọi đi qua cổng developer.misa.vn, KHÔNG phải
 * testapi.meinvoice.vn (host cũ đó trả InvalidParameter/404 cho mọi path).
 */
export function misaApiBase(): string {
  return (
    process.env.MISA_API_BASE?.replace(/\/+$/, "") ??
    "https://developer.misa.vn/apis/itg/meinvoice"
  );
}

/** Đọc cặp khóa từ env — trả null khi chưa cấu hình (để nơi gọi báo lỗi rõ). */
export function misaEnvCredentials(): MisaAuthCredentials | null {
  const clientId = process.env.MISA_CLIENT_ID?.trim();
  const clientSecret = process.env.MISA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Body request đăng nhập — ĐÚNG THEO TÀI LIỆU PORTAL (07/08/2026):
 *   POST {base}/invoice/token
 *   Headers : Content-Type, ClientID, ClientSecret   ← cặp khóa đi ở HEADER
 *   Body    : { taxcode, username, password }        ← tài khoản meInvoice
 *
 * Bản cũ nhét appid/appsecret vào BODY nên sandbox luôn trả InvalidParameter.
 */
function buildAuthBody(creds: MisaAuthCredentials): Record<string, string> {
  return {
    taxcode: creds.taxCode ?? process.env.MISA_TAX_CODE ?? "",
    username: creds.username ?? process.env.MISA_USERNAME ?? "",
    password: creds.password ?? process.env.MISA_PASSWORD ?? "",
  };
}

/** Header xác thực dùng chung cho MỌI request meInvoice (kể cả /invoice/token). */
export function misaAuthHeaders(creds: MisaAuthCredentials): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ClientID: creds.clientId,
    ClientSecret: creds.clientSecret,
  };
}

/**
 * Lấy Access Token (có cache). Ném Error với thông điệp tiếng Việt rõ ràng khi
 * chưa cấu hình khóa hoặc MISA từ chối — nơi gọi hiển thị thẳng cho người dùng.
 */
export async function getMisaAccessToken(
  creds?: MisaAuthCredentials
): Promise<string> {
  const effective = creds ?? misaEnvCredentials();
  if (!effective) {
    throw new Error(
      "Chưa cấu hình MISA_CLIENT_ID / MISA_CLIENT_SECRET trong backend/.env " +
        "(hoặc InvoiceConfig của shop) — không thể lấy Access Token."
    );
  }

  // Còn token của đúng bộ định danh này và chưa tới hạn → dùng lại.
  const key = cacheKey(effective);
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt - TOKEN_SAFETY_MS) {
    return hit.token;
  }

  const url = `${misaApiBase()}/invoice/token`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: misaAuthHeaders(effective),
      body: JSON.stringify(buildAuthBody(effective)),
    });
  } catch (err) {
    throw new Error(
      `Không gọi được endpoint auth của MISA (${url}): ${(err as Error).message}`
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `MISA từ chối cấp token (HTTP ${res.status}): ${text.slice(0, 300)}`
    );
  }

  // meInvoice bọc kết quả `{ Success, ErrorCode, Data }` (PascalCase — đã xác
  // nhận bằng request thật vào sandbox); Data là token chuỗi hoặc object chứa
  // token. Đề phòng cả biến thể lowercase trong tài liệu cũ.
  let token: string | undefined;
  let ttlMs = DEFAULT_TOKEN_TTL_MS;
  try {
    const json = JSON.parse(text) as {
      Success?: boolean;
      success?: boolean;
      ErrorCode?: string | null;
      errorcode?: string | null;
      Data?: unknown;
      data?: unknown;
    };
    if (json.Success === false || json.success === false) {
      throw new Error(`MISA từ chối: ErrorCode=${json.ErrorCode ?? json.errorcode ?? "?"}`);
    }
    const data = (json.Data ?? json.data) as
      | string
      | { token?: string; access_token?: string; expires_in?: number }
      | null
      | undefined;
    if (typeof data === "string") token = data;
    else if (data) {
      token = data.token ?? data.access_token;
      if (data.expires_in) ttlMs = data.expires_in * 1000;
    }
  } catch (err) {
    throw new Error(
      `Đăng nhập MISA thất bại: ${(err as Error).message} — body: ${text.slice(0, 300)}`
    );
  }
  if (!token) {
    throw new Error(`MISA trả 200 nhưng không thấy token trong body: ${text.slice(0, 300)}`);
  }

  cache.set(key, { token, expiresAt: Date.now() + ttlMs });
  return token;
}

/** Cho test/CLI: xoá cache để lần gọi sau bắt buộc đăng nhập lại. */
export function clearMisaTokenCache(): void {
  cache.clear();
}
