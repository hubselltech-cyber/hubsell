import React from "react";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { AppTabBar, type AppTab } from "@/components/AppTabBar";

/**
 * Khu NHÂN VIÊN — cùng bố cục với chủ shop, bớt phần tài chính (anh Trung
 * 04/10): Kho · [QR] · Cấu hình. Vào được khi có quyền Đơn hàng hoặc quyền Kho.
 * Nút QR giữa (xem chi tiết đơn hàng) cần quyền Đơn hàng vì API tra đơn gác
 * bằng quyền đó; không có thì nút ẩn. Quét nhận đơn hoàn nằm trong Kho → Đơn hoàn.
 */
const WAREHOUSE_TABS: AppTab[] = [
  { name: "stock", label: "Kho", icon: "cube-outline", iconActive: "cube" },
  { name: "scan", label: "Quét mã", icon: "qr-code-outline", iconActive: "qr-code", qr: true },
  { name: "settings", label: "Cấu hình", icon: "settings-outline", iconActive: "settings" },
];

export default function WarehouseLayout() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  const admin = user.role === "ADMIN";
  const canOrders = admin || hasPermission(user.permissions, "orders");
  const canWarehouse =
    admin ||
    hasPermission(user.permissions, "warehouse.returns") ||
    hasPermission(user.permissions, "warehouse.products");
  if (!canOrders && !canWarehouse) return <Redirect href="/no-access" />;

  // Không có quyền Đơn hàng thì bỏ nút QR khỏi thanh (route vẫn tồn tại nhưng không có lối vào).
  const tabs = WAREHOUSE_TABS.filter((t) => !t.qr || canOrders);

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <AppTabBar {...props} tabs={tabs} />}
    >
      <Tabs.Screen name="stock" />
      <Tabs.Screen name="scan" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
