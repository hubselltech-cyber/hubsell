import React from "react";
import { RequireAccess } from "@/components/RequireAccess";
import { CostPricesScreen } from "@/screens/CostPricesScreen";

/**
 * Màn Giá vốn (nhập nhanh SKU còn thiếu, 28/10/2026) — Stack gốc. Chủ shop và nhân
 * viên có quyền Cấu hình Giá vốn (cùng cửa với /api/finance/sku-products).
 */
export default function CostPricesRoute() {
  return (
    <RequireAccess allow={(a) => a.costPrices}>
      <CostPricesScreen />
    </RequireAccess>
  );
}
