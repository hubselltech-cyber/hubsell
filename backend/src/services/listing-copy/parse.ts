// ============================================================
// ĐỌC DỮ LIỆU THÔ (body HTTP / JSON bảng) — hàm thuần nhỏ dùng chung cho route,
// nguồn "Tạo mới" (manual.ts) và sửa bài đăng (job-edit.ts).
// ============================================================

/** Chuỗi đã trim, cắt `max`; không phải chuỗi → "". */
export function str(v: unknown, max = 10_000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Số hữu hạn từ số / chuỗi số; còn lại null. */
export function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Danh sách URL http(s) ≤ 2048 ký tự, bỏ trùng, tối đa `max` — luật chung cho ảnh bài đăng. */
export function urlList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const u of v) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    if (!/^https?:\/\//i.test(t) || t.length > 2048) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
