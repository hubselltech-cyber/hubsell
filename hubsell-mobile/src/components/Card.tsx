import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { CARD_SHADOW } from "@/theme/tokens";

/**
 * Card chuẩn toàn app: nền trắng/slate-900, bo 2xl, bóng 2 lớp + viền hairline
 * (trên nền tối bóng gần vô hình — viền mảnh mới giữ được ranh giới card).
 * Có onPress thì tự thành Pressable với hiệu ứng nhấn.
 */
export function Card({
  children,
  className = "",
  style,
  onPress,
}: {
  children: React.ReactNode;
  /** Class bổ sung — thường là margin/padding của màn hình gọi. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const base =
    "rounded-2xl bg-white dark:bg-slate-900 " +
    "border border-slate-900/5 dark:border-white/5 ";
  if (onPress) {
    return (
      <Pressable
        className={base + "active:opacity-80 " + className}
        style={[CARD_SHADOW, style]}
        onPress={onPress}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View className={base + className} style={[CARD_SHADOW, style]}>
      {children}
    </View>
  );
}
