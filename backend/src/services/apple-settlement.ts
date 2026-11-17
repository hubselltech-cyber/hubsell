// ============================================================
// ĐỢT APPLE CHUYỂN TIỀN — đối soát khoản bán gói qua App Store (lát B, 17/11/2026)
//
// Bối cảnh + căn cứ: docs/APPLE-IAP-MUA-GOI-TRONG-APP.md mục "Thuế + sổ sách cho
// khoản Apple". Hubsell xuất hóa đơn ĐỦ giá khách trả ngay ngày mua (Công văn
// 1063/CT-CS); Apple giữ hoa hồng + trừ thuế nhà thầu trên hoa hồng rồi chuyển
// phần còn lại một lần mỗi tháng tài chính.
//
// Ghi nhận một đợt (HQ nhập theo sổ phụ ngân hàng + báo cáo tài chính Apple):
//   - các khoản bán được chọn → appleSettlementId = đợt (hết "chờ Apple chuyển");
//   - phiếu THU  "Apple chuyển tiền"      = tổng khách trả (gross), ngày tiền về;
//   - phiếu CHI  "Hoa hồng App Store"     = gross − tiền về − thuế;
//   - phiếu CHI  "Thuế nhà thầu Apple trừ" = thuế theo báo cáo (bỏ qua nếu 0).
//   Thu − chi = đúng số ngân hàng nhận → khớp sổ phụ; chi phí tách đúng khoản mục.
// Hủy đợt (nhập sai): xóa 2–3 bút toán của đợt + trả các khoản bán về "chờ".
//
// Ghi chép cho kế toán, KHÔNG phải ý kiến cơ quan thuế — cách hạch toán gộp này
// theo Công văn 1063/CT-CS (doanh thu gộp, thù lao Apple là chi phí).
// ============================================================

import { LedgerDirection, LedgerInvoiceStatus, LedgerSource } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { APPLE_RECEIVABLE_WHERE } from "./apple-receivable";

/** Pháp nhân Apple thu hộ + nhận hoa hồng tại Việt Nam (Exhibit A hợp đồng Apple; cổng NCCNN). */
export const APPLE_VENDOR_NAME = "Apple Distribution International Ltd.";
export const APPLE_VENDOR_TAX_CODE = "9000000486";
/** Khoản mục chi mới của sổ quỹ HQ (khớp frontend/src/lib/hq-expense-categories.ts). */
export const APP_STORE_FEE_CATEGORY = "APP_STORE_FEE";

/**
 * Dải hoa hồng "bình thường" để HỎI LẠI người nhập (không chặn). NGƯỠNG TỰ CHỌN:
 * Apple giữ 15 % (Small Business Program) hoặc 30 %, tính trên giá đã trừ VAT ước
 * tính theo tax category (Exhibit B) — nên tỷ lệ trên tổng khách trả có thể lệch
 * vài điểm. Ngoài 10–35 % gần như chắc là nhập nhầm số.
 */
export const COMMISSION_RATE_NORMAL = { min: 0.1, max: 0.35 } as const;

export class AppleSettlementError extends Error {
  constructor(message: string, readonly httpStatus = 400) {
    super(message);
    this.name = "AppleSettlementError";
  }
}

export interface SettlementMath {
  gross: number;
  bank: number;
  tax: number;
  commission: number;
  /** Hoa hồng / tổng khách trả (0–1). */
  commissionRate: number;
  /** true = tỷ lệ ngoài dải bình thường → giao diện hỏi lại. */
  unusualRate: boolean;
}

/** Tính hoa hồng từ tổng khách trả, tiền về, thuế. Ném lỗi nếu số không hợp lý. */
export function computeSettlement(gross: number, bank: number, tax: number): SettlementMath {
  if (!Number.isInteger(bank) || bank <= 0) throw new AppleSettlementError("Số tiền ngân hàng nhận phải là số nguyên dương");
  if (!Number.isInteger(tax) || tax < 0) throw new AppleSettlementError("Thuế Apple trừ phải là số nguyên ≥ 0");
  if (!(gross > 0)) throw new AppleSettlementError("Chưa chọn khoản bán nào");
  const commission = gross - bank - tax;
  if (commission < 0) {
    throw new AppleSettlementError(
      `Tiền về (${bank.toLocaleString("vi-VN")}) + thuế (${tax.toLocaleString("vi-VN")}) lớn hơn tổng khách trả của các khoản đã chọn (${gross.toLocaleString("vi-VN")}) — kiểm lại khoản chọn hoặc số tiền`
    );
  }
  const commissionRate = commission / gross;
  return {
    gross,
    bank,
    tax,
    commission,
    commissionRate,
    unusualRate: commissionRate < COMMISSION_RATE_NORMAL.min || commissionRate > COMMISSION_RATE_NORMAL.max,
  };
}

// ---------------- Danh sách khoản chờ (cho hộp ghi nhận) ----------------

export async function listAppleReceivables() {
  const rows = await prisma.platformLedgerEntry.findMany({
    where: APPLE_RECEIVABLE_WHERE,
    orderBy: { occurredAt: "asc" },
    select: {
      id: true,
      amount: true,
      occurredAt: true,
      note: true,
      invoiceNo: true,
      customer: { select: { fullName: true, email: true } },
    },
  });
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

// ---------------- Ghi nhận / hủy đợt ----------------

export interface CreateSettlementInput {
  entryIds: string[];
  /** Ngày tiền về (yyyy-mm-dd, giờ Việt Nam). */
  receivedOn: string;
  bankAmount: number;
  taxWithheldAmount: number;
  bankRef?: string | null;
  reportRef?: string | null;
  note?: string | null;
  actorId: string | null;
  actorName: string;
}

/** "dd/mm" theo giờ Việt Nam (tự dựng — ICU của Node có bản ra "dd-mm"). */
function ddmm(d: Date): string {
  const vn = new Date(d.getTime() + 7 * 3600_000);
  return `${String(vn.getUTCDate()).padStart(2, "0")}/${String(vn.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function createAppleSettlement(input: CreateSettlementInput) {
  const ids = [...new Set(input.entryIds.filter((x) => typeof x === "string" && x))];
  if (ids.length === 0) throw new AppleSettlementError("Chưa chọn khoản bán nào");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) throw new AppleSettlementError("Ngày tiền về không hợp lệ");
  // 12:00 giờ Việt Nam — ngày không lệch khi hiển thị ở múi giờ khác.
  const receivedAt = new Date(`${input.receivedOn}T12:00:00+07:00`);
  if (Number.isNaN(receivedAt.getTime())) throw new AppleSettlementError("Ngày tiền về không hợp lệ");
  const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

  return prisma.$transaction(async (tx) => {
    const sales = await tx.platformLedgerEntry.findMany({
      where: { ...APPLE_RECEIVABLE_WHERE, id: { in: ids } },
      select: { id: true, amount: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    });
    if (sales.length !== ids.length) {
      throw new AppleSettlementError(
        "Có khoản đã được ghi vào đợt khác hoặc không phải khoản bán qua App Store — tải lại trang rồi chọn lại",
        409
      );
    }
    const gross = sales.reduce((s, x) => s + Number(x.amount), 0);
    const m = computeSettlement(gross, input.bankAmount, input.taxWithheldAmount);
    const reportRef = clean(input.reportRef);

    const settlement = await tx.appleSettlement.create({
      data: {
        receivedAt,
        bankAmount: m.bank,
        grossAmount: m.gross,
        commissionAmount: m.commission,
        taxWithheldAmount: m.tax,
        bankRef: clean(input.bankRef),
        reportRef,
        note: clean(input.note),
        createdById: input.actorId,
        createdByName: input.actorName,
      },
    });

    // Khóa lạc quan: chỉ đóng khoản còn chờ — đua với một lần ghi khác thì hủy cả giao dịch.
    const linked = await tx.platformLedgerEntry.updateMany({
      where: { id: { in: ids }, appleSettlementId: null },
      data: { appleSettlementId: settlement.id },
    });
    if (linked.count !== ids.length) {
      throw new AppleSettlementError("Khoản đã được ghi vào đợt khác cùng lúc — tải lại trang", 409);
    }

    const span = `${ddmm(sales[0].occurredAt)}–${ddmm(sales[sales.length - 1].occurredAt)}`;
    const base = {
      occurredAt: receivedAt,
      appleSettlementId: settlement.id,
      createdById: input.actorId,
      createdByName: input.actorName,
    };
    await tx.platformLedgerEntry.create({
      data: {
        ...base,
        direction: LedgerDirection.IN,
        source: LedgerSource.OTHER,
        amount: m.gross,
        note: `Apple chuyển tiền bán gói App Store — ${sales.length} khoản (${span}), tổng khách trả`,
        // Hóa đơn đã xuất theo từng khoản bán — dòng tiền về không xuất thêm.
        invoiceStatus: LedgerInvoiceStatus.NONE,
      },
    });
    if (m.commission > 0) {
      await tx.platformLedgerEntry.create({
        data: {
          ...base,
          direction: LedgerDirection.OUT,
          source: LedgerSource.OTHER,
          amount: m.commission,
          note: "Hoa hồng App Store — Apple giữ lại, cấn trừ vào tiền chuyển về",
          invoiceStatus: LedgerInvoiceStatus.NONE,
          expenseCategory: APP_STORE_FEE_CATEGORY,
          vendorName: APPLE_VENDOR_NAME,
          vendorTaxCode: APPLE_VENDOR_TAX_CODE,
          inputInvoiceNo: reportRef,
        },
      });
    }
    if (m.tax > 0) {
      await tx.platformLedgerEntry.create({
        data: {
          ...base,
          direction: LedgerDirection.OUT,
          source: LedgerSource.OTHER,
          amount: m.tax,
          note: "Thuế nhà thầu trên hoa hồng — Apple khấu trừ vào tiền chuyển về",
          invoiceStatus: LedgerInvoiceStatus.NONE,
          expenseCategory: APP_STORE_FEE_CATEGORY,
          vendorName: APPLE_VENDOR_NAME,
          vendorTaxCode: APPLE_VENDOR_TAX_CODE,
          inputInvoiceNo: reportRef,
        },
      });
    }
    return { settlement, math: m, saleCount: sales.length };
  });
}

/** Hủy một đợt (nhập sai): xóa bút toán của đợt, trả các khoản bán về "chờ Apple chuyển". */
export async function cancelAppleSettlement(id: string) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.appleSettlement.findUnique({ where: { id } });
    if (!s) throw new AppleSettlementError("Không tìm thấy đợt Apple chuyển này", 404);
    const removed = await tx.platformLedgerEntry.deleteMany({
      where: { appleSettlementId: id, packagePaymentId: null },
    });
    const reopened = await tx.platformLedgerEntry.updateMany({
      where: { appleSettlementId: id, packagePaymentId: { not: null } },
      data: { appleSettlementId: null },
    });
    await tx.appleSettlement.delete({ where: { id } });
    return { settlement: s, removedEntries: removed.count, reopenedSales: reopened.count };
  });
}
