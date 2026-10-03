import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/auth/AuthContext";
import { homePathFor } from "@/lib/permissions";
import { ApiError } from "@/api/client";
import { checkUsernameAvailable } from "@/api/auth";
import { toAsciiUsername, USERNAME_REGEX } from "@/lib/username";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legal";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{6,15}$/;

type UsernameStatus = "idle" | "checking" | "free" | "taken";

/**
 * ĐĂNG KÝ CHỦ SHOP — cùng bộ trường và cùng luật với form web
 * (frontend/src/app/login/page.tsx, RegisterForm): họ tên, email, tên đăng
 * nhập (kiểm trùng ngay khi gõ), SĐT, mật khẩu ×2, tick Điều khoản.
 * App tiếng Việt → quốc gia cố định VN (backend ghép mã vùng +84).
 * Thành công là backend trả token → vào thẳng Trang chủ, không đăng nhập lại.
 */
export default function RegisterScreen() {
  const { signUp } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  // Tên đăng nhập tự gợi ý từ họ tên cho tới khi người dùng tự sửa ô này.
  const usernameTouched = useRef(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");

  // Đổi tên đăng nhập = đặt lại trạng thái kiểm trùng ngay tại handler
  // (không setState trong effect), effect bên dưới chỉ lo hẹn giờ hỏi server.
  const applyUsername = (raw: string) => {
    const v = toAsciiUsername(raw);
    setUsername(v);
    setUsernameStatus(v.length >= 3 ? "checking" : "idle");
  };
  const onFullNameChange = (v: string) => {
    setFullName(v);
    if (!usernameTouched.current) applyUsername(v);
  };
  const onUsernameChange = (v: string) => {
    usernameTouched.current = true;
    applyUsername(v);
  };

  // Kiểm TRÙNG tên đăng nhập ngay khi gõ (debounce 450ms) — như web, để
  // không điền xong cả form mới dính 409.
  useEffect(() => {
    if (username.length < 3) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailable(username);
        if (!cancelled) setUsernameStatus(res.available ? "free" : "taken");
      } catch {
        if (!cancelled) setUsernameStatus("idle"); // mạng lỗi thì im lặng, server vẫn chặn lúc submit
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  const validate = (): string => {
    if (fullName.trim().length < 2) return "Vui lòng nhập họ tên";
    if (!EMAIL_REGEX.test(email.trim())) return "Email không hợp lệ";
    if (!USERNAME_REGEX.test(username))
      return "Tên đăng nhập: 3-30 ký tự, chữ thường, số, dấu chấm, gạch dưới";
    if (usernameStatus === "taken") return "Tên đăng nhập này đã có người dùng, chọn tên khác nhé";
    if (!PHONE_REGEX.test(phone)) return "Vui lòng nhập số điện thoại hợp lệ (6-15 chữ số)";
    if (password.length < 6) return "Mật khẩu phải có ít nhất 6 ký tự";
    if (password !== confirmPassword) return "Mật khẩu nhập lại không khớp";
    if (!acceptTerms) return "Bạn cần đồng ý Điều khoản dịch vụ và Chính sách bảo mật";
    return "";
  };

  const submit = async () => {
    if (busy) return;
    const problem = validate();
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const user = await signUp({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        username,
        country: "VN",
        phoneNumber: phone,
        ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}),
        acceptTerms: true,
      });
      router.replace(homePathFor(user) as Href);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau");
    } finally {
      setBusy(false);
    }
  };

  const openLegal = (url: string) => {
    void WebBrowser.openBrowserAsync(url);
  };

  const inputClass =
    "rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-3 text-sm text-slate-900 dark:text-slate-100";
  const labelClass = "mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300";

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-6 items-center">
          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Tạo tài khoản
          </Text>
          <Text className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
            Dùng thử miễn phí, không cần thẻ
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
          <Text className={labelClass}>Họ tên</Text>
          <TextInput
            className={`mb-3 ${inputClass}`}
            placeholder="Nguyễn Văn A"
            placeholderTextColor="#94a3b8"
            autoCapitalize="words"
            value={fullName}
            onChangeText={onFullNameChange}
          />

          <Text className={labelClass}>Email</Text>
          <TextInput
            className={`mb-3 ${inputClass}`}
            placeholder="ban@email.com"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />

          <Text className={labelClass}>Tên đăng nhập</Text>
          <View className={`flex-row items-center ${inputClass} py-0`}>
            <TextInput
              className="flex-1 py-3 text-sm text-slate-900 dark:text-slate-100"
              placeholder="vd: shopcuaban"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={onUsernameChange}
            />
            {usernameStatus === "checking" ? (
              <ActivityIndicator size="small" color="#94a3b8" />
            ) : usernameStatus === "free" ? (
              <Ionicons name="checkmark-circle" size={18} color="#10b981" />
            ) : usernameStatus === "taken" ? (
              <Ionicons name="close-circle" size={18} color="#ef4444" />
            ) : null}
          </View>
          <Text
            className={`mb-3 mt-1 text-[11px] ${
              usernameStatus === "taken"
                ? "text-red-500 dark:text-red-400"
                : "text-slate-400 dark:text-slate-500"
            }`}
          >
            {usernameStatus === "taken"
              ? "Tên này đã có người dùng"
              : "Viết liền, không dấu — nhân viên sẽ đăng nhập dạng tênnày/têncủahọ"}
          </Text>

          <Text className={labelClass}>Số điện thoại</Text>
          <View className={`mb-3 flex-row items-center ${inputClass} py-0`}>
            <Text className="mr-2 text-sm text-slate-500 dark:text-slate-400">🇻🇳 +84</Text>
            <TextInput
              className="flex-1 py-3 text-sm text-slate-900 dark:text-slate-100"
              placeholder="0912345678"
              placeholderTextColor="#94a3b8"
              keyboardType="number-pad"
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, ""))}
            />
          </View>

          <Text className={labelClass}>Mật khẩu</Text>
          <View className={`mb-3 flex-row items-center ${inputClass} py-0`}>
            <TextInput
              className="flex-1 py-3 text-sm text-slate-900 dark:text-slate-100"
              placeholder="Ít nhất 6 ký tự"
              placeholderTextColor="#94a3b8"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18}
                color="#94a3b8"
              />
            </Pressable>
          </View>

          <Text className={labelClass}>Nhập lại mật khẩu</Text>
          <TextInput
            className={`mb-3 ${inputClass}`}
            placeholder="••••••••"
            placeholderTextColor="#94a3b8"
            secureTextEntry={!showPassword}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          <Text className={labelClass}>Mã giới thiệu (nếu có)</Text>
          <TextInput
            className={`mb-4 ${inputClass}`}
            placeholder="Để trống nếu không có"
            placeholderTextColor="#94a3b8"
            autoCapitalize="characters"
            autoCorrect={false}
            value={referralCode}
            onChangeText={setReferralCode}
          />

          {/* Click-wrap: tick = giao kết hợp đồng điện tử — backend cũng từ chối
              nếu thiếu, ở đây chặn sớm để báo đúng chỗ. */}
          <Pressable
            className="mb-4 flex-row items-start gap-2.5"
            onPress={() => setAcceptTerms((v) => !v)}
            hitSlop={6}
          >
            <Ionicons
              name={acceptTerms ? "checkbox" : "square-outline"}
              size={20}
              color={acceptTerms ? "#10b981" : "#94a3b8"}
            />
            <Text className="flex-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Tôi đã đọc và đồng ý với{" "}
              <Text
                className="font-semibold text-emerald-600 dark:text-emerald-400"
                onPress={() => openLegal(TERMS_URL)}
              >
                Điều khoản dịch vụ
              </Text>{" "}
              và{" "}
              <Text
                className="font-semibold text-emerald-600 dark:text-emerald-400"
                onPress={() => openLegal(PRIVACY_URL)}
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
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-semibold text-white">Tạo tài khoản</Text>
            )}
          </Pressable>

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-xs text-slate-500 dark:text-slate-400">Đã có tài khoản?</Text>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/login"))}
              hitSlop={8}
            >
              <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Đăng nhập
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
