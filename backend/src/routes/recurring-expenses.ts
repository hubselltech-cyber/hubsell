import { Router } from "express";
import { ExpenseCategory, ExpenseType, RecurringCadence, RecurringStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { toBusinessDateKey } from "../lib/date-range";
import {
  MAX_ACTIVE_RULES,
  addDays,
  checkRecurringSchedule,
  dateToDayKey,
  dayKeyToDate,
  nextOccurrence,
  type RecurringCadenceKey,
} from "../lib/recurring-expense";
import { VALID_EXPENSE_CATEGORIES, resolveExpenseFund } from "../services/expense-input";
import { generateRecurringExpenses } from "../services/recurring-expense";

// ============================================================
// LUẬT CHI PHÍ ĐỊNH KỲ — gắn dưới /api/expenses/recurring (cùng quyền finance.expenses).
// Luật chỉ là LỊCH; tiền vào báo cáo qua các dòng OperatingExpense do
// services/recurring-expense.ts ghi (docs/THU-CHI-VAN-HANH-CHI-PHI-DINH-KY.md).
//
//   GET    /            danh sách luật + đã ghi bao nhiêu + ngày ghi kế tiếp
//   POST   /            tạo luật; ngày bắt đầu ≤ hôm nay thì GHI BÙ ngay trong cùng giao dịch
//   POST   /:id/stop    dừng: ghi nốt tới hôm nay rồi thôi, các khoản đã ghi giữ nguyên
//   DELETE /:id         xóa luật + MỌI khoản luật đã ghi
// ============================================================

const router = Router();

/** Trần số tiền của cột DECIMAL(12,2). */
const MAX_AMOUNT = 9_999_999_999.99;

// GET /api/expenses/recurring
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const rules = await prisma.recurringExpense.findMany({
      where: { userId: ownerId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { fundChannel: { select: { channelName: true, shopName: true } } },
    });
    const stats = rules.length
      ? await prisma.operatingExpense.groupBy({
          by: ["recurringId"],
          where: { userId: ownerId, recurringId: { in: rules.map((r) => r.id) } },
          _count: { _all: true },
          _sum: { amount: true },
        })
      : [];
    const statById = new Map(stats.map((s) => [s.recurringId, s]));
    res.json(
      rules.map((r) => {
        const s = statById.get(r.id);
        const endDay = r.endDay ? dateToDayKey(r.endDay) : null;
        return {
          id: r.id,
          name: r.name,
          category: r.category,
          type: r.type,
          appliedSku: r.appliedSku,
          amount: Number(r.amount),
          cadence: r.cadence,
          startDay: dateToDayKey(r.startDay),
          endDay,
          status: r.status,
          fundChannelId: r.fundChannelId,
          fundPlatform: r.fundPlatform,
          fundSource: r.fundSource,
          fundChannelName: r.fundChannel?.channelName ?? null,
          fundShopName: r.fundChannel?.shopName ?? null,
          note: r.note,
          entryCount: s?._count._all ?? 0,
          entryTotal: Number(s?._sum.amount ?? 0),
          // Ngày máy sẽ ghi khoản kế tiếp — chỉ luật còn chạy mới có.
          nextDay:
            r.status === RecurringStatus.ACTIVE
              ? nextOccurrence({
                  cadence: r.cadence as RecurringCadenceKey,
                  start: dateToDayKey(r.startDay),
                  after: dateToDayKey(r.generatedThrough),
                  end: endDay,
                })
              : null,
          createdAt: r.createdAt,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/recurring — tạo luật chi phí định kỳ
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const { name, category, type, appliedSku, amount, note, cadence, startDay, endDay, fundChannelId, fundPlatform } =
      req.body ?? {};

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Vui lòng nhập nội dung khoản chi" });
      return;
    }
    const amt = typeof amount === "string" ? Number(amount) : amount;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt <= 0 || amt > MAX_AMOUNT) {
      res.status(400).json({ error: "Số tiền mỗi lần phải là số dương" });
      return;
    }
    if (!VALID_EXPENSE_CATEGORIES.includes(category)) {
      res.status(400).json({ error: "Nhóm chi phí không hợp lệ (RENT, SALARY, PACKAGING, ADS, OTHER)" });
      return;
    }
    // Chi phí định kỳ phần lớn là khoản đều kỳ (kho, lương…) → mặc định CỐ ĐỊNH.
    const finalType: ExpenseType = type === ExpenseType.VARIABLE ? ExpenseType.VARIABLE : ExpenseType.FIXED;
    const finalAppliedSku =
      finalType === ExpenseType.VARIABLE && typeof appliedSku === "string" && appliedSku.trim()
        ? appliedSku.trim()
        : null;
    if (note !== undefined && note !== null && typeof note !== "string") {
      res.status(400).json({ error: "Ghi chú không hợp lệ" });
      return;
    }

    const schedule = checkRecurringSchedule({ cadence, startDay, endDay });
    if (!schedule.ok) {
      res.status(400).json({ error: schedule.error });
      return;
    }
    const start = startDay as string;
    const end = endDay ? (endDay as string) : null;

    const fund = await resolveExpenseFund({ fundChannelId, fundPlatform }, ownerId);
    if (!fund.ok) {
      res.status(fund.status).json({ error: fund.error });
      return;
    }

    const active = await prisma.recurringExpense.count({
      where: { userId: ownerId, status: RecurringStatus.ACTIVE },
    });
    if (active >= MAX_ACTIVE_RULES) {
      res.status(400).json({
        error: `Đang có ${active} khoản định kỳ còn chạy (tối đa ${MAX_ACTIVE_RULES}) — dừng bớt khoản không dùng rồi tạo mới`,
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const rule = await tx.recurringExpense.create({
        data: {
          userId: ownerId,
          name: name.trim(),
          category: category as ExpenseCategory,
          type: finalType,
          appliedSku: finalAppliedSku,
          amount: amt,
          cadence: cadence as RecurringCadence,
          startDay: dayKeyToDate(start),
          endDay: end ? dayKeyToDate(end) : null,
          fundChannelId: fund.fundChannelId,
          fundPlatform: fund.fundPlatform,
          fundSource: fund.fundSource,
          note: typeof note === "string" && note.trim() ? note.trim() : null,
          // Mốc "đã xét" lùi một ngày trước ngày bắt đầu → lượt ghi đầu lấy cả ngày bắt đầu.
          generatedThrough: dayKeyToDate(addDays(start, -1)),
        },
        select: { id: true },
      });
      // Ngày bắt đầu ≤ hôm nay: ghi bù ngay để chủ shop thấy số liền, không chờ worker.
      const gen = await generateRecurringExpenses({ ruleId: rule.id, todayKey: toBusinessDateKey(new Date()) }, tx);
      return { id: rule.id, created: gen.created };
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/recurring/:id/stop — dừng luật, giữ các khoản đã ghi
router.post("/:id/stop", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const rule = await prisma.recurringExpense.findFirst({
      where: { id: String(req.params.id), userId: ownerId },
      select: { id: true, status: true },
    });
    if (!rule) {
      res.status(404).json({ error: "Không tìm thấy khoản chi phí định kỳ" });
      return;
    }
    if (rule.status !== RecurringStatus.ACTIVE) {
      res.json({ ok: true });
      return;
    }
    await prisma.$transaction(async (tx) => {
      // "Dừng" = thôi từ NGÀY MAI: khoản của hôm nay (nếu worker chưa kịp ghi) vẫn được ghi.
      await generateRecurringExpenses({ ruleId: rule.id, todayKey: toBusinessDateKey(new Date()) }, tx);
      // Vừa ghi xong mà trùng ngày kết thúc thì luật đã tự sang ENDED — không ghi đè.
      await tx.recurringExpense.updateMany({
        where: { id: rule.id, status: RecurringStatus.ACTIVE },
        data: { status: RecurringStatus.STOPPED, stoppedAt: new Date() },
      });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/expenses/recurring/:id — xóa luật + mọi khoản luật đã ghi
router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const rule = await prisma.recurringExpense.findFirst({
      where: { id: String(req.params.id), userId: ownerId },
      select: { id: true },
    });
    if (!rule) {
      res.status(404).json({ error: "Không tìm thấy khoản chi phí định kỳ" });
      return;
    }
    const [entries] = await prisma.$transaction([
      prisma.operatingExpense.deleteMany({ where: { userId: ownerId, recurringId: rule.id } }),
      prisma.recurringExpense.delete({ where: { id: rule.id } }),
    ]);
    res.json({ ok: true, deletedEntries: entries.count });
  } catch (err) {
    next(err);
  }
});

export default router;
