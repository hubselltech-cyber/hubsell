import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";

/**
 * Pill ▲/▼ % so với kỳ trước. Kỳ trước = 0 mà kỳ này có số → "mới" (không
 * chia 0 ra Infinity); cả hai = 0 → ẩn; kỳ trước KHÔNG CÓ SỐ (null — tải hỏng,
 * không lọc ngày) → ẩn, tuyệt đối không coi là 0 rồi báo "mới" (rà 26/10).
 * % làm tròn 1 chữ số lẻ ở MỌI mức như web (trước đây ≥100% làm tròn số
 * nguyên → "150%" trong khi web "150,4%").
 * Dark mode dùng lại đúng bảng màu của prop onDark (nền tối = nền card tối).
 */
export function DeltaPill({
  current,
  previous,
  suffix = "so hôm qua",
  onDark: onDarkProp = false,
}: {
  current: number;
  previous: number | null | undefined;
  suffix?: string;
  onDark?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const onDark = onDarkProp || colorScheme === "dark";
  if (previous === null || previous === undefined) return null;
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
    label = `${(Math.round(abs * 10) / 10).toFixed(1).replace(".", ",").replace(/,0$/, "")}%`;
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
