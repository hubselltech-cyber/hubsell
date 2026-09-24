"use client";

import { NativeSelect } from "@/components/ui/native-select";
import type { StockLocation } from "@/lib/api";
import { locationTree } from "@/lib/stock-locations";

/**
 * Ô CHỌN VỊ TRÍ dùng chung (Nhập/Xuất, Phiếu nhiều mã, Kiểm kê, Chuyển vị trí, Cất
 * lên kệ, lọc bảng, chọn cha trong hộp vị trí): luôn liệt kê theo CÂY thụt lề
 * "Kho 2 › Kệ A1 › T1" để kệ không bị nhầm là kho khác — một kiểu ở mọi chỗ.
 */
export function LocationSelect({
  id,
  locations,
  value,
  onChange,
  exclude,
  placeholder,
  suffix,
  className,
  ariaLabel,
}: {
  id?: string;
  /** Danh sách vị trí (đã lọc trước nếu cần, vd parentOptions). */
  locations: StockLocation[];
  value: string;
  onChange: (id: string) => void;
  /** Ẩn một vị trí (vd nơi đi khi chọn nơi đến). */
  exclude?: string;
  /** Dòng đầu với value rỗng (vd "Tự trừ theo thứ tự ưu tiên", "— chọn —"). */
  placeholder?: string;
  /** Chữ nối sau tên mỗi vị trí (số SKU, số đang có…). */
  suffix?: (loc: StockLocation) => string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <NativeSelect
      id={id}
      aria-label={ariaLabel}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {locationTree(locations)
        .filter(({ loc }) => loc.id !== exclude)
        .map(({ loc, depth }) => (
          <option key={loc.id} value={loc.id}>
            {"  ".repeat(depth)}
            {depth > 0 ? "› " : ""}
            {loc.name}
            {loc.sellable ? "" : " · không bán"}
            {suffix ? suffix(loc) : ""}
          </option>
        ))}
    </NativeSelect>
  );
}
