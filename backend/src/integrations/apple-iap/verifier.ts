// ============================================================
// XÁC MINH CHỮ KÝ APPLE (StoreKit 2 JWS) — 10/10/2026
//
// Giao dịch app gửi lên (purchaseToken của expo-iap = JWS) và thông báo máy
// chủ App Store (App Store Server Notifications V2) đều là JWS ký bằng chuỗi
// chứng chỉ Apple. Thư viện chính thức @apple/app-store-server-library kiểm
// chuỗi tới root CA Apple (certs/apple/*.cer, tải từ apple.com/certificateauthority
// 10/10/2026 — Apple Root CA G3 là gốc ký StoreKit) và đối chiếu bundleId +
// môi trường + appAppleId.
//
// HAI MÔI TRƯỜNG: người duyệt App Review mua bằng tài khoản SANDBOX trên bản
// build production, nên backend phải nhận cả hai: thử Production trước, lệch
// môi trường thì thử Sandbox. Khoản sandbox ghi amount 0 (không vào sổ quỹ).
//
// Cấu hình (Render): APPLE_IAP_BUNDLE_ID (mặc định vn.hubsell.app),
// APPLE_IAP_APP_APPLE_ID (6819512670), APPLE_IAP_ROOT_CA_DIR (mặc định certs/apple).
// Không cần khóa API App Store Connect cho đường này — chỉ xác minh offline.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";

export const APPLE_BUNDLE_ID = process.env.APPLE_IAP_BUNDLE_ID?.trim() || "vn.hubsell.app";
export const APPLE_APP_APPLE_ID = Number(process.env.APPLE_IAP_APP_APPLE_ID?.trim() || "6819512670");

export type AppleEnv = "Production" | "Sandbox";

function rootCaDir(): string {
  const fromEnv = process.env.APPLE_IAP_ROOT_CA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const cwdDir = path.resolve(process.cwd(), "certs/apple");
  if (fs.existsSync(cwdDir)) return cwdDir;
  // dist/integrations/apple-iap → backend/
  return path.resolve(__dirname, "../../../certs/apple");
}

let cachedRoots: Buffer[] | null = null;
function loadRootCAs(): Buffer[] {
  if (cachedRoots) return cachedRoots;
  const dir = rootCaDir();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".cer")) : [];
  if (files.length === 0) {
    throw new Error(`Thiếu chứng chỉ gốc Apple trong ${dir} (cần *.cer từ apple.com/certificateauthority)`);
  }
  cachedRoots = files.map((f) => fs.readFileSync(path.join(dir, f)));
  return cachedRoots;
}

const verifiers: Partial<Record<AppleEnv, SignedDataVerifier>> = {};
function verifierFor(env: AppleEnv): SignedDataVerifier {
  const existing = verifiers[env];
  if (existing) return existing;
  const v = new SignedDataVerifier(
    loadRootCAs(),
    true, // enableOnlineChecks: kiểm OCSP thu hồi chứng chỉ
    env === "Production" ? Environment.PRODUCTION : Environment.SANDBOX,
    APPLE_BUNDLE_ID,
    env === "Production" ? APPLE_APP_APPLE_ID : undefined
  );
  verifiers[env] = v;
  return v;
}

/** Cho test: thay bộ xác minh bằng bản giả (không đụng chứng chỉ thật). */
export function __setVerifierForTests(env: AppleEnv, v: SignedDataVerifier | null): void {
  if (v) verifiers[env] = v;
  else delete verifiers[env];
}

export class AppleVerifyError extends Error {
  constructor(message: string, readonly status: VerificationStatus | null) {
    super(message);
    this.name = "AppleVerifyError";
  }
}

function isEnvMismatch(err: unknown): boolean {
  return err instanceof VerificationException && err.status === VerificationStatus.INVALID_ENVIRONMENT;
}

function describe(err: unknown): AppleVerifyError {
  if (err instanceof VerificationException) {
    return new AppleVerifyError(`Chữ ký Apple không hợp lệ (${VerificationStatus[err.status] ?? err.status})`, err.status);
  }
  return new AppleVerifyError((err as Error)?.message || "Không xác minh được chữ ký Apple", null);
}

/**
 * Xác minh JWS giao dịch; trả kèm môi trường đã khớp. Thử Production trước,
 * chỉ khi lỗi đúng INVALID_ENVIRONMENT mới thử Sandbox (lỗi khác = từ chối).
 */
export async function verifyAppleTransaction(
  jws: string
): Promise<{ txn: JWSTransactionDecodedPayload; env: AppleEnv }> {
  try {
    return { txn: await verifierFor("Production").verifyAndDecodeTransaction(jws), env: "Production" };
  } catch (err) {
    if (!isEnvMismatch(err)) throw describe(err);
  }
  try {
    return { txn: await verifierFor("Sandbox").verifyAndDecodeTransaction(jws), env: "Sandbox" };
  } catch (err) {
    throw describe(err);
  }
}

/** Xác minh thông báo máy chủ App Store (signedPayload) — cùng luật hai môi trường. */
export async function verifyAppleNotification(
  signedPayload: string
): Promise<{ payload: ResponseBodyV2DecodedPayload; env: AppleEnv }> {
  try {
    return { payload: await verifierFor("Production").verifyAndDecodeNotification(signedPayload), env: "Production" };
  } catch (err) {
    if (!isEnvMismatch(err)) throw describe(err);
  }
  try {
    return { payload: await verifierFor("Sandbox").verifyAndDecodeNotification(signedPayload), env: "Sandbox" };
  } catch (err) {
    throw describe(err);
  }
}
