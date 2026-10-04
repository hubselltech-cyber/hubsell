import React from "react";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { AppTabBar, type AppTab } from "@/components/AppTabBar";

/**
 * Khu CHỦ SHOP — nhân viên lạc vào đây bị đá về cổng phân vai.
 * Thanh tab 04/10 (anh Trung): Trang chủ · Đơn hàng · [QR] · Kho · Cấu hình.
 * Nút QR nằm CHÍNH GIỮA, quét bất kỳ đơn nào để xem chi tiết đơn hàng (shop,
 * trạng thái, sản phẩm, tiền sàn trả — KHÔNG có lãi/lỗ). Kho rời khỏi dãy vuốt ngang của Trang chủ xuống
 * đây: Tồn kho là tab con chính, Đơn hoàn là tab con phụ (nút quét nhận đơn
 * hoàn nằm trong đó).
 */
const ADMIN_TABS: AppTab[] = [
  { name: "home", label: "Trang chủ", icon: "home-outline", iconActive: "home" },
  { name: "orders", label: "Đơn hàng", icon: "bag-handle-outline", iconActive: "bag-handle" },
  { name: "scan", label: "Quét mã", icon: "qr-code-outline", iconActive: "qr-code", qr: true },
  { name: "warehouse", label: "Kho", icon: "cube-outline", iconActive: "cube" },
  { name: "settings", label: "Cấu hình", icon: "settings-outline", iconActive: "settings" },
];

export default function AdminLayout() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  if (user.role !== "ADMIN") return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <AppTabBar {...props} tabs={ADMIN_TABS} />}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="orders" />
      <Tabs.Screen name="scan" />
      <Tabs.Screen name="warehouse" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
