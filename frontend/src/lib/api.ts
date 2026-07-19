// Lớp gọi API tới backend Hubsell (kèm token đăng nhập).

import { rangeToQuery, type DateRange } from "./date-range";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "hubsell_token";
const USER_KEY = "hubsell_user";

// ----- Quản lý token đăng nhập (lưu trong trình duyệt) -----

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ----- Lưu thông tin người đăng nhập (để biết vai trò Admin/Staff) -----

export function setStoredUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

// Lỗi API có kèm mã HTTP + mã lỗi để giao diện xử lý
// (ví dụ 401 → chuyển về trang đăng nhập; code NO_CHANNEL → hiện màn hình onboarding)
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Hàm gọi API dùng chung: tự gắn token, tự đọc thông báo lỗi tiếng Việt từ backend
/**
 * Gắn ?from=&to= vào endpoint báo cáo. Không truyền range thì giữ nguyên URL
 * (backend hiểu là xem toàn bộ lịch sử).
 */
/**
 * Bộ lọc phân tầng của các trang báo cáo, khớp với component ChannelFilter.
 * Cả hai trường rỗng = xem toàn bộ gian hàng trong quyền của mình.
 */
export interface ChannelFilterQuery {
  channelName?: ChannelName | "";
  channelId?: string;
}

/** Đổi bộ lọc phân tầng thành query param cho backend. */
export function channelFilterToQuery(
  filter?: ChannelFilterQuery
): Record<string, string> {
  if (!filter) return {};
  const q: Record<string, string> = {};
  if (filter.channelName) q.channelName = filter.channelName;
  if (filter.channelId) q.channelId = filter.channelId;
  return q;
}

/**
 * Gắn bộ lọc báo cáo vào URL: khoảng thời gian và phạm vi gian hàng.
 */
function withRange(
  path: string,
  range?: DateRange,
  channel?: ChannelFilterQuery
): string {
  const params = new URLSearchParams({
    ...rangeToQuery(range),
    ...channelFilterToQuery(channel),
  });
  const qs = params.toString();
  if (!qs) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Máy chủ trả về lỗi ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // giữ thông báo mặc định
    }
    throw new ApiError(res.status, message, code);
  }

  return res.json();
}

// Mã lỗi khi shop chưa kết nối gian hàng nào (Onboarding guard)
export const NO_CHANNEL_CODE = "NO_CHANNEL";

// ----- Kiểu dữ liệu -----

export type ChannelName = "SHOPEE" | "LAZADA" | "TIKTOK" | "OFFLINE";

/**
 * Vai trò tài khoản.
 * - ADMIN     : chủ shop, toàn quyền
 * - SALES     : nhân viên vận hành — chỉ gian hàng được phân công, không thấy giá vốn/lợi nhuận
 * - WAREHOUSE : nhân viên kho — đơn của mọi gian, nhưng không vào được mục Tài chính
 */
export type Role = "ADMIN" | "SALES" | "WAREHOUSE";

/** Vai trò chủ shop có thể gán cho nhân viên. */
export const ASSIGNABLE_ROLES: Role[] = ["SALES", "WAREHOUSE"];

export const ROLE_META: Record<
  Role,
  { label: string; description: string; className: string }
> = {
  ADMIN: {
    label: "Chủ shop",
    description: "Toàn quyền: mọi gian hàng, mọi báo cáo tài chính.",
    className: "bg-violet-100 text-violet-700 border-violet-200",
  },
  SALES: {
    label: "Nhân viên vận hành",
    description:
      "Chỉ xử lý đơn và xem doanh thu của những gian hàng được phân công. Không thấy giá vốn, lợi nhuận hay chi phí.",
    className: "bg-sky-100 text-sky-700 border-sky-200",
  },
  WAREHOUSE: {
    label: "Nhân viên kho",
    description:
      "Thấy đơn của TẤT CẢ gian hàng để nhặt và đóng gói. Không vào được mục Tài chính và không thấy giá vốn.",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
};

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface Product {
  id: string;
  skuCode: string;
  productName: string;
  /** Vắng mặt khi người đang xem không được phép biết giá vốn (SALES/WAREHOUSE). */
  costPrice?: string | number;
  sellingPrice: string | number;
  quantityInStock: number;
  createdAt: string;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface InventoryLog {
  id: string;
  productId: string;
  changeQuantity: number;
  type: "IMPORT" | "EXPORT" | "SYNC";
  reason: string | null;
  createdAt: string;
}

/** Tình trạng hàng hoàn về kho — khớp enum ReturnStatus ở backend */
export type ReturnStatus =
  | "NONE"
  | "AWAITING"
  | "RECEIVED_INTACT"
  | "DAMAGED"
  | "CLAIM_SETTLED"
  | "WRITTEN_OFF";

/** Vòng đời đơn hàng — khớp enum ShippingStatus ở backend */
export type ShippingStatus =
  | "PENDING"
  | "PROCESSED"
  | "SHIPPING"
  | "DELIVERED"
  | "CANCELLED";

/** Đơn vị vận chuyển — khớp enum Carrier ở backend */
export type Carrier =
  | "SPX"
  | "GHTK"
  | "GHN"
  | "JT"
  | "VIETTEL_POST"
  | "NINJA_VAN"
  | "BEST"
  | "KHAC";

export interface OrderItemLine {
  id: string;
  productName: string;
  channelSku: string;
  quantity: number;
  price: string | number;
  /** Ảnh sản phẩm gốc — null khi sản phẩm đã bị xoá hoặc chưa có ảnh */
  product?: { imageUrl: string | null } | null;
}

export interface Order {
  id: string;
  channelId: string;
  orderCode: string;
  customerName: string;
  customerPhone: string | null;
  totalAmount: string | number;
  paymentStatus: string;
  shippingStatus: ShippingStatus;
  carrier: Carrier | null;
  trackingCode: string | null;
  packedAt: string | null;
  /** Mốc đã in phiếu giao hàng — null nghĩa là chưa in lần nào */
  labelPrintedAt: string | null;
  /** Số dòng hàng của đơn (0 với đơn cũ chưa ghi chi tiết) */
  itemCount: number;
  returnStatus: ReturnStatus;
  returnNote: string | null;
  returnedAt: string | null;
  /** Mốc sàn báo đơn bắt đầu hoàn — null khi chưa rõ */
  returnRequestedAt: string | null;
  /** Tiền bưu cục/sàn đã đền (chỉ > 0 khi khiếu nại thắng) */
  compensationAmount: string | number;
  /** Mốc đã cộng lại tồn kho — có giá trị nghĩa là không cộng thêm lần nữa */
  stockRestoredAt: string | null;
  createdAt: string;
  channel: { channelName: ChannelName; shopName: string };
  items?: OrderItemLine[];
}

export interface OrderListResponse {
  items: Order[];
  /** Số đơn theo từng trạng thái, để hiện badge trên tab */
  counts: Record<string, number>;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export type ExpenseCategory = "RENT" | "SALARY" | "PACKAGING" | "ADS" | "OTHER";
export type ExpenseType = "FIXED" | "VARIABLE";

export interface OperatingExpense {
  id: string;
  name: string;
  category: ExpenseCategory;
  type: ExpenseType;
  appliedSku: string | null; // SKU được gắn (chỉ với chi phí VARIABLE)
  amount: string | number;
  note: string | null;
  expenseDate: string;
  createdAt: string;
}

// ----- Báo cáo Lời/Lỗ theo SKU -----

/// Ngưỡng hòa vốn an toàn của một SKU (null nếu chưa đủ dữ liệu để tính)
export interface SkuBreakEven {
  unitCogs: number; // giá vốn / sản phẩm
  unitFee: number; // phí sàn & ship / sản phẩm
  avgSellingPrice: number; // giá bán trung bình thực tế
  floorPrice: number; // GIÁ BÁN HÒA VỐN — dưới mức này là lỗ
  maxDiscountPercent: number; // được phép giảm giá tối đa bao nhiêu %
  targetCpa: number; // trần chi phí quảng cáo cho mỗi đơn
  actualCpa: number; // chi phí marketing thực tế đang tiêu mỗi đơn
  isOverspending: boolean; // đang chi Ads vượt ngưỡng ⇒ cảnh báo đỏ
}

export interface SkuPnlRow {
  sku: string;
  productName: string;
  imageUrl: string | null;
  quantitySold: number;
  revenue: number;
  cogs: number;
  allocatedFee: number; // phí sàn + ship phân bổ cho SKU
  marketingCost: number; // chi phí biến đổi gắn riêng SKU
  grossBeforeMarketing: number; // lợi nhuận gộp trước khi trừ marketing
  profit: number;
  margin: number;
  missingCost: boolean; // đã bán nhưng chưa nhập giá vốn
  /**
   * Vì sao mã này lỗ — hai loại cần hai cách chữa khác nhau:
   * ADS  = mặt hàng vẫn có lãi, tiền quảng cáo ăn hết → tắt/tối ưu chiến dịch
   * COST = lỗ ngay trước khi tiêu đồng quảng cáo nào → phải sửa giá nhập/giá bán
   * null = đang có lãi, hoặc chưa nhập giá vốn nên chưa kết luận được
   */
  lossReason: "ADS" | "COST" | null;
  breakEven: SkuBreakEven | null;
}

export interface SkuPnlResponse {
  items: SkuPnlRow[];
  summary: {
    skuCount: number;
    skuProfitTotal: number;
    fixedExpense: number;
    shopProfit: number;
    overspendingCount: number; // số SKU đang chi Ads vượt ngưỡng
    urgentCount: number; // số SKU đang lỗ hoặc vượt trần Ads
    missingCostCount: number; // số SKU đã bán nhưng chưa nhập giá vốn
  };
}

export function fetchSkuPnl(range?: DateRange, channel?: ChannelFilterQuery) {
  return apiFetch<SkuPnlResponse>(
    withRange("/api/finance/sku-pnl", range, channel)
  );
}

export interface AnalyticsResponse {
  deliveredOrderCount: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  totalOperatingExpense: number;
  netProfit: number;
  expensesByCategory: { category: ExpenseCategory | string; amount: number }[];
  revenueByDay: { date: string; label: string; revenue: number }[];
  ordersByChannel: {
    channelId: string;
    channelName: ChannelName | string;
    shopName: string;
    count: number;
    revenue: number;
  }[];
  /** Đang lọc 1 gian hàng ⇒ chi phí vận hành vẫn là của TOÀN SHOP. */
  operatingExpenseIsShopWide: boolean;
}

export interface RecentOrder {
  id: string;
  orderCode: string;
  customerName: string;
  totalAmount: string | number;
  paymentStatus: string;
  shippingStatus: string;
  channelName: ChannelName;
  shopName: string;
  createdAt: string;
}

export interface DashboardSummary {
  productCount: number;
  orderCount: number;
  channelCount: number;
  totalRevenue: string | number;
  recentOrders: RecentOrder[];
}

// ----- Auth -----

export function login(email: string, password: string) {
  return apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function register(email: string, password: string, fullName: string) {
  return apiFetch<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, fullName }),
  });
}

export function fetchMe() {
  return apiFetch<{
    user: AuthUser & { createdAt: string };
    hasChannels: boolean;
  }>("/api/auth/me");
}

// ----- Quản lý nhân viên (chỉ Admin) -----

export interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: string;
  /** Gian hàng được phân công. CHỈ có ý nghĩa với SALES; rỗng = chưa thấy đơn nào. */
  allowedChannelIds: string[];
}

export function fetchStaff() {
  return apiFetch<StaffMember[]>("/api/staff");
}

export function createStaff(data: {
  email: string;
  password: string;
  fullName: string;
  role: Role;
  channelIds?: string[];
}) {
  return apiFetch<StaffMember>("/api/staff", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function setStaffChannels(staffId: string, channelIds: string[]) {
  return apiFetch<{ id: string; allowedChannelIds: string[] }>(
    `/api/staff/${staffId}/channels`,
    { method: "PUT", body: JSON.stringify({ channelIds }) }
  );
}

/** Đổi vai trò của một nhân viên. */
export function updateStaffRole(staffId: string, role: Role) {
  return apiFetch<StaffMember>(`/api/staff/${staffId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

/** Phân quyền từ phía gian hàng: chọn những SALES nào phụ trách gian này. */
export function setChannelStaff(channelId: string, staffIds: string[]) {
  return apiFetch<{ channelId: string; staffIds: string[] }>(
    `/api/staff/by-channel/${channelId}`,
    { method: "PUT", body: JSON.stringify({ staffIds }) }
  );
}

export function deleteStaff(staffId: string) {
  return apiFetch<{ ok: boolean }>(`/api/staff/${staffId}`, {
    method: "DELETE",
  });
}

// ----- Dashboard -----

export function fetchDashboardSummary() {
  return apiFetch<DashboardSummary>("/api/dashboard/summary");
}

// ----- Sản phẩm -----

export function fetchProducts(params: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.search) qs.set("search", params.search);
  return apiFetch<ProductListResponse>(`/api/products?${qs.toString()}`);
}

export function createProduct(data: {
  skuCode: string;
  productName: string;
  costPrice: number;
  sellingPrice: number;
  initialQuantity: number;
}) {
  return apiFetch<Product>("/api/products", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface ImportResult {
  created: number;
  updated: number;
  totalImported: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

// Nhập sản phẩm từ file Excel (multipart/form-data — không dùng apiFetch vì
// apiFetch luôn gắn Content-Type: application/json).
export async function importProductsExcel(file: File): Promise<ImportResult> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/api/products/import`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (!res.ok) {
    let message = `Máy chủ trả về lỗi ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // giữ thông báo mặc định
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

export function updateProduct(
  id: string,
  data: Partial<{
    skuCode: string;
    productName: string;
    costPrice: number;
    sellingPrice: number;
  }>
) {
  return apiFetch<Product>(`/api/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ----- Đơn hàng -----

export function fetchOrders(params: {
  page?: number;
  pageSize?: number;
  shippingStatus?: string;
  channel?: ChannelFilterQuery;
  carrier?: string;
  search?: string;
  /** Bộ lọc con của tab "Đã xử lý": "yes" đã in phiếu, "no" chưa in */
  printed?: "yes" | "no";
  /** Loại đơn theo độ khó đóng gói: 1 dòng hàng hay nhiều dòng */
  orderType?: "single" | "multi";
  /** Lọc theo tình trạng hàng hoàn (dùng trong tab Hủy / Hoàn) */
  returnStatus?: ReturnStatus;
}) {
  const qs = new URLSearchParams(channelFilterToQuery(params.channel));
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.shippingStatus) qs.set("shippingStatus", params.shippingStatus);
  if (params.carrier) qs.set("carrier", params.carrier);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.printed) qs.set("printed", params.printed);
  if (params.orderType) qs.set("orderType", params.orderType);
  if (params.returnStatus) qs.set("returnStatus", params.returnStatus);
  return apiFetch<OrderListResponse>(`/api/orders?${qs.toString()}`);
}

interface BulkResult {
  confirmed: number;
  skipped: { orderCode: string; reason: string }[];
}

/** Xác nhận & chuẩn bị hàng cho nhiều đơn (Chờ xử lý → Đã xử lý). */
export function bulkConfirmOrders(orderIds: string[]) {
  return apiFetch<BulkResult>("/api/orders/bulk/confirm", {
    method: "POST",
    body: JSON.stringify({ orderIds }),
  });
}

/** Bàn giao cho đơn vị vận chuyển (Đã xử lý → Đang giao). */
export function bulkHandoverOrders(orderIds: string[]) {
  return apiFetch<BulkResult>("/api/orders/bulk/handover", {
    method: "POST",
    body: JSON.stringify({ orderIds }),
  });
}

/** Lấy dữ liệu dựng phiếu giao hàng cho nhiều đơn để in một lượt. */
export function fetchOrderLabels(orderIds: string[]) {
  return apiFetch<{ labels: Order[] }>("/api/orders/bulk/labels", {
    method: "POST",
    body: JSON.stringify({ orderIds }),
  });
}

/**
 * Tra một đơn theo mã quét được từ máy quét barcode/QR hoặc camera.
 * Trả 409 kèm danh sách gợi ý nếu mã khớp nhiều đơn.
 */
export function lookupOrderByCode(code: string) {
  return apiFetch<{ order: Order }>(
    `/api/orders/lookup?code=${encodeURIComponent(code)}`
  );
}

export type ReturnAging = "unknown" | "ok" | "warning" | "overdue";

export interface ReturnRow extends Order {
  /** Số ngày kể từ lúc sàn báo hoàn — null khi chưa rõ mốc bắt đầu */
  daysWaiting: number | null;
  agingLevel: ReturnAging;
}

export interface WarehouseReturnsResponse {
  items: ReturnRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: Record<string, number>;
  /** Tổng tiền đã đòi được — dành cho module Tài chính hạch toán sau */
  totalCompensated: number;
  thresholds: { warningDays: number; overdueDays: number };
}

/** Danh sách đối soát đơn hoàn của kho, kèm số ngày chờ và mức cảnh báo. */
export function fetchWarehouseReturns(params: {
  status?: string;
  search?: string;
  channel?: ChannelFilterQuery;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams(channelFilterToQuery(params.channel));
  if (params.status) qs.set("status", params.status);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  return apiFetch<WarehouseReturnsResponse>(
    `/api/warehouse/returns?${qs.toString()}`
  );
}

/** Kéo về các đơn sàn báo đang hoàn (bản giả lập — chưa có API sàn thật). */
export function syncWarehouseReturns() {
  return apiFetch<{ synced: number; orderCodes: string[] }>(
    "/api/warehouse/returns/sync",
    { method: "POST" }
  );
}

/**
 * Chốt kết quả khiếu nại cho đơn hư hỏng/mất.
 * CẢ HAI kết quả đều KHÔNG cộng lại tồn kho — hàng được đền bằng tiền.
 */
export function updateReturnClaim(
  orderId: string,
  outcome: "COMPENSATED" | "REJECTED",
  /** Bắt buộc > 0 khi được đền bù; bỏ qua khi không được đền */
  amount?: number,
  note?: string
) {
  return apiFetch<{ order: Order }>(
    `/api/warehouse/returns/${orderId}/claim`,
    { method: "POST", body: JSON.stringify({ outcome, amount, note }) }
  );
}

/** Kho xác nhận đã nhận kiện hàng hoàn. INTACT thì cộng ngược tồn kho. */
export function processOrderReturn(
  orderId: string,
  condition: "INTACT" | "DAMAGED",
  note?: string
) {
  return apiFetch<{
    order: Order;
    restored: {
      productName: string;
      restoredQuantity: number;
      newQuantity: number;
    }[];
    stockSkippedReason: string | null;
  }>(`/api/orders/${orderId}/return`, {
    method: "POST",
    body: JSON.stringify({ condition, note }),
  });
}

/**
 * Đánh dấu đã in phiếu. Gọi SAU khi cửa sổ in mở thành công — nếu đánh dấu
 * ngay lúc lấy dữ liệu, trình duyệt chặn pop-up là đơn bị ghi "đã in" trong
 * khi chưa có tờ phiếu nào ra giấy.
 */
export function markOrdersPrinted(orderIds: string[]) {
  return apiFetch<{ markedPrinted: number }>("/api/orders/bulk/mark-printed", {
    method: "POST",
    body: JSON.stringify({ orderIds }),
  });
}

export function updateOrderStatus(id: string, shippingStatus: string) {
  return apiFetch<{
    order: Order;
    restored: { productName: string; restoredQuantity: number; newQuantity: number }[];
  }>(`/api/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ shippingStatus }),
  });
}

// ----- Báo cáo tài chính (chỉ Admin) -----

export function fetchAnalytics(range?: DateRange, channel?: ChannelFilterQuery) {
  return apiFetch<AnalyticsResponse>(
    withRange("/api/analytics", range, channel)
  );
}

// ----- Chi phí hoạt động (chỉ Admin) -----

export function fetchExpenses(range?: DateRange) {
  return apiFetch<OperatingExpense[]>(withRange("/api/expenses", range));
}

export function createExpense(data: {
  name: string;
  category: ExpenseCategory;
  amount: number;
  note?: string;
  expenseDate?: string;
}) {
  return apiFetch<OperatingExpense>("/api/expenses", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteExpense(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/expenses/${id}`, { method: "DELETE" });
}

// ----- Module Tài chính chuyên sâu /api/finance (chỉ Admin) -----

export interface LossOrder {
  id: string;
  orderCode: string;
  customerName: string;
  channelName: ChannelName | string;
  shopName: string;
  createdAt: string;
  revenue: number;
  platformFee: number;
  isSettled: boolean; // phí đã quyết toán hay còn tạm tính
  cost: number;
  profit: number; // ≤ 0 = lỗ
  isLoss: boolean;
  lossReason: "COST" | "FEE" | null; // COST = lỗ do giá vốn, FEE = lỗ do chi phí sàn
  warning?: string; // "Chưa nhập giá vốn"
}

// Một dòng chi tiết trong thẻ bóc tách dòng tiền
export interface BreakdownItem {
  key: string;
  label: string;
  hint: string; // nội dung tooltip giải thích công thức
  amount: number;
  percent: number;
  count?: number; // số đơn (nếu có)
}

export interface FinanceBreakdown {
  gross: {
    total: number;
    orderCount: number;
    items: BreakdownItem[];
    totalDeduction: number;
  };
  revenue: { total: number; items: BreakdownItem[] };
  costs: { total: number; items: BreakdownItem[] };
  profit: { total: number; items: BreakdownItem[] };
}

export interface FinanceAnalytics {
  deliveredOrderCount: number;
  totalRevenue: number;
  totalCost: number;
  totalPlatformFee: number;
  pendingPayout: number; // tiền chờ về (dự kiến)
  settledPayout: number; // tiền thực tế đã quyết toán
  pendingOrderCount: number;
  settledOrderCount: number;
  breakdown: FinanceBreakdown;
  grossProfit: number;
  totalOperatingExpense: number;
  fixedExpense: number;
  variableExpense: number;
  netProfit: number;
  series: { date: string; label: string; revenue: number; cost: number }[];
  /** Đang lọc 1 gian hàng ⇒ chi phí vận hành vẫn là của TOÀN SHOP. */
  operatingExpenseIsShopWide: boolean;
}

// ----- Đối soát & khiếu nại chênh lệch phí vận chuyển -----

export type ShippingDisputeStatus =
  | "CHO_KHIEU_NAI"
  | "DANG_KHIEU_NAI"
  | "DA_DOI_SOAT";

export interface ShippingDiscrepancy {
  id: string;
  orderCode: string;
  channelName: ChannelName;
  shopName: string;
  settledAt: string | null;
  createdAt: string;
  shippingFeeQuoted: number; // phí sàn báo
  shippingFeeActual: number; // phí thực tế bị trừ
  discrepancy: number; // ÂM = số tiền shop bị mất
  status: ShippingDisputeStatus;
}

export interface ShippingDiscrepancyResponse {
  summary: {
    totalOrders: number;
    totalDiscrepancy: number; // âm
    pendingCount: number;
  };
  page: number;
  pageSize: number;
  pageCount: number;
  items: ShippingDiscrepancy[];
}

export function fetchShippingDiscrepancies(params: {
  page?: number;
  pageSize?: number;
  channel?: ChannelFilterQuery;
  status?: string;
  range?: DateRange;
}) {
  const qs = new URLSearchParams({
    ...rangeToQuery(params.range),
    ...channelFilterToQuery(params.channel),
  });
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.status) qs.set("status", params.status);
  return apiFetch<ShippingDiscrepancyResponse>(
    `/api/finance/shipping-discrepancies?${qs.toString()}`
  );
}

export function updateShippingDisputeStatus(
  orderId: string,
  status: ShippingDisputeStatus
) {
  return apiFetch<{ id: string; orderCode: string; status: ShippingDisputeStatus }>(
    `/api/finance/shipping-discrepancies/${orderId}/status`,
    { method: "PATCH", body: JSON.stringify({ status }) }
  );
}

// ----- Cấu hình giá vốn theo SKU -----

export type SkuChannelFilter = "all" | "shopee" | "tiktok" | "lazada" | "offline";

export interface SkuProduct {
  skuId: string; // id dùng để cập nhật giá vốn
  productId: string;
  sku: string;
  productName: string;
  variantName: string | null; // phân loại (màu/size) theo tên trên sàn
  channelName: ChannelName;
  imageUrl: string | null;
  sellingPrice: string;
  costPrice: string;
}

export function fetchSkuProducts(channel: SkuChannelFilter = "all") {
  return apiFetch<{
    channel: string;
    total: number;
    missingCostCount: number;
    items: SkuProduct[];
  }>(`/api/finance/sku-products?channel=${channel}`);
}

// Chủ động quét sản phẩm từ các sàn đã kết nối về hệ thống (upsert)
/**
 * Kéo danh mục từ sàn về TẦNG ĐỆM. Bỏ trống channelId để quét mọi gian hàng.
 * KHÔNG tạo sản phẩm gốc — việc đó do người dùng làm ở trang Sản phẩm.
 */
export function syncProductsFromChannels(channelId?: string) {
  return apiFetch<{
    created: number;
    updated: number;
    perChannel: {
      channelId: string;
      channelName: ChannelName;
      shopName: string;
      scanned: number;
      created: number;
    }[];
  }>("/api/finance/sync-products", {
    method: "POST",
    body: JSON.stringify({ channelId }),
  });
}

export interface CostImportResult {
  updated: number;
  totalRows: number;
  errors: { row: number; message: string }[];
}

/** Áp một giá vốn cho nhiều SKU cùng lúc (nút "áp dụng cho mọi phân loại"). */
export function updateSkuCostPriceBulk(skuIds: string[], costPrice: number) {
  return apiFetch<{ updated: number; costPrice: string }>(
    "/api/finance/update-cost-bulk",
    {
      method: "PATCH",
      body: JSON.stringify({ sku_ids: skuIds, cost_price: costPrice }),
    }
  );
}

/** Nhập giá vốn hàng loạt từ file Excel (cột: Mã SKU, Giá vốn). */
export async function importCostPricesExcel(
  file: File
): Promise<CostImportResult> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/api/finance/cost-prices/import`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (!res.ok) {
    let message = `Máy chủ trả về lỗi ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // giữ thông báo mặc định
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

interface UpdateCostResult {
  skuId: string;
  productId: string;
  productName: string;
  costPrice: string;
  /**
   * Số dòng hàng ĐÃ BÁN được vá lại giá vốn. Đơn bán ra khi chưa nhập giá vốn
   * lưu ảnh chụp = 0; đặt giá vốn xong thì các dòng đó được tính lại để báo cáo
   * lãi/lỗ cũ hết sai.
   */
  backfilledOrderLines: number;
}

export function updateSkuCostPrice(skuId: string, costPrice: number) {
  return apiFetch<UpdateCostResult>("/api/finance/update-cost", {
    method: "PATCH",
    body: JSON.stringify({ sku_id: skuId, cost_price: costPrice }),
  });
}

/**
 * Đặt giá vốn theo MÃ SKU. Bảng SKU P&L gom số liệu theo mã chứ không mang theo
 * id sản phẩm gốc, nên popup nhập nhanh trên bảng đó dùng hàm này.
 */
export function updateCostPriceBySku(skuCode: string, costPrice: number) {
  return apiFetch<UpdateCostResult>("/api/finance/update-cost", {
    method: "PATCH",
    body: JSON.stringify({ sku_code: skuCode, cost_price: costPrice }),
  });
}

export function fetchFinanceAnalytics(range?: DateRange, channel?: ChannelFilterQuery) {
  return apiFetch<FinanceAnalytics>(
    withRange("/api/finance/analytics", range, channel)
  );
}

export function fetchLossOrders(range?: DateRange, channel?: ChannelFilterQuery) {
  return apiFetch<{
    analyzedCount: number;
    lossCount: number;
    warningCount: number;
    orders: LossOrder[];
    lossOrders: LossOrder[];
  }>(withRange("/api/finance/orders-analysis", range, channel));
}

export function createFinanceExpense(data: {
  description: string;
  type: ExpenseType;
  amount: number;
  category?: ExpenseCategory;
  appliedSku?: string; // chỉ dùng khi type = VARIABLE
  note?: string;
  expenseDate?: string;
}) {
  return apiFetch<OperatingExpense>("/api/finance/expenses", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ----- Kênh bán & Mapping -----

/** TẦNG 1 — một GIAN HÀNG cụ thể. Một sàn có thể có nhiều gian hàng. */
export interface Channel {
  id: string;
  channelName: ChannelName; // sàn: SHOPEE / LAZADA / TIKTOK / OFFLINE
  shopName: string; // tên gian hàng — thứ phân biệt 2 shop cùng sàn
  externalShopId: string | null;
  apiToken: string | null;
  status: string;
  feeRate: string | number;
  createdAt: string;
  _count?: { orders: number; channelProducts: number };
}

/** TẦNG 2 — một sản phẩm thô kéo từ gian hàng về. */
export interface ChannelProduct {
  id: string;
  channelSku: string;
  productName: string; // tên trên sàn
  variantName: string | null;
  price: string | number;
  imageUrl: string | null;
  status: "ACTIVE" | "DELISTED";
  lastSyncedAt: string | null;
  createdAt: string;
  /** null = CHƯA liên kết về kho gốc */
  productId: string | null;
  channel: { id: string; channelName: ChannelName; shopName: string };
  product: {
    id: string;
    skuCode: string;
    productName: string;
    quantityInStock: number;
  } | null;
}

export interface ChannelProductListResponse {
  items: ChannelProduct[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: { all: number; linked: number; unlinked: number };
}

export function fetchChannels() {
  return apiFetch<Channel[]>("/api/channels");
}

/** Kết nối thêm một gian hàng. Cùng một sàn có thể kết nối nhiều gian. */
export function connectChannel(channelName: ChannelName, shopName?: string) {
  return apiFetch<Channel>("/api/channels", {
    method: "POST",
    body: JSON.stringify({ channelName, shopName }),
  });
}

/** Sửa tên gian hàng và/hoặc % phí sàn. feeRate ở dạng thập phân (0.12 = 12%). */
export function updateChannel(
  id: string,
  data: { shopName?: string; feeRate?: number }
) {
  return apiFetch<Channel>(`/api/channels/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function disconnectChannel(id: string) {
  return apiFetch<Channel>(`/api/channels/${id}/disconnect`, { method: "POST" });
}

/** Danh sách sản phẩm sàn ở tầng đệm, kèm trạng thái liên kết. */
export function fetchChannelProducts(params: {
  channelId?: string;
  linked?: "yes" | "no";
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  if (params.channelId) qs.set("channelId", params.channelId);
  if (params.linked) qs.set("linked", params.linked);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  return apiFetch<ChannelProductListResponse>(`/api/mappings?${qs.toString()}`);
}

/** Nối nhiều sản phẩm sàn về CÙNG một SKU gốc. */
export function linkChannelProducts(channelProductIds: string[], productId: string) {
  return apiFetch<{
    linked: number;
    product: { id: string; skuCode: string; productName: string };
  }>("/api/mappings/link", {
    method: "POST",
    body: JSON.stringify({ channelProductIds, productId }),
  });
}

/** Gỡ liên kết — sản phẩm sàn vẫn còn ở tầng đệm, chỉ bỏ nối về kho gốc. */
export function unlinkChannelProducts(channelProductIds: string[]) {
  return apiFetch<{ unlinked: number }>("/api/mappings/unlink", {
    method: "POST",
    body: JSON.stringify({ channelProductIds }),
  });
}

// Giả lập một đơn hàng từ sàn gửi về (gọi webhook công khai)
export function sendMockOrder(data: {
  channelId: string;
  webhookToken: string;
  customerName?: string;
  items: { channelSku: string; quantity: number }[];
}) {
  return apiFetch<{
    message: string;
    order: { orderCode: string; totalAmount: string | number };
    adjustments: { productName: string; deducted: number; newQuantity: number }[];
  }>("/api/webhooks/mock-order", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ----- Kho hàng -----

export function adjustInventory(data: {
  productId: string;
  type: "IMPORT" | "EXPORT";
  quantity: number;
  reason?: string;
}) {
  return apiFetch<{ product: Product; log: InventoryLog }>(
    "/api/inventory/adjust",
    { method: "POST", body: JSON.stringify(data) }
  );
}
