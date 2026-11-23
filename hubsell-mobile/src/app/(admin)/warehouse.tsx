import React from "react";
import { RequireAccess } from "@/components/RequireAccess";
import { KhoScreen } from "@/screens/KhoScreen";

/** Tab "Kho" — Tồn kho (chính) + Đơn hoàn (phụ), tab con hiện theo quyền. */
export default function WarehouseTab() {
  return (
    <RequireAccess allow={(a) => a.warehouse}>
      <KhoScreen />
    </RequireAccess>
  );
}
