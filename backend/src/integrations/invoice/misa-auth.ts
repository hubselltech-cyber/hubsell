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
}

interface CachedToken {
  token: string;
  /** Epoch ms — sau mốc này phải đăng nhập lại. */
  expiresAt: number;
  /** Cache theo clientId — đổi cặp khóa (shop khác) là đăng nhập lại. */
  clientId: string;
}

let cached: CachedToken | null = null;

/** Base URL API meInvoice — sandbox mặc định, đổi qua env khi lên production. */
export function misaApiBase(): string {
  return (
    process.env.MISA_API_BASE?.replace(/\/+$/, "") ??
    "https://testapi.meinvoice.vn/api/v3"
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
 * Body request đăng nhập — sandbox trả InvalidParameter thì chỉnh TẠI ĐÂY.
 *
 * Đã bắn thử thực tế (28/07/2026): sandbox NHẬN request (HTTP 200) nhưng trả
 * `ErrorCode: InvalidParameter` — theo tài liệu meInvoice, auth cần thêm THÔNG
 * TIN TÀI KHOẢN sandbox bên cạnh cặp khóa: mã số thuế + tài khoản đăng nhập.
 * Khi MISA gửi bộ tài khoản sandbox, điền 3 env dưới là chạy:
 *   MISA_TAX_CODE / MISA_USERNAME / MISA_PASSWORD
 */
function buildAuthBody(creds: MisaAuthCredentials): Record<string, string> {
  return {
    appid: creds.clientId,
    appsecret: creds.clientSecret,
    ...(process.env.MISA_TAX_CODE ? { taxcode: process.env.MISA_TAX_CODE } : {}),
    ...(process.env.MISA_USERNAME ? { username: process.env.MISA_USERNAME } : {}),
    ...(process.env.MISA_PASSWORD ? { password: process.env.MISA_PASSWORD } : {}),
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

  // Còn token của đúng clientId này và chưa tới hạn → dùng lại.
  if (
    cached &&
    cached.clientId === effective.clientId &&
    Date.now() < cached.expiresAt - TOKEN_SAFETY_MS
  ) {
    return cached.token;
  }

  const url = `${misaApiBase()}/auth/token`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  cached = {
    token,
    clientId: effective.clientId,
    expiresAt: Date.now() + ttlMs,
  };
  return token;
}

/** Cho test/CLI: xoá cache để lần gọi sau bắt buộc đăng nhập lại. */
export function clearMisaTokenCache(): void {
  cached = null;
}
