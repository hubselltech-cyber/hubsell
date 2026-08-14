import React from "react";
import { Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Cặp chip cho pattern [Bộ lọc] + bottom sheet (màn Đơn hàng đặt chuẩn,
 * trang Kho dùng lại): ActiveChip = bộ lọc đang bật gỡ nhanh bên ngoài,
 * PickChip = chọn một giá trị bên trong panel.
 */

/** Chip bộ lọc đang bật kèm nút gỡ nhanh. */
export function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Pressable
      className="flex-row items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 active:opacity-80 dark:bg-slate-700"
      onPress={onClear}
      hitSlop={4}
    >
      <Text className="text-[11px] font-semibold text-white">{label}</Text>
      <Ionicons name="close" size={11} color="#cbd5e1" />
    </Pressable>
  );
}

/** Chip chọn MỘT giá trị trong panel lọc. */
export function PickChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 ${
        active ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-100 dark:bg-slate-800"
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-xs font-semibold ${active ? "text-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300"}`}
      >
        {label}
      </Text>
      {count !== undefined && count > 0 ? (
        <Text className={`text-[10px] ${active ? "text-slate-300 dark:text-slate-600" : "text-slate-400 dark:text-slate-500"}`}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
