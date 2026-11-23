import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/auth/AuthContext";

/**
 * Nhân viên chưa được cấp quyền nào trong các mục app có: Tổng quan, Đơn hàng, Kho,
 * Báo cáo dòng tiền, Trợ lý quảng cáo (các mục khác — KOC, Hóa đơn & Thuế, Trợ lý vận
 * hành… — mới có trên web).
 */
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
        App hiện có các mục Tổng quan, Đơn hàng, Kho, Báo cáo dòng tiền và Trợ lý
        quảng cáo. Nhờ chủ shop cấp một trong các quyền đó, hoặc dùng bản web
        app.hubsell.vn.
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
