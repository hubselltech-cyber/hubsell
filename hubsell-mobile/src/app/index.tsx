import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, type Href } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { homePathFor } from "@/lib/permissions";

/**
 * CỔNG ĐIỀU HƯỚNG THEO QUYỀN — điểm vào duy nhất của app:
 *   vào tab ĐẦU TIÊN người đó có quyền: Trang chủ → Đơn hàng → Kho (homePathFor);
 *   chủ shop luôn là Trang chủ; nhân viên không có quyền nào trong đó → /no-access
 */
export default function Gate() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" color="#64748b" />
      </View>
    );
  }
  if (status === "signedOut" || !user) {
    return <Redirect href="/login" />;
  }
  return <Redirect href={homePathFor(user) as Href} />;
}
