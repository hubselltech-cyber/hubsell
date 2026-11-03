"use client";

import { Loader2, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

/**
 * Tìm ra 0 kết quả trên trang Giá vốn. Bộ lọc che mất mã thì nói đúng là đang bị che và cho một nút xem, không báo
 * "không tìm thấy" như thể cả gian không có (khách 03/11/2026 báo tìm không ra).
 */
export function CostSearchEmpty({
  keyword,
  checking,
  filtersNarrow,
  rowsEverywhere,
  hiddenBy,
  onShowAll,
}: {
  keyword: string;
  /** Đang hỏi máy chủ, chưa kết luận được. */
  checking: boolean;
  filtersNarrow: boolean;
  /** Số dòng khớp trong toàn bộ gian; null = không hỏi được. */
  rowsEverywhere: number | null;
  /** Tên các bộ lọc đang bật. */
  hiddenBy: string[];
  onShowAll: () => void;
}) {
  if (checking) {
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
        {filtersNarrow && rowsEverywhere === null
          ? `Không có mã nào khớp “${keyword}” trong bộ lọc đang chọn.`
          : `Không có mã nào khớp “${keyword}” trong toàn bộ gian hàng.`}
      </p>
      <p className="mt-1 text-muted-foreground">
        Thử gõ ngắn hơn, hoặc mã sản phẩm trên sàn. Mã vừa thêm trên sàn thì bấm “Đồng bộ từ sàn”.
      </p>
    </div>
  );
}
