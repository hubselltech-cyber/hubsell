import React, { useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "../auth/AuthContext";
import { changePassword } from "../api/auth";
import { ApiError } from "../api/client";

/** Tài khoản + đổi mật khẩu + đăng xuất — dùng chung cho cả 2 vai. */
export function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user) return null;

  const identity =
    user.staffUsername && user.username
      ? `${user.username}/${user.staffUsername}`
      : (user.username ?? user.email ?? "");
  const roleLabel = user.role === "ADMIN" ? "Chủ shop" : "Nhân viên";

  const submit = async () => {
    setMessage(null);
    if (!current || !next) {
      setMessage({ ok: false, text: "Điền đủ mật khẩu hiện tại và mật khẩu mới" });
      return;
    }
    if (next !== confirm) {
      setMessage({ ok: false, text: "Mật khẩu nhập lại không khớp" });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setMessage({ ok: true, text: "Đã đổi mật khẩu thành công" });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="mb-4 text-2xl font-bold text-slate-900">Cấu hình</Text>

        <View className="mb-4 rounded-2xl bg-white p-4" style={{ elevation: 2 }}>
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-slate-900">
              <Text className="text-lg font-bold text-white">
                {(user.fullName || "?").charAt(0).toUpperCase()}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-slate-900">
                {user.fullName}
              </Text>
              <Text className="text-xs text-slate-500">
                {identity} · {roleLabel}
              </Text>
            </View>
          </View>
        </View>

        <View className="mb-4 rounded-2xl bg-white p-4" style={{ elevation: 2 }}>
          <Text className="mb-3 text-sm font-semibold text-slate-900">
            Đổi mật khẩu
          </Text>
          <TextInput
            className="mb-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900"
            placeholder="Mật khẩu hiện tại"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={current}
            onChangeText={setCurrent}
          />
          <TextInput
            className="mb-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900"
            placeholder="Mật khẩu mới (tối thiểu 6 ký tự)"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={next}
            onChangeText={setNext}
          />
          <TextInput
            className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900"
            placeholder="Nhập lại mật khẩu mới"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />
          {message ? (
            <Text
              className={`mb-2 text-xs ${message.ok ? "text-emerald-600" : "text-red-500"}`}
            >
              {message.text}
            </Text>
          ) : null}
          <Pressable
            className="items-center rounded-xl bg-slate-900 py-3 active:opacity-80"
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-semibold text-white">Đổi mật khẩu</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          className="flex-row items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white py-3.5 active:opacity-80"
          onPress={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
          <Text className="text-sm font-semibold text-red-500">Đăng xuất</Text>
        </Pressable>

        <Text className="mt-6 text-center text-[11px] text-slate-400">
          Hubsell Mobile · v1.0
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
