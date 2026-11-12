import React from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { ExpensesScreen } from "@/screens/ExpensesScreen";

/** Màn Chi phí vận hành (12/11/2026) — Stack gốc, chỉ chủ shop (số tiền nội bộ). */
export default function ExpensesRoute() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (user.role !== "ADMIN") return <Redirect href="/" />;
  return <ExpensesScreen />;
}
