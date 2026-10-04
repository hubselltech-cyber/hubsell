import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { AccountScreen } from "@/components/AccountScreen";

/**
 * Trang Tài khoản mở từ dòng tên ở màn Cấu hình (đặt ở Stack gốc để phủ kín
 * thanh tab và có mũi tên quay lại; đặt trong nhóm tab là thành một tab mới).
 */
export default function AccountRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  return <AccountScreen />;
}
