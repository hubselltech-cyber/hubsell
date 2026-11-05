import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { PackScanScreen } from "@/screens/PackScanScreen";

/**
 * Màn QUÉT ĐÓNG GÓI mở từ nút "Đóng gói" cạnh ô tìm ở Đơn hàng (đặt ở Stack gốc để phủ
 * kín thanh tab và có mũi tên quay lại). Cùng cửa quyền với backend: /api/orders/packing
 * gác bằng quyền Đơn hàng. Nhân viên vào bằng công tắc ở tab QR giữa (ScanDetailTab).
 */
export default function PackScanRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  const allowed = user.role === "ADMIN" || hasPermission(user.permissions, "orders");
  if (!allowed) return <Redirect href="/no-access" />;
  return <PackScanScreen />;
}
