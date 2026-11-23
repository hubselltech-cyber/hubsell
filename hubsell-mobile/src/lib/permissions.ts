/**
 * Bản sao RÚT GỌN từ backend/src/config/permission-registry.ts (convention chép
 * tay giữa các package). ADMIN không đi qua hasPermission — chủ shop toàn quyền.
 */
export function hasPermission(perms: readonly string[], key: string): boolean {
  if (perms.includes(key)) return true;
  const prefix = `${key}.`;
  return perms.some((p) => p.startsWith(prefix));
}

import type { AuthUser } from "../types/api";

/**
 * NGƯỜI NÀY ĐƯỢC THẤY GÌ TRÊN APP — một nguồn duy nhất cho thanh tab, cổng vào
 * từng màn và từng khối trong màn (23/11/2026, anh Trung: "nhân viên anh cấp
 * full quyền nhưng vào thì lại không đủ"). Trước đó app chia cứng theo VAI: nhân
 * viên nào cũng chỉ có Kho · QR · Cấu hình dù chủ shop đã tick đủ quyền. Nay theo
 * đúng luật "tick gì thấy nấy" của web và đúng cửa quyền từng API ở backend/app.ts:
 *
 *   overview   Trang chủ → Tổng quan     /api/analytics            → "dashboard"
 *   finance    Trang chủ → Tài chính     /api/finance/analytics    → "finance.analytics"
 *              (cũng là quyền xem khối TIỀN ở Tổng quan — cùng một nguồn số)
 *   ads        Trang chủ → Quảng cáo     /api/quang-cao            → "ads.*"
 *   orders     tab Đơn hàng + nút QR     /api/orders               → "orders"
 *   stock      Kho → Tồn kho             /api/products, /inventory → "warehouse.products" | "orders"
 *   returns    Kho → Đơn hoàn            /api/warehouse            → "warehouse.returns"
 *   costPrices màn Giá vốn               /api/finance/sku-products → "finance.cost-prices"
 *   expenses   màn Chi phí vận hành      /api/expenses             → "finance.expenses"
 *
 * `owner` = việc CHỈ chủ shop làm được dù nhân viên có đủ mọi quyền: nối gian
 * hàng, chuông + tin đẩy, Trợ lý Hubsell, gói dịch vụ (backend gác adminOnly).
 */
export interface AppAccess {
  owner: boolean;
  overview: boolean;
  finance: boolean;
  ads: boolean;
  adsShopee: boolean;
  adsLazada: boolean;
  adsTiktok: boolean;
  /** Có ít nhất một trang của Trang chủ → có tab Trang chủ. */
  home: boolean;
  orders: boolean;
  stock: boolean;
  returns: boolean;
  /** Có ít nhất một tab con của Kho → có tab Kho. */
  warehouse: boolean;
  costPrices: boolean;
  expenses: boolean;
}

export function accessOf(user: Pick<AuthUser, "role" | "permissions"> | null | undefined): AppAccess {
  const owner = user?.role === "ADMIN";
  const perms = user?.permissions ?? [];
  const can = (key: string) => owner || (!!user && hasPermission(perms, key));
  const overview = can("dashboard");
  const finance = can("finance.analytics");
  const adsShopee = can("ads.shopee");
  const adsLazada = can("ads.lazada");
  const adsTiktok = can("ads.tiktok");
  const ads = adsShopee || adsLazada || adsTiktok;
  const orders = can("orders");
  const stock = can("warehouse.products") || orders;
  const returns = can("warehouse.returns");
  return {
    owner,
    overview,
    finance,
    ads,
    adsShopee,
    adsLazada,
    adsTiktok,
    home: overview || finance || ads,
    orders,
    stock,
    returns,
    warehouse: stock || returns,
    costPrices: can("finance.cost-prices"),
    expenses: can("finance.expenses"),
  };
}

/**
 * Màn mở đầu sau đăng nhập = tab ĐẦU TIÊN người này có, theo thứ tự thanh tab
 * (Trang chủ → Đơn hàng → Kho). Không có tab nào thì ra màn "chưa có quyền".
 */
export function homePathFor(user: AuthUser): string {
  const a = accessOf(user);
  if (a.home) return "/(admin)/home";
  if (a.orders) return "/(admin)/orders";
  if (a.warehouse) return "/(admin)/warehouse";
  return "/no-access";
}
