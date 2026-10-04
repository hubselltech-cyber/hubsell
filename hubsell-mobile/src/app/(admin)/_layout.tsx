import React from "react";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/auth/AuthContext";
import { hapticSelect } from "@/lib/haptics";
import { QrTabButton } from "@/components/QrTabButton";

/**
 * Khu CHỦ SHOP — nhân viên lạc vào đây bị đá về cổng phân vai.
 * Thanh tab 04/10 (anh Trung): Trang chủ · Đơn hàng · [QR] · Kho · Cấu hình.
 * Nút QR nằm CHÍNH GIỮA, quét bất kỳ đơn nào để xem chi tiết đơn hàng (shop,
 * trạng thái, sản phẩm, tiền sàn trả — KHÔNG có lãi/lỗ). Kho rời khỏi dãy vuốt ngang của Trang chủ xuống
 * đây: Tồn kho là tab con chính, Đơn hoàn là tab con phụ (nút quét nhận đơn
 * hoàn nằm trong đó).
 */
export default function AdminLayout() {
  const { status, user } = useAuth();
  // Tab bar là component native — không ăn class dark: nên đổi màu bằng JS.
  // Hook đứng trước các return sớm để thứ tự hook không đổi giữa các lần render.
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";

  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (user.role !== "ADMIN") return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? "#f1f5f9" : "#0f172a",
        tabBarInactiveTintColor: dark ? "#64748b" : "#94a3b8",
        tabBarStyle: {
          backgroundColor: dark ? "#0f172a" : "#ffffff",
          borderTopColor: dark ? "#1e293b" : "#e2e8f0",
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
      screenListeners={{ tabPress: () => hapticSelect() }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Trang chủ",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Đơn hàng",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bag-handle-outline" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Quét mã",
          tabBarButton: (p) => <QrTabButton onPress={p.onPress} onLongPress={p.onLongPress} />,
        }}
      />
      <Tabs.Screen
        name="warehouse"
        options={{
          title: "Kho",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Cấu hình",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size - 2} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
