import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useNotifications } from "@/notifications/NotificationsContext";
import { hapticTap } from "@/lib/haptics";
import { TABULAR } from "@/theme/tokens";

/**
 * CHUÔNG trên thanh mục Trang chủ (chủ shop) — badge đỏ số chưa đọc (9+ khi
 * vượt 9), bấm mở trang Thông báo. Vùng chạm 40×40 dù icon 22 px.
 */
export function NotificationBell() {
  const router = useRouter();
  const { unread } = useNotifications();
  const dark = useColorScheme().colorScheme === "dark";
  const label = unread > 0 ? `Thông báo, ${unread} chưa đọc` : "Thông báo";
  return (
    <Pressable
      className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
      onPress={() => {
        hapticTap();
        router.push("/notifications");
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
    >
      <Ionicons
        name={unread > 0 ? "notifications" : "notifications-outline"}
        size={22}
        color={dark ? "#e2e8f0" : "#0f172a"}
      />
      {unread > 0 ? (
        <View
          className="absolute right-0.5 top-0.5 min-w-[18px] items-center justify-center rounded-full border-2 border-slate-50 bg-red-500 px-1 dark:border-slate-950"
          style={{ height: 18 }}
        >
          <Text className="text-[10px] font-bold leading-[14px] text-white" style={TABULAR}>
            {unread > 9 ? "9+" : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
