import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { TiktokVideosScreen } from "@/screens/TiktokVideosScreen";

/**
 * Màn Video của một chiến dịch GMV Max TikTok — ?id=&from=&to=&name=&filter=.
 * Đặt ở Stack gốc (phủ kín thanh tab, có mũi tên về, địa chỉ mở được từ
 * thông báo sau này). Chủ shop loại / khôi phục được; nhân viên có quyền
 * ads.tiktok chỉ xem (backend requireAdmin cho lệnh).
 */
export default function TiktokCampaignRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  const allowed = user.role === "ADMIN" || hasPermission(user.permissions, "ads.tiktok");
  if (!allowed) return <Redirect href="/no-access" />;
  return <TiktokVideosScreen />;
}
