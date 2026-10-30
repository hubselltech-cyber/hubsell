// ============================================================
// CÂY PHẲNG CÓ CHA — hàm thuần, có test. Dùng cho cây danh mục 3 sàn (mỗi nút
// có id + id cha) khi cần đường dẫn gốc → nút (tên hoặc id).
// ============================================================

/**
 * Đi ngược từ `id` lên gốc, trả mảng `pick(node)` theo thứ tự gốc → nút.
 * `parentOf` trả id cha hoặc null/undefined ở gốc. Trần 10 cấp (cây sàn ≤ 6 cấp)
 * để dữ liệu vòng không treo vòng lặp. Id không có trong `byId` → mảng rỗng.
 */
export function pathToRoot<K, N, R>(byId: Map<K, N>, id: K, parentOf: (n: N) => K | null | undefined, pick: (n: N) => R): R[] {
  const out: R[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 10) {
    out.unshift(pick(cur));
    const p = parentOf(cur);
    cur = p == null ? undefined : byId.get(p);
  }
  return out;
}
