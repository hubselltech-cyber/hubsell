import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { CostPricesScreen } from "@/screens/CostPricesScreen";

/** Màn Giá vốn (nhập nhanh SKU còn thiếu, 28/10/2026) — Stack gốc, chỉ chủ shop. */
export default function CostPricesRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (user.role !== "ADMIN") return <Redirect href="/" />;
  return <CostPricesScreen />;
}
