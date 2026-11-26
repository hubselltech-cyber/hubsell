import { Router } from "express";
import { ExpenseCategory, ExpenseType, TransactionDirection } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { parseDateRange } from "../lib/date-range";
import { parseExpenseDate } from "../lib/expense-date";
import { VALID_EXPENSE_CATEGORIES, resolveExpenseFund } from "../services/expense-input";
import recurringExpensesRouter from "./recurring-expenses";

// ============================================================
// THU CHI VẬN HÀNH (OperatingExpense — giờ chứa CẢ thu lẫn chi)
// Mỗi bản ghi có `direction` (INCOME|EXPENSE), `amount` luôn DƯƠNG. Khoản gắn
// "nguồn tiền áp dụng" (fundChannelId + fundSource) sẽ được bảng dòng tiền cộng/
// trừ vào đúng cột (Ví sàn / Ngân hàng) của gian tương ứng.
// ============================================================

const router = Router();

// Luật CHI PHÍ ĐỊNH KỲ (máy tự ghi khoản chi theo lịch) — /api/expenses/recurring.
router.use("/recurring", recurringExpensesRouter);

// GET /api/expenses — danh sách THU & CHI vận hành của shop (mới nhất trước)
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.operatingExpense.findMany({
      where: { userId: req.ownerId!, expenseDate: parseDateRange(req.query) },
      orderBy: { expenseDate: "desc" },
      include: { fundChannel: { select: { channelName: true, shopName: true } } },
    });
    res.json(
      rows.map((e) => ({
        id: e.id,
        direction: e.direction,
        name: e.name,
        category: e.category,
        type: e.type,
        appliedSku: e.appliedSku,
        amount: Number(e.amount),
        fundChannelId: e.fundChannelId,
        fundPlatform: e.fundPlatform,
        fundSource: e.fundSource,
        // Khoản do luật chi phí định kỳ ghi (null = nhập tay) — web hiện nhãn "Định kỳ".
        recurringId: e.recurringId,
        fundChannelName: e.fundChannel?.channelName ?? null,
        fundShopName: e.fundChannel?.shopName ?? null,
        note: e.note,
        expenseDate: e.expenseDate,
        createdAt: e.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses — thêm một khoản THU hoặc CHI vận hành
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const {
      direction,
      name,
      category,
      type,
      appliedSku,
      amount,
      note,
      expenseDate,
      fundChannelId,
      fundPlatform,
    } = req.body ?? {};

    // Chiều giao dịch: mặc định CHI để tương thích ngược với form cũ.
    const dir: TransactionDirection =
      direction === TransactionDirection.INCOME
        ? TransactionDirection.INCOME
        : TransactionDirection.EXPENSE;

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Vui lòng nhập tên khoản thu/chi" });
      return;
    }
    const amt = typeof amount === "string" ? Number(amount) : amount;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt <= 0) {
      res.status(400).json({ error: "Số tiền phải là số dương" });
      return;
    }

    // CHI: category bắt buộc hợp lệ (giữ như cũ). THU: bỏ qua, để OTHER.
    let finalCategory: ExpenseCategory = ExpenseCategory.OTHER;
    if (dir === TransactionDirection.EXPENSE) {
      if (!VALID_EXPENSE_CATEGORIES.includes(category)) {
        res.status(400).json({
          error: "Loại chi phí không hợp lệ (RENT, SALARY, PACKAGING, ADS, OTHER)",
        });
        return;
      }
      finalCategory = category as ExpenseCategory;
    }
    const finalType: ExpenseType =
      type === ExpenseType.FIXED ? ExpenseType.FIXED : ExpenseType.VARIABLE;
    // SKU chỉ gắn cho CHI biến đổi (Ads/KOC…) để bóc lời/lỗ theo SKU.
    const finalAppliedSku =
      dir === TransactionDirection.EXPENSE &&
      finalType === ExpenseType.VARIABLE &&
      typeof appliedSku === "string" &&
      appliedSku.trim()
        ? appliedSku.trim()
        : null;

    // NGUỒN TIỀN — TÙY CHỌN ở API (form module gắn shop; quick-add dashboard bỏ trống).
    // Luật ba mức gắn + ép Ngân hàng: services/expense-input.ts.
    const fund = await resolveExpenseFund({ fundChannelId, fundPlatform }, req.ownerId!);
    if (!fund.ok) {
      res.status(fund.status).json({ error: fund.error });
      return;
    }

    if (note !== undefined && typeof note !== "string") {
      res.status(400).json({ error: "Ghi chú không hợp lệ" });
      return;
    }

    // Năm gõ tay 2 chữ số ("0026-…") vẫn là Date hợp lệ → phải chặn theo khoảng năm,
    // không thì khoản chi lọt vào năm 26 và biến mất khỏi mọi báo cáo (lib/expense-date.ts).
    const parsedDate = parseExpenseDate(expenseDate);
    if (!parsedDate.ok) {
      res.status(400).json({ error: parsedDate.error });
      return;
    }
    const date = parsedDate.date;

    const created = await prisma.operatingExpense.create({
      data: {
        userId: req.ownerId!,
        direction: dir,
        name: name.trim(),
        category: finalCategory,
        type: finalType,
        appliedSku: finalAppliedSku,
        amount: amt,
        fundChannelId: fund.fundChannelId,
        fundPlatform: fund.fundPlatform,
        fundSource: fund.fundSource,
        note: typeof note === "string" && note.trim() ? note.trim() : null,
        ...(date ? { expenseDate: date } : {}),
      },
    });
    res.status(201).json({ id: created.id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/expenses/:id — xoá một khoản thu/chi
router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.operatingExpense.findFirst({
      where: { id: req.params.id, userId: req.ownerId! },
      select: { id: true },
    });
    if (!row) {
      res.status(404).json({ error: "Không tìm thấy khoản thu/chi" });
      return;
    }
    await prisma.operatingExpense.delete({ where: { id: row.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
