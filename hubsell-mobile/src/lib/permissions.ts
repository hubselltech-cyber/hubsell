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
 * hàng, cài đặt thông báo, Trợ lý Hubsell, gói dịch vụ (backend gác adminOnly).
 *
 * `notifications` = có chuông + nhận tin đẩy (23/11/2026). Nhân viên có chuông khi
 * có ít nhất một quyền ứng với một mục thông báo — chép bảng CATEGORY_PERMISSIONS ở
 * backend/src/services/notification-access.ts; máy chủ tự lọc từng dòng theo quyền
 * + gian được giao, app chỉ quyết có vẽ chuông hay không.
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
  notifications: boolean;
}

/** Quyền nào mở ít nhất một mục thông báo cho nhân viên (bản sao notification-access.ts). */
const NOTIFICATION_PERMISSION_KEYS = [
  "orders",
  "warehouse.returns",
  "warehouse.products",
  "finance.analytics",
  "invoicing",
  "ads",
  "koc",
] as const;

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
    notifications: NOTIFICATION_PERMISSION_KEYS.some(can),
  };
}

/**
 * Tab mang nút CHUÔNG — tab đầu tiên người này có (Trang chủ → Đơn hàng → Kho), để
 * mở app là thấy chuông ngay. Chủ shop luôn là Trang chủ (như trước). null = không chuông.
 */
export function bellTabFor(
  user: Pick<AuthUser, "role" | "permissions"> | null | undefined
): "home" | "orders" | "warehouse" | null {
  const a = accessOf(user);
  if (!a.notifications) return null;
  if (a.home) return "home";
  if (a.orders) return "orders";
  if (a.warehouse) return "warehouse";
  return null;
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
