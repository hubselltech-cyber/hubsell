import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/auth/AuthContext";
import { homePathFor } from "@/lib/permissions";
import { ApiError } from "@/api/client";
import { useKeyboardScroll } from "@/lib/useKeyboardScroll";

const TERMS_URL = "https://hubsell.vn/terms";
const PRIVACY_URL = "https://hubsell.vn/privacy";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INPUT_CLS =
  "rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const LABEL_CLS = "mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300";

/**
 * MÀN ĐĂNG KÝ TRONG APP (bản 1.3.1, anh Trung chốt 18/10: "Thêm cả màn đăng ký
 * nữa. Salework được thì mình cũng được"). Đảo quyết định 08/10 (gỡ sau khi
 * Apple từ chối 3.1.1 lần 2): khi đó luồng đăng ký dẫn tới dùng thử / mua gói
 * ngoài IAP; từ 10/10 iOS mua gói qua App Store (màn /plan) nên tài khoản mới
 * có đường mua hợp lệ trong app.
 *
 * Điều kiện giữ để không bị bắt lại (docs DANG-NHAP-GOOGLE-APPLE mục 12.4):
 * chỉ Họ tên / Email / Mật khẩu (+ nhập lại) + ô tick Điều khoản — KHÔNG chữ
 * "dùng thử", "miễn phí", "gói", "giá". Gọi POST /api/auth/register sẵn có
 * (client="app" → bằng chứng đồng ý nguồn register_app), nhận token → vào app
 * như đăng nhập. Chủ shop mới chưa có gian → thẻ "Chưa có gian hàng nào" ở
 * Trang chủ dẫn sang app.hubsell.vn/channels.
 */
export default function RegisterScreen() {
  const { signUp } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { scrollRef, onInputFocus } = useKeyboardScroll();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    setError("");
    if (fullName.trim().length < 2) {
      setError("Nhập họ tên của bạn");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Email không hợp lệ");
      return;
    }
    // Cùng ngưỡng với backend /register (6) — đổi mật khẩu sau đòi 8.
    if (password.length < 6) {
      setError("Mật khẩu cần ít nhất 6 ký tự");
      return;
    }
    if (password !== confirm) {
      setError("Mật khẩu nhập lại không khớp");
      return;
    }
    if (!agreed) {
      setError("Bạn cần đồng ý Điều khoản dịch vụ và Chính sách bảo mật");
      return;
    }
    setBusy(true);
    try {
      const user = await signUp({ fullName, email, password });
      router.replace(homePathFor(user) as Href);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau");
    } finally {
      setBusy(false);
    }
  };

  const goLogin = () => (router.canGoBack() ? router.back() : router.replace("/login"));

  return (
    <KeyboardAvoidingView className="flex-1 bg-slate-50 dark:bg-slate-950" behavior="padding">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-6 flex-row items-center gap-2">
          <Pressable
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
            onPress={goLogin}
            accessibilityRole="button"
            accessibilityLabel="Quay lại đăng nhập"
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={24} color="#64748b" />
          </Pressable>
          <View>
            <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Tạo tài khoản
            </Text>
            <Text className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Tài khoản chủ shop trên Hubsell
            </Text>
          </View>
        </View>

        <View
          className="rounded-2xl bg-white p-5 dark:bg-slate-900"
          style={{
            shadowColor: "#0f172a",
            shadowOpacity: 0.06,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
          }}
        >
          <Text className={LABEL_CLS}>Họ tên</Text>
          <TextInput
            className={`mb-3 ${INPUT_CLS}`}
            placeholder="Nguyễn Văn A"
            placeholderTextColor="#94a3b8"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            value={fullName}
            onChangeText={setFullName}
            onFocus={onInputFocus}
          />

          <Text className={LABEL_CLS}>Email</Text>
          <TextInput
            className={`mb-3 ${INPUT_CLS}`}
            placeholder="ban@example.com"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            onFocus={onInputFocus}
          />

          <Text className={LABEL_CLS}>Mật khẩu</Text>
          <View className="mb-3 flex-row items-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
            <TextInput
              className="flex-1 px-3.5 py-3 text-sm text-slate-900 dark:text-slate-100"
              placeholder="Ít nhất 6 ký tự"
              placeholderTextColor="#94a3b8"
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
              onFocus={onInputFocus}
            />
            <Pressable className="px-3" onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18}
                color="#94a3b8"
              />
            </Pressable>
          </View>

          <Text className={LABEL_CLS}>Nhập lại mật khẩu</Text>
          <TextInput
            className={`mb-4 ${INPUT_CLS}`}
            placeholder="••••••••"
            placeholderTextColor="#94a3b8"
            secureTextEntry={!showPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            value={confirm}
            onChangeText={setConfirm}
            onFocus={onInputFocus}
            onSubmitEditing={submit}
          />

          {/* Tick tay (hợp đồng click-wrap) — backend chặn khi acceptTerms !== true. */}
          <Pressable
            className="mb-4 flex-row items-start gap-2.5 active:opacity-80"
            onPress={() => setAgreed((a) => !a)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            hitSlop={6}
          >
            <Ionicons
              name={agreed ? "checkbox" : "square-outline"}
              size={22}
              color={agreed ? "#059669" : "#94a3b8"}
              style={{ marginTop: -2 }}
            />
            <Text className="flex-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
              Tôi đồng ý với{" "}
              <Text
                className="font-medium text-emerald-700 underline dark:text-emerald-300"
                onPress={() => void Linking.openURL(TERMS_URL)}
              >
                Điều khoản dịch vụ
              </Text>{" "}
              và{" "}
              <Text
                className="font-medium text-emerald-700 underline dark:text-emerald-300"
                onPress={() => void Linking.openURL(PRIVACY_URL)}
              >
                Chính sách bảo mật
              </Text>{" "}
              của Hubsell.
            </Text>
          </Pressable>

          {error ? (
            <Text className="mb-3 text-xs text-red-500 dark:text-red-400">{error}</Text>
          ) : null}

          <Pressable
            className="items-center rounded-xl bg-slate-900 py-3.5 active:opacity-80 dark:bg-slate-700"
            onPress={submit}
            disabled={busy}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-semibold text-white">Tạo tài khoản</Text>
            )}
          </Pressable>
        </View>

        <Pressable className="mt-6 self-center active:opacity-70" onPress={goLogin} hitSlop={8}>
          <Text className="text-sm text-slate-500 dark:text-slate-400">
            Đã có tài khoản?{" "}
            <Text className="font-semibold text-emerald-700 dark:text-emerald-300">Đăng nhập</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
