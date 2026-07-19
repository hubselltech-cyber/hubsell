import { Router } from "express";
import { ExpenseCategory } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { parseDateRange } from "../date-range";

const router = Router();

const VALID_CATEGORIES: ExpenseCategory[] = [
  ExpenseCategory.RENT,
  ExpenseCategory.SALARY,
  ExpenseCategory.PACKAGING,
  ExpenseCategory.ADS,
  ExpenseCategory.OTHER,
];

// GET /api/expenses — danh sách chi phí hoạt động của shop
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const expenses = await prisma.operatingExpense.findMany({
      where: { userId: req.ownerId!, expenseDate: parseDateRange(req.query) },
      orderBy: { expenseDate: "desc" },
    });
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses — thêm một khoản chi phí
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { name, category, amount, note, expenseDate } = req.body ?? {};

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Vui lòng nhập tên khoản chi" });
      return;
    }
    if (!VALID_CATEGORIES.includes(category)) {
      res.status(400).json({
        error: "Loại chi phí không hợp lệ (RENT, SALARY, PACKAGING, ADS, OTHER)",
      });
      return;
    }
    const amt = typeof amount === "string" ? Number(amount) : amount;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt <= 0) {
      res.status(400).json({ error: "Số tiền phải là số dương" });
      return;
    }
    if (note !== undefined && typeof note !== "string") {
      res.status(400).json({ error: "Ghi chú không hợp lệ" });
      return;
    }

    // Ngày phát sinh: nếu người dùng gửi lên thì dùng, không thì mặc định hôm nay
    let date: Date | undefined;
    if (expenseDate !== undefined && expenseDate !== "") {
      const d = new Date(expenseDate);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Ngày phát sinh không hợp lệ" });
        return;
      }
      date = d;
    }

    const expense = await prisma.operatingExpense.create({
      data: {
        userId: req.ownerId!,
        name: name.trim(),
        category: category as ExpenseCategory,
        amount: amt,
        note: note?.trim() || null,
        ...(date ? { expenseDate: date } : {}),
      },
    });

    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/expenses/:id — xoá một khoản chi phí
router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    const expense = await prisma.operatingExpense.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
    });
    if (!expense) {
      res.status(404).json({ error: "Không tìm thấy khoản chi phí" });
      return;
    }
    await prisma.operatingExpense.delete({ where: { id: expense.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
