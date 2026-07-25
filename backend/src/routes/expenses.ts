import { Router } from "express";
import {
  ExpenseCategory,
  ExpenseType,
  FundSourceType,
  TransactionDirection,
} from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { parseDateRange } from "../date-range";

// ============================================================
// THU CHI VẬN HÀNH (OperatingExpense — giờ chứa CẢ thu lẫn chi)
// Mỗi bản ghi có `direction` (INCOME|EXPENSE), `amount` luôn DƯƠNG. Khoản gắn
// "nguồn tiền áp dụng" (fundChannelId + fundSource) sẽ được bảng dòng tiền cộng/
// trừ vào đúng cột (Ví sàn / Ngân hàng) của gian tương ứng.
// ============================================================

const router = Router();

const VALID_CATEGORIES: ExpenseCategory[] = [
  ExpenseCategory.RENT,
  ExpenseCategory.SALARY,
  ExpenseCategory.PACKAGING,
  ExpenseCategory.ADS,
  ExpenseCategory.OTHER,
];
const VALID_SOURCES: FundSourceType[] = [
  FundSourceType.PLATFORM_WALLET,
  FundSourceType.BANK_ACCOUNT,
];

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
        fundSource: e.fundSource,
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
      fundSource,
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
      if (!VALID_CATEGORIES.includes(category)) {
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

    // NGUỒN TIỀN ÁP DỤNG — TÙY CHỌN ở API (form module bắt buộc client-side). Nếu
    // gắn thì gian phải thuộc chủ shop + túi tiền hợp lệ; khoản KHÔNG gắn nguồn
    // vẫn tính vào P&L nhưng không tác động bảng dòng tiền.
    let finalFundChannelId: string | null = null;
    let finalFundSource: FundSourceType | null = null;
    if (fundChannelId || fundSource) {
      if (typeof fundChannelId !== "string" || !fundChannelId) {
        res.status(400).json({ error: "Thiếu gian hàng cho nguồn tiền" });
        return;
      }
      if (!VALID_SOURCES.includes(fundSource)) {
        res.status(400).json({ error: "Nguồn tiền không hợp lệ (Ví sàn / Ngân hàng)" });
        return;
      }
      const channel = await prisma.channel.findFirst({
        where: { id: fundChannelId, userId: req.ownerId! },
        select: { id: true },
      });
      if (!channel) {
        res.status(404).json({ error: "Không tìm thấy gian hàng của nguồn tiền" });
        return;
      }
      finalFundChannelId = fundChannelId;
      finalFundSource = fundSource as FundSourceType;
    }

    if (note !== undefined && typeof note !== "string") {
      res.status(400).json({ error: "Ghi chú không hợp lệ" });
      return;
    }

    let date: Date | undefined;
    if (expenseDate !== undefined && expenseDate !== "") {
      const d = new Date(expenseDate);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Ngày phát sinh không hợp lệ" });
        return;
      }
      date = d;
    }

    const created = await prisma.operatingExpense.create({
      data: {
        userId: req.ownerId!,
        direction: dir,
        name: name.trim(),
        category: finalCategory,
        type: finalType,
        appliedSku: finalAppliedSku,
        amount: amt,
        fundChannelId: finalFundChannelId,
        fundSource: finalFundSource,
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
