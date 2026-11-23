import React from "react";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { accessOf, type AppAccess } from "@/lib/permissions";
import { AppTabBar, type AppTab } from "@/components/AppTabBar";

/**
 * KHU CHÍNH của app — chủ shop VÀ nhân viên dùng chung một thanh tab, mỗi tab
 * hiện theo quyền (23/11/2026, anh Trung: "nhân viên anh cấp full quyền nhưng
 * vào thì lại không đủ"). Trước đó nhân viên có khu riêng `(warehouse)` cố định
 * Kho · [QR] · Cấu hình bất kể quyền; khu đó đã bỏ. Tên nhóm `(admin)` giữ lại
 * vì đường dẫn thông báo đẩy và nhánh thử đang trỏ vào nó.
 *
 * Thanh tab 04/10 (anh Trung): Trang chủ · Đơn hàng · [QR] · Kho · Cấu hình.
 *   Trang chủ  — có ít nhất một trong Tổng quan / Tài chính / Quảng cáo;
 *   Đơn hàng   — quyền Đơn hàng;
 *   [QR]       — quyền Đơn hàng (API tra đơn + đóng gói gác bằng quyền đó). Nút
 *                nằm CHÍNH GIỮA dù số tab hai bên lệch nhau (AppTabBar);
 *   Kho        — Tồn kho (quyền Tổng kho hoặc Đơn hàng) / Đơn hoàn (quyền Đối
 *                soát đơn hoàn), nút quét nhận đơn hoàn nằm trong đó;
 *   Cấu hình   — ai cũng có.
 * Màn nào cũng tự gác lại bằng RequireAccess — thanh tab chỉ là phần nhìn thấy.
 */
const TABS: (AppTab & { allow: (a: AppAccess) => boolean })[] = [
  { name: "home", label: "Trang chủ", icon: "home-outline", iconActive: "home", allow: (a) => a.home },
  { name: "orders", label: "Đơn hàng", icon: "bag-handle-outline", iconActive: "bag-handle", allow: (a) => a.orders },
  { name: "scan", label: "Quét mã", icon: "qr-code-outline", iconActive: "qr-code", qr: true, allow: (a) => a.orders },
  { name: "warehouse", label: "Kho", icon: "cube-outline", iconActive: "cube", allow: (a) => a.warehouse },
  { name: "settings", label: "Cấu hình", icon: "settings-outline", iconActive: "settings", allow: () => true },
];

export default function MainLayout() {
  const { status, user } = useAuth();
  if (status === "loading") return null;
  if (status === "signedOut" || !user) return <Redirect href="/login" />;
  const access = accessOf(user);
  // Không có tab làm việc nào (chỉ được cấp quyền của những mục app chưa có,
  // vd Hóa đơn & Thuế) → màn "chưa có quyền", không để họ lạc vào Cấu hình trống.
  if (!access.home && !access.orders && !access.warehouse) return <Redirect href="/no-access" />;

  const tabs = TABS.filter((t) => t.allow(access));
  // Tab ĐƯỢC THẤY xếp trước: phím Back của Android đưa về tab đầu của navigator
  // (mặc định "firstRoute") — tab đó phải là tab người này vào được, không thì
  // nhân viên không có Trang chủ bấm Back sẽ bị đẩy vòng qua cổng quyền mãi.
  const screens = [...tabs, ...TABS.filter((t) => !t.allow(access))];

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <AppTabBar {...props} tabs={tabs} />}
    >
      {screens.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}
