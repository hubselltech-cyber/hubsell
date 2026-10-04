import React from "react";
import { KhoScreen } from "@/screens/KhoScreen";

/**
 * Tab "Kho" khu nhân viên — cùng màn với chủ shop, tab con hiện theo quyền
 * (warehouse.products → Tồn kho, warehouse.returns → Đơn hoàn).
 */
export default function WarehouseStockTab() {
  return <KhoScreen />;
}
