/**
 * TẦNG PHÂN LOẠI — "Hồng, 5-7kg" = hai tầng (màu, size). Cả ba sàn nối tên tầng bằng
 * ", " (Shopee model_name, TikTok sales_attributes, Lazada saleProp — backend
 * normalizeVariantName), SKU kho giữ nguyên chuỗi đó ở `variantName`.
 *
 * Dùng cho hộp nhập / xuất kho theo mẫu (05/11/2026): mẫu 5 màu × 5 size = 25 dòng thì
 * chia mục theo một tầng cho dễ tìm. Màn Giá vốn (CostPricesScreen, 28/10) có bản viết
 * liền trong tệp với cùng luật — sửa luật ở đây thì soát cả bên đó.
 */

function tiersOf(variantName: string | null | undefined): string[] {
  return (variantName ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface TierLayout<T> {
  /** Số tầng — 0 khi không chia mục được. */
  tierCount: number;
  /** Mỗi tầng: nhãn chip = hai giá trị đầu của tầng ("Hồng, Vàng…"), số giá trị khác nhau. */
  axes: { index: number; label: string; count: number }[];
  /** Chia `rows` thành mục theo tầng `axis`. */
  sections: (axis: number) => { key: string; rows: T[] }[];
  /** Nhãn dòng trong mục = các tầng CÒN LẠI ("Hồng" khi đang chia theo size). */
  restLabel: (row: T, axis: number) => string;
}

/**
 * Đủ điều kiện chia mục khi mọi dòng cùng số tầng ≥ 2 và có từ 4 dòng (ít hơn thì danh
 * sách phẳng đã đủ nhìn). Không đủ → null, màn gọi hiện danh sách phẳng.
 */
export function tierLayout<T>(
  rows: T[],
  nameOf: (row: T) => string | null | undefined
): TierLayout<T> | null {
  if (rows.length < 4) return null;
  const tierCount = tiersOf(nameOf(rows[0])).length;
  if (tierCount < 2) return null;
  if (!rows.every((r) => tiersOf(nameOf(r)).length === tierCount)) return null;
  return {
    tierCount,
    axes: Array.from({ length: tierCount }, (_, index) => {
      const vals = [...new Set(rows.map((r) => tiersOf(nameOf(r))[index]))];
      return {
        index,
        label: `${vals.slice(0, 2).join(", ")}${vals.length > 2 ? "…" : ""}`,
        count: vals.length,
      };
    }),
    sections: (axis) => {
      const m = new Map<string, T[]>();
      for (const r of rows) {
        const k = tiersOf(nameOf(r))[axis];
        const list = m.get(k);
        if (list) list.push(r);
        else m.set(k, [r]);
      }
      return [...m.entries()].map(([key, list]) => ({ key, rows: list }));
    },
    restLabel: (row, axis) =>
      tiersOf(nameOf(row))
        .filter((_, i) => i !== axis)
        .join(", "),
  };
}
