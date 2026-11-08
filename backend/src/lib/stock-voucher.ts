// ============================================================
// PHIẾU NHẬP / XUẤT KHO — phần thuần (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 4).
// Số phiếu + ảnh chụp dòng để in lại y nguyên; cùng khuôn với biên bản bàn giao
// (lib/packing-scan.ts): 4 ký tự cuối id, KHÔNG đếm tuần tự để hai người lập
// cùng lúc không đụng số (anh Trung gật 05/11).
// ============================================================

import { randomBytes } from "node:crypto";
import type { InventoryLogType } from "@prisma/client";

export type VoucherType = Extract<InventoryLogType, "IMPORT" | "EXPORT">;

/** Một dòng phiếu — chụp lúc lập, in lại không phụ thuộc tên hàng / giá vốn sau này. */
export interface StockVoucherLine {
  productId: string;
  skuCode: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  /** Giá vốn mặc định của SKU lúc lập (đ). Nhân viên không có quyền tài chính: API cắt khi trả. */
  unitCost: number;
  /** Tồn tổng của SKU ngay sau khi ghi phiếu. */
  balanceAfter: number;
  /** Giá nhập của dòng (đ) — chỉ phiếu NHẬP, tùy chọn (05/11/2026 mục 5). Số tài chính: API cắt như unitCost. */
  purchasePrice?: number | null;
}

/** Trần giá nhập một dòng (đ) — chặn gõ nhầm thừa số 0; DECIMAL(14,2) chứa tới 999 tỷ. */
export const PURCHASE_PRICE_MAX = 10_000_000_000;

/** Đọc giá nhập từ body: số ≥ 0 hữu hạn trong trần → số (làm tròn đồng); rỗng / sai → null. */
export function parsePurchasePrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > PURCHASE_PRICE_MAX) return null;
  return Math.round(n);
}

/**
 * Giá nhập trung bình THEO SỐ LƯỢNG: Σ(số lượng × giá) / Σ số lượng trên các dòng CÓ giá.
 * Không lấy trung bình cộng giá các nhà (nhà nhập 10 cái sẽ kéo lệch nhà nhập 1.000 cái).
 */
export function weightedAveragePrice(value: number, pricedQuantity: number): number | null {
  if (!(pricedQuantity > 0)) return null;
  return Math.round(value / pricedQuantity);
}

/** Date → 'yyyy-MM-dd HH:mm:ss.SSS' UTC để ép ::timestamp trong SQL thô (cột DateTime không múi giờ). */
export function utcTimestampLiteral(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

export function newVoucherId(): string {
  // 24 ký tự hex — đủ duy nhất, 4 ký tự cuối lên số phiếu.
  return `sv${randomBytes(11).toString("hex")}`;
}

/** PN-yyMMdd-XXXX (nhập) / PX-yyMMdd-XXXX (xuất), ngày theo giờ Việt Nam. */
export function stockVoucherCode(type: VoucherType, id: string, at: Date): string {
  const vn = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  const yy = String(vn.getUTCFullYear()).slice(-2);
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  return `${type === "IMPORT" ? "PN" : "PX"}-${yy}${mm}${dd}-${id.slice(-4).toUpperCase()}`;
}

/**
 * Giá trị phiếu = Σ số lượng × đơn giá, đơn giá = GIÁ NHẬP của dòng nếu có ghi (phiếu nhập, 05/11 mục 5),
 * không thì giá vốn mặc định lúc lập. Cùng một luật cho cột Giá trị ở Phiếu kho và bản in — không để
 * hai màn ra hai con số.
 */
export function sumVoucherCost(lines: Pick<StockVoucherLine, "quantity" | "unitCost" | "purchasePrice">[]): number {
  return Math.round(lines.reduce((a, l) => a + l.quantity * (l.purchasePrice ?? l.unitCost), 0));
}

// ============================================================
// CÔNG NỢ NHÀ CUNG CẤP — bản hẹp (08/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 8).
// Khảo sát 10 phần mềm: ở phần mềm bán hàng, công nợ NCC = ĐUÔI CỦA PHIẾU NHẬP ("đã trả / còn nợ")
// cộng dồn theo nhà cung cấp; không định khoản, không tuổi nợ. Anh Trung chốt "Làm bản hẹp NCC":
// chỉ phải trả theo phiếu nhập có nhà cung cấp, KHÔNG đụng Dòng tiền (tiền trả NCC đã nằm trong giá vốn).
// Giá trị phiếu dùng CÙNG luật sumVoucherCost — một con số cho cột Giá trị, bản in và công nợ.
// ============================================================

/** Hai cột ghi sẵn trên phiếu: đã trả + còn nợ. paidAmount null = không theo dõi → cả hai null. */
export function payableFields(totalCost: number, paidAmount: number | null): { paidAmount: number | null; debtAmount: number | null } {
  if (paidAmount === null) return { paidAmount: null, debtAmount: null };
  const paid = Math.max(0, Math.round(paidAmount));
  return { paidAmount: paid, debtAmount: Math.max(0, Math.round(totalCost) - paid) };
}

/** Số tiền một lần trả: số dương hữu hạn trong trần → làm tròn đồng; còn lại null. */
export function parsePaymentAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > PURCHASE_PRICE_MAX) return null;
  return Math.round(n);
}

export type VoucherPaymentMode = "full" | "none" | "partial";

/**
 * Cách thanh toán lúc LẬP phiếu nhập (ô "Thanh toán" trên Phiếu nhiều mã): `full` = trả đủ ngay,
 * `none` = ghi nợ toàn bộ, `partial` = trả một phần (amount < giá trị phiếu). Không gửi → không theo dõi
 * (null): client cũ / app mobile / nhân viên không thấy tài chính không bị gán "đã trả đủ" oan.
 */
export function parseVoucherPayment(
  raw: unknown,
  totalCost: number
): { ok: true; paid: number | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, paid: null };
  if (typeof raw !== "object") return { ok: false, error: "Thông tin thanh toán không hợp lệ" };
  const mode = (raw as { mode?: unknown }).mode;
  const total = Math.round(totalCost);
  if (mode === "full") return { ok: true, paid: total };
  if (mode === "none") return { ok: true, paid: 0 };
  if (mode === "partial") {
    const amount = parsePaymentAmount((raw as { amount?: unknown }).amount);
    if (amount === null) return { ok: false, error: "Nhập số tiền đã trả nhà cung cấp (lớn hơn 0)" };
    if (amount >= total) return { ok: false, error: "Số đã trả bằng hoặc vượt giá trị phiếu — chọn \"Đã trả đủ\"" };
    return { ok: true, paid: amount };
  }
  return { ok: false, error: "Cách thanh toán không hợp lệ" };
}
