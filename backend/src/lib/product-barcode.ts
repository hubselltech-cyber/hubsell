// ============================================================
// MÃ VẠCH QUẢN LÝ của sản phẩm kho (05/11/2026 — docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.2)
//
// Anh Trung: sản phẩm Tổng kho là sản phẩm RIÊNG, cần một mã quản lý để kho quét hàng — mã
// SKU là mã để KHỚP VỚI SÀN, không phải mã này. Chốt 13 số theo chuẩn EAN-13.
//
// Mã do DB sinh (hàm product_new_barcode(), DEFAULT của cột "Product"."barcode", migration
// 20261105220000_product_barcode): "2" + 11 số thứ tự + 1 số kiểm tra. Tệp này chỉ giữ phần
// TÍNH + KIỂM dùng chung (số kiểm tra, chuẩn hóa mã khách gõ tay) — một nguồn cho route và test.
// ============================================================

/** Số kiểm tra EAN-13 của 12 chữ số đầu: vị trí lẻ (từ trái) nhân 1, vị trí chẵn nhân 3. */
export function ean13CheckDigit(body12: string): number {
  if (!/^\d{12}$/.test(body12)) throw new Error("ean13CheckDigit cần đúng 12 chữ số");
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (total % 10)) % 10;
}

/** Đúng 13 chữ số và số cuối khớp số kiểm tra. */
export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Mã nội bộ từ số thứ tự — bản TypeScript của hàm SQL product_new_barcode(), để test đối chiếu. */
export function internalBarcodeFromSeq(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 99_999_999_999) {
    throw new Error("Số thứ tự mã vạch phải từ 1 đến 99.999.999.999");
  }
  const body = `2${String(seq).padStart(11, "0")}`;
  return `${body}${ean13CheckDigit(body)}`;
}

/** Mã Hubsell tự sinh: 13 số hợp lệ, bắt đầu bằng 2 (khoảng mã lưu hành hạn chế của GS1). */
export function isInternalBarcode(code: string): boolean {
  return code.startsWith("2") && isValidEan13(code);
}

export const BARCODE_MIN_LENGTH = 4;
export const BARCODE_MAX_LENGTH = 32;

export type BarcodeInput =
  | { ok: true; value: string }
  /** Khách xóa trắng ô = nhờ máy sinh mã mới (sản phẩm không bao giờ thiếu mã). */
  | { ok: true; value: null }
  | { ok: false; error: string };

/**
 * Chuẩn hóa mã vạch khách GÕ TAY (hàng có sẵn mã nhà sản xuất, mã mang từ phần mềm cũ sang).
 * Chỉ nhận chữ, số và . _ - (đúng tập ký tự mã vạch Code 128 / EAN in được, quét ra không lệch);
 * KHÔNG ép số kiểm tra với mã 13 số — mã nội bộ của phần mềm khác có thể không theo EAN.
 */
export function parseBarcodeInput(raw: unknown): BarcodeInput {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Mã vạch không hợp lệ" };
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  if (value.length < BARCODE_MIN_LENGTH || value.length > BARCODE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Mã vạch dài từ ${BARCODE_MIN_LENGTH} đến ${BARCODE_MAX_LENGTH} ký tự`,
    };
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    return { ok: false, error: "Mã vạch chỉ gồm chữ không dấu, số và các dấu . _ -" };
  }
  return { ok: true, value };
}
