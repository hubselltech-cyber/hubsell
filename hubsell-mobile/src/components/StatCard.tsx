import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { compactMoney } from "../lib/format";

/**
 * Thẻ chỉ số của màn Tài chính — số GỌN (1,2 tỷ / 34 tr) vì màn điện thoại
 * không đủ chỗ cho "1.234.567.890 ₫"; số đầy đủ nằm ở dòng phụ.
 */
export function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  sub?: string;
  tone?: "neutral" | "signal"; // signal: emerald khi dương, red khi âm
}) {
  const valueColor =
    tone === "signal"
      ? value < 0
        ? "text-red-500 dark:text-red-400"
        : "text-emerald-600 dark:text-emerald-400"
      : "text-slate-900 dark:text-slate-100";
  return (
    <View
      className="flex-1 rounded-2xl bg-white p-4 dark:bg-slate-900"
      style={{
        shadowColor: "#0f172a",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      <View className="mb-2 flex-row items-center gap-1.5">
        <Ionicons name={icon} size={14} color="#64748b" />
        <Text className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </Text>
      </View>
      <Text className={`text-2xl font-bold ${valueColor}`}>
        {compactMoney(value)}
      </Text>
      {sub ? (
        <Text className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}
