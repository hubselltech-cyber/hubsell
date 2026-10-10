import React from "react";
import { Platform } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { PlanStoreScreen } from "@/components/PlanStoreScreen";

/**
 * Gói dịch vụ — mua qua App Store (10/10/2026). Stack gốc như /account để phủ
 * kín thanh tab. Chỉ iOS: Android chưa nối Google Play Billing nên không có
 * lối vào (SettingsScreen gác) — vào thẳng URL thì về Trang chủ.
 */
export default function PlanRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (Platform.OS !== "ios") return <Redirect href="/" />;
  return <PlanStoreScreen />;
}
