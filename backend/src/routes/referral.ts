// ============================================================
// /api/referral — Affiliate Tiếp Thị & Ví Hubsell (phía SELLER).
//
// Chỉ ADMIN (chủ shop) — nhân viên không có ví riêng. KHÔNG gác requireChannel:
// giới thiệu bạn bè không phụ thuộc shop đã kết nối gian hàng hay chưa.
//
// Duyệt lệnh rút là việc của PLATFORM ADMIN (khu /admin) — làm ở giai đoạn
// sau; hiện lệnh nằm PENDING, tiền đã bị giữ khỏi balance ngay lúc đặt.
// ============================================================

import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import {
  MIN_WITHDRAWAL_AMOUNT,
  creditReferralCommission,
  ensureReferralCode,
} from "../referral-wallet";

const router = Router();

// Link chia sẻ trỏ về LANDING (hubsell.tech) — trang đăng ký landing dẫn tiếp
// sang app kèm ?ref=. Dev local chưa chạy landing thì đổi qua env cho tiện test.
const REFERRAL_LINK_BASE =
  process.env.REFERRAL_LINK_BASE ?? "https://hubsell.tech/register";

/**
 * GÓI GIA HẠN (KHUNG DEMO — đồng bộ Feature Matrix trên landing, CHƯA thương
 * mại hóa). Khi có bảng giá thật chỉ cần sửa một chỗ này.
 */
const RENEWAL_PACKAGES = [
  { id: "STARTER_1M", name: "Starter — 1 tháng", price: 199_000 },
  { id: "STARTER_12M", name: "Starter — 12 tháng", price: 1_990_000 },
  { id: "PRO_1M", name: "Professional — 1 tháng", price: 499_000 },
  { id: "PRO_12M", name: "Professional — 12 tháng", price: 4_990_000 },
] as const;

const toNumber = (d: Prisma.Decimal | null | undefined) =>
  d ? Number(d) : 0;

// GET /api/referral/summary — mã + link + 4 chỉ số + số dư ví.
router.get("/summary", async (req: AuthRequest, res, next) => {
  try {
    const userId = req.userId!;
    const referralCode = await ensureReferralCode(userId);

    const [wallet, referredCount, commissionAgg] = await Promise.all([
      prisma.hubsellWallet.findUnique({ where: { userId } }),
      prisma.user.count({ where: { referredById: userId } }),
      prisma.walletTransaction.aggregate({
        where: { userId, type: "COMMISSION", status: { not: "REJECTED" } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    res.json({
      referralCode,
      referralLink: `${REFERRAL_LINK_BASE}?ref=${referralCode}`,
      stats: {
        /** Tổng số người đăng ký qua link/mã của tôi. */
        referredCount,
        /** Số lượt thanh toán thành công đã phát sinh hoa hồng. */
        paidCount: commissionAgg._count,
        /** Tổng hoa hồng 10% tích lũy từ trước đến nay. */
        totalCommission: toNumber(commissionAgg._sum.amount),
        /** Số dư khả dụng hiện tại của Ví Hubsell. */
        balance: toNumber(wallet?.balance),
      },
      packages: RENEWAL_PACKAGES,
      minWithdrawal: MIN_WITHDRAWAL_AMOUNT,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/referral/history — bạn bè đã đăng ký + sổ cái ví + lệnh rút.
router.get("/history", async (req: AuthRequest, res, next) => {
  try {
    const userId = req.userId!;

    const [referrals, perFriend, transactions, withdrawals] = await Promise.all([
      prisma.user.findMany({
        where: { referredById: userId },
        select: { id: true, fullName: true, email: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      // Gom hoa hồng theo TỪNG người được giới thiệu (ai đã đóng bao nhiêu).
      prisma.walletTransaction.groupBy({
        by: ["sourceUserId"],
        where: { userId, type: "COMMISSION", status: { not: "REJECTED" } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.withdrawalRequest.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const bySource = new Map(
      perFriend.map((g) => [
        g.sourceUserId,
        { paidCount: g._count, totalCommission: toNumber(g._sum.amount) },
      ])
    );

    res.json({
      referrals: referrals.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        email: r.email,
        registeredAt: r.createdAt,
        paidCount: bySource.get(r.id)?.paidCount ?? 0,
        totalCommission: bySource.get(r.id)?.totalCommission ?? 0,
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: toNumber(t.amount),
        status: t.status,
        note: t.note,
        createdAt: t.createdAt,
      })),
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        amount: toNumber(w.amount),
        bankName: w.bankName,
        bankAccountNumber: w.bankAccountNumber,
        bankAccountName: w.bankAccountName,
        status: w.status,
        reviewNote: w.reviewNote,
        createdAt: w.createdAt,
        processedAt: w.processedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/referral/withdraw — đặt lệnh rút về ngân hàng.
// Tiền bị TRỪ NGAY khỏi balance (giữ chỗ, chống đặt trùng vượt số dư);
// lệnh nằm PENDING chờ platform admin duyệt, từ chối thì hoàn bằng ADJUSTMENT.
router.post("/withdraw", async (req: AuthRequest, res, next) => {
  try {
    const userId = req.userId!;
    const { amount, bankName, bankAccountNumber, bankAccountName } =
      req.body ?? {};

    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value) || value < MIN_WITHDRAWAL_AMOUNT) {
      res.status(400).json({
        error: `Số tiền rút tối thiểu là ${MIN_WITHDRAWAL_AMOUNT.toLocaleString("vi-VN")}₫`,
      });
      return;
    }
    for (const [field, label] of [
      [bankName, "tên ngân hàng"],
      [bankAccountNumber, "số tài khoản"],
      [bankAccountName, "tên chủ tài khoản"],
    ] as const) {
      if (typeof field !== "string" || !field.trim()) {
        res.status(400).json({ error: `Vui lòng nhập ${label}` });
        return;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Trừ CÓ ĐIỀU KIỆN balance >= amount ngay trong UPDATE — hai lệnh rút
      // bắn cùng lúc thì lệnh sau tự trượt, không bao giờ âm ví.
      const deducted = await tx.hubsellWallet.updateMany({
        where: { userId, balance: { gte: value } },
        data: { balance: { decrement: value } },
      });
      if (deducted.count !== 1) return null;

      const request = await tx.withdrawalRequest.create({
        data: {
          userId,
          amount: value,
          bankName: bankName.trim(),
          bankAccountNumber: bankAccountNumber.trim(),
          bankAccountName: bankAccountName.trim(),
        },
      });
      await tx.walletTransaction.create({
        data: {
          userId,
          type: "WITHDRAWAL",
          amount: -value,
          status: "PENDING",
          withdrawalRequestId: request.id,
          note: `Rút về ${bankName.trim()} — ${bankAccountNumber.trim()}`,
        },
      });
      return request;
    });

    if (!result) {
      res.status(400).json({ error: "Số dư Ví Hubsell không đủ" });
      return;
    }
    res.status(201).json({
      id: result.id,
      amount: value,
      status: result.status,
      message: "Đã tạo yêu cầu rút tiền — Hubsell sẽ duyệt trong 1-2 ngày làm việc.",
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/referral/renew — DÙNG VÍ GIA HẠN GÓI (khung demo, chưa thương mại
// hóa). Trừ thẳng số dư; và vì đây cũng là MỘT LƯỢT THANH TOÁN THÀNH CÔNG nên
// người đã giới thiệu TÔI (nếu có) tiếp tục nhận 10% — "hoa hồng vĩnh viễn".
router.post("/renew", async (req: AuthRequest, res, next) => {
  try {
    const userId = req.userId!;
    const pkg = RENEWAL_PACKAGES.find((p) => p.id === req.body?.packageId);
    if (!pkg) {
      res.status(400).json({ error: "Gói gia hạn không hợp lệ" });
      return;
    }

    const ok = await prisma.$transaction(async (tx) => {
      const deducted = await tx.hubsellWallet.updateMany({
        where: { userId, balance: { gte: pkg.price } },
        data: { balance: { decrement: pkg.price } },
      });
      if (deducted.count !== 1) return false;
      await tx.walletTransaction.create({
        data: {
          userId,
          type: "PACKAGE_RENEWAL",
          amount: -pkg.price,
          note: `Gia hạn gói ${pkg.name} bằng Ví Hubsell`,
        },
      });
      return true;
    });

    if (!ok) {
      res.status(400).json({ error: "Số dư Ví Hubsell không đủ để gia hạn gói này" });
      return;
    }

    // Gia hạn = thanh toán thành công → chảy tiếp 10% cho người giới thiệu tôi.
    await creditReferralCommission(userId, pkg.price);

    res.json({ ok: true, package: pkg, message: `Đã gia hạn ${pkg.name} thành công.` });
  } catch (err) {
    next(err);
  }
});

// POST /api/referral/mock/payment — MÔ PHỎNG một người được giới thiệu thanh
// toán thành công, để test luồng cộng hoa hồng 10% khi CHƯA có cổng thanh toán.
// CHỈ TỒN TẠI Ở DEV — production trả 404 như thể endpoint không có.
router.post("/mock/payment", async (req: AuthRequest, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { payerEmail, amount } = req.body ?? {};
    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value) || value <= 0) {
      res.status(400).json({ error: "Số tiền thanh toán không hợp lệ" });
      return;
    }
    if (typeof payerEmail !== "string" || !payerEmail.trim()) {
      res.status(400).json({ error: "Thiếu email người thanh toán" });
      return;
    }
    const payer = await prisma.user.findUnique({
      where: { email: payerEmail.trim().toLowerCase() },
      select: { id: true, referredById: true },
    });
    if (!payer) {
      res.status(404).json({ error: "Không tìm thấy tài khoản với email này" });
      return;
    }
    if (!payer.referredById) {
      res.status(400).json({
        error: "Tài khoản này không được ai giới thiệu — không phát sinh hoa hồng",
      });
      return;
    }
    const txn = await creditReferralCommission(
      payer.id,
      value,
      `[DEMO] Hoa hồng 10% từ thanh toán ${value.toLocaleString("vi-VN")}₫ của ${payerEmail.trim()}`
    );
    res.json({ ok: true, commission: txn ? Number(txn.amount) : 0 });
  } catch (err) {
    next(err);
  }
});

export default router;
