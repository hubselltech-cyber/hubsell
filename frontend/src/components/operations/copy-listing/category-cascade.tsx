"use client";

// ============================================================
// Chọn danh mục xổ cha → con theo cây của CHÍNH sàn đích (mỗi sàn một cây khác
// nhau). Mỗi cấp một ô; chọn tới lá mới tính là xong (onChange(id)), chọn nút
// giữa chừng → onChange(null) để ô báo "còn thiếu".
// Nạp tay (không qua react-query): lượt nạp đầu theo `value`, các cấp con nạp khi
// khách chọn; `loadedFor` chặn effect nạp lại và xóa ô đang chọn.
// ============================================================

import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { apiErrorMessage, fetchCopyListingCategoryTree, type CopyListingCategoryNode } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

export function CategoryCascade({
  jobId,
  targetId,
  value,
  disabled,
  invalid,
  onChange,
}: {
  jobId: string;
  targetId: string;
  value: string | null;
  disabled: boolean;
  invalid: boolean;
  onChange: (id: string | null) => void;
}) {
  const [levels, setLevels] = useState<CopyListingCategoryNode[][]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Giá trị đã nạp lần cuối — đổi từ ngoài (lưu xong, "Áp cho sản phẩm còn lại") thì nạp lại. */
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (loadedFor !== undefined && (value === loadedFor || path[path.length - 1] === value)) return;
    let alive = true;
    setLoading(true);
    fetchCopyListingCategoryTree(jobId, targetId, { selectedId: value })
      .then((r) => {
        if (!alive) return;
        setLevels(r.levels);
        setPath(r.path);
        setLoadedFor(value);
        setError(null);
      })
      .catch((err) => alive && setError(apiErrorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      // Lượt nạp bị huỷ giữa chừng (giá trị đổi tiếp) thì không được kẹt "đang tải".
      setLoading(false);
    };
    // Chỉ nạp lại khi value đổi từ ngoài; loadedFor/path là trạng thái do chính effect này ghi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, targetId, value]);

  async function pick(level: number, id: string) {
    const node = levels[level]?.find((n) => n.id === id);
    const nextPath = [...path.slice(0, level), ...(id ? [id] : [])];
    const nextLevels = levels.slice(0, level + 1);
    setPath(nextPath);
    setLevels(nextLevels);
    // Ghi loadedFor TRƯỚC khi báo lên cha: giá trị mới (lá hoặc null khi chọn dở)
    // khớp loadedFor nên effect không nạp lại và không xoá các ô đang chọn.
    setLoadedFor(node?.leaf ? id : null);
    if (!node) {
      onChange(null);
      return;
    }
    if (node.leaf) {
      onChange(id);
      return;
    }
    onChange(null);
    try {
      const r = await fetchCopyListingCategoryTree(jobId, targetId, { parentId: id });
      setLevels([...nextLevels, r.levels[0] ?? []]);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const names = path.map((id, i) => levels[i]?.find((n) => n.id === id)?.name ?? id);
  const done = path.length > 0 && levels[path.length - 1]?.find((n) => n.id === path[path.length - 1])?.leaf;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {levels.map((nodes, i) => (
          <NativeSelect
            key={i}
            className={cn("w-56", invalid && !done && "[&>select]:border-amber-300 [&>select]:bg-amber-50/40")}
            aria-label={`Danh mục cấp ${i + 1}`}
            value={path[i] ?? ""}
            disabled={disabled || loading}
            onChange={(e) => void pick(i, e.target.value)}
          >
            <option value="">— Cấp {i + 1} —</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.leaf ? "" : " ›"}
              </option>
            ))}
          </NativeSelect>
        ))}
        {loading && levels.length === 0 && <span className={TEXT_SUB}>Đang tải cây danh mục…</span>}
      </div>
      {error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : names.length > 0 ? (
        <div className={TEXT_SUB}>
          {names.join(" › ")}
          {!done && " · chọn tiếp tới cấp cuối"}
        </div>
      ) : null}
    </div>
  );
}
