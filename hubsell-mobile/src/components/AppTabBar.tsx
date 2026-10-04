import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { hapticSelect } from "@/lib/haptics";

type IconName = keyof typeof Ionicons.glyphMap;

export interface AppTab {
  /** Tên route trong nhóm tab (tên file). */
  name: string;
  label: string;
  /** Icon khi KHÔNG chọn (nét viền) và khi ĐANG chọn (tô đặc). */
  icon: IconName;
  iconActive: IconName;
  /** Nút QR tròn ở giữa — không nhãn, không đổi trạng thái. */
  qr?: boolean;
}

/**
 * THANH TAB DƯỚI dùng chung cho khu chủ shop và khu nhân viên (anh Trung 04/10:
 * "đổi trạng thái đen-trắng giống bản web, bo góc nhẹ nhàng"). Cùng nết với
 * thanh bên của web: mục đang chọn = viên nền bo góc + icon TÔ ĐẶC + chữ đậm;
 * mục còn lại = icon nét viền, chữ xám. Thanh tự chừa phần đáy cho nút điều
 * hướng / vạch vuốt của từng dòng máy (safe area).
 */
export function AppTabBar({
  state,
  navigation,
  tabs,
}: BottomTabBarProps & { tabs: AppTab[] }) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  return (
    <View
      className="flex-row items-center border-t border-slate-200 bg-white px-2 pt-1.5 dark:border-slate-800 dark:bg-slate-900"
      style={{ paddingBottom: Math.max(insets.bottom, 6) }}
    >
      {tabs.map((tab) => {
        const index = state.routes.findIndex((r) => r.name === tab.name);
        if (index < 0) return null;
        const route = state.routes[index];
        const focused = state.index === index;
        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            hapticSelect();
            navigation.navigate(route.name, route.params);
          }
        };

        if (tab.qr) {
          return (
            <Pressable
              key={tab.name}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel="Quét mã xem chi tiết đơn hàng"
              className="flex-1 items-center justify-center active:opacity-80"
            >
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500">
                <Ionicons name="qr-code-outline" size={22} color="#fff" />
              </View>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={tab.name}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            className="flex-1 items-center active:opacity-70"
          >
            {/* Thử máy ảo Android 04/10: đổi nền của một view đang hiện (trong suốt → có màu)
                làm viên MẤT BO GÓC, lần dựng đầu thì bo đúng. Nên nền + bo góc đặt bằng
                style và gắn key theo trạng thái để viên được dựng lại khi đổi tab. */}
            <View
              key={focused ? "on" : "off"}
              className="w-full max-w-[84px] items-center py-1.5"
              style={{
                borderRadius: 16,
                backgroundColor: focused ? (dark ? "#1e293b" : "#f1f5f9") : "transparent",
              }}
            >
              <TabIcon name={focused ? tab.iconActive : tab.icon} focused={focused} />
              <Text
                numberOfLines={1}
                className={`mt-0.5 text-[11px] ${
                  focused
                    ? "font-bold text-slate-900 dark:text-slate-50"
                    : "font-medium text-slate-400 dark:text-slate-500"
                }`}
              >
                {tab.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Icon đổi màu theo class để ăn cả hai giao diện sáng / tối. */
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <Text
      className={
        focused ? "text-slate-900 dark:text-slate-50" : "text-slate-400 dark:text-slate-500"
      }
    >
      <Ionicons name={name} size={22} />
    </Text>
  );
}
