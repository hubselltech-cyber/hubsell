import type { StockLocation } from "@/lib/api";

/**
 * CÂY VỊ TRÍ (Kho › Kệ › Tầng) phía giao diện. Backend đã đánh số `sortOrder`
 * theo duyệt cây chiều sâu nên thứ tự đến tay đã là thứ tự cây; ở đây chỉ dựng
 * lại độ sâu để thụt lề và ghép đường dẫn khi backend cũ chưa trả `path`.
 */
export interface LocationNode {
  loc: StockLocation;
  depth: number;
  /** Vị trí có con (kho chứa kệ) — không cho chọn làm nơi chứa hàng trực tiếp? Vẫn cho: kho vẫn có thể để hàng ở sàn. */
  hasChildren: boolean;
}

export function locationTree(locations: StockLocation[]): LocationNode[] {
  const ids = new Set(locations.map((l) => l.id));
  const children = new Map<string | null, StockLocation[]>();
  for (const l of locations) {
    const key = l.parentId && ids.has(l.parentId) ? l.parentId : null;
    const arr = children.get(key) ?? [];
    arr.push(l);
    children.set(key, arr);
  }
  const out: LocationNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const l of children.get(parent) ?? []) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push({ loc: l, depth, hasChildren: (children.get(l.id) ?? []).length > 0 });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** "Kho 2 › Kệ A1" — dùng ở mọi ô chọn / nhãn để kệ không bị nhầm là kho khác. */
export function locationLabel(l: StockLocation): string {
  return l.path ?? l.name;
}

/** Các vị trí có thể làm CHA của `id` (loại chính nó và con cháu của nó). */
export function parentOptions(locations: StockLocation[], id?: string): StockLocation[] {
  if (!id) return locations;
  const ids = new Set(locations.map((l) => l.id));
  const up = new Map(locations.map((l) => [l.id, l.parentId && ids.has(l.parentId) ? l.parentId : null]));
  return locations.filter((l) => {
    if (l.id === id) return false;
    let cur: string | null | undefined = l.id;
    let guard = 0;
    while (cur && guard++ < 50) {
      if (cur === id) return false;
      cur = up.get(cur);
    }
    return true;
  });
}
