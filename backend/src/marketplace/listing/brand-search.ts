// ============================================================
// Hàm thuần cho ô tìm THƯƠNG HIỆU (docs/SAO-CHEP-SAN-PHAM.md mục 22, 30/10/2026).
// Shopee get_brand_list KHÔNG có tham số tìm theo tên, chỉ lật trang 100 dòng xếp
// theo A→Z. Lỗi khách Bunchar (Safari/macOS): gõ "B" vẫn ra toàn hãng dòng A vì
// adapter chỉ đọc trang đầu rồi lọc "chứa b" (AMBY, ANASTASIA BEVERLY…). Sửa:
// lật HẾT trang (đệm 6 giờ theo danh mục) + xếp hãng BẮT ĐẦU bằng từ khóa lên trước.
// ============================================================

import type { Brand } from "./types";
import { normalizeText } from "./variant-map";

export interface BrandPage<T> {
  items: T[];
  hasNext: boolean;
  nextOffset?: number;
}

/** Trần số trang lật cho một danh mục — 100 trang × 100 = 10.000 thương hiệu. */
export const MAX_BRAND_PAGES = 100;

/**
 * Lật hết các trang: `loadPage(offset)` trả trang + cờ còn trang sau. Dừng khi hết
 * trang, chạm trần, hoặc sàn trả offset không tiến (tránh lặp vô hạn).
 */
export async function collectBrandPages<T>(
  loadPage: (offset: number) => Promise<BrandPage<T>>,
  pageSize: number,
  maxPages = MAX_BRAND_PAGES
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

/** Nhãn cho hãng lấy từ sản phẩm đã đăng trên gian (không có trong danh sách hãng của danh mục). */
export const USED_ON_SHOP_NOTE = "đang dùng trên gian này — sàn có thể từ chối nếu hãng chưa gắn với danh mục";

/**
 * Gộp hãng khách ĐANG DÙNG trên gian (đọc từ sản phẩm đã đăng, Bunchar 30/10: hãng đã được
 * Shopee duyệt nhưng không nằm trong danh sách của danh mục đang chọn) vào danh sách của danh
 * mục: trùng id thì giữ bản của danh mục (không ghi chú); hãng chỉ có trên gian thì thêm cuối
 * kèm USED_ON_SHOP_NOTE để khách biết.
 */
export function mergeUsedBrands(categoryList: Brand[], used: Brand[]): Brand[] {
  const ids = new Set(categoryList.map((b) => b.id));
  const extra = used.filter((b) => b.id !== "0" && !ids.has(b.id)).map((b) => ({ id: b.id, name: b.name, note: USED_ON_SHOP_NOTE }));
  return [...categoryList, ...extra];
}

/**
 * Lọc theo từ khóa (không dấu, không phân biệt hoa thường) rồi xếp: tên BẮT ĐẦU bằng
 * từ khóa trước, tên CHỨA từ khóa sau; trong mỗi nhóm giữ thứ tự sàn. Không có từ khóa
 * → giữ nguyên. Cắt `limit` dòng.
 */
export function rankBrands(list: Brand[], query: string, limit = 200): Brand[] {
  const q = normalizeText(query);
  if (!q) return list.slice(0, limit);
  const starts: Brand[] = [];
  const contains: Brand[] = [];
  for (const b of list) {
    const n = normalizeText(b.name);
    if (n.startsWith(q)) starts.push(b);
    else if (n.includes(q)) contains.push(b);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
