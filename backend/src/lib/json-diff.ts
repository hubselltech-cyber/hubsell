// ============================================================
// SO HAI KẾT QUẢ DẠNG JSON — dùng chung cho các công cụ đối chiếu hai đường cộng
// của quảng cáo (Shopee/Lazada: ads-margin-compare, TikTok: breakeven-compare).
// Thuần. Chuỗi mô tả lệch viết KHÔNG DẤU để đọc được trên Render Shell.
// ============================================================

export interface JsonDiffOptions {
  /** Tên trường là TIỀN — so theo lệch tuyệt đối `moneyTolerance` (đồng). */
  moneyKeys: ReadonlySet<string>;
  moneyTolerance: number;
  /** Số không nguyên còn lại (biên lãi, ROAS…) — so theo lệch tương đối. */
  relativeTolerance: number;
  /** Dừng sau bấy nhiêu chỗ lệch (mặc định 20). */
  limit?: number;
}

/**
 * So đệ quy hai giá trị JSON, ghi từng chỗ lệch vào `out` dạng "đường.dẫn: a/b".
 * Số nguyên ở cả hai bên phải bằng tuyệt đối (số đơn, điểm, số lượng).
 */
export function diffJson(a: unknown, b: unknown, path: string, out: string[], opts: JsonDiffOptions, key = ""): void {
  if (out.length >= (opts.limit ?? 20)) return;
  if (typeof a === "number" && typeof b === "number") {
    const d = Math.abs(a - b);
    const ok = opts.moneyKeys.has(key)
      ? d <= opts.moneyTolerance
      : Number.isInteger(a) && Number.isInteger(b)
        ? d === 0
        : d <= opts.relativeTolerance * Math.max(Math.abs(a), Math.abs(b));
    if (!ok) out.push(`${path}: ${a}/${b}`);
    return;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)}/${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: mang/doi tuong`);
    return;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  for (const k of new Set([...ka, ...kb])) {
    diffJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out, opts, k);
  }
}

/** Mảng → đối tượng theo khóa, để thứ tự sắp xếp (theo doanh thu, điểm) không gây lệch giả. */
export function keyBy<T>(list: T[], idOf: (x: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) out[idOf(x)] = x;
  return out;
}
