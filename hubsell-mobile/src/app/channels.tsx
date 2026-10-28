import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { ChannelsScreen } from "@/screens/ChannelsScreen";

/**
 * Màn Gian hàng (nối Shopee / TikTok Shop / Lazada ngay trong app, 28/10/2026).
 * Stack gốc để phủ thanh tab; chỉ chủ shop. Cũng là đích deep link
 * `hubsellmobile://channels?shopee=connected…` khi sàn trả về.
 */
export default function ChannelsRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (user.role !== "ADMIN") return <Redirect href="/" />;
  return <ChannelsScreen />;
}
