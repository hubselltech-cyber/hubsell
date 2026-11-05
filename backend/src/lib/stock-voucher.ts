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

export function sumVoucherCost(lines: Pick<StockVoucherLine, "quantity" | "unitCost">[]): number {
  return Math.round(lines.reduce((a, l) => a + l.quantity * l.unitCost, 0));
}
