import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { LabelTemplateScreen } from "@/screens/LabelTemplateScreen";

/**
 * Màn TÙY CHỈNH PHIẾU IN (19/11/2026) — Stack gốc, mở từ hộp Xử lý đơn / hộp In phiếu ở
 * Đơn hàng. Cùng cửa quyền với backend (/api/orders/label-template gác bằng quyền Đơn
 * hàng): nhân viên có quyền Đơn hàng vào XEM được, chỉ chủ shop lưu được (máy chủ chặn).
 */
export default function LabelTemplateRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  const allowed = user.role === "ADMIN" || hasPermission(user.permissions, "orders");
  if (!allowed) return <Redirect href="/no-access" />;
  return <LabelTemplateScreen />;
}
