/**
 * CÂY VỊ TRÍ CHỨA HÀNG (Kho › Kệ › Tầng) — phần thuần dùng chung cho route vị trí,
 * lọc bảng Hàng hóa và phiếu nhặt, để một cách hiểu cây duy nhất:
 *   · anh em xếp theo sortOrder rồi createdAt; con đi ngay sau cha (duyệt chiều sâu)
 *   · cha không còn (dòng mồ côi) coi như gốc, không bao giờ rơi ra ngoài cây
 *   · đường dẫn = tên các cấp nối bằng " › "
 */

export interface TreeRow {
  id: string;
  parentId: string | null;
}

function childrenOf<T extends TreeRow>(rows: T[]): Map<string | null, T[]> {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string | null, T[]>();
  for (const r of rows) {
    const key = r.parentId && ids.has(r.parentId) ? r.parentId : null;
    const arr = children.get(key) ?? [];
    arr.push(r);
    children.set(key, arr);
  }
  return children;
}

/** Thứ tự duyệt cây chiều sâu (cha rồi tới các con) — cũng là thứ tự ưu tiên trừ hàng. */
export function depthFirstIds<T extends TreeRow & { sortOrder: number; createdAt: Date }>(rows: T[]): string[] {
  const sorted = rows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
  const children = childrenOf(sorted);
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const r of children.get(parent) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r.id);
      walk(r.id);
    }
  };
  walk(null);
  return out;
}

/** Đường dẫn "Kho 2 › Kệ A1 › T2" cho từng vị trí. */
export function buildLocationPaths<T extends TreeRow & { name: string }>(rows: T[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const paths = new Map<string, string>();
  const pathOf = (id: string, guard = 0): string => {
    const cached = paths.get(id);
    if (cached) return cached;
    const r = byId.get(id);
    if (!r) return "?";
    const parent = r.parentId && byId.has(r.parentId) && guard < 20 ? pathOf(r.parentId, guard + 1) : null;
    const p = parent ? `${parent} › ${r.name}` : r.name;
    paths.set(id, p);
    return p;
  };
  for (const r of rows) pathOf(r.id);
  return paths;
}

/** Một vị trí và toàn bộ con cháu của nó (chọn KHO = gom cả kệ / tầng bên trong). */
export function subtreeIds(rows: TreeRow[], rootId: string): string[] {
  const children = childrenOf(rows);
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of children.get(id) ?? []) stack.push(c.id);
  }
  return out;
}

/** `candidate` có nằm trong nhánh con cháu của `id` (kể cả chính nó) không — chặn vòng lặp khi đổi cha. */
export function isSelfOrDescendant(rows: TreeRow[], id: string, candidate: string): boolean {
  return subtreeIds(rows, id).includes(candidate);
}
