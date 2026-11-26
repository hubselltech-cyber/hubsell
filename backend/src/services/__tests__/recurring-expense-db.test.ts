// ============================================================
// Chi phí định kỳ (26/11/2026): câu SQL ghi gộp của services/recurring-expense.ts chạy trên
// DB dev phải ra ĐÚNG các ngày mà phép tính thuần lib/recurring-expense.ts tính ra — hai
// bên là một luật viết hai lần (SQL để ghi, JS để hiện "ngày ghi kế tiếp" + kiểm đầu vào).
// Mỗi ca tạo một chủ shop thử riêng rồi xóa (cascade dọn luật + khoản chi).
// ============================================================

import "../../integrations/__tests__/load-env";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import {
  addDays,
  dateToDayKey,
  dayKeyToDate,
  occurrencesBetween,
  type RecurringCadenceKey,
} from "../../lib/recurring-expense";
import { generateRecurringExpenses } from "../recurring-expense";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "recurring_expenses" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();
if (!dbReady) console.log("[recurring-expense-db.test] BỎ QUA: không nối được DB dev / chưa áp migration");

const TAG = `re-test-${Date.now()}`;
const createdUsers: string[] = [];

async function makeOwner(): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `${TAG}-${createdUsers.length}@test.local`, passwordHash: "x", fullName: "Thử chi phí định kỳ" },
    select: { id: true },
  });
  createdUsers.push(u.id);
  return u.id;
}

async function makeRule(ownerId: string, cadence: RecurringCadenceKey, start: string, end: string | null) {
  return prisma.recurringExpense.create({
    data: {
      userId: ownerId,
      name: `${TAG} ${cadence}`,
      category: "RENT",
      type: "FIXED",
      amount: 100_000,
      cadence,
      startDay: dayKeyToDate(start),
      endDay: end ? dayKeyToDate(end) : null,
      generatedThrough: dayKeyToDate(addDays(start, -1)),
    },
    select: { id: true },
  });
}

async function daysOf(ruleId: string): Promise<string[]> {
  const rows = await prisma.operatingExpense.findMany({
    where: { recurringId: ruleId },
    orderBy: { expenseDate: "asc" },
    select: { expenseDate: true },
  });
  return rows.map((r) => dateToDayKey(r.expenseDate));
}

afterAll(async () => {
  if (createdUsers.length) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe.skipIf(!dbReady)("generateRecurringExpenses — SQL khớp phép tính thuần", () => {
  const cases: { cadence: RecurringCadenceKey; start: string; end: string | null; today: string }[] = [
    { cadence: "DAILY", start: "2026-11-01", end: "2026-11-30", today: "2026-11-10" },
    { cadence: "DAILY", start: "2026-11-01", end: "2026-11-05", today: "2026-11-26" }, // đã hết kỳ
    { cadence: "MONTHLY", start: "2026-01-31", end: null, today: "2026-11-26" }, // kẹp cuối tháng
    { cadence: "MONTHLY", start: "2025-11-05", end: "2026-03-01", today: "2026-11-26" },
    { cadence: "YEARLY", start: "2024-02-29", end: null, today: "2026-11-26" }, // 29/02
    { cadence: "MONTHLY", start: "2026-12-05", end: null, today: "2026-11-26" }, // chưa tới ngày bắt đầu
  ];

  for (const c of cases) {
    it(`${c.cadence} từ ${c.start} tới ${c.end ?? "không hạn"}, hôm nay ${c.today}`, async () => {
      const ownerId = await makeOwner();
      const rule = await makeRule(ownerId, c.cadence, c.start, c.end);
      const r = await generateRecurringExpenses({ ruleId: rule.id, todayKey: c.today });
      const expected = occurrencesBetween({
        cadence: c.cadence,
        start: c.start,
        after: addDays(c.start, -1),
        through: c.today,
        end: c.end,
      });
      expect(await daysOf(rule.id)).toEqual(expected);
      expect(r.created).toBe(expected.length);

      const after = await prisma.recurringExpense.findUniqueOrThrow({ where: { id: rule.id } });
      const ended = c.end !== null && c.end <= c.today;
      expect(after.status).toBe(ended ? "ENDED" : "ACTIVE");
      // Luật chưa tới ngày bắt đầu không bị đụng mốc.
      if (c.start > c.today) expect(dateToDayKey(after.generatedThrough)).toBe(addDays(c.start, -1));
      else expect(dateToDayKey(after.generatedThrough)).toBe(ended ? c.end : c.today);
    });
  }

  it("chạy lại cùng ngày không ghi trùng; sang ngày mới chỉ ghi phần thiếu; dòng xóa tay không bị ghi lại", async () => {
    const ownerId = await makeOwner();
    const rule = await makeRule(ownerId, "DAILY", "2026-11-01", "2026-11-30");
    await generateRecurringExpenses({ ruleId: rule.id, todayKey: "2026-11-03" });
    const again = await generateRecurringExpenses({ ruleId: rule.id, todayKey: "2026-11-03" });
    expect(again).toEqual({ created: 0, rules: 0 });

    // Chủ shop xóa khoản ngày 02/11 (kho nghỉ).
    await prisma.operatingExpense.deleteMany({
      where: { recurringId: rule.id, expenseDate: dayKeyToDate("2026-11-02") },
    });
    // Worker ngừng 2 ngày rồi chạy lại ngày 06/11 → ghi bù 04, 05, 06; không ghi lại 02.
    const next = await generateRecurringExpenses({ ruleId: rule.id, todayKey: "2026-11-06" });
    expect(next.created).toBe(3);
    expect(await daysOf(rule.id)).toEqual(["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  });

  it("khoản ghi ra là khoản CHI thường: chép đủ tên / nhóm / loại / tiền, ngày 00:00 UTC", async () => {
    const ownerId = await makeOwner();
    const rule = await makeRule(ownerId, "DAILY", "2026-11-01", "2026-11-01");
    await generateRecurringExpenses({ ruleId: rule.id, todayKey: "2026-11-26" });
    const [row] = await prisma.operatingExpense.findMany({ where: { recurringId: rule.id } });
    expect(row.userId).toBe(ownerId);
    expect(row.direction).toBe("EXPENSE");
    expect(row.category).toBe("RENT");
    expect(row.type).toBe("FIXED");
    expect(Number(row.amount)).toBe(100_000);
    expect(row.expenseDate.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("luật đã Dừng không ghi thêm; lọc theo chủ shop không đụng luật của người khác", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const stopped = await makeRule(a, "DAILY", "2026-11-01", "2026-11-30");
    await prisma.recurringExpense.update({ where: { id: stopped.id }, data: { status: "STOPPED" } });
    const other = await makeRule(b, "DAILY", "2026-11-01", "2026-11-30");
    const r = await generateRecurringExpenses({ ownerId: a, todayKey: "2026-11-05" });
    expect(r).toEqual({ created: 0, rules: 0 });
    expect(await daysOf(stopped.id)).toEqual([]);
    expect(await daysOf(other.id)).toEqual([]);
  });
});
