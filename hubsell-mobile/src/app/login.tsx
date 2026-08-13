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
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useAuth } from "@/auth/AuthContext";
import { homePathFor } from "@/lib/permissions";
import { ApiError } from "@/api/client";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-10 items-center">
          {/* Logo Hubsell thật (chữ H xanh lá + mũi tên đi lên) */}
          <Image
            source={require("@/assets/images/logo-hubsell.png")}
            style={{ width: 72, height: 72, marginBottom: 12 }}
            contentFit="contain"
          />
          <Text className="text-2xl font-bold text-slate-900">Hubsell</Text>
          <Text className="mt-1 text-sm text-slate-500">
            Quản lý bán hàng đa kênh
          </Text>
        </View>

        <View
          className="rounded-2xl bg-white p-5"
          style={{
            shadowColor: "#0f172a",
            shadowOpacity: 0.06,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
          }}
        >
          <Text className="mb-1.5 text-xs font-medium text-slate-600">
            Tên đăng nhập
          </Text>
          <TextInput
            className="mb-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900"
            placeholder="email, tên đăng nhập hoặc chushop/nhanvien"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            value={identifier}
            onChangeText={setIdentifier}
          />
          <Text className="mb-3 text-[11px] text-slate-400">
            Nhân viên đăng nhập dạng: tênchủshop/têncủabạn
          </Text>

          <Text className="mb-1.5 text-xs font-medium text-slate-600">
            Mật khẩu
          </Text>
          <View className="mb-4 flex-row items-center rounded-xl border border-slate-200 bg-slate-50">
            <TextInput
              className="flex-1 px-3.5 py-3 text-sm text-slate-900"
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
            <Text className="mb-3 text-xs text-red-500">{error}</Text>
          ) : null}

          <Pressable
            className="items-center rounded-xl bg-slate-900 py-3.5 active:opacity-80"
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-sm font-semibold text-white">Đăng nhập</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
