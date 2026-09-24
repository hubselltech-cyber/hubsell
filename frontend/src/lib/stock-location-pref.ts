import type { StockLocation } from "@/lib/api";

/**
 * Nhớ VỊ TRÍ chọn lần cuối khi nhập/xuất (đợt B, anh Trung 15/09: "ô chọn vị trí
 * trên phiếu nhập, nhớ lần chọn cuối"). Tiện ích theo từng trình duyệt, không
 * phải dữ liệu — mất cũng chỉ về vị trí mặc định.
 */
export const LAST_LOCATION_KEY = "hubsell_last_stock_location";

export function readLastLocation(locations: StockLocation[]): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LAST_LOCATION_KEY);
  } catch {
    saved = null;
  }
  if (saved && locations.some((l) => l.id === saved)) return saved;
  return locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? "";
}

export function rememberLocation(id: string) {
  try {
    localStorage.setItem(LAST_LOCATION_KEY, id);
  } catch {
    // private mode / bị chặn — bỏ qua
  }
}
