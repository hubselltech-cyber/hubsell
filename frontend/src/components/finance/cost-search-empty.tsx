"use client";

import * as React from "react";
import { Loader2, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchSkuSearchCount } from "@/lib/api";
import { formatNumber } from "@/lib/format";

/**
 * Tìm ra 0 kết quả trên trang Giá vốn (03/11/2026, khách báo tìm không ra). Đang có bộ lọc thì tự hỏi máy chủ xem
 * toàn gian có mã khớp không: có thì nói rõ bộ lọc đang che và cho một nút xem, không báo "không tìm thấy" như thể
 * cả gian không có. Đếm này gồm cả dòng khớp theo tên, khác với dải áp giá chỉ đếm dòng khớp mã.
 */
export function CostSearchEmpty({
  keyword,
  loading,
  filtersNarrow,
  hiddenBy,
  onShowAll,
}: {
  keyword: string;
  /** Bảng đang tải lại, chưa kết luận được. */
  loading: boolean;
  filtersNarrow: boolean;
  /** Tên các bộ lọc đang bật. */
  hiddenBy: string[];
  onShowAll: () => void;
}) {
  // null = chưa hỏi xong; -1 = hỏi lỗi, chỉ nói được trong phạm vi bộ lọc.
  const [rowsEverywhere, setRowsEverywhere] = React.useState<number | null>(null);
  React.useEffect(() => {
    setRowsEverywhere(null);
    if (!filtersNarrow) return;
    let stale = false;
    fetchSkuSearchCount(keyword)
      .then((r) => {
        if (!stale) setRowsEverywhere(r.rows);
      })
      .catch(() => {
        if (!stale) setRowsEverywhere(-1);
      });
    return () => {
      stale = true;
    };
  }, [keyword, filtersNarrow]);

  if (loading || (filtersNarrow && rowsEverywhere === null)) {
    return (
      <div className="px-4 py-12 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-3 size-8 animate-spin motion-reduce:animate-none" />
        Đang tìm “{keyword}” trong toàn bộ gian hàng…
      </div>
    );
  }
  if (filtersNarrow && rowsEverywhere !== null && rowsEverywhere > 0) {
    return (
      <div className="px-4 py-12 text-center text-sm">
        <SearchX className="mx-auto mb-3 size-9 text-muted-foreground" />
        <p className="break-words">
          Có <b className="tabular-nums">{formatNumber(rowsEverywhere)}</b> mã khớp “{keyword}” nhưng
          đang bị ẩn bởi bộ lọc: {hiddenBy.join(" · ")}.
        </p>
        <Button className="mt-3" size="sm" onClick={onShowAll}>
          Xem {formatNumber(rowsEverywhere)} mã này
        </Button>
      </div>
    );
  }
  return (
    <div className="px-4 py-12 text-center text-sm">
      <SearchX className="mx-auto mb-3 size-9 text-muted-foreground" />
      <p className="break-words">
        {filtersNarrow && rowsEverywhere === -1
          ? `Không có mã nào khớp “${keyword}” trong bộ lọc đang chọn.`
          : `Không có mã nào khớp “${keyword}” trong toàn bộ gian hàng.`}
      </p>
      <p className="mt-1 text-muted-foreground">
        Thử gõ ngắn hơn, hoặc mã sản phẩm trên sàn. Mã vừa thêm trên sàn thì bấm “Đồng bộ từ sàn”.
      </p>
    </div>
  );
}
