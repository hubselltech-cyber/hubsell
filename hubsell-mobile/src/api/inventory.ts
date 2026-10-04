import { api } from "./client";
import type {
  AdjustStockResponse,
  ProductsListResponse,
  StockLocationsResponse,
} from "../types/api";

/** Danh sách SKU kho — tìm theo mã SKU / tên, phân trang phía máy chủ. */
export function fetchProducts(params: { page?: number; pageSize?: number; search?: string } = {}) {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  if (params.search) q.set("search", params.search);
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
