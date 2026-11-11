import { Truck } from "lucide-react";

import type { Product } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * CHỜ GIAO ở bảng Tổng kho (11/11/2026, khách xin "đơn đang ra 10 con thì hiện 10 con bị giữ lại").
 * Số đã trừ khỏi Tồn kho cho đơn đã chốt nhưng CHƯA giao cho đơn vị vận chuyển — hàng vẫn nằm trong
 * kho. Chỉ để xem: Tồn kho và Có thể bán giữ nguyên nghĩa. Thiết kế: docs/TONG-KHO-DANG-GIU-CHO-DON.md.
 *
 * Tên là "Chờ giao", KHÔNG phải "Đang giữ": ở phần mềm khác "đang giữ" nằm TRONG Tồn kho, ở Hubsell
 * nó đã bị trừ ra — gọi là "giữ" thì khách lấy Tồn kho trừ thêm lần nữa.
 *
 * KHÔNG có hộp danh sách đơn khi bấm số (anh Trung 11/11: "khách có 1.000 đơn thì cũng mệt") — đơn
 * đã có ở trang Đơn hàng; ở đây chỉ là con số + chú thích khi rê chuột.
 */

/**
 * CỘT CO THEO BỀ RỘNG KHUNG BẢNG — cùng cách với cột Giá trị tồn (stock-value.tsx): khung đủ rộng thì
 * là cột riêng sau "Có thể bán", hẹp hơn thì thành dòng nhỏ dưới số Có thể bán. Ngưỡng = ngưỡng của
 * bảng khi chưa có cột này + 76px của cột (4.75rem); người không thấy giá vốn không có cột Giá trị
 * tồn nên ngưỡng thấp hơn 112px. Khung bảng phải mang class `@container`. Chuỗi class viết LIỀN để
 * Tailwind nhận ra.
 */
export const AWAITING_SHIP_SHOW = {
  plain: { column: "hidden @min-[1052px]:table-cell", subline: "@min-[1052px]:hidden" },
  plainWithValue: { column: "hidden @min-[1164px]:table-cell", subline: "@min-[1164px]:hidden" },
  withLocations: { column: "hidden @min-[1116px]:table-cell", subline: "@min-[1116px]:hidden" },
  withLocationsAndValue: { column: "hidden @min-[1228px]:table-cell", subline: "@min-[1228px]:hidden" },
} as const;

/** Tổng chờ giao của cả mẫu (dòng cha) = tổng các phân loại. */
export function groupAwaitingShip(rows: Pick<Product, "awaitingShip">[]): number {
  return rows.reduce((s, p) => s + (p.awaitingShip ?? 0), 0);
}

/** Chú thích khi rê chuột vào số chờ giao của MỘT mã. */
export function awaitingShipTitle(p: Pick<Product, "awaitingShip" | "awaitingShipOrders">): string {
  const orders = p.awaitingShipOrders ?? 0;
  return (
    `${formatNumber(p.awaitingShip ?? 0)} sản phẩm` +
    (orders > 0 ? ` của ${formatNumber(orders)} đơn` : "") +
    " đã chốt, chưa giao cho đơn vị vận chuyển. Đã trừ khỏi Tồn kho, hàng vẫn còn trong kho."
  );
}

/** Chú thích cho DÒNG CHA (tổng các phân loại — không cộng được số đơn vì một đơn có thể chứa nhiều phân loại). */
export const AWAITING_SHIP_GROUP_TITLE =
  "Tổng chờ giao các phân loại: hàng của đơn đã chốt, chưa giao cho đơn vị vận chuyển. Đã trừ khỏi Tồn kho, hàng vẫn còn trong kho.";

/**
 * Số "Chờ giao" — dùng cho cả dòng một mã lẫn dòng cha.
 *   · variant "column": ô của cột riêng; không có gì thì gạch ngang.
 *   · variant "subline": dòng nhỏ dưới số Có thể bán khi khung bảng hẹp; không có gì thì không vẽ.
 *
 * Dòng nhỏ là biểu tượng xe tải + số, KHÔNG viết chữ "chờ giao": cột Có thể bán chỉ 75px (đệm px-2
 * còn 59px chữ) — "chờ giao 9.998" cần 70px, tràn sang cột bên (đo 11/11 ở 1280). Xe tải 12px + khe
 * 2px + "10.022" 40px = 54px. Nghĩa nằm ở chú thích khi rê chuột.
 */
export function AwaitingShip({
  quantity,
  title,
  variant = "column",
  className,
}: {
  quantity: number;
  title: string;
  variant?: "column" | "subline";
  className?: string;
}) {
  if (quantity <= 0) {
    return variant === "column" ? <span className={cn(TEXT_SUB, className)}>—</span> : null;
  }
  return variant === "column" ? (
    <span className={cn("text-sm font-semibold tabular-nums text-slate-900", className)} title={title}>
      {formatNumber(quantity)}
    </span>
  ) : (
    <span
      className={cn("mx-auto mt-0.5 flex w-fit items-center gap-0.5 text-xs text-slate-500 tabular-nums", className)}
      title={title}
    >
      <Truck className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">chờ giao</span>
      {formatNumber(quantity)}
    </span>
  );
}
