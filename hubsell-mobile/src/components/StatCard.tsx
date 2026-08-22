import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { compactMoney } from "../lib/format";
import { Card } from "./Card";
import { ICON_TINT, TABULAR, type IconTint } from "../theme/tokens";

/**
 * Thẻ chỉ số của màn Tài chính — số GỌN (1,2 tỷ / 34 tr) vì màn điện thoại
 * không đủ chỗ cho "1.234.567.890 ₫"; số đầy đủ nằm ở dòng phụ.
 * Icon nằm trong chip tint màu riêng từng thẻ — liếc màu là biết thẻ nào.
 */
export function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
  tint = "slate",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  sub?: string;
  tone?: "neutral" | "signal"; // signal: emerald khi dương, red khi âm
  /** Màu chip icon — bảng ICON_TINT trong theme/tokens. */
  tint?: IconTint;
}) {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  const t = ICON_TINT[tint];
  const valueColor =
    tone === "signal"
      ? value < 0
        ? "text-red-500 dark:text-red-400"
        : "text-emerald-600 dark:text-emerald-400"
      : "text-slate-900 dark:text-slate-100";
  return (
    <Card className="flex-1 p-4">
      <View className="mb-2.5 flex-row items-center gap-2">
        <View
          className="h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: dark ? t.dark : t.light }}
        >
          <Ionicons name={icon} size={14} color={t.icon} />
        </View>
        <Text
          className="flex-1 text-xs font-medium text-slate-500 dark:text-slate-400"
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      <Text className={`text-[22px] font-bold ${valueColor}`} style={TABULAR}>
        {compactMoney(value)}
      </Text>
      {sub ? (
        <Text className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
          {sub}
        </Text>
      ) : null}
    </Card>
  );
}
