// ============================================================
// CHI PHÍ NGOÀI ĐƠN của một kỳ — quảng cáo sàn (AdSpend), thu/chi vận hành
// nhập tay. Ba khoản này KHÔNG nằm trong sổ cái đơn; Báo cáo dòng tiền
// (/api/finance/analytics) và Tổng quan Lợi nhuận của trang Lãi/Lỗ
// (/api/finance/realized-pnl/insights) cùng đọc qua đây để hai trang không bao
// giờ lệch nhau về "tiền ngoài đơn" (08/11/2026: khách thắc mắc Lãi/Lỗ ≠ Dòng
// tiền, gốc là 2 khoản này + đơn hủy/đang hoàn — docs/LAI-LO-TONG-QUAN-LOI-NHUAN.md).
//
// Nạp đầu vào song song; phần gom AdSpend cần Σ phí GMV Max theo gian (đọc từ
// sổ cái) nên để `adsSummary(gmvMaxByChannel)` gọi sau khi có bộ tổng.
// ============================================================

import { ExpenseType, TransactionDirection, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { ChannelScope } from "../lib/channel-filter";
import { toBusinessDateKey, type DateRangeFilter } from "../lib/date-range";
import {
  loadAdSpendRows,
  loadShopeeAdsChannels,
  loadTiktokAdsChannels,
  summarizeAdsSpend,
  type AdSpendRow,
  type AdsSpendSummary,
  type ShopeeAdsChannel,
  type TiktokAdsChannel,
} from "./ads-spend";

export interface OffOrderExpenseRow {
  amount: Prisma.Decimal;
  type: ExpenseType;
  category: string;
  expenseDate: Date;
}

export interface OffOrderCostInputs {
  /** Khoản CHI nhập tay trong kỳ (đã lọc gian bằng manualTxnScope). */
  expenses: OffOrderExpenseRow[];
  /** Σ khoản THU vận hành nhập tay (đền bù, thưởng…). */
  operatingIncomeTotal: number;
  /** Σ chi phí nhập tay theo loại — tiện cho nơi chỉ cần tổng. */
  fixedExpenseTotal: number;
  variableExpenseTotal: number;
  adSpendRows: AdSpendRow[];
  tiktokChannels: TiktokAdsChannel[];
  shopeeChannels: ShopeeAdsChannel[];
  /** Gom AdSpend theo luật summarizeAdsSpend (gian TikTok bị thu GMV Max trong đơn chỉ cộng phần vượt). */
  adsSummary: (gmvMaxChargedByChannel: Map<string, number>) => AdsSpendSummary;
}

export async function loadOffOrderCostInputs(input: {
  ownerId: string;
  scope: ChannelScope;
  manualTxnScope: Prisma.OperatingExpenseWhereInput;
  range: DateRangeFilter | undefined;
}): Promise<OffOrderCostInputs> {
  const { ownerId, scope, manualTxnScope, range } = input;
  const [expenses, incomeAgg, adSpendRows, tiktokChannels, shopeeChannels] = await Promise.all([
    prisma.operatingExpense.findMany({
      where: {
        userId: ownerId,
        direction: TransactionDirection.EXPENSE,
        expenseDate: range,
        ...manualTxnScope,
      },
      select: { amount: true, type: true, category: true, expenseDate: true },
    }),
    prisma.operatingExpense.aggregate({
      _sum: { amount: true },
      where: {
        userId: ownerId,
        direction: TransactionDirection.INCOME,
        expenseDate: range,
        ...manualTxnScope,
      },
    }),
    loadAdSpendRows(scope, range),
    loadTiktokAdsChannels(scope),
    loadShopeeAdsChannels(scope),
  ]);
  let fixedExpenseTotal = 0;
  let variableExpenseTotal = 0;
  for (const e of expenses) {
    if (e.type === ExpenseType.FIXED) fixedExpenseTotal += Number(e.amount);
    else variableExpenseTotal += Number(e.amount);
  }
  return {
    expenses,
    operatingIncomeTotal: Number(incomeAgg._sum.amount ?? 0),
    fixedExpenseTotal,
    variableExpenseTotal,
    adSpendRows,
    tiktokChannels,
    shopeeChannels,
    adsSummary: (gmvMaxChargedByChannel) =>
      summarizeAdsSpend({
        rows: adSpendRows,
        gmvMaxChargedByChannel,
        tiktokChannels,
        shopeeChannels,
        dateKey: toBusinessDateKey,
      }),
  };
}
