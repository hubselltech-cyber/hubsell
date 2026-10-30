// ============================================================
// Hàm thuần cho ô tìm THƯƠNG HIỆU (docs/SAO-CHEP-SAN-PHAM.md mục 22, 25).
// Shopee get_brand_list KHÔNG có tham số tìm theo tên, chỉ lật trang 100 dòng xếp
// theo A→Z (lật hết trang ở integrations/shopee/listing-api.ts qua lib/paginate).
// Ở đây: xếp hãng BẮT ĐẦU bằng từ khóa lên trước + gộp hãng gian đang dùng.
// ============================================================

import type { Brand } from "./types";
import { normalizeText } from "./variant-map";

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
