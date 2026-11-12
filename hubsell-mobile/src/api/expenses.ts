import { api } from "./client";
import type { ChannelName } from "../types/api";

/**
 * CHI PHÍ VẬN HÀNH (12/11/2026) — cùng route với trang Tài chính → Chi phí của web
 * (backend/src/routes/expenses.ts): GET theo kỳ, POST thêm, DELETE xóa (không có sửa).
 * Bảng OperatingExpense chứa CẢ thu lẫn chi; app chỉ nhập và hiện khoản CHI, khoản thu
 * vẫn làm trên web.
 */
export type ExpenseCategory = "RENT" | "SALARY" | "PACKAGING" | "ADS" | "OTHER";

export interface ExpenseDto {
  id: string;
  direction: "INCOME" | "EXPENSE";
  name: string;
  category: ExpenseCategory;
  type: "FIXED" | "VARIABLE";
  appliedSku: string | null;
  amount: number;
  fundChannelId: string | null;
  fundPlatform: ChannelName | null;
  fundChannelName: ChannelName | null;
  fundShopName: string | null;
  note: string | null;
  expenseDate: string;
  createdAt: string;
}

export function fetchExpenses(from: string, to: string) {
  const q = new URLSearchParams({ from, to }).toString();
  return api<ExpenseDto[]>(`/api/expenses?${q}`);
}

export interface NewExpense {
  name: string;
  amount: number;
  category: ExpenseCategory;
  /** yyyy-mm-dd; bỏ trống = ngay lúc lưu. */
  expenseDate?: string;
  /** Gian đích danh; "" = không gắn gian. */
  fundChannelId?: string;
  /** Khoản chung của cả một sàn (khi không chọn gian). */
  fundPlatform?: string;
  note?: string;
}

/**
 * Nhóm → loại chi phí. Web bắt chọn tay "Cố định / Biến đổi"; app tự suy để form còn ít ô:
 * mặt bằng và lương là khoản đều kỳ, còn lại theo lượng bán.
 */
export function expenseTypeOf(category: ExpenseCategory): "FIXED" | "VARIABLE" {
  return category === "RENT" || category === "SALARY" ? "FIXED" : "VARIABLE";
}

export function createExpense(e: NewExpense) {
  return api<{ id: string }>("/api/expenses", {
    method: "POST",
    body: {
      direction: "EXPENSE",
      name: e.name,
      amount: e.amount,
      category: e.category,
      type: expenseTypeOf(e.category),
      expenseDate: e.expenseDate || undefined,
      fundChannelId: e.fundChannelId || undefined,
      fundPlatform: e.fundChannelId ? undefined : e.fundPlatform || undefined,
      note: e.note || undefined,
    },
  });
}

export function deleteExpense(id: string) {
  return api<{ ok: true }>(`/api/expenses/${encodeURIComponent(id)}`, { method: "DELETE" });
}
