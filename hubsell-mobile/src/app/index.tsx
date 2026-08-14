import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, type Href } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { homePathFor } from "@/lib/permissions";

/**
 * CỔNG ĐIỀU HƯỚNG THEO VAI — điểm vào duy nhất của app:
 *   ADMIN                     → (admin)/finance   (Tài chính & Dòng tiền)
 *   Nhân viên có quyền kho    → (warehouse)/scan  (Quét đơn hoàn)
 *   Nhân viên không quyền kho → /no-access
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
