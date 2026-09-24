/**
 * SINH VỊ TRÍ HÀNG LOẠT (đợt 2, học Nhanh.vn): "Kệ A[1-5]" → Kệ A1 … Kệ A5;
 * "Kệ [A-C][1-3]" → 9 vị trí; "[01-12]" giữ số 0 đầu. Nhiều dải = tích Descartes.
 * Phần thuần, không đụng DB.
 */

export const PATTERN_MAX = 200;

type Range = string[];

function expandRange(inner: string): Range | null {
  const m = inner.match(/^\s*([A-Za-z]|\d+)\s*-\s*([A-Za-z]|\d+)\s*$/);
  if (!m) return null;
  const [, a, b] = m;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const from = Number(a);
    const to = Number(b);
    if (to < from) return null;
    const pad = a.length > 1 && a.startsWith("0") ? a.length : 0;
    const out: string[] = [];
    for (let i = from; i <= to; i++) out.push(pad ? String(i).padStart(pad, "0") : String(i));
    return out;
  }
  if (/^[A-Za-z]$/.test(a) && /^[A-Za-z]$/.test(b)) {
    const from = a.charCodeAt(0);
    const to = b.charCodeAt(0);
    if (to < from) return null;
    const out: string[] = [];
    for (let c = from; c <= to; c++) out.push(String.fromCharCode(c));
    return out;
  }
  return null;
}

export function expandLocationPattern(
  pattern: string
): { ok: true; names: string[] } | { ok: false; error: string } {
  const p = pattern.trim();
  if (!p) return { ok: false, error: "Nhập mẫu tên, vd: Kệ A[1-5]" };
  if (p.length > 80) return { ok: false, error: "Mẫu tên quá dài" };
  // Tách thành các đoạn: chữ thường + [dải]
  const parts: (string | Range)[] = [];
  let i = 0;
  let total = 1;
  while (i < p.length) {
    const open = p.indexOf("[", i);
    if (open === -1) {
      parts.push(p.slice(i));
      break;
    }
    if (open > i) parts.push(p.slice(i, open));
    const close = p.indexOf("]", open);
    if (close === -1) return { ok: false, error: "Thiếu dấu ] đóng dải" };
    const range = expandRange(p.slice(open + 1, close));
    if (!range) {
      return { ok: false, error: `Dải "${p.slice(open, close + 1)}" không hợp lệ — dùng [1-5], [01-12] hoặc [A-C]` };
    }
    total *= range.length;
    if (total > PATTERN_MAX) {
      return { ok: false, error: `Mẫu sinh quá ${PATTERN_MAX} vị trí — thu hẹp dải lại` };
    }
    parts.push(range);
    i = close + 1;
  }
  let names: string[] = [""];
  for (const part of parts) {
    if (typeof part === "string") {
      names = names.map((n) => n + part);
    } else {
      names = names.flatMap((n) => part.map((v) => n + v));
    }
  }
  names = names.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (names.length === 0) return { ok: false, error: "Mẫu không sinh được tên nào" };
  return { ok: true, names };
}

/**
 * Mã ngắn từ tên: bỏ dấu, in hoa, ký tự lạ → "-", tối đa 30 (Code 128 B chỉ mã hoá ASCII).
 * "Kệ A1" → "KE-A1", "Kho Bình Tân" → "KHO-BINH-TAN". Rỗng nếu tên không còn ký tự ASCII.
 */
export function codeFromName(name: string): string {
  const ascii = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.slice(0, 30).replace(/-+$/g, "");
}
