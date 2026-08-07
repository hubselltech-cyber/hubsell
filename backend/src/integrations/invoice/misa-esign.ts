/**
 * MISA eSign — CHỮ KÝ SỐ TỪ XA (Remote Signing).
 *
 * Đây là dịch vụ ĐỘC LẬP với meInvoice (base URL, cặp khóa, token đều riêng).
 * Vai trò trong Hubsell: ký số hồ sơ/hóa đơn thay cho USB Token — khớp lựa
 * chọn signMethod = "ESIGN_CLOUD" trong InvoiceConfig.
 *
 * Luồng ký số từ xa chuẩn theo tài liệu Open API MISA eSign:
 *   1. POST /api/auth/api/v1/auth/login-api        (header x-clientId/x-clientKey,
 *      body {userName, password}) → accessToken + remoteSigningAccessToken.
 *   2. GET  /external/esrm/service/general/api/v1/Certificates/by-userId
 *      → danh sách chứng thư số của tài khoản (lấy certAlias/certId).
 *   3. POST /external/esrm/service/document/api/v1/documents/hash
 *      → tạo hash tài liệu (PDF/XML/Word/Excel) cần ký.
 *   4. POST /external/esrm/service/signing/api/v1/Signing/hash
 *      → gửi yêu cầu ký hash — NGƯỜI KÝ XÁC NHẬN TRÊN APP MISA eSign
 *      (sandbox có thể cấu hình tự động) → transactionId.
 *   5. GET  /external/esrm/service/signing/api/v1/Signing/status/{transactionId}
 *      → poll trạng thái đến khi ký xong, nhận chữ ký.
 *   6. POST /external/esrm/service/document/api/v1/documents/attachment
 *      → đóng chữ ký vào file gốc, nhận file đã ký (base64).
 *
 * Response bọc { status: {code, error, ...}, data: {...} } (camelCase) — khác
 * envelope PascalCase của meInvoice; bước hash/sign lại nhận body PascalCase
 * (DataToBeDisplayed, CertAlias...) đúng theo mẫu trong tài liệu. Sandbox trả
 * lỗi tên trường thì chỉnh MỘT chỗ ở hàm build body tương ứng.
 */

import { pick } from "./misa-inbot";

const TOKEN_SAFETY_MS = 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000; // tài liệu mẫu: expiresIn 3600

// ---------- Cấu hình từ env ----------

export interface EsignConfig {
  apiBase: string;
  clientId: string;
  clientKey: string;
  username: string;
  password: string;
}

/** Đọc bộ cấu hình eSign từ env — trả danh sách env còn thiếu để test dễ soi. */
export function esignConfigFromEnv():
  | { ok: true; config: EsignConfig }
  | { ok: false; missing: string[] } {
  const read = (key: string) => process.env[key]?.trim() || "";
  const values = {
    // Production: https://esignapp.misa.vn — sandbox điền URL trong kit MISA gửi.
    apiBase: read("MISA_ESIGN_API_BASE").replace(/\/+$/, "") || "https://esignapp.misa.vn",
    clientId: read("MISA_ESIGN_CLIENT_ID"),
    clientKey: read("MISA_ESIGN_CLIENT_KEY"),
    username: read("MISA_ESIGN_USERNAME"),
    password: read("MISA_ESIGN_PASSWORD"),
  };
  const required: Array<[keyof typeof values, string]> = [
    ["clientId", "MISA_ESIGN_CLIENT_ID"],
    ["clientKey", "MISA_ESIGN_CLIENT_KEY"],
    ["username", "MISA_ESIGN_USERNAME"],
    ["password", "MISA_ESIGN_PASSWORD"],
  ];
  const missing = required.filter(([k]) => !values[k]).map(([, env]) => env);
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, config: values };
}

/**
 * Hợp nhất env + overrides theo SHOP (InvoiceConfig.esign*): trường nào shop
 * có thì ghi đè env, còn thiếu ở CẢ HAI thì báo rõ tên env. Nút "Kiểm tra kết
 * nối eSign" và luồng ký nền per-shop đi qua đây.
 */
function requireConfig(overrides?: Partial<EsignConfig>): EsignConfig {
  const r = esignConfigFromEnv();
  const base: Partial<EsignConfig> = r.ok
    ? r.config
    : { apiBase: "https://esignapp.misa.vn" };
  const merged: Partial<EsignConfig> = {
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides ?? {}).filter(([, v]) => typeof v === "string" && v.trim() !== "")
    ),
  };
  const missing: string[] = [];
  if (!merged.clientId) missing.push("MISA_ESIGN_CLIENT_ID");
  if (!merged.clientKey) missing.push("MISA_ESIGN_CLIENT_KEY");
  if (!merged.username) missing.push("MISA_ESIGN_USERNAME");
  if (!merged.password) missing.push("MISA_ESIGN_PASSWORD");
  if (missing.length > 0) {
    throw new Error(
      `Chưa cấu hình đủ MISA eSign — còn thiếu: ${missing.join(", ")} ` +
        "(điền backend/.env theo kit sandbox, hoặc nhập ở trang Kết nối & Xuất hóa đơn)."
    );
  }
  return merged as EsignConfig;
}

// ---------- Envelope {status, data} ----------

function unwrapEsign(text: string, context: string): unknown {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${context}: eSign trả body không phải JSON: ${text.slice(0, 300)}`);
  }
  const status = pick(json, "status");
  if (status && typeof status === "object") {
    const error = pick(status, "error");
    if (error === true) {
      const code = pick(status, "errorCode") ?? pick(status, "code") ?? "?";
      const msg =
        pick(status, "userMsg") ?? pick(status, "devMsg") ?? pick(status, "message") ?? "";
      throw new Error(`${context}: eSign báo lỗi (code=${String(code)}${msg ? ` — ${String(msg)}` : ""})`);
    }
  }
  const data = pick(json, "data", "Data");
  return data !== undefined ? data : json;
}

// ---------- Đăng nhập + cache token ----------

export interface EsignSession {
  accessToken: string;
  /** Token RIÊNG cho cụm API ký từ xa (esrm) — có thì ưu tiên dùng cho các
   * endpoint /external/esrm/*, không có thì fallback accessToken. */
  remoteSigningAccessToken: string | null;
  /** id user eSign — tham số UserId của yêu cầu ký + query by-userId. */
  userId: string | null;
  expiresAt: number;
  cacheKey: string;
}

let cachedSession: EsignSession | null = null;

/** Đăng nhập eSign (cache theo clientId+username, làm mới sớm 60s trước hạn).
 * `overrides` = bộ khóa theo shop (InvoiceConfig) ghi đè env. */
export async function esignLogin(overrides?: Partial<EsignConfig>): Promise<EsignSession> {
  const cfg = requireConfig(overrides);
  const cacheKey = `${cfg.clientId}:${cfg.username}`;
  if (
    cachedSession &&
    cachedSession.cacheKey === cacheKey &&
    Date.now() < cachedSession.expiresAt - TOKEN_SAFETY_MS
  ) {
    return cachedSession;
  }

  const url = `${cfg.apiBase}/api/auth/api/v1/auth/login-api`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-clientId": cfg.clientId,
        "x-clientKey": cfg.clientKey,
      },
      body: JSON.stringify({ userName: cfg.username, password: cfg.password }),
    });
  } catch (err) {
    throw new Error(`eSign login: không gọi được ${url} — ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`eSign login: HTTP ${res.status} — ${text.slice(0, 300)}`);

  const data = unwrapEsign(text, "eSign login");
  const accessToken = pick(data, "accessToken", "access_token");
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(
      `eSign login: không thấy accessToken trong response: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  const remote = pick(data, "remoteSigningAccessToken");
  const expiresIn = pick(data, "expiresIn", "expires_in");
  const user = pick(data, "user");
  const userId = pick(user, "id");

  cachedSession = {
    accessToken,
    remoteSigningAccessToken: typeof remote === "string" && remote ? remote : null,
    userId: typeof userId === "string" && userId ? userId : null,
    expiresAt:
      Date.now() +
      (typeof expiresIn === "number" && expiresIn > 0
        ? expiresIn * 1000
        : DEFAULT_TOKEN_TTL_MS),
    cacheKey,
  };
  return cachedSession;
}

export function clearEsignSessionCache(): void {
  cachedSession = null;
}

// ---------- Gọi cụm API ký từ xa (esrm) ----------

async function esrmFetch(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  query?: Record<string, string>
): Promise<unknown> {
  const cfg = requireConfig();
  const session = await esignLogin();
  const token = session.remoteSigningAccessToken ?? session.accessToken;
  const url = new URL(`${cfg.apiBase}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-clientId": cfg.clientId,
        "x-clientKey": cfg.clientKey,
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`eSign ${method} ${path}: không gọi được — ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`eSign ${method} ${path}: HTTP ${res.status} — ${text.slice(0, 300)}`);
  return unwrapEsign(text, `eSign ${method} ${path}`);
}

/** Danh sách chứng thư số của tài khoản đang đăng nhập. */
export async function listCertificates(): Promise<unknown> {
  const session = await esignLogin();
  return esrmFetch(
    "GET",
    "/external/esrm/service/general/api/v1/Certificates/by-userId",
    undefined,
    session.userId ? { userId: session.userId } : undefined
  );
}

/** Chi tiết một chứng thư số (lấy certificate + chain cho bước hash). */
export async function getCertificateById(certId: string): Promise<unknown> {
  return esrmFetch(
    "GET",
    "/external/esrm/service/general/api/v1/Certificates/by-certId",
    undefined,
    { certId }
  );
}

/** Bước 3 — tạo hash tài liệu. Body theo mẫu tài liệu (certificate + *Docs). */
export async function hashDocuments(body: unknown): Promise<unknown> {
  return esrmFetch("POST", "/external/esrm/service/document/api/v1/documents/hash", body);
}

export interface SignHashRequest {
  userId: string;
  certAlias: string;
  /** Thông điệp hiển thị trên app MISA eSign khi hỏi xác nhận ký. */
  dataToBeDisplayed: string;
  documents: Array<{ DocumentId: string; FileToSign: string; DocumentName: string }>;
}

/** Bước 4 — gửi yêu cầu ký hash → transactionId (chờ người ký duyệt trên app). */
export async function requestSignHash(req: SignHashRequest): Promise<string> {
  const data = await esrmFetch("POST", "/external/esrm/service/signing/api/v1/Signing/hash", {
    DataToBeDisplayed: req.dataToBeDisplayed,
    UserId: req.userId,
    CertAlias: req.certAlias,
    Documents: req.documents,
  });
  const txId = pick(data, "transactionId", "TransactionId");
  if (typeof txId !== "string" || !txId) {
    throw new Error(
      `eSign Signing/hash: không thấy transactionId trong response: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  return txId;
}

/** Bước 5 — trạng thái một giao dịch ký (poll đến khi có chữ ký). */
export async function getSigningStatus(transactionId: string): Promise<unknown> {
  return esrmFetch(
    "GET",
    `/external/esrm/service/signing/api/v1/Signing/status/${encodeURIComponent(transactionId)}`
  );
}

/** Bước 6 — đóng chữ ký vào file gốc, nhận file đã ký (base64). */
export async function attachSignatures(body: unknown): Promise<unknown> {
  return esrmFetch("POST", "/external/esrm/service/document/api/v1/documents/attachment", body);
}

// ---------- Smoke test sandbox ----------

/** PDF 1 trang tối giản làm tài liệu ký thử — đủ hợp lệ để tạo hash. */
export function buildSamplePdfBase64(): string {
  const pdf = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R>>endobj",
    "4 0 obj<</Length 44>>stream",
    "BT /F1 12 Tf 10 50 Td (Hubsell eSign test) Tj ET",
    "endstream endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n");
  return Buffer.from(pdf, "utf8").toString("base64");
}

export interface EsignSmokeTestResult {
  user: unknown;
  certificates: unknown;
  /** Các bước sau chỉ chạy khi tìm được chứng thư — null nghĩa là dừng ở đó. */
  certAliasUsed: string | null;
  hashResult: unknown;
  transactionId: string | null;
  signingStatus: unknown;
  note: string;
}

/**
 * Chạy trọn luồng ký thử trên sandbox: login → lấy chứng thư → hash PDF mẫu →
 * gửi yêu cầu ký → đọc trạng thái đầu tiên. KHÔNG poll đến cùng (người ký có
 * thể phải xác nhận trên app eSign) — trả transactionId để gọi tiếp
 * GET /esign/status/{transactionId} khi cần.
 */
export async function runEsignSmokeTest(): Promise<EsignSmokeTestResult> {
  const session = await esignLogin();
  const certificates = await listCertificates();

  const result: EsignSmokeTestResult = {
    user: { userId: session.userId, hasRemoteSigningToken: Boolean(session.remoteSigningAccessToken) },
    certificates,
    certAliasUsed: null,
    hashResult: null,
    transactionId: null,
    signingStatus: null,
    note: "",
  };

  // Tìm chứng thư đầu tiên trong response (mảng trực tiếp hoặc bọc 1 lớp).
  const certList = Array.isArray(certificates)
    ? certificates
    : (pick(certificates, "certificates", "items", "list") as unknown[] | undefined);
  const firstCert = Array.isArray(certList) ? certList[0] : undefined;
  const certAlias = pick(firstCert, "certAlias", "alias", "certId", "id");
  const certPem = pick(firstCert, "certificate", "certBase64", "cert");
  const certChain = pick(firstCert, "certificateChain", "chain");
  if (typeof certAlias !== "string" || !certAlias) {
    result.note =
      "Đăng nhập + đọc chứng thư OK nhưng tài khoản chưa có chứng thư số nào " +
      "(hoặc field alias khác tên) — xem raw `certificates` ở trên rồi chỉnh runEsignSmokeTest().";
    return result;
  }
  result.certAliasUsed = certAlias;

  // Hash PDF mẫu. SignatureInfo để trống {} — sandbox đòi thêm trường
  // (vị trí ký, lý do...) thì bổ sung tại đây theo tài liệu kit.
  const documentId = `HUBSELL-TEST-${Date.now()}`;
  const hashResult = await hashDocuments({
    certificate: typeof certPem === "string" ? certPem : "",
    certificateChain: typeof certChain === "string" ? certChain : "",
    pdfDocs: [
      {
        DocumentId: documentId,
        FileToSign: buildSamplePdfBase64(),
        SignatureInfo: {},
      },
    ],
    xmlDocs: [],
    wordDocs: [],
    excelDocs: [],
  });
  result.hashResult = hashResult;

  const pdfDocs = pick(hashResult, "pdfDocs") as unknown[] | undefined;
  const digest = pick(Array.isArray(pdfDocs) ? pdfDocs[0] : undefined, "digest", "documentHash");
  if (typeof digest !== "string" || !digest) {
    result.note =
      "Hash tài liệu chưa trả digest — xem raw `hashResult` ở trên, khả năng body " +
      "documents/hash cần thêm trường theo kit (chỉnh một chỗ trong runEsignSmokeTest()).";
    return result;
  }

  if (!session.userId) {
    result.note = "Login không trả user.id — cần UserId cho Signing/hash; xem raw login/kit.";
    return result;
  }

  result.transactionId = await requestSignHash({
    userId: session.userId,
    certAlias,
    dataToBeDisplayed: "Hubsell test ký số sandbox",
    documents: [{ DocumentId: documentId, FileToSign: digest, DocumentName: "hubsell-test.pdf" }],
  });
  result.signingStatus = await getSigningStatus(result.transactionId);
  result.note =
    "Đã gửi yêu cầu ký — nếu trạng thái đang chờ, xác nhận trên app MISA eSign rồi " +
    "gọi lại GET /api/test/misa-sandbox/esign/status/{transactionId}.";
  return result;
}
