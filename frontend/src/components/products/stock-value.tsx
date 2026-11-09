import { Money } from "@/components/ui/money";
import type { Product } from "@/lib/api";
import { formatCompactVND, formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * GIÁ TRỊ TỒN ở bảng Tổng kho (09/11/2026, khách xin "cột tổng giá trị tồn = số lượng × giá vốn").
 * Thiết kế + bảng đo từng bề rộng màn: docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 10.2.
 */

/**
 * Giá trị tồn của một SKU = tồn kho × giá vốn. Tồn âm (bán vượt) tính 0 — không có hàng thì không
 * có giá trị, và không để một mã âm kéo tụt tổng của cả mẫu. null = chưa nhập giá vốn.
 */
export function stockValueOf(p: Pick<Product, "costPrice" | "quantityInStock">): number | null {
  const cost = Number(p.costPrice ?? 0);
  if (!(cost > 0)) return null;
  return Math.max(0, p.quantityInStock) * cost;
}

/** Giá trị tồn của cả mẫu = tổng các phân loại ĐÃ có giá vốn; chưa phân loại nào có giá → null. */
export function groupStockValue(rows: Pick<Product, "costPrice" | "quantityInStock">[]): {
  value: number | null;
  /** Số phân loại chưa nhập giá vốn nên chưa được cộng. */
  noCostCount: number;
} {
  const values = rows.map(stockValueOf);
  const noCostCount = values.filter((v) => v === null).length;
  return {
    value: noCostCount === rows.length ? null : values.reduce<number>((s, v) => s + (v ?? 0), 0),
    noCostCount,
  };
}

/**
 * CỘT CO THEO BỀ RỘNG KHUNG BẢNG (anh Trung 09/11: "chú ý tới tỉ lệ màn hình"). Thêm hẳn một cột
 * 112px thì laptop 1366–1440 phải cuộn ngang, cột Nhập · Xuất bị cắt. Nên:
 *   · khung bảng ĐỦ rộng → hiện cột riêng (giữa Bán trên và Nhập · Xuất);
 *   · khung hẹp hơn → ẩn cột, giá trị thành DÒNG NHỎ dưới số Tồn kho (như "an toàn N" ở Có thể bán).
 * Ngưỡng = bề rộng tối thiểu của bảng + 112px của cột mới − 24px dư sẵn ở bảng 1.000px (không có
 * cột Vị trí); có cột Vị trí thì bảng vốn đã bị ép sát nên cộng đủ 112px → mọi cột cũ giữ ≥ bề rộng
 * đã đo. Khung bảng phải mang class `@container`. Chuỗi class viết LIỀN để Tailwind nhận ra.
 */
export const STOCK_VALUE_SHOW = {
  plain: { column: "hidden @min-[1088px]:table-cell", subline: "@min-[1088px]:hidden" },
  withLocations: { column: "hidden @min-[1152px]:table-cell", subline: "@min-[1152px]:hidden" },
} as const;

/** Nội dung ô của cột Giá trị tồn. Từ 1 tỷ trở lên hạ cỡ chữ cho vừa cột 7rem. */
export function StockValueAmount({
  value,
  title,
  emptyTitle,
}: {
  value: number | null;
  /** Chú thích khi rê chuột vào số (cách tính). */
  title: string;
  /** Chú thích khi chưa có giá vốn. */
  emptyTitle: string;
}) {
  if (value === null) {
    return (
      <span className={TEXT_SUB} title={emptyTitle}>
        —
      </span>
    );
  }
  return (
    <span title={title}>
      <Money value={value} className={cn("text-slate-900", value >= 1_000_000_000 && "text-xs")} />
    </span>
  );
}

/**
 * Giá trị tồn dạng dòng nhỏ dưới số Tồn kho — chỉ hiện khi khung bảng hẹp, cột riêng đang ẩn.
 * Số RÚT GỌN ("≈ 298,4tr ₫"): cột Tồn kho chỉ 80px, "298.400.000 ₫" đủ chữ dài ~110px, đè sang hai
 * cột bên (đo 09/11 ở 1280–1440). Số đủ nằm trong chú thích khi rê chuột.
 */
export function StockValueSubline({ value, className }: { value: number | null; className: string }) {
  if (value === null) return null;
  return (
    <p
      className={cn("mt-0.5 text-[11px] leading-tight whitespace-nowrap tabular-nums text-muted-foreground", className)}
      title={`Giá trị tồn = tồn kho × giá vốn: ${formatNumber(value)} ₫`}
    >
      ≈ {formatCompactVND(value)} ₫
    </p>
  );
}
