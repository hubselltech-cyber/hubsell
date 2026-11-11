// Soi số điện thoại khách tự gõ — CHỈ để cảnh báo, không bao giờ tự sửa số và không
// khóa cứng (anh Trung 11/11/2026: khách để lại 09795971478, thừa chữ số, sale không
// gọi được; số đúng không suy ra được bằng cách bỏ một chữ số nên máy không đoán).

/** Bỏ dấu cách, chấm, gạch, ngoặc — cùng phép chuẩn hóa backend dùng khi nhận số. */
export function normalizePhoneInput(raw: string): string {
  return raw.replace(/[\s.\-()]/g, "");
}

/** Số di động / bàn Việt Nam thường gặp: 0 + 9 số, hoặc +84 / 84 + 9 số. */
export function looksLikeVnPhone(raw: string): boolean {
  return /^(0|\+84|84)\d{9}$/.test(normalizePhoneInput(raw));
}

/** Số chữ số khách đã gõ (không tính dấu +) — để câu cảnh báo nói rõ "có N chữ số". */
export function phoneDigitCount(raw: string): number {
  return normalizePhoneInput(raw).replace(/\D/g, "").length;
}
