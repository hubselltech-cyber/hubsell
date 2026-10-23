import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { NotificationSettingsScreen } from "@/screens/NotificationSettingsScreen";

/** Cài đặt thông báo — mở từ màn Thông báo hoặc Cấu hình; chỉ chủ shop (GĐ1). */
export default function NotificationSettingsRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (user.role !== "ADMIN") return <Redirect href="/" />;
  return <NotificationSettingsScreen />;
}
