import React from "react";
import { RequireAccess } from "@/components/RequireAccess";
import { ExpensesScreen } from "@/screens/ExpensesScreen";

/**
 * Màn Chi phí vận hành (12/11/2026) — Stack gốc. Chủ shop và nhân viên có quyền
 * Thu chi vận hành (cùng cửa với /api/expenses); số tiền nội bộ nên không mở rộng hơn.
 */
export default function ExpensesRoute() {
  return (
    <RequireAccess allow={(a) => a.expenses}>
      <ExpensesScreen />
    </RequireAccess>
  );
}
