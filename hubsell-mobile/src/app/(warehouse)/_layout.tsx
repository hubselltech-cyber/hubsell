import React from "react";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/auth/AuthContext";
import { hapticSelect } from "@/lib/haptics";
import { hasPermission } from "@/lib/permissions";

/**
 * Khu KHO — cho nhân viên có quyền "warehouse.returns".
 * ADMIN cũng vào được (nút quét trên tab Đơn hàng) để chủ shop tự thử luồng.
 */
export default function WarehouseLayout() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  const allowed =
    user.role === "ADMIN" || hasPermission(user.permissions, "warehouse.returns");
  if (!allowed) return <Redirect href="/no-access" />;

  // Tab bar là component native — không ăn class dark: nên đổi màu bằng JS
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";

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
        name="scan"
        options={{
          title: "Quét đơn hoàn",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan" size={size - 2} color={color} />
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
