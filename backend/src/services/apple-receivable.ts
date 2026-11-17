// ============================================================
// PHẢI THU APPLE — khoản bán gói qua App Store chưa về tài khoản (17/11/2026)
//
// Khách mua trong app iOS: Apple thu tiền, giữ hoa hồng (15–30 %) + thuế nhà
// thầu, rồi chuyển phần còn lại khoảng 45 ngày sau tháng tài chính. Hubsell
// vẫn xuất hóa đơn ĐỦ giá khách trả ngay ngày mua (Công văn 1063/CT-CS), nên
// bút toán THU của khoản này là DOANH THU đúng nhưng CHƯA phải tiền trong quỹ.
//
// Lát A (17/11): sổ quỹ HQ không cộng các khoản này vào Tổng THU / chênh lệch,
// mà hiện riêng thành "Apple chưa chuyển về". Hóa đơn, hoa hồng giới thiệu,
// thời hạn gói — không đổi.
//
// Lát B (chưa làm, cần báo cáo tài chính Apple thật): đối soát theo tháng tài
// chính → đóng khoản phải thu + ghi phiếu thu đúng số ngân hàng nhận + chi phí
// hoa hồng / thuế Apple trừ. Khi đó CHỈ sửa điều kiện ở tệp này (thêm "chưa
// đối soát") — mọi chỗ đọc đều đi qua đây.
// ============================================================

import { LedgerDirection, PackagePaymentMethod, type Prisma } from "@prisma/client";

/** Lọc Prisma: bút toán THU của khoản mua qua App Store (còn chờ Apple chuyển). */
export const APPLE_RECEIVABLE_WHERE: Prisma.PlatformLedgerEntryWhereInput = {
  direction: LedgerDirection.IN,
  packagePayment: { method: PackagePaymentMethod.APPLE_IAP },
};

/** Điều kiện SQL thô tương đương, dùng với bí danh bảng sổ quỹ `l`. */
export const APPLE_RECEIVABLE_SQL_NOT = `NOT EXISTS (
  SELECT 1 FROM "package_payments" pp
  WHERE pp."id" = l."packagePaymentId" AND pp."method" = 'APPLE_IAP'
)`;

export interface LedgerCashInput {
  direction: LedgerDirection | "IN" | "OUT";
  amount: number;
  packagePayment: { method: PackagePaymentMethod | string } | null;
}

export function isAppleReceivable(e: LedgerCashInput): boolean {
  return e.direction === LedgerDirection.IN && e.packagePayment?.method === PackagePaymentMethod.APPLE_IAP;
}

/**
 * Tổng tiền quỹ một kỳ: THU chỉ gồm tiền đã vào tài khoản; khoản App Store
 * tách sang `appleAwaiting` (đã xuất hóa đơn, chờ Apple chuyển).
 */
export function ledgerCashTotals(entries: LedgerCashInput[]) {
  let cashIn = 0;
  let cashOut = 0;
  let appleAwaiting = 0;
  let appleAwaitingCount = 0;
  for (const e of entries) {
    if (isAppleReceivable(e)) {
      appleAwaiting += e.amount;
      appleAwaitingCount += 1;
    } else if (e.direction === LedgerDirection.IN) cashIn += e.amount;
    else cashOut += e.amount;
  }
  return { in: cashIn, out: cashOut, net: cashIn - cashOut, appleAwaiting, appleAwaitingCount };
}
