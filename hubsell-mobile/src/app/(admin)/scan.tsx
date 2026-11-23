import React from "react";
import type { Href } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { homePathFor } from "@/lib/permissions";
import { RequireAccess } from "@/components/RequireAccess";
import { ScanDetailTab } from "@/screens/ScanDetailTab";

/**
 * Nút QR giữa thanh tab — quét xem chi tiết đơn / quét nhiều / đóng gói (cần quyền
 * Đơn hàng). Quét NHẬN đơn hoàn nằm trong Kho → Đơn hoàn (/scan-returns).
 * Nút X của màn quét về tab đầu của chính người đó (nhân viên có thể không có Trang chủ).
 */
export default function ScanTab() {
  const { user } = useAuth();
  return (
    <RequireAccess allow={(a) => a.orders}>
      <ScanDetailTab homeHref={(user ? homePathFor(user) : "/") as Href} />
    </RequireAccess>
  );
}
