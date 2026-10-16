import React from "react";
import type { Href } from "expo-router";
import { ScanDetailTab } from "@/screens/ScanDetailTab";

/** Nút QR giữa thanh tab khu chủ shop — quét xem chi tiết đơn hàng. */
export default function AdminScanTab() {
  return <ScanDetailTab homeHref={"/(admin)/home" as Href} />;
}
