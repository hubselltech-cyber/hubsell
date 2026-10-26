/** Prisma Decimal về qua JSON là chuỗi — quy mọi thứ về number một chỗ. */
export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 1234567 → "1.234.567" (không dựa vào Intl — Hermes/web đều chạy giống nhau). */
export function groupVN(n: number): string {
  const sign = n < 0 ? "-" : "";
  return sign + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatMoney(v: string | number | null | undefined): string {
  return `${groupVN(num(v))} ₫`;
}

/**
 * Số tiền GỌN cho thẻ chỉ số: 1,23 tỷ / 45,6 tr / 789 k / 999 ₫.
 * Làm tròn TRƯỚC rồi mới chọn đơn vị: 999.950.000 phải ra "1 tỷ", không phải
 * "1000 tr"; 999.950 ra "1 tr", không phải "1.000 k" (rà 26/10/2026).
 */
export function compactMoney(v: string | number | null | undefined): string {
  const n = num(v);
  const abs = Math.abs(n);
  // Dấu trừ thật (U+2212) như các bậc trừ của thác nước và web formatCompactVND
  // — trước đây hyphen "-" nên cột Lãi ròng âm khác dấu với bậc kế bên.
  const sign = n < 0 ? "−" : "";
  const one = (x: number) => x.toFixed(1).replace(".", ",").replace(/,0$/, "");
  const round1 = (x: number) => Math.round(x * 10) / 10;
  if (abs >= 1_000_000_000 || round1(abs / 1_000_000) >= 1000) {
    return `${sign}${one(abs / 1_000_000_000)} tỷ`;
  }
  if (abs >= 1_000_000 || Math.round(abs / 1000) >= 1000) {
    return `${sign}${one(abs / 1_000_000)} tr`;
  }
  if (abs >= 10_000) return `${sign}${groupVN(abs / 1000)} k`;
  return `${sign}${groupVN(abs)} ₫`;
}

/** ISO string → "13/08 14:05" cho dòng đơn hàng. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
