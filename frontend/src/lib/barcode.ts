/**
 * VẼ MÃ VẠCH trong trình duyệt cho TEM SẢN PHẨM KHO (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.4).
 *
 * Hai kiểu mã:
 *   · EAN-13 — mã vạch quản lý 13 số Hubsell tự sinh và mã nhà sản xuất hợp lệ (đúng số kiểm tra);
 *   · Code 128 bộ B — mọi mã còn lại khách gõ tay (chữ, số, . _ -), kể cả mã 13 số sai số kiểm tra.
 * Hàm trả về dãy MÔ-ĐUN ("1" = vạch đen, "0" = khoảng trắng) kèm vùng trắng bắt buộc hai bên; phần
 * vẽ SVG ở components/products/barcode-svg.tsx. Không phụ thuộc thư viện ngoài.
 *
 * Bảng mẫu Code 128 chép nguyên từ backend/src/services/fulfillment/code128.ts (đang in phiếu nhặt
 * hàng + tem vị trí) — sửa bảng thì sửa CẢ HAI nơi.
 */

/** Mẫu trái lẻ (bộ L) của EAN-13: 7 mô-đun mỗi chữ số. */
const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
/** Bộ R = đảo bit bộ L; bộ G = bộ R đọc ngược. */
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const EAN_G = EAN_R.map((p) => [...p].reverse().join(""));
/** Chữ số ĐẦU không có vạch riêng — nó quyết định 6 chữ số nửa trái dùng bộ L hay G. */
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Số kiểm tra EAN-13 của 12 chữ số đầu (cùng công thức với backend/src/lib/product-barcode.ts). */
export function ean13CheckDigit(body12: string): number {
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (total % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** 95 mô-đun của một mã EAN-13 hợp lệ: 101 + 6 số trái + 01010 + 6 số phải + 101. */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new Error("Mã EAN-13 không hợp lệ");
  const parity = EAN_PARITY[Number(code[0])];
  let bits = "101";
  for (let i = 0; i < 6; i++) {
    const d = Number(code[i + 1]);
    bits += parity[i] === "L" ? EAN_L[d] : EAN_G[d];
  }
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += EAN_R[Number(code[i + 7])];
  return bits + "101";
}

/**
 * Bảng mẫu chuẩn Code 128: mỗi ký hiệu 6 số (vạch, trắng, vạch, trắng, vạch, trắng) tổng 11
 * mô-đun; ký hiệu STOP (106) có 7 số, tổng 13 mô-đun.
 */
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const CODE128_START_B = 104;
const CODE128_STOP = 106;

/** Chỉ ký tự ASCII in được (32–126) mới mã hóa được bằng bộ B. */
export function isCode128Text(text: string): boolean {
  return text.length > 0 && /^[\x20-\x7E]+$/.test(text);
}

/** Mô-đun của một chuỗi Code 128 bộ B: START B + từng ký tự + ký hiệu kiểm tra + STOP. */
export function code128Modules(text: string): string {
  if (!isCode128Text(text)) throw new Error("Code 128 bộ B chỉ nhận ký tự ASCII in được");
  const values = [...text].map((ch) => ch.charCodeAt(0) - 32);
  const checksum = (CODE128_START_B + values.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103;
  let bits = "";
  for (const symbol of [CODE128_START_B, ...values, checksum, CODE128_STOP]) {
    [...CODE128_PATTERNS[symbol]].forEach((width, i) => {
      bits += (i % 2 === 0 ? "1" : "0").repeat(Number(width));
    });
  }
  return bits;
}

export interface BarcodeShape {
  kind: "ean13" | "code128";
  /** "1" = vạch đen, "0" = trắng — CHƯA gồm vùng trắng hai bên. */
  modules: string;
  /** Vùng trắng bắt buộc (số mô-đun) bên trái / bên phải: thiếu là máy quét không bắt được mã. */
  quietLeft: number;
  quietRight: number;
}

/** Chọn kiểu mã cho một chuỗi; null = không vẽ được (ký tự ngoài ASCII). */
export function barcodeShape(code: string): BarcodeShape | null {
  const text = code.trim();
  if (isValidEan13(text)) return { kind: "ean13", modules: ean13Modules(text), quietLeft: 11, quietRight: 7 };
  if (isCode128Text(text)) return { kind: "code128", modules: code128Modules(text), quietLeft: 10, quietRight: 10 };
  return null;
}
