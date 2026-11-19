/**
 * LỐI ĐƯA TỆP VẬN ĐƠN RA MÁY IN — lối nào đứng làm nút chính trong hộp In phiếu.
 *
 *   "share" = mở tệp bằng app của hãng máy in (qua bảng chia sẻ của điện thoại).
 *   "print" = hộp in của điện thoại (AirPrint / dịch vụ in) — máy in nối Wi-Fi / LAN.
 *
 * Vì sao "share" là mặc định (anh Trung chốt 19/11/2026): hỏi khách thật thì ShipXanh, BigSeller
 * và app TikTok Shop đều chỉ tạo tệp rồi in bằng app của hãng máy in — máy in nhiệt Bluetooth
 * (loại shop dùng nhiều nhất) không hiện trong hộp in của điện thoại. Hubsell KHÔNG tự nối máy
 * in: "việc gì mình phải gánh phần này". Khổ giấy (A6 / A7…) cũng do app máy in lo.
 *
 * Shop có máy in Wi-Fi thì bấm lối "print" một lần là lần sau lối đó đứng làm nút chính —
 * app nhớ lối dùng gần nhất theo từng điện thoại.
 */
export type PrintVia = "share" | "print";

export const DEFAULT_PRINT_VIA: PrintVia = "share";

/**
 * Lối đứng làm nút chính. `last` = lối dùng gần nhất đã lưu trên máy (chuỗi bất kỳ / chưa có).
 * Trả null khi bản app không in được bằng lối nào (thiếu module native).
 */
export function primaryPrintVia(
  support: { print: boolean; share: boolean },
  last: string | null | undefined
): PrintVia | null {
  if (!support.print && !support.share) return null;
  if (!support.share) return "print";
  if (!support.print) return "share";
  return last === "print" ? "print" : DEFAULT_PRINT_VIA;
}

/** Lối còn lại — nút phụ; null khi máy chỉ đi được một lối. */
export function secondaryPrintVia(
  support: { print: boolean; share: boolean },
  primary: PrintVia | null
): PrintVia | null {
  if (!primary || !support.print || !support.share) return null;
  return primary === "share" ? "print" : "share";
}
