import React from "react";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/auth/AuthContext";
import { hapticSelect } from "@/lib/haptics";
import { hasPermission } from "@/lib/permissions";
import { QrTabButton } from "@/components/QrTabButton";

/**
 * Khu NHÂN VIÊN — cùng bố cục với chủ shop, bớt phần tài chính (anh Trung
 * 04/10): Kho · [QR] · Cấu hình. Vào được khi có quyền Đơn hàng hoặc quyền Kho.
 * Nút QR giữa (xem chi tiết đơn hàng) cần quyền Đơn hàng vì API tra đơn gác
 * bằng quyền đó; không có thì nút ẩn. Quét nhận đơn hoàn nằm trong Kho → Đơn hoàn.
 */
export default function WarehouseLayout() {
  const { status, user } = useAuth();
  // Tab bar là component native — không ăn class dark: nên đổi màu bằng JS.
  // Hook phải đứng TRƯỚC các return sớm bên dưới (React cảnh "change in the
  // order of Hooks" khi status đổi loading → signedIn).
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";

  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  const admin = user.role === "ADMIN";
  const canOrders = admin || hasPermission(user.permissions, "orders");
  const canWarehouse =
    admin ||
    hasPermission(user.permissions, "warehouse.returns") ||
    hasPermission(user.permissions, "warehouse.products");
  if (!canOrders && !canWarehouse) return <Redirect href="/no-access" />;

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
        name="stock"
        options={{
          title: "Kho",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        // expo-router không cho đặt href cùng tabBarButton → tách hai nhánh.
        options={
          canOrders
            ? {
                title: "Quét mã",
                tabBarButton: (p) => (
                  <QrTabButton onPress={p.onPress} onLongPress={p.onLongPress} />
                ),
              }
            : { href: null }
        }
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
