import React from "react";
import { RequireAccess } from "@/components/RequireAccess";
import { NotificationsScreen } from "@/screens/NotificationsScreen";

/**
 * Trang Thông báo (chuông) — Stack gốc để phủ thanh tab. Chủ shop + nhân viên có
 * chuông (23/11/2026); máy chủ chỉ trả dòng trong phạm vi của người gọi.
 */
export default function NotificationsRoute() {
  return (
    <RequireAccess allow={(a) => a.notifications}>
      <NotificationsScreen />
    </RequireAccess>
  );
}
