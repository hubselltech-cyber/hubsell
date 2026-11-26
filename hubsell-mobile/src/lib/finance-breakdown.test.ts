/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { costSegments, waterfallSteps } from "./finance-breakdown";
import type { OverviewAnalytics } from "../types/api";

/**
 * Chạy (không cần RN): từ backend/
 *   npx tsx --test ../hubsell-mobile/src/lib/finance-breakdown.test.ts
 *
 * Số mẫu dựng đúng cách backend ghép (routes/analytics.ts):
 *   totalOperatingExpense = chi phí nhập tay (biến đổi + cố định) + quảng cáo + thất thu NGOÀI giá vốn
 *   thất thu ngoài giá vốn = damagedLoss − damagedLossInCost (âm được)
 *   netProfit = totalRevenue − totalCost − totalPlatformFee − totalOperatingExpense + operatingIncome − additionalTax
 */
function sample(over: { damagedLoss?: number; damagedLossInCost?: number; withFields?: boolean } = {}): OverviewAnalytics {
  const damagedLoss = over.damagedLoss ?? 0;
  const damagedLossInCost = over.damagedLossInCost ?? 0;
  const fee = { service: 120_000, affiliate: 30_000, tax: 45_000, refund: 0, voucher: 50_000, shippingDiff: -8_000, adWallet: 0, other: 3_000 };
  const totalPlatformFee = Object.values(fee).reduce((s, n) => s + n, 0);
  const ads = 200_000;
  const variable = 60_000;
  const fixed = 90_000;
  const totalCost = 900_000;
  const totalOperatingExpense = variable + fixed + ads + (damagedLoss - damagedLossInCost);
  const totalRevenue = 3_000_000;
  const operatingIncome = 25_000;
  const additionalTax = 10_000;
  const a = {
    totalRevenue,
    totalCost,
    totalPlatformFee,
    totalPlatformTax: fee.tax,
    platformFeeBreakdown: fee,
    totalOperatingExpense,
    operatingVariableExpense: variable,
    operatingFixedExpense: fixed,
    expensesByCategory: [
      { category: "ADS", amount: ads },
      { category: "PACKAGING", amount: variable },
      { category: "RENT", amount: fixed },
    ],
    operatingIncome,
    additionalTax,
    netProfit: totalRevenue - totalCost - totalPlatformFee - totalOperatingExpense + operatingIncome - additionalTax,
    ...(over.withFields === false ? {} : { damagedLoss, damagedLossInCost }),
  };
  return a as unknown as OverviewAnalytics;
}

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const of = <T extends { key: string; amount: number }>(xs: T[], key: string) => xs.find((x) => x.key === key)?.amount;

/** Hai đẳng thức màn Tài chính phải giữ với MỌI bộ số. */
function assertCloses(a: OverviewAnalytics) {
  assert.equal(
    sum(costSegments(a)),
    (a.totalPlatformFee ?? 0) + (a.totalCost ?? 0) + (a.totalOperatingExpense ?? 0),
    "Σ cơ cấu chi phí = phí sàn + giá vốn + chi phí hoạt động"
  );
  assert.equal(a.totalRevenue - sum(waterfallSteps(a)), a.netProfit, "Tổng giá trị SP − Σ bậc = Lãi ròng");
}

test("không có hàng báo hỏng → không có lát / bậc Thất thu, số như trước", () => {
  const a = sample();
  assert.equal(of(costSegments(a), "damaged"), undefined);
  assert.equal(of(waterfallSteps(a), "damaged"), 0); // chart tự bỏ bậc 0
  assert.equal(of(costSegments(a), "cogs"), 900_000);
  assert.equal(of(waterfallSteps(a), "ops"), 150_000);
  assertCloses(a);
});

test("hàng hỏng thuộc đơn ĐANG tính doanh thu (nằm sẵn trong giá vốn) → tách khỏi Giá vốn thành Thất thu", () => {
  const a = sample({ damagedLoss: 130_000, damagedLossInCost: 130_000 });
  assert.equal(of(costSegments(a), "damaged"), 130_000);
  assert.equal(of(costSegments(a), "cogs"), 770_000);
  assert.equal(of(waterfallSteps(a), "damaged"), 130_000);
  assert.equal(of(waterfallSteps(a), "cogs"), 770_000);
  assert.equal(of(waterfallSteps(a), "ops"), 150_000);
  assertCloses(a);
});

test("hàng hỏng của đơn sàn hủy (ngoài giá vốn) → tách khỏi Vận hành, Giá vốn giữ nguyên", () => {
  const a = sample({ damagedLoss: 92_000, damagedLossInCost: 0 });
  assert.equal(of(costSegments(a), "damaged"), 92_000);
  assert.equal(of(costSegments(a), "cogs"), 900_000);
  assert.equal(of(waterfallSteps(a), "ops"), 150_000);
  assert.equal(of(waterfallSteps(a), "damaged"), 92_000);
  assertCloses(a);
});

test("trộn hai loại + phần ngoài giá vốn ÂM (đơn tạo trong kỳ, kho báo hỏng ở kỳ khác) → vẫn đóng từng đồng", () => {
  assertCloses(sample({ damagedLoss: 257_000, damagedLossInCost: 130_000 }));
  const neg = sample({ damagedLoss: 0, damagedLossInCost: 126_000 });
  assert.equal(of(costSegments(neg), "damaged"), undefined);
  assert.equal(of(costSegments(neg), "cogs"), 774_000);
  // Vận hành không bị kéo lệch: phần âm backend gộp vào chi phí hoạt động được gỡ ra.
  assert.equal(of(waterfallSteps(neg), "ops"), 150_000);
  assert.equal(a_ops(neg), 150_000);
  assert.equal(neg.totalRevenue - sum(waterfallSteps(neg)), neg.netProfit);
});

function a_ops(a: OverviewAnalytics) {
  return sum(costSegments(a).filter((s) => s.key === "varops" || s.key === "fixops"));
}

test("backend bản cũ không gửi hai trường Thất thu → hai khối vẽ như trước, thác vẫn đóng", () => {
  const a = sample({ withFields: false });
  assert.equal(of(costSegments(a), "damaged"), undefined);
  assertCloses(a);
});
