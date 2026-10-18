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
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useAuth } from "@/auth/AuthContext";
import { homePathFor } from "@/lib/permissions";
import { ApiError } from "@/api/client";
import { SocialCancelledError, appleSignInAvailable, googleSignInAvailable } from "@/auth/social";
import { GoogleLogo } from "@/components/GoogleLogo";
import { useKeyboardScroll } from "@/lib/useKeyboardScroll";

const TERMS_URL = "https://hubsell.vn/terms";
const PRIVACY_URL = "https://hubsell.vn/privacy";

/** Web /login đọc ?mode=forgot → mở thẳng form Quên mật khẩu (cùng link thư "Mật khẩu vừa đổi"). */
const FORGOT_PASSWORD_URL = "https://app.hubsell.vn/login?mode=forgot";

/** Cỡ nút tròn Google / Apple (1.3.1, học Salework V3.3.5). Hai nút cùng cỡ, cùng hàng — Apple 4.8. */
const SOCIAL_SIZE = 56;

export default function LoginScreen() {
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();
  const router = useRouter();
  const scheme = useColorScheme();
  const { scrollRef, onInputFocus } = useKeyboardScroll();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // "Sử dụng tài khoản nhân viên" (1.3.1): chỉ đổi nhãn + placeholder ô nhập
  // sang dạng chủshop/nhânviên — backend nhận chung identifier, không đổi.
  const [staffMode, setStaffMode] = useState(false);
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

  const showApple = appleReady && Platform.OS === "ios";
  const anySocial = googleReady || showApple;
  const locked = busy || socialBusy !== null;

  return (
    // behavior="padding" cho CẢ Android: app chạy tràn viền (edge-to-edge) nên
    // Android không tự co màn khi bàn phím mở — để undefined là bàn phím che
    // ô Mật khẩu (anh Trung 04/10). Bàn phím đóng thì form tự về giữa màn.
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior="padding"
    >
      <ScrollView
        ref={scrollRef}
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
            {staffMode ? "Tài khoản nhân viên" : "Tên đăng nhập"}
          </Text>
          <TextInput
            className="mb-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-3 text-sm text-slate-900 dark:text-slate-100"
            placeholder={staffMode ? "tênchủshop/têncủabạn" : "Email hoặc tên đăng nhập"}
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={staffMode ? "default" : "email-address"}
            value={identifier}
            onChangeText={setIdentifier}
            onFocus={onInputFocus}
          />

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
              onFocus={onInputFocus}
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
            disabled={locked}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-semibold text-white">Đăng nhập</Text>
            )}
          </Pressable>

          {/* Link kiểu Salework thay dòng chú thích cũ "Nhân viên đăng nhập dạng: …" */}
          <Pressable
            className="mt-3 self-center active:opacity-70"
            onPress={() => setStaffMode((s) => !s)}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {staffMode ? "Dùng tài khoản chủ shop" : "Sử dụng tài khoản nhân viên"}
            </Text>
          </Pressable>

          {anySocial && (
            <>
              <Text className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
                Hoặc đăng nhập với
              </Text>

              {/* Hàng icon tròn cách đều (1.3.1): Apple nền đen logo trắng (iOS),
                  Google nền trắng viền xám logo G màu. Không Facebook (chưa nối).
                  Apple HIG cho nút "logo-only" tròn nếu giữ đúng logo + tương phản,
                  nên tự vẽ Pressable — expo-apple-authentication không có kiểu này. */}
              <View className="mt-3 flex-row items-center justify-center gap-6">
                {showApple && (
                  <Pressable
                    onPress={() => void runSocial("apple")}
                    disabled={locked}
                    accessibilityRole="button"
                    accessibilityLabel="Đăng nhập bằng Apple"
                    className="items-center justify-center rounded-full bg-black active:opacity-80 dark:bg-white"
                    style={{ width: SOCIAL_SIZE, height: SOCIAL_SIZE }}
                  >
                    {socialBusy === "apple" ? (
                      <ActivityIndicator size="small" color={scheme === "dark" ? "#000" : "#fff"} />
                    ) : (
                      <Ionicons
                        name="logo-apple"
                        size={30}
                        color={scheme === "dark" ? "#000" : "#fff"}
                        // Logo Apple lệch lên một chút so với tâm hình học.
                        style={{ marginTop: -3 }}
                      />
                    )}
                  </Pressable>
                )}
                {googleReady && (
                  <Pressable
                    onPress={() => void runSocial("google")}
                    disabled={locked}
                    accessibilityRole="button"
                    accessibilityLabel="Đăng nhập bằng Google"
                    className="items-center justify-center rounded-full border border-slate-200 bg-white active:opacity-80 dark:border-slate-600"
                    style={{ width: SOCIAL_SIZE, height: SOCIAL_SIZE }}
                  >
                    {socialBusy === "google" ? (
                      <ActivityIndicator size="small" color="#64748b" />
                    ) : (
                      <GoogleLogo size={26} />
                    )}
                  </Pressable>
                )}
              </View>

              {/* Đồng ý ngầm (backend ghi nguồn google_app / apple_app) — giống dòng
                  dưới nút Google trên web. Chỉ điều khoản, không chữ gói / giá. */}
              <Text className="mt-4 text-center text-[10px] leading-4 text-slate-400 dark:text-slate-500">
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
        </View>

        {/* Dưới cùng như Salework: Quên mật khẩu? · Đăng ký. Màn Đăng ký trong
            app quay lại từ 1.3.1 (anh Trung chốt 18/10) — iOS đã có IAP nên tài
            khoản mới có đường mua hợp lệ trong app (hết vướng Apple 3.1.1). */}
        <View className="mt-6 flex-row items-center justify-center gap-3">
          <Pressable
            className="active:opacity-70"
            onPress={() => void Linking.openURL(FORGOT_PASSWORD_URL)}
            hitSlop={8}
            accessibilityRole="link"
          >
            <Text className="text-sm text-slate-500 dark:text-slate-400">Quên mật khẩu?</Text>
          </Pressable>
          <Text className="text-sm text-slate-300 dark:text-slate-600">·</Text>
          <Pressable
            className="active:opacity-70"
            onPress={() => router.push("/register" as Href)}
            hitSlop={8}
            accessibilityRole="link"
          >
            <Text className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Đăng ký
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
