import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";

/**
 * Pill ▲/▼ % so với kỳ trước. Kỳ trước = 0 mà kỳ này có số → "mới" (không
 * chia 0 ra Infinity); cả hai = 0 → ẩn (trả null).
 * Dark mode dùng lại đúng bảng màu của prop onDark (nền tối = nền card tối).
 */
export function DeltaPill({
  current,
  previous,
  suffix = "so hôm qua",
  onDark: onDarkProp = false,
}: {
  current: number;
  previous: number;
  suffix?: string;
  onDark?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const onDark = onDarkProp || colorScheme === "dark";
  if (current === 0 && previous === 0) return null;

  let label: string;
  let up: boolean;
  if (previous === 0) {
    label = "mới";
    up = current > 0;
  } else {
    const delta = ((current - previous) / Math.abs(previous)) * 100;
    up = delta >= 0;
    const abs = Math.abs(delta);
    label = `${abs >= 100 ? Math.round(abs) : abs.toFixed(1).replace(".", ",").replace(/,0$/, "")}%`;
  }

  const bg = up
    ? onDark
      ? "bg-emerald-500/20"
      : "bg-emerald-100"
    : onDark
      ? "bg-red-500/20"
      : "bg-red-100";
  const fg = up
    ? onDark
      ? "#34d399"
      : "#059669"
    : onDark
      ? "#f87171"
      : "#dc2626";

  return (
    <View className={`flex-row items-center gap-1 rounded-full px-2 py-0.5 ${bg}`}>
      <Ionicons name={up ? "caret-up" : "caret-down"} size={10} color={fg} />
      <Text className="text-[11px] font-bold" style={{ color: fg }}>
        {label}
      </Text>
      {suffix ? (
        <Text
          className="text-[10px]"
          style={{ color: onDark ? "#94a3b8" : "#64748b" }}
        >
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}
