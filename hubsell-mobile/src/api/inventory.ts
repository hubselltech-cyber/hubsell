import { api } from "./client";
import type {
  AdjustStockBulkResponse,
  AdjustStockResponse,
  ProductsListResponse,
  StockLocationsResponse,
} from "../types/api";

/**
 * Danh sách SKU kho — tìm theo mã SKU / tên / phân loại, phân trang phía máy chủ.
 *   grouped: true → phân trang theo MẪU hàng (`?view=grouped`, như bảng Tổng kho web):
 *     mỗi trang = pageSize mẫu, các phân loại của một mẫu không bao giờ bị cắt sang trang
 *     sau; dòng trả về đã xếp theo mẫu rồi theo phân loại. `total` khi đó là số MẪU.
 *   stock: "out" → chỉ SKU hết hàng (tồn ≤ 0).
 */
export function fetchProducts(
  params: {
    page?: number;
    pageSize?: number;
    search?: string;
    grouped?: boolean;
    stock?: "out";
  } = {}
) {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  if (params.search) q.set("search", params.search);
  if (params.grouped) q.set("view", "grouped");
  if (params.stock) q.set("stock", params.stock);
  return api<ProductsListResponse>(`/api/products?${q.toString()}`);
}

/** Vị trí chứa hàng — shop chưa tạo vị trí thì enabled=false, app ẩn ô chọn. */
export function fetchStockLocations() {
  return api<StockLocationsResponse>("/api/stock-locations");
}

/**
 * Nhập thêm / xuất bớt theo SỐ LƯỢNG. Cố ý không có "gõ đè tồn": đơn vẫn về
 * trong lúc đang sửa, cộng trừ thì không đè mất lượt trừ kho của đơn vừa về.
 * Backend khóa dòng, ghi nhật ký kèm người làm và tự đẩy tồn mới lên sàn.
 */
export function adjustStock(body: {
  productId: string;
  type: "IMPORT" | "EXPORT";
  quantity: number;
  reason?: string;
  locationId?: string;
}) {
  return api<AdjustStockResponse>("/api/inventory/adjust", { method: "POST", body });
}

/**
 * Nhập / xuất NHIỀU mã một lượt (nhiều phân loại của một mẫu) — MỘT giao dịch ở máy chủ:
 * xuất mà một mã thiếu hàng thì không mã nào bị ghi (báo đích danh mã thiếu), không có
 * cảnh "nửa lưu nửa không" như khi gọi `adjustStock` lần lượt. Máy chủ lập luôn một
 * Phiếu kho (PN- / PX-) như "Phiếu nhiều mã" trên web; tối đa 200 mã.
 */
export function adjustStockBulk(body: {
  type: "IMPORT" | "EXPORT";
  items: { productId: string; quantity: number }[];
  reason?: string;
  locationId?: string;
}) {
  return api<AdjustStockBulkResponse>("/api/inventory/adjust-bulk", { method: "POST", body });
}
