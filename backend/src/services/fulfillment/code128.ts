// ============================================================
// MÃ VẠCH CODE 128 (bộ B) — cho phiếu nhặt hàng Hubsell
//
// Mã đơn (2609044PUTPY83, 123456789…) chỉ gồm chữ/số ASCII nên bộ B là đủ.
// Trả về dãy độ rộng vạch/khoảng trắng (tính theo mô-đun) để pick-list-pdf
// vẽ hình chữ nhật — không cần thư viện canvas trên máy chủ.
// ============================================================

/**
 * Bảng mẫu chuẩn Code 128: mỗi ký hiệu 6 số (vạch, trắng, vạch, trắng, vạch,
 * trắng) tổng 11 mô-đun; ký hiệu STOP (106) có 7 số, tổng 13 mô-đun.
 */
const PATTERNS = [
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

const START_B = 104;
const STOP = 106;

export interface Code128Bar {
  /** true = vạch đen, false = khoảng trắng. */
  dark: boolean;
  /** Độ rộng tính theo mô-đun (1–4). */
  width: number;
}

/** Bảng mẫu — export cho test kiểm tổng mô-đun. */
export const CODE128_PATTERNS: readonly string[] = PATTERNS;

/**
 * Mã hoá chuỗi ASCII (32–126) thành dãy vạch Code 128 B. Ký tự ngoài bộ B bị
 * thay bằng "?" thay vì ném — mã vạch sai còn hơn phiếu không in được; mã đơn
 * thật của 3 sàn đều là chữ/số nên nhánh này gần như không chạy.
 */
export function encodeCode128B(text: string): Code128Bar[] {
  const values: number[] = [START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    values.push(code >= 32 && code <= 126 ? code - 32 : 31 /* "?" */);
  }
  // Checksum: start + Σ(vị trí × giá trị), mod 103
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += i * values[i];
  values.push(sum % 103);
  values.push(STOP);

  const bars: Code128Bar[] = [];
  for (const v of values) {
    const pattern = PATTERNS[v];
    for (let i = 0; i < pattern.length; i++) {
      bars.push({ dark: i % 2 === 0, width: Number(pattern[i]) });
    }
  }
  // Mẫu STOP 7 số đã gồm vạch kết thúc (termination bar) — không cộng thêm.
  return bars;
}

/** Tổng số mô-đun của dãy vạch — để tính độ rộng khi vẽ. */
export function code128TotalModules(bars: Code128Bar[]): number {
  return bars.reduce((s, b) => s + b.width, 0);
}
