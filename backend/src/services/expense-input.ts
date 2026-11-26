// ============================================================
// Kiểm đầu vào DÙNG CHUNG của khoản thu/chi vận hành nhập tay (routes/expenses.ts) và
// luật chi phí định kỳ (routes/recurring-expenses.ts) — tách ra 26/11/2026 để hai cửa
// nhập không bao giờ hiểu "nguồn tiền" theo hai kiểu.
// ============================================================

import { ChannelName, ExpenseCategory, FundSourceType } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const VALID_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  ExpenseCategory.RENT,
  ExpenseCategory.SALARY,
  ExpenseCategory.PACKAGING,
  ExpenseCategory.ADS,
  ExpenseCategory.OTHER,
];

export type ExpenseFundResult =
  | {
      ok: true;
      fundChannelId: string | null;
      fundPlatform: ChannelName | null;
      fundSource: FundSourceType | null;
    }
  | { ok: false; status: number; error: string };

/**
 * NGUỒN TIỀN — ba mức gắn (xem chú thích model OperatingExpense):
 *   - fundChannelId thật            → đích danh 1 gian.
 *   - "ALL"/trống + fundPlatform    → khoản CHUNG CẤP SÀN ("Lazada — Tất cả shop").
 *   - "ALL"/trống + không sàn       → khoản CHUNG TOÀN SHOP.
 * Khoản chung không cộng/trừ vào cột dòng tiền của riêng gian nào (fundSource null).
 * ERP CORE LOGIC: mọi khoản thu/chi THỦ CÔNG đi qua NGÂN HÀNG, TUYỆT ĐỐI không đụng Ví
 * sàn (ví sàn chỉ nhận tiền sàn quyết toán về). Vì vậy khi có gắn gian, ÉP fundSource =
 * BANK_ACCOUNT bất kể client gửi gì.
 */
export async function resolveExpenseFund(
  body: { fundChannelId?: unknown; fundPlatform?: unknown },
  ownerId: string
): Promise<ExpenseFundResult> {
  const { fundChannelId, fundPlatform } = body;
  if (fundChannelId && fundChannelId !== "ALL") {
    if (typeof fundChannelId !== "string") {
      return { ok: false, status: 400, error: "Gian hàng cho nguồn tiền không hợp lệ" };
    }
    const channel = await prisma.channel.findFirst({
      where: { id: fundChannelId, userId: ownerId },
      select: { id: true },
    });
    if (!channel) {
      return { ok: false, status: 404, error: "Không tìm thấy gian hàng của nguồn tiền" };
    }
    return {
      ok: true,
      fundChannelId,
      fundPlatform: null,
      fundSource: FundSourceType.BANK_ACCOUNT, // luôn Ngân hàng
    };
  }
  if (fundPlatform !== undefined && fundPlatform !== null && fundPlatform !== "" && fundPlatform !== "ALL") {
    if (typeof fundPlatform !== "string" || !(fundPlatform in ChannelName)) {
      return { ok: false, status: 400, error: "Sàn cho nguồn tiền không hợp lệ" };
    }
    return { ok: true, fundChannelId: null, fundPlatform: fundPlatform as ChannelName, fundSource: null };
  }
  return { ok: true, fundChannelId: null, fundPlatform: null, fundSource: null };
}
