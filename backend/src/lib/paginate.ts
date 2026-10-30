// ============================================================
// LẬT HẾT TRANG của một API phân trang theo offset — thuần, có test.
// Dùng cho Shopee get_brand_list (không tìm theo tên, chỉ lật 100 dòng/trang).
// ============================================================

export interface OffsetPage<T> {
  items: T[];
  hasNext: boolean;
  nextOffset?: number;
}

/** Trần số trang mặc định — 100 trang × 100 dòng = 10.000 dòng. */
export const MAX_PAGES = 100;

/**
 * `loadPage(offset)` trả trang + cờ còn trang sau. Dừng khi hết trang, trang rỗng,
 * chạm trần (`truncated: true`), hoặc offset không tiến (tránh lặp vô hạn).
 */
export async function collectPages<T>(
  loadPage: (offset: number) => Promise<OffsetPage<T>>,
  pageSize: number,
  maxPages = MAX_PAGES
): Promise<{ items: T[]; truncated: boolean; pages: number }> {
  const items: T[] = [];
  let offset = 0;
  let pages = 0;
  for (;;) {
    const page = await loadPage(offset);
    pages += 1;
    items.push(...page.items);
    if (!page.hasNext || page.items.length === 0) return { items, truncated: false, pages };
    if (pages >= maxPages) return { items, truncated: true, pages };
    const next = page.nextOffset ?? offset + pageSize;
    if (next <= offset) return { items, truncated: false, pages };
    offset = next;
  }
}
