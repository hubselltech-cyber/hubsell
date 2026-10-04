import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { ScanScreen } from "@/screens/ScanScreen";

/**
 * Màn QUÉT NHẬN ĐƠN HOÀN mở từ nút trong Kho → Đơn hoàn (đặt ở Stack gốc để
 * phủ kín thanh tab và có mũi tên quay lại). Nút QR giữa thanh tab là việc
 * khác: xem chi tiết đơn hàng.
 */
export default function ScanReturnsRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  const allowed =
    user.role === "ADMIN" || hasPermission(user.permissions, "warehouse.returns");
  if (!allowed) return <Redirect href="/no-access" />;
  return <ScanScreen />;
}
