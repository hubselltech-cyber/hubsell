import React from "react";
import { Pressable, Text, View } from "react-native";
import { hapticSelect } from "@/lib/haptics";

/**
 * Thanh tab kiểu segmented — hàng viên thuốc trên nền xám, tab active nổi
 * trắng. Dùng chung cho bộ chọn khoảng thời gian (Tài chính) và tab đơn hoàn
 * (Kho); nhãn do màn hình tự ghép (kèm số đếm nếu cần).
 */
export function SegmentedTabs<K extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: ReadonlyArray<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
  /** Class bổ sung cho khung ngoài — thường là margin của màn hình gọi. */
  className?: string;
}) {
  return (
    <View
      className={`flex-row rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800 ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <Pressable
            key={opt.key}
            className={`flex-1 items-center rounded-lg py-2 ${
              active ? "bg-white dark:bg-slate-600" : ""
            }`}
            style={active ? { elevation: 1 } : undefined}
            onPress={() => {
              if (!active) hapticSelect();
              onChange(opt.key);
            }}
          >
            <Text
              className={`text-xs font-semibold ${
                active
                  ? "text-slate-900 dark:text-slate-50"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
