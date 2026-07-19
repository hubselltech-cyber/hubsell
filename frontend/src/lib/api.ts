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
function withRange(path: string, range?: DateRange): string {
  const qs = new URLSearchParams(rangeToQuery(range)).toString();
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

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface Product {
  id: string;
  skuCode: string;
  productName: string;
  costPrice: string | number;
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

export interface Order {
  id: string;
  channelId: string;
  orderCode: string;
  customerName: string;
  totalAmount: string | number;
  paymentStatus: string;
  shippingStatus: string;
  createdAt: string;
  channel: { channelName: ChannelName };
}

export interface OrderListResponse {
  items: Order[];
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
  };
}

export function fetchSkuPnl(range?: DateRange) {
  return apiFetch<SkuPnlResponse>(withRange("/api/finance/sku-pnl", range));
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
  ordersByChannel: { channelName: ChannelName | string; count: number }[];
}

export interface RecentOrder {
  id: string;
  orderCode: string;
  customerName: string;
  totalAmount: string | number;
  paymentStatus: string;
  shippingStatus: string;
  channelName: ChannelName;
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
  createdAt: string;
  allowedChannelIds: string[]; // rỗng = xem tất cả kênh
}

export function fetchStaff() {
  return apiFetch<StaffMember[]>("/api/staff");
}

export function createStaff(data: {
  email: string;
  password: string;
  fullName: string;
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
  channelId?: string;
}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.shippingStatus) qs.set("shippingStatus", params.shippingStatus);
  if (params.channelId) qs.set("channelId", params.channelId);
  return apiFetch<OrderListResponse>(`/api/orders?${qs.toString()}`);
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

export function fetchAnalytics(range?: DateRange) {
  return apiFetch<AnalyticsResponse>(withRange("/api/analytics", range));
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
  channel?: string;
  status?: string;
  range?: DateRange;
}) {
  const qs = new URLSearchParams(rangeToQuery(params.range));
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params.channel && params.channel !== "all") qs.set("channel", params.channel);
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
export function syncProductsFromChannels() {
  return apiFetch<{
    message: string;
    created: number;
    updated: number;
    unchanged: number;
    missingCostCount: number;
    perChannel: { channelName: ChannelName; scanned: number; created: number }[];
  }>("/api/finance/sync-products", { method: "POST" });
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

export function updateSkuCostPrice(skuId: string, costPrice: number) {
  return apiFetch<{
    skuId: string;
    productId: string;
    productName: string;
    costPrice: string;
  }>("/api/finance/update-cost", {
    method: "PATCH",
    body: JSON.stringify({ sku_id: skuId, cost_price: costPrice }),
  });
}

export function fetchFinanceAnalytics(range?: DateRange) {
  return apiFetch<FinanceAnalytics>(withRange("/api/finance/analytics", range));
}

export function fetchLossOrders(range?: DateRange) {
  return apiFetch<{
    analyzedCount: number;
    lossCount: number;
    warningCount: number;
    orders: LossOrder[];
    lossOrders: LossOrder[];
  }>(withRange("/api/finance/orders-analysis", range));
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

export interface Channel {
  id: string;
  channelName: ChannelName;
  apiToken: string | null;
  status: string;
  createdAt: string;
  _count?: { orders: number; mappings: number };
}

export interface ChannelProductItem {
  channelSku: string;
  name: string;
  price: number;
  mapping: {
    id: string;
    productId: string;
    productSku: string;
    productName: string;
    quantityInStock: number;
  } | null;
}

export interface ChannelProductsResponse {
  channel: { id: string; channelName: ChannelName; status: string };
  items: ChannelProductItem[];
}

export function fetchChannels() {
  return apiFetch<Channel[]>("/api/channels");
}

export function connectChannel(channelName: ChannelName) {
  return apiFetch<Channel>("/api/channels", {
    method: "POST",
    body: JSON.stringify({ channelName }),
  });
}

export function disconnectChannel(id: string) {
  return apiFetch<Channel>(`/api/channels/${id}/disconnect`, { method: "POST" });
}

export function fetchChannelProducts(channelId: string) {
  return apiFetch<ChannelProductsResponse>(`/api/channels/${channelId}/products`);
}

export function createMapping(data: {
  productId: string;
  channelId: string;
  channelSku: string;
}) {
  return apiFetch<{ id: string }>("/api/mappings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteMapping(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/mappings/${id}`, { method: "DELETE" });
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
