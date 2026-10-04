import React from "react";
import { ScanDetailTab } from "@/screens/ScanDetailTab";

/**
 * Nút QR giữa thanh tab khu nhân viên — quét xem chi tiết đơn hàng (cần quyền
 * Đơn hàng). Quét NHẬN đơn hoàn nằm trong Kho → Đơn hoàn (/scan-returns).
 */
export default function WarehouseScanTab() {
  return <ScanDetailTab />;
}
