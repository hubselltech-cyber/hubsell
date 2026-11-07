// ============================================================
// AFFILIATE TIẾP THỊ & VÍ HUBSELL — service dùng chung.
//
// Chương trình referral của CHÍNH nền tảng Hubsell (đừng nhầm với module
// /koc-marketing của chủ shop): Seller giới thiệu bạn bè, mỗi lượt THANH TOÁN
// THÀNH CÔNG của người được giới thiệu chia 10% vào Ví Hubsell người giới
// thiệu — vĩnh viễn, áp dụng cho cả các lần gia hạn về sau.
//
// LƯU Ý THƯƠNG MẠI HÓA: Hubsell chưa có cổng thanh toán thật, nên điểm gọi
// creditReferralCommission() hiện là (1) luồng "Dùng ví gia hạn gói" và
// (2) endpoint mô phỏng thanh toán CHỈ BẬT Ở DEV. Khi cổng thanh toán thật
// (VNPay/Momo/Stripe...) lên sóng, webhook thanh-toán-thành-công chỉ cần gọi
// đúng một hàm này là hoa hồng tự chảy.
// ============================================================

import { prisma } from "../lib/prisma";

/** Tỷ lệ hoa hồng affiliate MẶC ĐỊNH — 10% trên mọi lượt thanh toán thành công. */
export const REFERRAL_COMMISSION_RATE = 0.1;
/** Cùng con số trên, dạng phần trăm — để ghép chuỗi hiển thị và so với mức riêng. */
export const DEFAULT_COMMISSION_PERCENT = 10;

/**
 * Dòng Cộng tác viên đặc biệt rút gọn — đủ để quyết định % (bảng referral_partners,
 * 07/11/2026). Tách kiểu riêng để hàm thuần dưới test được không cần DB.
 */
export interface PartnerRateRow {
  commissionPercent: number;
  startsAt: Date;
  endsAt: Date | null;
}

/**
 * PHẦN TRĂM HOA HỒNG HIỆU LỰC của một người giới thiệu tại thời điểm `at`.
 *
 * Luật (anh Trung 07/11): mọi tài khoản vốn là CTV 10% vĩnh viễn; HQ đặt mức
 * riêng trong một khoảng [startsAt, endsAt). Trong khoảng → % riêng (kể cả khi
 * HQ cố tình HẠ dưới 10%); chưa tới ngày, đã hết hạn, hoặc không có dòng → 10%.
 * Hàm thuần, không đụng DB — creditReferralCommission và /summary cùng dùng.
 */
/** Mức riêng có ĐANG trong khoảng hiệu lực tại `at` không (chưa tới ngày / hết hạn = false). */
export function isPartnerRateActive(partner: PartnerRateRow | null | undefined, at: Date = new Date()): boolean {
  if (!partner) return false;
  if (at < partner.startsAt) return false;
  if (partner.endsAt && at >= partner.endsAt) return false;
  return true;
}

export function resolveCommissionPercent(partner: PartnerRateRow | null | undefined, at: Date = new Date()): number {
  if (!isPartnerRateActive(partner, at)) return DEFAULT_COMMISSION_PERCENT;
  const pct = Number(partner!.commissionPercent);
  return Number.isFinite(pct) && pct >= 0 ? pct : DEFAULT_COMMISSION_PERCENT;
}

/**
 * Đọc dòng CTV đặc biệt của một user (null nếu chưa được HQ đặt) — một câu theo
 * khóa unique, dùng ở cả lúc cộng hoa hồng lẫn trang Affiliate của khách.
 */
export async function getPartnerRate(userId: string): Promise<PartnerRateRow | null> {
  const row = await prisma.referralPartner.findUnique({
    where: { userId },
    select: { commissionPercent: true, startsAt: true, endsAt: true },
  });
  return row ? { ...row, commissionPercent: Number(row.commissionPercent) } : null;
}

/** Rút tối thiểu 100.000₫ — tránh lệnh chuyển khoản lắt nhắt khi duyệt tay. */
export const MIN_WITHDRAWAL_AMOUNT = 100_000;

/**
 * Lấy mã giới thiệu của user — SINH LƯỜI ở lần gọi đầu (user cũ trước tính
 * năng này cũng tự có mã ngay khi mở trang Affiliate).
 *
 * MÃ CÓ CẤU TRÚC "HUBSELL<referralSeq>" (vd HUBSELL102): dễ đọc, dễ nhớ khi
 * chia sẻ miệng, và KHÔNG BAO GIỜ TRÙNG vì referralSeq là số tự tăng unique.
 * User còn giữ mã ngẫu nhiên đời đầu cũng được nâng cấp êm sang định dạng này.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true, referralSeq: true },
  });
  const structured = `HUBSELL${user.referralSeq}`;
  if (user.referralCode === structured) return structured;

  await prisma.user.update({
    where: { id: userId },
    data: { referralCode: structured },
  });
  return structured;
}

/**
 * Tra user theo mã giới thiệu (không phân biệt hoa thường). Trả null nếu mã
 * không tồn tại — luồng đăng ký NUỐT LỖI mã sai chứ không chặn đăng ký.
 */
export async function findReferrerByCode(rawCode: unknown) {
  if (typeof rawCode !== "string") return null;
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(code)) return null;
  return prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });
}

/**
 * CỘNG HOA HỒNG cho người giới thiệu khi `payerUserId` THANH TOÁN THÀNH CÔNG
 * `paidAmount` (VNĐ). Không có người giới thiệu thì trả null (không lỗi).
 * % lấy theo resolveCommissionPercent() TẠI THỜI ĐIỂM thanh toán: 10% mặc định,
 * hoặc mức riêng nếu người giới thiệu là CTV đặc biệt còn hạn. Bút toán ghi rõ
 * % đã áp để sau này đối soát không phải suy ngược.
 *
 * Nguyên tử trong một transaction: upsert ví + increment balance + ghi sổ cái.
 */
export async function creditReferralCommission(
  payerUserId: string,
  paidAmount: number,
  note?: string
) {
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) return null;

  const payer = await prisma.user.findUnique({
    where: { id: payerUserId },
    select: { id: true, email: true, referredById: true },
  });
  if (!payer?.referredById) return null;

  const referrerId = payer.referredById;
  const percent = resolveCommissionPercent(await getPartnerRate(referrerId));
  const commission = Math.round((paidAmount * percent) / 100);
  if (commission <= 0) return null;

  const [, txn] = await prisma.$transaction([
    prisma.hubsellWallet.upsert({
      where: { userId: referrerId },
      create: { userId: referrerId, balance: commission },
      update: { balance: { increment: commission } },
    }),
    prisma.walletTransaction.create({
      data: {
        userId: referrerId,
        type: "COMMISSION",
        amount: commission,
        status: "COMPLETED",
        sourceUserId: payer.id,
        note:
          note ??
          `Hoa hồng ${percent}% từ thanh toán ${paidAmount.toLocaleString("vi-VN")}₫ của ${payer.email}`,
      },
    }),
  ]);
  return txn;
}
