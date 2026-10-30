// ============================================================
// SUY NHÓM PHÂN LOẠI từ tên phân loại của bảng (thuần, có test) — nguồn kho / dòng
// ChannelProduct không lưu options, chỉ có tên "Màu: Đen, Size: M" hoặc "Đen, M".
// ============================================================

import type { ListingOption, ListingVariant } from "./types";

export function inferOptions(variants: ListingVariant[]): ListingOption[] {
  const named = new Map<string, Set<string>>();
  const positional: Set<string>[] = [];
  for (const v of variants) {
    if (!v.name) continue;
    const parts = v.name.split(/[,|/;]+/).map((p) => p.trim()).filter(Boolean);
    parts.forEach((p, idx) => {
      const m = p.match(/^([^:]{1,30}):\s*(.+)$/);
      if (m) {
        const set = named.get(m[1].trim()) ?? new Set<string>();
        set.add(m[2].trim());
        named.set(m[1].trim(), set);
      } else {
        positional[idx] = positional[idx] ?? new Set<string>();
        positional[idx].add(p);
      }
    });
  }
  const out: ListingOption[] = [];
  for (const [name, values] of named) out.push({ name, values: [...values] });
  positional.forEach((set, idx) => {
    if (set && set.size > 0) out.push({ name: `Phân loại ${idx + 1}`, values: [...set] });
  });
  return out;
}
