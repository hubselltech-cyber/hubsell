// Đăng nhập Google / Apple trong app (bản 1.3.0) — gói SDK native lại thành
// hai hàm trả token cho backend; AuthContext chỉ gọi API + lưu phiên.
// Thiết kế: docs/DANG-NHAP-GOOGLE-APPLE-TRONG-APP.md. Cần build native mới
// (EAS) — Expo Go không có hai module này.
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";

/** Người dùng tự đóng bộ chọn tài khoản — màn đăng nhập im lặng, không báo lỗi. */
export class SocialCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "SocialCancelledError";
  }
}

type Extra = { googleIosClientId?: string; googleWebClientId?: string };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** Có client id Google chưa (app.json → extra). Thiếu thì ẩn nút, không để nút chết. */
export function googleSignInAvailable(): boolean {
  return Boolean(extra.googleWebClientId) && (Platform.OS !== "ios" || Boolean(extra.googleIosClientId));
}

let googleConfigured = false;
function ensureGoogleConfigured() {
  if (googleConfigured) return;
  GoogleSignin.configure({
    // webClientId = client "Web application" cùng dự án — bắt buộc để nhận idToken
    // (aud của token Android là client web; backend chấp nhận cả 3 client).
    webClientId: extra.googleWebClientId,
    iosClientId: extra.googleIosClientId,
    offlineAccess: false,
  });
  googleConfigured = true;
}

/** Mở bộ chọn tài khoản Google của máy → idToken cho POST /api/auth/social/google. */
export async function getGoogleIdToken(): Promise<string> {
  ensureGoogleConfigured();
  try {
    await GoogleSignin.hasPlayServices();
    // Đăng xuất phiên SDK cũ để luôn hiện bộ chọn tài khoản (bài học Lazada:
    // dính tài khoản khác là đăng nhập nhầm người).
    await GoogleSignin.signOut().catch(() => {});
    const res = await GoogleSignin.signIn();
    // v13+: người dùng đóng bộ chọn → { type: "cancelled" } (không throw nữa).
    if (isCancelledResponse(res) || !isSuccessResponse(res)) throw new SocialCancelledError();
    const idToken = res.data.idToken;
    if (!idToken) throw new Error("Google không trả idToken — kiểm webClientId trong app.json");
    return idToken;
  } catch (err) {
    if (err instanceof SocialCancelledError) throw err;
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.IN_PROGRESS) throw new Error("Đang có một lượt đăng nhập Google chạy, chờ xong rồi thử lại");
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error("Máy chưa có Google Play Services — đăng nhập bằng email và mật khẩu");
      }
      // DEVELOPER_ERROR: SHA-1 / package chưa khai ở Google Cloud (mục C2 docs).
      throw new Error(`Google từ chối (${err.code}) — kiểm cấu hình OAuth client`);
    }
    throw err;
  }
}

export interface AppleCredential {
  identityToken: string;
  authorizationCode: string | null;
  /** Apple CHỈ gửi tên ở lần đầu — gửi ngay cho backend lần đó. */
  fullName: { givenName: string | null; familyName: string | null } | null;
}

/** Chỉ iOS 13+; Android / web không có. */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function getAppleCredential(): Promise<AppleCredential> {
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!cred.identityToken) throw new Error("Apple không trả identityToken");
    return {
      identityToken: cred.identityToken,
      authorizationCode: cred.authorizationCode ?? null,
      fullName: cred.fullName
        ? { givenName: cred.fullName.givenName ?? null, familyName: cred.fullName.familyName ?? null }
        : null,
    };
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_REQUEST_CANCELED") throw new SocialCancelledError();
    throw err;
  }
}
