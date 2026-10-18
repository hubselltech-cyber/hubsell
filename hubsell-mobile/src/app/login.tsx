import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useAuth } from "@/auth/AuthContext";
import { homePathFor } from "@/lib/permissions";
import { ApiError } from "@/api/client";
import { SocialCancelledError, appleSignInAvailable, googleSignInAvailable } from "@/auth/social";

const TERMS_URL = "https://hubsell.vn/terms";
const PRIVACY_URL = "https://hubsell.vn/privacy";

/** Web /login đọc ?mode=forgot → mở thẳng form Quên mật khẩu (cùng link thư "Mật khẩu vừa đổi"). */
const FORGOT_PASSWORD_URL = "https://app.hubsell.vn/login?mode=forgot";

export default function LoginScreen() {
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();
  const router = useRouter();
  const scheme = useColorScheme();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Nút nào đang chạy — khóa cả 3 nút, chỉ nút đó quay.
  const [socialBusy, setSocialBusy] = useState<"google" | "apple" | null>(null);
  const [appleReady, setAppleReady] = useState(false);
  const googleReady = googleSignInAvailable();

  useEffect(() => {
    let cancelled = false;
    void appleSignInAvailable().then((ok) => {
      if (!cancelled) setAppleReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Google / Apple (bản 1.3.0, anh Trung chốt 18/10): khách đăng ký web bằng
  // Google không có mật khẩu vẫn vào thẳng. Apple 4.8: có Google thì iOS phải
  // có Apple ngang hàng (cùng cỡ, cùng chỗ). Người dùng đóng bộ chọn → im lặng.
  const runSocial = async (kind: "google" | "apple") => {
    if (busy || socialBusy) return;
    setError("");
    setSocialBusy(kind);
    try {
      const user = await (kind === "google" ? signInWithGoogle() : signInWithApple());
      router.replace(homePathFor(user) as Href);
    } catch (err) {
      if (err instanceof SocialCancelledError) return;
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : "Có lỗi xảy ra, thử lại sau"
      );
    } finally {
      setSocialBusy(null);
    }
  };

  const submit = async () => {
    if (busy) return;
    setError("");
    if (!identifier.trim() || !password) {
      setError("Điền tên đăng nhập và mật khẩu");
      return;
    }
    setBusy(true);
    try {
      const user = await signIn(identifier, password);
      router.replace(homePathFor(user) as Href);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    // behavior="padding" cho CẢ Android: app chạy tràn viền (edge-to-edge) nên
    // Android không tự co màn khi bàn phím mở — để undefined là bàn phím che
    // ô Mật khẩu (anh Trung 04/10). Bàn phím đóng thì form tự về giữa màn.
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-10 items-center">
          {/* Logo Hubsell thật (chữ H xanh lá + mũi tên đi lên) — PNG nền
              trắng vuông nên phải bo góc + viền mảnh cho khỏi thô trên nền
              slate-50, kèm bóng nhẹ kiểu app icon. */}
          <Image
            source={require("@/assets/images/logo-hubsell.png")}
            style={{
              width: 72,
              height: 72,
              marginBottom: 12,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: "#e2e8f0",
            }}
            contentFit="contain"
          />
          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">Hubsell</Text>
          <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Trợ lý quảng cáo đa sàn
          </Text>
        </View>

        <View
          className="rounded-2xl bg-white dark:bg-slate-900 p-5"
          style={{
            shadowColor: "#0f172a",
            shadowOpacity: 0.06,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
          }}
        >
          <Text className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            Tên đăng nhập
          </Text>
          <TextInput
            className="mb-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-3 text-sm text-slate-900 dark:text-slate-100"
            placeholder="email, tên đăng nhập hoặc chushop/nhanvien"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            value={identifier}
            onChangeText={setIdentifier}
          />
          <Text className="mb-3 text-[11px] text-slate-400 dark:text-slate-500">
            Nhân viên đăng nhập dạng: tênchủshop/têncủabạn
          </Text>

          <Text className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            Mật khẩu
          </Text>
          <View className="mb-4 flex-row items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950">
            <TextInput
              className="flex-1 px-3.5 py-3 text-sm text-slate-900 dark:text-slate-100"
              placeholder="••••••••"
              placeholderTextColor="#94a3b8"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
            />
            <Pressable
              className="px-3"
              onPress={() => setShowPassword((s) => !s)}
              hitSlop={8}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18}
                color="#94a3b8"
              />
            </Pressable>
          </View>

          {error ? (
            <Text className="mb-3 text-xs text-red-500 dark:text-red-400">{error}</Text>
          ) : null}

          <Pressable
            className="items-center rounded-xl bg-slate-900 py-3.5 active:opacity-80 dark:bg-slate-700"
            onPress={submit}
            disabled={busy || socialBusy !== null}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-semibold text-white">Đăng nhập</Text>
            )}
          </Pressable>

          {(googleReady || appleReady) && (
            <>
              <View className="my-4 flex-row items-center gap-3">
                <View className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                <Text className="text-xs text-slate-400 dark:text-slate-500">Hoặc</Text>
                <View className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              </View>

              {googleReady && (
                <Pressable
                  className="mb-2.5 h-11 flex-row items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white active:opacity-80 dark:border-slate-700 dark:bg-slate-950"
                  onPress={() => void runSocial("google")}
                  disabled={busy || socialBusy !== null}
                  accessibilityRole="button"
                  accessibilityLabel="Tiếp tục với Google"
                >
                  {socialBusy === "google" ? (
                    <ActivityIndicator size="small" color="#64748b" />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={18} color="#4285F4" />
                      <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Tiếp tục với Google
                      </Text>
                    </>
                  )}
                </Pressable>
              )}

              {appleReady && Platform.OS === "ios" && (
                /* Nút chuẩn của Apple (HIG) — không tự vẽ; cùng cao 44 với nút Google. */
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={
                    scheme === "dark"
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={12}
                  style={{ width: "100%", height: 44, opacity: socialBusy === "apple" ? 0.6 : 1 }}
                  onPress={() => void runSocial("apple")}
                />
              )}

              {/* Đồng ý ngầm (backend ghi nguồn google_app / apple_app) — giống dòng
                  dưới nút Google trên web. Chỉ điều khoản, không chữ đăng ký / gói. */}
              <Text className="mt-3 text-center text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                Bằng việc tiếp tục với Google hoặc Apple, bạn đồng ý{" "}
                <Text className="underline" onPress={() => void Linking.openURL(TERMS_URL)}>
                  Điều khoản dịch vụ
                </Text>{" "}
                và{" "}
                <Text className="underline" onPress={() => void Linking.openURL(PRIVACY_URL)}>
                  Chính sách bảo mật
                </Text>{" "}
                của Hubsell.
              </Text>
            </>
          )}

          {/* KHÔNG có màn Đăng ký trong app (anh Trung chốt 08/10 tối, sau khi
              Apple từ chối 3.1.1 lần 2): tài khoản tạo trên bản web — app chỉ
              đăng nhập, như Haravan / Pancake POS. Chỉ chữ, không link, không
              nhắc dùng thử / gói (Apple 3.1.3(f)). Cùng hành vi iOS + Android. */}
          <Text className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
            Dùng tài khoản Hubsell sẵn có của shop bạn.
          </Text>

          {/* Quên mật khẩu → web (/login?mode=forgot mở thẳng form). Bản 1.2.1 dòng
              này còn nhắc "đăng ký bằng Google" — 1.3.0 có nút Google rồi nên rút. */}
          <Pressable
            className="mt-2 active:opacity-70"
            onPress={() => void Linking.openURL(FORGOT_PASSWORD_URL)}
            hitSlop={8}
          >
            <Text className="text-center text-xs text-slate-500 dark:text-slate-400">
              Quên mật khẩu?{" "}
              <Text className="font-medium text-slate-700 underline dark:text-slate-200">
                Đặt lại tại app.hubsell.vn
              </Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
