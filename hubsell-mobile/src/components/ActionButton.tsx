import React from "react";
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { RAISED_SHADOW } from "@/theme/tokens";

type Variant = "primary" | "danger" | "neutral";

/**
 * NÚT THAO TÁC CỠ LỚN cho màn kho (anh Trung 03/10: nút "Quét nhận" nền
 * xanh nhạt + chữ trắng gần như vô hình dưới ánh đèn kho, "Quét tiếp" là
 * viên xám nhỏ xấu). Ba biến thể, tương phản cao ở CẢ HAI theme, cao tối
 * thiểu 56px cho tay đeo găng, chữ 16px đậm, phụ đề 12px:
 *   primary — nền emerald-600 đặc, chữ trắng, có bóng nổi (hành động chính);
 *   danger  — nền đỏ nhạt + viền đỏ 2px + chữ đỏ đậm (hành động phá hủy,
 *             nhìn rõ nhưng không "hút" tay bằng primary);
 *   neutral — nền trắng/slate-800 + viền, chữ slate đậm (bỏ qua, quét tiếp).
 */
export function ActionButton({
  label,
  sublabel,
  icon,
  variant = "primary",
  onPress,
  disabled = false,
  loading = false,
  className = "",
  style,
}: {
  label: string;
  sublabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: Variant;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  const base = "min-h-[56px] items-center justify-center rounded-2xl px-4 py-3 active:opacity-85 ";
  const look: Record<Variant, { box: string; text: string; sub: string; icon: string }> = {
    primary: {
      box: "bg-emerald-600 dark:bg-emerald-500",
      text: "text-white",
      sub: "text-emerald-100 dark:text-emerald-950/80",
      icon: "#ffffff",
    },
    danger: {
      box: "bg-red-50 dark:bg-red-500/15 border-2 border-red-500 dark:border-red-400",
      text: "text-red-600 dark:text-red-300",
      sub: "text-red-500/80 dark:text-red-300/70",
      icon: dark ? "#fca5a5" : "#dc2626",
    },
    neutral: {
      box: "bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600",
      text: "text-slate-800 dark:text-slate-100",
      sub: "text-slate-500 dark:text-slate-400",
      icon: dark ? "#e2e8f0" : "#334155",
    },
  };
  const l = look[variant];
  const spinner = variant === "primary" ? "#fff" : l.icon;
  return (
    <Pressable
      className={`${base}${l.box} ${disabled && !loading ? "opacity-50" : ""} ${className}`}
      style={[variant === "primary" ? RAISED_SHADOW : null, style]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label} — ${sublabel}` : label}
    >
      {loading ? (
        <ActivityIndicator color={spinner} />
      ) : (
        <View className="items-center">
          <View className="flex-row items-center gap-2">
            {icon ? <Ionicons name={icon} size={22} color={l.icon} /> : null}
            <Text className={`text-base font-bold ${l.text}`}>{label}</Text>
          </View>
          {sublabel ? (
            <Text className={`mt-0.5 text-xs font-medium ${l.sub}`}>{sublabel}</Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
