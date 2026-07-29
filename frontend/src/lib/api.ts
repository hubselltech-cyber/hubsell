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
    className: "bg-violet-50 text-violet-700 border-violet-200",
  },
  SALES: {
    label: "Nhân viên vận hành",
    description:
      "Chỉ xử lý đơn và xem doanh thu của những gian hàng được phân công. Không thấy giá vốn, lợi nhuận hay chi phí.",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  WAREHOUSE: {
    label: "Nhân viên kho",
    description:
      "Thấy đơn của TẤT CẢ gian hàng để nhặt và đóng gói. Không vào được mục Tài chính và không thấy giá vốn.",
    className: "bg-amber-50 text-amber-700 border-amber-200",
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
  /**
   * Số đang bị GIỮ bởi đơn sàn chưa chốt (UNPAID) — khả dụng thật =
   * quantityInStock − holdQuantity. Optional vì dữ liệu cũ có thể chưa có.
   */
  holdQuantity?: number;
  /** Thuế & Hóa đơn (module đang dựng khung — giữ chỗ). */
  taxName?: string | null;
  /** % thuế suất GTGT đầu ra: 0 / 5 / 8 / 10. */
  vatRate?: number;
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

/** Cảnh báo lệch tồn: đẩy tồn lên sàn thất bại sau đủ số lần retry. */
export interface InventorySyncAlert {
  id: string;
  shopName: string;
  channelSku: string | null;
  orderSn: string | null;
  message: string;
  createdAt: string;
  /** Tồn khả dụng HIỆN TẠI của SKU trên Hubsell — số chuẩn nút "Cập nhật tồn" sẽ đè lên sàn. */
  hubsellAvailable: number | null;
}

/** Một dòng trong hàng đợi webhook + job đối soát tồn (bảng shopee_webhook_logs). */
export interface ShopeeWebhookLogRow {
  id: string;
  /** 3/4/5 = sự kiện push Shopee; 100 = job đối soát tồn nội bộ. */
  eventCode: number;
  shopId: string;
  orderSn: string | null;
  status: "PENDING" | "PROCESSING" | "VERIFYING" | "SUCCESS" | "FAILED";
  attempts: number;
  nextRetryAt: string | null;
  processedAt: string | null;
  lastError: string | null;
  /** JSON thô (stringify) — payload webhook hoặc nội dung job đối soát. */
  payload: string;
  createdAt: string;
}

export interface WebhookLogsResponse {
  items: ShopeeWebhookLogRow[];
  counts: Partial<Record<ShopeeWebhookLogRow["status"], number>>;
}

/** Một dòng nhật ký đối soát đẩy tồn lên sàn: [SKU, số cũ, số mới, kết quả]. */
export interface InventorySyncLog {
  id: string;
  shopName: string;
  channelSku: string;
  oldQuantity: number;
  newQuantity: number;
  status: "SUCCESS" | "FAILED";
  message: string | null;
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
export type TransactionDirection = "INCOME" | "EXPENSE";
export type FundSourceType = "PLATFORM_WALLET" | "BANK_ACCOUNT";

export interface OperatingExpense {
  id: string;
  direction: TransactionDirection;
  name: string;
  category: ExpenseCategory;
  type: ExpenseType;
  appliedSku: string | null; // SKU được gắn (chỉ với chi phí VARIABLE)
  amount: number;
  // Nguồn tiền áp dụng — để đối chiếu với bảng dòng tiền
  fundChannelId: string | null;
  fundSource: FundSourceType | null;
  fundChannelName: ChannelName | null;
  fundShopName: string | null;
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

/** Bộ lọc trạng thái đơn — dùng chung cho các báo cáo lãi/lỗ (P&L). */
export type ReconciliationStatus =
  | "all"
  | "delivered"
  | "shipping"
  | "cancelled";

// ----- Lãi/Lỗ Thực Hiện — chi tiết từng đơn theo sàn -----

/** Một dòng sản phẩm trong đơn (phục vụ cột "Chi tiết sản phẩm"). */
export interface PnlItemLine {
  sku: string;
  name: string;
  variation: string;
  quantity: number;
  price: number;
  costPriceAtSale: number;
}

/**
 * "Detail row" GIÀU trường của một đơn — superset dùng chung cho mọi sàn. Mỗi
 * bảng sàn (Shopee/TikTok) tự ánh xạ sang cấu trúc cột đặc thù của mình. Các
 * trường phí là ĐỘ LỚN DƯƠNG (magnitude); giao diện tự thêm dấu trừ.
 */
export interface PnlDetailRow {
  id: string;
  orderCode: string;
  shippingStatus: string;
  isSettled: boolean;
  channelName: ChannelName;
  shopName: string;
  createdAt: string;
  /** Mốc bàn giao ĐVVC (≈ "ngày gửi ĐVVC") — null nếu chưa. */
  shippedAt: string | null;
  customerName: string;
  carrier: Carrier | null;
  items: PnlItemLine[];
  // Doanh thu & trợ giá
  revenueGross: number;
  sellerVoucher: number;
  platformSubsidy: number;
  // Vận chuyển
  shippingFeeQuoted: number;
  shippingFeeActual: number;
  shippingFeeDiff: number;
  /** Trợ giá VC từ SÀN / do SHOP chịu — bóc tách nội bộ của phí ship. */
  shipSubsidyPlatform: number;
  shipSubsidyShop: number;
  // Phí sàn theo bucket
  feeFixedPayment: number;
  feeService: number;
  feeAffiliate: number;
  /** Khấu trừ lúc giải ngân (đã phản ánh trong actualPayout) — chỉ hiển thị. */
  adWalletTopup: number;
  taxWithheld: number;
  // Hiệu quả
  costSnapshot: number;
  netRevenue: number;
  actualPayout: number;
  profit: number;
  /** Thuế sàn TMĐT: số THẬT sàn trích khi đã quyết toán / ước tính % khi chưa. */
  platformTax: number;
  /** profit − platformTax (thuế bổ sung của kỳ nằm ở summary, không chia dòng). */
  profitAfterTax: number;
  missingCostPrice: boolean;
  /**
   * SAO KÊ QUYẾT TOÁN LAZADA CHI TIẾT — số CÓ DẤU NGUYÊN BẢN từ Finance API
   * (âm = sàn trừ, dương = ghi có). null với đơn sàn khác / chưa đối soát.
   */
  lazada: LazadaSettlementDetail | null;
}

/** Bộ cột sao kê chi tiết Lazada (xem model LazadaOrderSettlement phía backend). */
export interface LazadaSettlementDetail {
  itemRevenue: number;
  // Chi tiết phí vận chuyển
  shipFee: number;
  shipFeeCustomer: number;
  shipDiscountPlatform: number;
  shipDiscountSeller: number;
  shipFeeReturn: number;
  shipFeeAdjustment: number;
  // Phí nền tảng
  feePayment: number;
  feeCommission: number;
  feeShipSeller: number;
  shipSubsidySeller: number;
  feeFreeshipMax: number;
  feeCashbackMax: number;
  feeSponsoredDiscovery: number;
  feeLazadaBonus: number;
  bonusLzdCofund: number;
  feeBuyerReview: number;
  feeLazpick: number;
  feeCampaign: number;
  feeAffiliate: number;
  feeInfrastructure: number;
  feeOther: number;
  subsidyOther: number;
  // Thuế
  vatFee: number;
  incomeTaxFee: number;
  // Kết quả
  actualPayout: number;
}

export interface RealizedPnlResponse {
  rows: PnlDetailRow[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  summary: {
    count: number;
    settledCount: number;
    totalNetRevenue: number;
    totalProfit: number;
    /** Tổng thuế sàn TMĐT (thực + ước tính) của toàn bộ đơn khớp lọc. */
    totalPlatformTax: number;
    /** Thuế bổ sung ước tính của kỳ theo cấu hình trang "Thuế bổ sung". */
    additionalTax: number;
    totalProfitAfterTax: number;
    taxSettings: {
      calculationBase: TaxCalculationBase;
      platformTaxPercent: number;
      customTaxPercent: number;
    };
    /** { SHOPEE: { count, profit }, ... } trên toàn bộ đơn khớp lọc. */
    byPlatform: Record<string, { count: number; profit: number }>;
  };
}

export function fetchRealizedPnl(params: {
  range?: DateRange;
  channel?: ChannelFilterQuery;
  status?: ReconciliationStatus;
  /** Chỉ lấy đơn LỖ (lợi nhuận thực tế < 0). */
  lossOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams({
    ...rangeToQuery(params.range),
    ...channelFilterToQuery(params.channel),
    ...(params.status && params.status !== "all" ? { status: params.status } : {}),
    ...(params.lossOnly ? { lossOnly: "true" } : {}),
    ...(params.page ? { page: String(params.page) } : {}),
    ...(params.pageSize ? { pageSize: String(params.pageSize) } : {}),
  }).toString();
  return apiFetch<RealizedPnlResponse>(
    `/api/finance/realized-pnl${qs ? `?${qs}` : ""}`
  );
}

// ----- Phân bổ dòng tiền theo gian hàng (Cash Flow) -----

/**
 * Một dòng dòng-tiền của MỘT gian hàng. Mọi giá trị là số tiền (VNĐ). Backend
 * trả về đủ mọi gian đã liên kết (kể cả gian chưa phát sinh đơn = toàn 0).
 */
export interface CashFlowRow {
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  /** Tiền đang đi đường: đơn đang giao/chuẩn bị hoặc đang hoàn. */
  inTransit: number;
  /** Tiền chờ đối soát: đơn đã giao nhưng sàn chưa quyết toán. */
  pendingSettle: number;
  /** Tiền trên Ví sàn: đã quyết toán, còn ở ví sàn (đã trừ phần đã rút). Có thể ÂM
   *  nếu số đã rút vượt tiền quyết toán — tín hiệu lệch pha cần đối soát. */
  settled: number;
  /** Tiền về Ngân hàng: đã rút ví sàn về bank (Σ WalletWithdrawal thành công). */
  withdrawn: number;
  /** Tổng dòng tiền dự kiến của gian = tổng 4 cột trên. */
  total: number;
}

export interface CashFlowResponse {
  rows: CashFlowRow[];
}

export function fetchCashFlow() {
  return apiFetch<CashFlowResponse>("/api/finance/cash-flow");
}

// ----- Rút ví sàn → ngân hàng (WalletWithdrawal) -----

export interface Withdrawal {
  id: string;
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  amount: number;
  status: string;
  source: "MANUAL" | "SYNC";
  externalTxnId: string | null;
  transactionTime: string;
  note: string | null;
}

export function fetchWithdrawals(channelId?: string) {
  const qs = channelId ? `?channelId=${encodeURIComponent(channelId)}` : "";
  return apiFetch<{ items: Withdrawal[] }>(`/api/finance/withdrawals${qs}`);
}

/** Kế toán xác nhận đã rút ví thủ công. */
export function createWithdrawal(data: {
  channelId: string;
  amount: number;
  transactionTime?: string;
  note?: string;
}) {
  return apiFetch<{ id: string; amount: number }>("/api/finance/withdrawals", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteWithdrawal(id: string) {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/api/finance/withdrawals/${id}`,
    { method: "DELETE" }
  );
}

export interface AnalyticsResponse {
  /** Số đơn phát sinh trong kỳ đang tính doanh thu (không gồm đơn hủy). */
  activeOrderCount: number;
  totalRevenue: number;
  totalCost: number;
  /** Phí sàn giữ lại trên các đơn Đã giao. Vắng mặt với SALES. */
  totalPlatformFee: number;
  grossProfit: number;
  totalOperatingExpense: number;
  netProfit: number;
  expensesByCategory: { category: ExpenseCategory | string; amount: number }[];
  /** `cost` (giá vốn + chi phí vận hành trong ngày) vắng mặt với SALES. */
  revenueByDay: {
    date: string;
    label: string;
    revenue: number;
    cost?: number;
  }[];
  ordersByChannel: {
    channelId: string;
    channelName: ChannelName | string;
    shopName: string;
    count: number;
    revenue: number;
  }[];
  /** Tổng số đơn phát sinh trong kỳ (mọi trạng thái). */
  orderCount: number;
  /** Phễu vận hành: số đơn theo từng trạng thái trong kỳ. */
  pipeline: {
    PENDING: number;
    PROCESSED: number;
    SHIPPING: number;
    DELIVERED: number;
    CANCELLED: number;
    /** Hàng hoàn CHƯA xử lý xong (chờ nhận / chờ khiếu nại). */
    RETURNING: number;
  };
  /** Số liệu kỳ trước liền kề (cùng độ dài) để tính tăng/giảm. null khi không lọc ngày. */
  previous: { totalRevenue: number; orderCount: number } | null;
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

/**
 * Bốn chức năng có thể bật/tắt độc lập cho từng gian hàng của một SALES.
 * Khớp với các cột canFinance/canWarehouse/canAds/canOrders ở backend.
 */
export type StaffPermissionKey = "finance" | "warehouse" | "ads" | "orders";

/** Nhãn hiển thị của từng cột trong ma trận phân quyền. */
export const STAFF_PERMISSION_META: {
  key: StaffPermissionKey;
  label: string;
}[] = [
  { key: "finance", label: "Tài chính" },
  { key: "warehouse", label: "Kho hàng" },
  { key: "ads", label: "Quảng cáo" },
  { key: "orders", label: "Đơn hàng" },
];

/** Phân quyền của một SALES trên MỘT gian hàng: id gian + 4 cờ chức năng. */
export interface StaffChannelPermission {
  channelId: string;
  finance: boolean;
  warehouse: boolean;
  ads: boolean;
  orders: boolean;
}

export interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: string;
  /**
   * Phân quyền chi tiết theo gian hàng. CHỈ có ý nghĩa với SALES; rỗng = chưa
   * được gán gian nào (chưa thấy đơn nào). Mỗi phần tử là một gian kèm 4 cờ.
   */
  allowedChannels: StaffChannelPermission[];
  /** Danh sách id gian được gán — tiện cho chỗ chỉ cần biết phạm vi. */
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
  channels?: StaffChannelPermission[];
}) {
  return apiFetch<StaffMember>("/api/staff", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Đặt lại toàn bộ ma trận phân quyền gian hàng cho một SALES. */
export function setStaffChannels(
  staffId: string,
  channels: StaffChannelPermission[]
) {
  return apiFetch<StaffMember>(`/api/staff/${staffId}/channels`, {
    method: "PUT",
    body: JSON.stringify({ channels }),
  });
}

/** Đổi vai trò của một nhân viên. */
export function updateStaffRole(staffId: string, role: Role) {
  return apiFetch<StaffMember>(`/api/staff/${staffId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
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

// ----- Đồng bộ tồn kho tự động (Inventory Sync) -----

/** Cảnh báo lệch tồn CHƯA xử lý (mới nhất trước). */
export function fetchSyncAlerts() {
  return apiFetch<InventorySyncAlert[]>("/api/inventory/sync-alerts");
}

/** Đánh dấu một cảnh báo lệch tồn là đã xử lý tay xong. */
export function resolveSyncAlert(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/inventory/sync-alerts/${id}/resolve`, {
    method: "PATCH",
  });
}

/** Nhật ký các lượt đẩy tồn kho lên sàn (đối soát). */
export function fetchSyncLogs(limit = 50) {
  return apiFetch<InventorySyncLog[]>(`/api/inventory/sync-logs?limit=${limit}`);
}

/**
 * Nút [Cập nhật tồn] trên thẻ cảnh báo Trung tâm điều hành: đè trực tiếp tồn
 * khả dụng chuẩn từ Hubsell lên sàn cho SKU của cảnh báo; thành công thì backend
 * tự đóng cảnh báo + ghi nhật ký vận hành.
 */
export function forceSyncStockAlert(alertId: string) {
  return apiFetch<{ ok: boolean; pushed: number; applied: number }>(
    `/api/inventory/sync-alerts/${alertId}/force-sync`,
    { method: "POST" }
  );
}

/** Nhật ký hàng đợi webhook + job đối soát (CHỈ Quản trị). */
export function fetchWebhookLogs(params: { q?: string; status?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  return apiFetch<WebhookLogsResponse>(`/api/inventory/webhook-logs?${qs.toString()}`);
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
  /** Thuế & Hóa đơn (giữ chỗ) — tuỳ chọn. */
  taxName?: string;
  vatRate?: number;
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

export function createOperatingTxn(data: {
  direction?: TransactionDirection; // mặc định EXPENSE
  name: string;
  amount: number;
  fundChannelId?: string; // module bắt buộc; quick-add dashboard có thể bỏ
  fundSource?: FundSourceType;
  category?: ExpenseCategory; // chỉ với CHI
  type?: ExpenseType; // chỉ với CHI
  appliedSku?: string; // chỉ với CHI biến đổi
  note?: string;
  expenseDate?: string;
}) {
  return apiFetch<{ id: string }>("/api/expenses", {
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
  /** Khối THUẾ từ cấu hình trang "Thuế bổ sung" (module Hóa đơn & Thuế). */
  taxes: {
    calculationBase: TaxCalculationBase;
    platformTaxPercent: number;
    customTaxPercent: number;
    filterPeriod: TaxFilterPeriod;
    /** Sàn ĐÃ trích trên đơn quyết toán — chỉ đối soát, đã nằm trong tiền thực nhận. */
    platformTaxActual: number;
    /** Ước tính cho đơn chưa quyết toán — ĐÃ trừ vào netProfitAfterTax. */
    platformTaxEstimated: number;
    platformTaxTotal: number;
    additionalTax: number;
    netProfitAfterTax: number;
  };
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
  productId: string; // "" nếu SKU sàn chưa liên kết kho gốc
  sku: string;
  productName: string;
  variantName: string | null; // phân loại (màu/size) theo tên trên sàn
  channelName: ChannelName;
  imageUrl: string | null;
  sellingPrice: string;
  costPrice: string;
  /** false = SKU sàn chưa nối kho gốc — giá vốn lưu ở cấp SKU sàn, vẫn nhập được. */
  linked: boolean;
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


// ----- Kênh bán & Mapping -----

/** TẦNG 1 — một GIAN HÀNG cụ thể. Một sàn có thể có nhiều gian hàng. */
export interface Channel {
  id: string;
  channelName: ChannelName; // sàn: SHOPEE / LAZADA / TIKTOK / OFFLINE
  shopName: string; // tên gian hàng — thứ phân biệt 2 shop cùng sàn
  externalShopId: string | null;
  /** Tên gian phía sàn trả về (TikTok) — chỉ có khi nối qua API thật. */
  externalShopName?: string | null;
  apiToken: string | null;
  status: string;
  feeRate: string | number;
  createdAt: string;
  /** true = đã nối API thật (OAuth, có shop_cipher); false = gian giả lập/thủ công. */
  apiConnected?: boolean;
  /** Thời điểm access_token hết hạn (ISO) — chỉ có khi nối API thật. */
  accessTokenExpireAt?: string | null;
  _count?: { orders: number; channelProducts: number };
  /** Số sản phẩm sàn đã khớp mã SKU về kho gốc (productId != null). */
  matchedProductCount?: number;
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

/**
 * Lấy URL trang uỷ quyền TikTok Shop + state (chống CSRF). FE lưu state rồi
 * chuyển hướng người dùng sang `url`. TikTok sẽ redirect về trang callback.
 */
export function getTiktokAuthUrl() {
  return apiFetch<{ url: string; state: string }>("/api/channels/tiktok/auth-url");
}

/**
 * Lấy URL trang uỷ quyền Shopee. FE chỉ việc chuyển hướng sang `url`; danh tính
 * chủ shop đã được nhét vào `state` phía backend nên callback (route backend) tự
 * biết kết nối cho ai rồi redirect về `/channels?shopee=connected|error`.
 */
export function getShopeeAuthUrl() {
  return apiFetch<{ url: string }>("/api/channels/shopee/auth-url");
}

/** Gian Shopee vừa kết nối (không chứa token). */
export interface ShopeeConnectedChannel {
  id: string;
  channelName: ChannelName;
  shopName: string;
  externalShopId: string | null;
  status: string;
}

/**
 * Đổi CODE + SHOP_ID uỷ quyền Shopee lấy token + lưu gian hàng. Dành cho dev
 * local: callback đăng ký trên Console là backend Render, Render bật code về
 * FE local (?shopee=code&code=&shop_id=) rồi FE gọi vào đây — danh tính chủ
 * shop lấy từ JWT đăng nhập nên không cần state.
 */
export function connectShopeeCode(code: string, shopId: string) {
  return apiFetch<{ message: string; channel: ShopeeConnectedChannel }>(
    "/api/channels/shopee/connect",
    { method: "POST", body: JSON.stringify({ code, shopId }) }
  );
}

/**
 * Lấy URL trang uỷ quyền Lazada. Callback đăng ký trên App Console là backend
 * RENDER (Lazada bắt https) nên khi chạy LOCAL, người dùng mở URL này ở tab
 * mới, uỷ quyền xong copy ?code=... từ URL callback rồi dán lại vào dialog.
 */
export function getLazadaAuthUrl() {
  return apiFetch<{ url: string }>("/api/channels/lazada/auth-url");
}

/** Gian Lazada vừa kết nối (không chứa token). */
export interface LazadaConnectedChannel {
  id: string;
  channelName: ChannelName;
  shopName: string;
  externalShopId: string | null;
  status: string;
}

/**
 * Đổi CODE uỷ quyền Lazada (dán tay từ URL callback) lấy token + lưu gian hàng.
 * Danh tính chủ shop lấy từ JWT đăng nhập nên không cần state ở luồng này.
 */
export function connectLazadaCode(code: string) {
  return apiFetch<{ message: string; channel: LazadaConnectedChannel }>(
    "/api/channels/lazada/connect",
    { method: "POST", body: JSON.stringify({ code }) }
  );
}

/** Kết quả một gian TikTok đã nối qua OAuth (không chứa token). */
export interface TiktokConnectedChannel {
  id: string;
  channelName: ChannelName;
  shopName: string;
  externalShopId: string | null;
  status: string;
}

/**
 * Gửi auth_code (TikTok trả về ở callback) lên backend để đổi lấy access token,
 * lấy shop_cipher và lưu gian hàng. state đã được FE đối chiếu trước khi gọi.
 */
export function tiktokCallback(code: string) {
  return apiFetch<{ connected: number; channels: TiktokConnectedChannel[] }>(
    "/api/channels/tiktok/callback",
    { method: "POST", body: JSON.stringify({ code }) }
  );
}

/** Kết quả đồng bộ đơn hàng thật (TikTok/Shopee) về DB. */
export interface SyncOrdersResult {
  message: string;
  fetched: number;
  created: number;
  updated: number;
  itemsCreated: number;
  pages: number;
}

/**
 * Kéo đơn hàng thật về hệ thống (upsert theo mã đơn). Endpoint tự dispatch theo
 * sàn của gian (TikTok/Shopee) — dùng chung cho mọi gian đã nối API thật.
 */
export function syncChannelOrders(channelId: string) {
  return apiFetch<SyncOrdersResult>(`/api/channels/${channelId}/sync-orders`, {
    method: "POST",
  });
}

/** Kết quả đồng bộ đối soát/dòng tiền TikTok thật. */
export interface SyncSettlementsResult {
  message: string;
  statements: number;
  transactions: number;
  ordersUpdated: number;
  ordersNotFound: number;
  pages: number;
}

/** Kéo đối soát thật từ TikTok Shop → cập nhật số quyết toán từng đơn (Cash Flow). */
export function syncTiktokSettlements(channelId: string) {
  return apiFetch<SyncSettlementsResult>(
    `/api/channels/${channelId}/sync-settlements`,
    { method: "POST" }
  );
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
  /** Lọc theo SÀN (Shopee/Lazada/…). Kết hợp được với channelId. */
  channelName?: ChannelName;
  channelId?: string;
  linked?: "yes" | "no";
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  if (params.channelName) qs.set("channelName", params.channelName);
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

/**
 * TỰ KHỚP các SKU sàn chưa liên kết vào kho gốc theo trùng mã SKU (không phân
 * hoa-thường). Chỉ đụng dòng chưa nối — liên kết tay không bị ghi đè.
 */
export function autoMatchMappings(channelId?: string) {
  return apiFetch<{ matched: number; products: number; scanned: number }>(
    "/api/mappings/auto-match",
    { method: "POST", body: JSON.stringify(channelId ? { channelId } : {}) }
  );
}

/**
 * TẠO SẢN PHẨM KHO từ các SKU sàn đã chọn rồi liên kết luôn (≤200/lần).
 * Trùng mã sẵn có trong kho thì nối vào sản phẩm cũ thay vì tạo mới.
 */
export function createProductsFromMappings(channelProductIds: string[]) {
  return apiFetch<{
    createdProducts: number;
    reusedProducts: number;
    linked: number;
    skipped: number;
  }>("/api/mappings/create-products", {
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

// ----- Trung tâm điều hành (Command Center) -----
//
// Chỉ lưu các THAY ĐỔI do người dùng tạo (đã xử lý / chat / nhật ký). Cảnh báo
// gốc vẫn sinh ở frontend. role/tag để dạng string vì đây là vai trò & nhóm
// riêng của Command Center (types.ts), component tự ép về kiểu của nó.

/** Một dòng nhật ký vận hành đã lưu. */
export interface OpsActivityDTO {
  id: string;
  tag: string;
  message: string;
  at: string;
}

/** Một tin thảo luận đã lưu (body là ChatBody dạng JSON). */
export interface OpsChatDTO {
  id: string;
  alertId: string;
  author: string;
  role: string;
  body: unknown;
  at: string;
}

export interface OpsStateResponse {
  resolvedAlertIds: string[];
  chat: OpsChatDTO[];
  activities: OpsActivityDTO[];
}

/** Đọc toàn bộ trạng thái Command Center đã lưu của shop (gọi khi load/F5). */
export function fetchCommandCenterState() {
  return apiFetch<OpsStateResponse>("/api/command-center/state");
}

/** Đánh dấu / bỏ đánh dấu một cảnh báo "Đã xử lý" (kèm nhật ký nếu có). */
export function setCommandCenterResolved(input: {
  alertId: string;
  resolved: boolean;
  byRole?: string;
  activity?: { tag: string; message: string };
}) {
  return apiFetch<{ ok: boolean; resolved: boolean; activity: OpsActivityDTO | null }>(
    "/api/command-center/resolve",
    { method: "POST", body: JSON.stringify(input) }
  );
}

/** Lưu một tin thảo luận mới cho một cảnh báo (kèm nhật ký nếu có). */
export function postCommandCenterChat(input: {
  alertId: string;
  role: string;
  body: unknown;
  author?: string;
  activity?: { tag: string; message: string };
}) {
  return apiFetch<{ message: OpsChatDTO; activity: OpsActivityDTO | null }>(
    "/api/command-center/chat",
    { method: "POST", body: JSON.stringify(input) }
  );
}

// ----- Cấu hình Hóa đơn điện tử & Chữ ký số (Multi-Vendor Adapter) -----
//
// Trường bí mật (secretKey, apiKey) KHÔNG bao giờ nhận về nguyên văn — chỉ có bản
// che + cờ đã-đặt. Khi lưu, để trống nghĩa là giữ nguyên khóa cũ.

export interface InvoiceConfigDTO {
  provider: string; // MISA | VIETTEL | BKAV | CUSTOM
  signMethod: string; // usb | hsm
  partnerCode: string;
  clientId: string;
  customApiUrl: string;
  hasSecretKey: boolean;
  secretKeyMasked: string | null;
}

/** api_key riêng của một gian hàng (phục vụ đối soát hoa hồng theo shop). */
export interface InvoiceChannelKeyDTO {
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
}

export interface InvoiceConfigResponse {
  config: InvoiceConfigDTO;
  channelKeys: InvoiceChannelKeyDTO[];
}

export function fetchInvoiceConfig() {
  return apiFetch<InvoiceConfigResponse>("/api/invoice-config");
}

/** Lưu cấu hình cấp shop. secretKey để trống = giữ nguyên khóa cũ. */
export function saveInvoiceConfig(input: {
  provider: string;
  signMethod: string;
  partnerCode?: string;
  clientId?: string;
  secretKey?: string;
  customApiUrl?: string;
}) {
  return apiFetch<{ config: InvoiceConfigDTO }>("/api/invoice-config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Lưu api_key riêng cho một gian hàng. Để trống = giữ nguyên khóa cũ. */
export function saveInvoiceChannelKey(channelId: string, apiKey: string) {
  return apiFetch<{
    channelId: string;
    hasApiKey: boolean;
    apiKeyMasked: string | null;
  }>(`/api/invoice-config/channels/${channelId}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

// ----- Hóa đơn & Thuế: Thuế bổ sung + Báo cáo thuế -----
//
// % thuế đi qua API ở dạng PHẦN TRĂM (1.5 = 1.5%) khớp ô nhập của UI; backend
// tự đổi sang phân số khi lưu DB. Thuế sàn (platformTaxPercent) do luật ấn
// định — chỉ đọc, không có API sửa.

/** Nhân % thuế bổ sung vào LỢI NHUẬN trước thuế hay DOANH THU gốc của kỳ. */
export type TaxCalculationBase = "PROFIT" | "REVENUE";
export type TaxFilterPeriod = "MONTH" | "QUARTER" | "YEAR";

export interface TaxSettingsDTO {
  customTaxPercent: number; // % thuế bổ sung chủ shop tự ước tính
  calculationBase: TaxCalculationBase;
  filterPeriod: TaxFilterPeriod;
  platformTaxPercent: number; // thuế sàn TMĐT — hằng số luật 1.5, chỉ đọc
}

export function fetchTaxSettings() {
  return apiFetch<{ settings: TaxSettingsDTO }>("/api/tax/settings");
}

export function saveTaxSettings(input: {
  customTaxPercent: number;
  calculationBase: TaxCalculationBase;
  filterPeriod: TaxFilterPeriod;
}) {
  return apiFetch<{ settings: TaxSettingsDTO }>("/api/tax/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export type InvoiceLogStatus = "PENDING" | "ISSUED" | "CANCELLED" | "FAILED";

export interface InvoiceLogDTO {
  id: string;
  orderCode: string;
  provider: string;
  invoiceNo: string | null;
  status: InvoiceLogStatus;
  totalAmount: number;
  vatAmount: number;
  platformTaxWithheld: number;
  errorMessage: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export interface TaxReportResponse {
  settings: TaxSettingsDTO;
  summary: {
    orderCount: number;
    settledCount: number;
    grossRevenue: number;
    platformTaxActual: number; // sàn ĐÃ trích (số quyết toán thật)
    platformTaxEstimated: number; // ước tính cho phần đơn chưa quyết toán
    platformTaxTotal: number;
    additionalTax: number;
    additionalTaxBase: number; // cơ sở tính (doanh thu hoặc lợi nhuận)
  };
  logs: InvoiceLogDTO[];
}

export function fetchTaxReport(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams();
  if (params?.from && params?.to) {
    qs.set("from", params.from);
    qs.set("to", params.to);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<TaxReportResponse>(`/api/tax/report${suffix}`);
}
