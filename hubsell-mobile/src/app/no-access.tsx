import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/auth/AuthContext";

/** Nhân viên chưa được cấp quyền "Đối soát đơn hoàn" — app mobile v1 chỉ phục vụ kho. */
export default function NoAccessScreen() {
  const { signOut } = useAuth();
  const router = useRouter();
  return (
    <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950 px-8">
      <Ionicons name="lock-closed-outline" size={48} color="#94a3b8" />
      <Text className="mt-4 text-center text-base font-semibold text-slate-900 dark:text-slate-100">
        Tài khoản chưa có quyền dùng app
      </Text>
      <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
        App mobile hiện dành cho nhân viên kho (quyền "Đối soát đơn hoàn").
        Nhờ chủ shop cấp quyền, hoặc dùng bản web app.hubsell.tech.
      </Text>
      <Pressable
        className="mt-6 rounded-xl bg-slate-900 px-6 py-3 active:opacity-80 dark:bg-slate-700"
        onPress={async () => {
          await signOut();
          router.replace("/login");
        }}
      >
        <Text className="text-sm font-semibold text-white">Đăng xuất</Text>
      </Pressable>
    </View>
  );
}
