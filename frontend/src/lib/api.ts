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
    // Chủ shop vừa RÚT QUYỀN giữa phiên làm việc của nhân viên → phát tín hiệu
    // cho AppShell refetch /me để sidebar cập nhật ngay (trang hiện tại tự lo
    // hiển thị AccessDenied qua nhánh 403 sẵn có của nó).
    if (
      res.status === 403 &&
      code === "PERMISSION_DENIED" &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new CustomEvent("hubsell:permission-denied"));
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
 * Vai trò tài khoản (mô hình 10/08).
 * - ADMIN     : chủ shop, toàn quyền
 * - SALES     : NHÂN VIÊN — vào được gì do CÂY PHÂN QUYỀN (permissions) quyết,
 *               phạm vi gian hàng do chủ shop phân công
 * - WAREHOUSE : vai trò cũ, đã migration hết về SALES — giữ trong type để đọc
 *               được dữ liệu cũ, KHÔNG cấp mới
 */
export type Role = "ADMIN" | "SALES" | "WAREHOUSE";

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
    label: "Nhân viên",
    description:
      "Vào được những chức năng được tick trong cây phân quyền, trên những gian hàng được phân công.",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  WAREHOUSE: {
    label: "Nhân viên kho",
    description: "Vai trò cũ — đã chuyển sang mô hình cây phân quyền.",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
};

export interface AuthUser {
  id: string;
  /** Null với tài khoản NHÂN VIÊN kiểu "chủ/nhânviên" (không cần email). */
  email: string | null;
  /** Tên đăng nhập (thay thế được email ở ô login). Null với user cũ chưa đặt. */
  username?: string | null;
  /** Tên đăng nhập NHÂN VIÊN (nửa phải của "chủ/nhânviên"). Null với chủ shop. */
  staffUsername?: string | null;
  fullName: string;
  /** Quốc gia ISO 3166-1 alpha-2, mặc định "VN". */
  country?: string;
  /** SĐT chuẩn E.164 (vd "+84912345678") — nền cho OTP SMS/WhatsApp sau này. */
  phone?: string | null;
  /** Ảnh đại diện data URL base64 (~256px). Null/vắng mặt = icon mặc định. */
  avatar?: string | null;
  role: Role;
  /**
   * Cây quyền của NHÂN VIÊN — mảng khóa lá của permission-registry. Chủ shop
   * không cần (toàn quyền). Chỉ là lớp ẩn/hiện menu; lớp chặn thật ở backend.
   */
  permissions?: string[];
  /**
   * Quản trị NỀN TẢNG Hubsell (khác ADMIN của shop) — mở mục "Hệ thống" trên
   * sidebar (/admin). Chỉ gán được bằng script phía server, FE chỉ đọc.
   */
  isPlatformAdmin?: boolean;
  /**
   * Thuộc KHÔNG GIAN ĐIỀU HÀNH HUBSELL: chủ nền tảng, hoặc nhân viên do chủ
   * nền tảng tạo (quyền toàn lá hq.*). Backend tính sẵn (login + /me) — FE dựa
   * vào đây để vẽ sidebar Điều hành thay sidebar shop và bỏ màn chặn
   * onboarding "kết nối gian hàng".
   */
  platformWorkspace?: boolean;
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
  | "RECEIVED"
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
  // Nguồn tiền áp dụng — để đối chiếu với bảng dòng tiền.
  // fundChannelId null + fundPlatform set = khoản CHUNG CẤP SÀN ("Lazada — Tất
  // cả shop"); cả hai null = khoản CHUNG TOÀN SHOP.
  fundChannelId: string | null;
  fundPlatform: ChannelName | null;
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
  | "cancelled"
  | "returning";

/** Hình thức hoàn tiền/trả hàng của một đơn (null = đơn bán bình thường). */
export type PnlReturnType =
  | "REFUND_ONLY" // hoàn tiền 100%, khách giữ hàng
  | "PARTIAL_REFUND" // hoàn tiền một phần, khách giữ hàng
  | "PARTIAL_RETURN" // trả một vài SKU trong đơn nhiều sản phẩm
  | "FULL_RETURN"; // hoàn trả toàn bộ đơn

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
  /** Doanh thu thực tế = Giá trị đơn hàng (revenueGross) − voucher/xu của Shop. */
  actualRevenue: number;
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
  /** Phí "dịch vụ PiShip" (bảo hiểm giao hàng Shopee VN) — cột riêng, khác Phí Dịch Vụ. */
  feeSellerProtection: number;
  feeAffiliate: number;
  /** Khấu trừ lúc giải ngân (đã phản ánh trong actualPayout) — chỉ hiển thị. */
  adWalletTopup: number;
  taxWithheld: number;
  // Hoàn tiền / trả hàng — 4 kịch bản
  returnType: PnlReturnType | null;
  /** Tiền trả khách: số thật từ sàn, hoặc tạm tính full khi đơn hoàn chưa chốt. */
  refundedAmount: number;
  /** true = refundedAmount đang là số TẠM TÍNH (sàn chưa chốt số hoàn thật). */
  refundEstimated: boolean;
  returnedQuantity: number;
  totalQuantity: number;
  /** Giá vốn (tại thời điểm bán) của RIÊNG phần hàng bị trả. */
  returnedCostAtSale: number;
  /** Giá vốn đã thu hồi nhờ hàng trả nhập lại kho nguyên vẹn. */
  recoveredCost: number;
  // Hiệu quả — costSnapshot là giá vốn THỰC TÍNH (đã trừ phần thu hồi)
  costSnapshot: number;
  netRevenue: number;
  actualPayout: number;
  /**
   * DOANH THU THỰC TẾ TRÊN SÀN — "Tổng tiền" sàn báo: đã đối soát =
   * actualPayout (đã cấn trừ hết phí/thuế/xu); chưa = số từ API đơn hàng
   * (tạm tính). Cột "Doanh thu trên sàn" + Lợi nhuận (= trường này − giá vốn).
   */
  platformRevenue: number;
  profit: number;
  /** Thuế sàn TMĐT: số THẬT sàn trích khi đã quyết toán / 0 khi chờ đối soát. */
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
  // Phí nền tảng — mỗi khoản một cột, khớp từng dòng sao kê Lazada VN
  feeFixed: number;
  feeOrderProcessing: number;
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
  // Voucher người bán & Thuế
  sellerVoucher: number;
  vatFee: number;
  incomeTaxFee: number;
  // Kết quả
  actualPayout: number;
}

/**
 * Bóc tách THẤT THU do đơn hoàn của kỳ (xem computeReturnLoss backend):
 * feeLoss = phí + thuế sàn không hoàn lại; shipLoss = ship hoàn 2 chiều shop
 * gánh; costLoss = giá vốn hàng mất/hỏng không thu hồi. total = tổng 3 khoản.
 */
export interface ReturnLossBreakdown {
  total: number;
  feeLoss: number;
  shipLoss: number;
  costLoss: number;
}

/** Một điểm ngày trên biểu đồ Lãi/Lỗ & Tỷ lệ hoàn (ngày trống = 0). */
export interface PnlDailyPoint {
  date: string; // YYYY-MM-DD (giờ VN)
  label: string; // dd/MM
  profit: number;
  returnLoss: number;
  orderCount: number;
  returnCount: number;
  returnRatePercent: number;
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
    /** Doanh thu thực nhận = Σ netRevenue — ĐÃ trừ tiền hoàn trả khách. */
    totalNetRevenue: number;
    /** Số đơn có hoàn tiền/trả hàng trong tập lọc. */
    returnCount: number;
    /** Tổng tiền hoàn trả khách (số thật + tạm tính) của tập lọc. */
    totalRefunded: number;
    /** Thất thu do đơn hoàn của kỳ — bóc 3 khoản cho dashboard Tổng quan. */
    returnLoss: ReturnLossBreakdown;
    /** Chuỗi ngày liền mạch cho biểu đồ Lãi/Lỗ & Tỷ lệ hoàn theo thời gian. */
    daily: PnlDailyPoint[];
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
    /** { SHOPEE: { count, profit, returnCount, returnLoss }, ... } trên toàn bộ đơn khớp lọc. */
    byPlatform: Record<
      string,
      { count: number; profit: number; returnCount: number; returnLoss: number }
    >;
  };
}

/** Kiểu phần summary của Lãi/Lỗ Thực Hiện — dashboard Tổng quan nhận nguyên khối. */
export type RealizedPnlSummary = RealizedPnlResponse["summary"];

export function fetchRealizedPnl(params: {
  range?: DateRange;
  channel?: ChannelFilterQuery;
  status?: ReconciliationStatus;
  /** Chỉ lấy đơn LỖ (lợi nhuận thực tế < 0). */
  lossOnly?: boolean;
  /** Tìm theo MÃ ĐƠN (contains, không phân biệt hoa thường). */
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams({
    ...rangeToQuery(params.range),
    ...channelFilterToQuery(params.channel),
    ...(params.status && params.status !== "all" ? { status: params.status } : {}),
    ...(params.lossOnly ? { lossOnly: "true" } : {}),
    ...(params.search ? { search: params.search } : {}),
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
  /**
   * TOÀN BỘ sàn khấu trừ trên đơn của kỳ (phí + thuế + voucher/xu + chênh
   * lệch VC − trợ giá) = Σ (Giá trị đơn − "Tổng tiền" sàn báo). Vắng với SALES.
   */
  totalPlatformFee: number;
  /** Riêng THUẾ SÀN (TNCN + VAT thu hộ) đã nằm trong totalPlatformFee. */
  totalPlatformTax: number;
  /**
   * Bóc tách totalPlatformFee theo ĐÚNG các dòng khấu trừ của Báo cáo dòng
   * tiền (thẻ Tổng giá trị SP). `other` = phần dư chưa rơi vào bucket nào
   * (lệch đối soát, đã cấn trợ giá sàn) — Σ tất cả = totalPlatformFee.
   */
  platformFeeBreakdown: {
    service: number; // phí cố định + thanh toán + dịch vụ + PiShip
    affiliate: number; // hoa hồng tiếp thị liên kết
    tax: number; // thuế sàn TMĐT (GTGT + TNCN thu hộ)
    voucher: number; // voucher/xu trợ giá do shop chịu
    shippingDiff: number; // chênh lệch phí vận chuyển
    adWallet: number; // sàn giữ tiền đơn nạp ví quảng cáo
    refund: number; // tiền hoàn trả khách (đơn hoàn còn tính doanh thu)
    other: number; // khấu trừ khác/lệch đối soát
  };
  grossProfit: number;
  totalOperatingExpense: number;
  /** Chi phí vận hành BIẾN ĐỔI ngoài quảng cáo (bao bì, phí hoàn…). */
  operatingVariableExpense: number;
  /** Chi phí vận hành CỐ ĐỊNH ngoài quảng cáo (thuê kho, lương, phần mềm…). */
  operatingFixedExpense: number;
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

/** Đăng nhập bằng TÊN ĐĂNG NHẬP hoặc EMAIL (backend tự phân biệt theo "@"). */
export function login(identifier: string, password: string) {
  return apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
}

export function register(data: {
  email: string;
  password: string;
  fullName: string;
  /** Bỏ trống → backend tự sinh từ email. */
  username?: string;
  /** ISO alpha-2, mặc định "VN". */
  country?: string;
  /** Số trong nước ("0912345678" hoặc "912345678") — backend chuẩn hoá E.164. */
  phoneNumber?: string;
  /** Mã giới thiệu Affiliate (?ref= trên link) — sai/thiếu không chặn đăng ký. */
  referralCode?: string;
}) {
  return apiFetch<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Gửi link đặt lại mật khẩu qua email. Response luôn generic (chống dò email). */
export function forgotPassword(email: string) {
  return apiFetch<{ message: string }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Đặt mật khẩu mới bằng token trong link email (hạn 30 phút, dùng 1 lần). */
export function resetPassword(token: string, newPassword: string) {
  return apiFetch<{ ok: boolean; message: string }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}

/** URL bắt đầu luồng đăng nhập Google (redirect cả trang sang backend). */
export function googleAuthUrl(): string {
  return `${API_URL}/api/auth/google`;
}

/** Người dùng TỰ đổi mật khẩu của chính mình (phải xác nhận mật khẩu hiện tại). */
export function changePassword(data: {
  currentPassword: string;
  newPassword: string;
}) {
  return apiFetch<{ ok: boolean }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Đặt/gỡ ảnh đại diện của CHÍNH người đang đăng nhập (nhân viên cũng dùng
 * được). `avatar` là data URL base64 đã thu nhỏ ~256px; null = gỡ ảnh.
 * Trả về user mới để cập nhật localStorage + state ngay, khỏi gọi lại /me.
 */
export function updateAvatar(avatar: string | null) {
  return apiFetch<{ user: AuthUser }>("/api/auth/me/avatar", {
    method: "PUT",
    body: JSON.stringify({ avatar }),
  });
}

/**
 * Tên đăng nhập chủ shop còn trống không? (endpoint công khai — form đăng ký
 * báo "đã có người sử dụng" ngay khi gõ, không đợi submit dính 409.)
 */
export function checkUsernameAvailable(username: string) {
  return apiFetch<{ available: boolean }>(
    `/api/auth/check-username?username=${encodeURIComponent(username)}`
  );
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
  /** Luôn null với nhân viên mô hình mới (kiểu cũ tạo bằng email đã xóa 10/08). */
  email: string | null;
  /** Tên đăng nhập nhân viên (nửa phải của "chủ/nhânviên"). */
  staffUsername: string | null;
  /** Chuỗi gõ vào ô đăng nhập: "chủ/nhânviên". */
  loginName: string | null;
  fullName: string;
  role: Role;
  /** Cây quyền — mảng khóa lá của permission-registry. */
  permissions: string[];
  createdAt: string;
  /**
   * PHẠM VI GIAN HÀNG — id các gian được phân công (StaffChannel). Rỗng = chưa
   * gán gian nào → nhân viên chưa thấy đơn/dữ liệu nào (default-deny).
   */
  allowedChannelIds: string[];
}

export function fetchStaff() {
  return apiFetch<{ ownerUsername: string | null; staff: StaffMember[] }>(
    "/api/staff"
  );
}

/** Tạo tài khoản nhân viên "chủ/nhânviên" — KHÔNG cần email. */
export function createStaff(data: {
  staffUsername: string;
  password: string;
  fullName: string;
  permissions: string[];
  channelIds: string[];
}) {
  return apiFetch<StaffMember>("/api/staff", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Cập nhật nhân viên: họ tên / cây quyền / phạm vi gian hàng — trường vắng mặt
 * giữ nguyên (mảng RỖNG = thu hồi hết).
 */
export function updateStaff(
  staffId: string,
  data: { fullName?: string; permissions?: string[]; channelIds?: string[] }
) {
  return apiFetch<StaffMember>(`/api/staff/${staffId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Chủ shop cấp lại mật khẩu cho nhân viên (nhân viên không có email để tự reset). */
export function resetStaffPassword(staffId: string, password: string) {
  return apiFetch<{ ok: boolean }>(`/api/staff/${staffId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
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

/**
 * CÔNG ĐOẠN 1 — quét nhận: ghi nhận kiện hàng hoàn ĐÃ VỀ TAY kho.
 * KHÔNG cộng tồn kho; việc nhập kho là bước riêng (processOrderReturn hoặc
 * bulkInboundReturns). `unannounced` = true khi sàn chưa kịp báo hoàn đơn này.
 */
export function receiveWarehouseReturn(orderId: string) {
  return apiFetch<{ order: Order; unannounced: boolean }>(
    `/api/warehouse/returns/${orderId}/receive`,
    { method: "POST" }
  );
}

/**
 * CÔNG ĐOẠN 2 — "NHẬP KHO TẤT CẢ ĐƠN ĐÃ NHẬN" một chạm: cộng ngược tồn kho
 * cho toàn bộ đơn đang ở trạng thái RECEIVED, không cần tích chọn từng đơn.
 */
export function bulkInboundReturns() {
  return apiFetch<{
    processed: number;
    restockedUnits: number;
    orders: {
      orderCode: string;
      restored: {
        productName: string;
        restoredQuantity: number;
        newQuantity: number;
      }[];
    }[];
    failed: { orderCode: string; error: string }[];
  }>("/api/orders/returns/bulk-inbound", { method: "POST" });
}

/**
 * CÔNG ĐOẠN 2 — xử lý lẻ kiện hàng đã nhận: INTACT thì nhập kho (cộng ngược
 * tồn kho), DAMAGED thì gắn cờ chờ khiếu nại.
 */
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
  fundPlatform?: ChannelName; // khoản chung CẤP SÀN: bỏ fundChannelId, gửi sàn ở đây
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
  /** Luôn false từ 30/07 — thu/chi vận hành đã lọc theo sàn/gian (fundChannel). */
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
      /** Lỗi riêng của gian này (nếu có) — các gian khác vẫn quét bình thường. */
      error?: string;
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
 * `reconnectChannelId` (luồng Kết nối lại): gian đích được ký vào state để
 * callback đối chiếu shop_id — đăng nhập sai tài khoản Shopee sẽ báo lỗi rõ.
 */
export function getShopeeAuthUrl(reconnectChannelId?: string) {
  const qs = reconnectChannelId
    ? `?channelId=${encodeURIComponent(reconnectChannelId)}`
    : "";
  return apiFetch<{ url: string }>(`/api/channels/shopee/auth-url${qs}`);
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
export function connectShopeeCode(
  code: string,
  shopId: string,
  reconnectChannelId?: string
) {
  return apiFetch<{ message: string; channel: ShopeeConnectedChannel }>(
    "/api/channels/shopee/connect",
    {
      method: "POST",
      body: JSON.stringify({ code, shopId, channelId: reconnectChannelId }),
    }
  );
}

/**
 * Lấy URL trang uỷ quyền Lazada. Callback đăng ký trên App Console là backend
 * RENDER (Lazada bắt https) nên khi chạy LOCAL, người dùng mở URL này ở tab
 * mới, uỷ quyền xong copy ?code=... từ URL callback rồi dán lại vào dialog.
 */
export function getLazadaAuthUrl(reconnectChannelId?: string) {
  const qs = reconnectChannelId
    ? `?channelId=${encodeURIComponent(reconnectChannelId)}`
    : "";
  return apiFetch<{ url: string }>(`/api/channels/lazada/auth-url${qs}`);
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
export function connectLazadaCode(code: string, reconnectChannelId?: string) {
  return apiFetch<{ message: string; channel: LazadaConnectedChannel }>(
    "/api/channels/lazada/connect",
    { method: "POST", body: JSON.stringify({ code, channelId: reconnectChannelId }) }
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
export function tiktokCallback(code: string, reconnectChannelId?: string) {
  return apiFetch<{ connected: number; channels: TiktokConnectedChannel[] }>(
    "/api/channels/tiktok/callback",
    { method: "POST", body: JSON.stringify({ code, channelId: reconnectChannelId }) }
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

/** Một cảnh báo THẬT từ bảng OpsAlert (detector backend quét dữ liệu thật). */
export interface OpsAlertDTO {
  id: string;
  /** Loại detector: stockout | channel-disconnected | loss-orders | shipping-fee-diff */
  type: string;
  tag: string;
  severity: string;
  title: string;
  summary: string;
  /** ActionParams cho nút xử lý (VD {kind:"navigate",href,label}) — có thể null. */
  payload: unknown;
  createdAt: string;
}

export interface OpsStateResponse {
  resolvedAlertIds: string[];
  chat: OpsChatDTO[];
  activities: OpsActivityDTO[];
  opsAlerts: OpsAlertDTO[];
  /** Mốc lần mở Trung tâm điều hành TRƯỚC — null nếu chưa từng mở. */
  lastSeenAt: string | null;
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

/** Tick "Đã xử lý" một cảnh báo THẬT (OpsAlert) — một chiều, ẩn tới khi tái phát. */
export function resolveCommandCenterOpsAlert(
  id: string,
  activity?: { tag: string; message: string }
) {
  return apiFetch<{ ok: boolean; activity: OpsActivityDTO | null }>(
    `/api/command-center/alerts/${id}/resolve`,
    { method: "POST", body: JSON.stringify({ activity }) }
  );
}

/** Ghi nhận "vừa xem Trung tâm điều hành" — dời mốc gắn nhãn "Mới". */
export function postCommandCenterSeen() {
  return apiFetch<{ ok: boolean; lastSeenAt: string }>(
    "/api/command-center/seen",
    { method: "POST", body: JSON.stringify({}) }
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
  // (1) Pháp nhân & Thuế — NĐ 123/2020: hóa đơn phải mang MST + tên + địa chỉ.
  taxCode: string; // MST: 10 số hoặc 10-3 số
  companyName: string;
  companyAddress: string;
  // (2) meInvoice API
  provider: string; // MISA | VIETTEL | BKAV | CUSTOM
  partnerCode: string;
  clientId: string;
  customApiUrl: string;
  invoicePattern: string; // Mẫu số hóa đơn (TT 78/2021)
  invoiceSeries: string; // Ký hiệu hóa đơn (VD "C26TAA")
  hasSecretKey: boolean;
  secretKeyMasked: string | null;
  // (3) Chữ ký số MISA eSign
  signMethod: string; // USB_TOKEN | ESIGN_CLOUD
  esignClientId: string;
  esignUsername: string;
  certSerial: string;
  hasEsignSecretKey: boolean;
  esignSecretKeyMasked: string | null;
  hasEsignPassword: boolean;
  esignPasswordMasked: string | null;
  // (4) Hóa đơn từ máy tính tiền (POS — HKD/bán lẻ, ký hiệu C26MXX)
  posProvider: string; // NCC luồng POS: MISA | VIETTEL | VNPT | BKAV
  posClientId: string;
  posCodePrefix: string; // dải mã CQT cấp sẵn
  posMachineId: string;
  posSeries: string; // ký tự thứ 4 bắt buộc là M
  hasPosSecretKey: boolean;
  posSecretKeyMasked: string | null;
  defaultInvoiceType: string; // STANDARD | POS
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

/** Lưu cấu hình cấp shop. Các secret để trống = giữ nguyên khóa cũ. */
export function saveInvoiceConfig(input: {
  taxCode?: string;
  companyName?: string;
  companyAddress?: string;
  provider: string;
  signMethod: string;
  partnerCode?: string;
  clientId?: string;
  secretKey?: string;
  customApiUrl?: string;
  invoicePattern?: string;
  invoiceSeries?: string;
  esignClientId?: string;
  esignSecretKey?: string;
  esignUsername?: string;
  esignPassword?: string;
  certSerial?: string;
  posProvider?: string;
  posClientId?: string;
  posSecretKey?: string;
  posCodePrefix?: string;
  posMachineId?: string;
  posSeries?: string;
  defaultInvoiceType?: string;
}) {
  return apiFetch<{ config: InvoiceConfigDTO }>("/api/invoice-config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Một máy tính tiền đã đăng ký — test-pos trả kèm (nếu MISA mở API danh mục)
 * để UI auto-fill Mã máy/Dải mã CQT. */
export interface PosMachineDTO {
  machineId: string | null;
  codePrefix: string | null;
  serial: string | null;
}

/** Kết quả các nút "Kiểm tra kết nối" (meInvoice / eSign / POS). */
export interface InvoiceConnectionTestResult {
  ok: boolean;
  /** Bộ khóa đã dùng: của shop hay env sandbox dùng chung. */
  source?: "shop-config" | "env-sandbox";
  message?: string;
  error?: string;
  /** Chỉ có ở test-pos, khi MISA trả được danh mục máy tính tiền. */
  machines?: PosMachineDTO[];
}

export function testMeinvoiceConnection() {
  return apiFetch<InvoiceConnectionTestResult>(
    "/api/invoice-config/test-meinvoice",
    { method: "POST" }
  );
}

export function testEsignConnection() {
  return apiFetch<InvoiceConnectionTestResult>(
    "/api/invoice-config/test-esign",
    { method: "POST" }
  );
}

export function testPosConnection() {
  return apiFetch<InvoiceConnectionTestResult>(
    "/api/invoice-config/test-pos",
    { method: "POST" }
  );
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

// ============================================================
// QUẢN TRỊ NỀN TẢNG (/api/admin) — chỉ tài khoản có isPlatformAdmin.
// Đây là góc nhìn CHỦ NỀN TẢNG trên toàn hệ thống, không bó theo shop.
// ============================================================

export interface PlatformStats {
  users: {
    totalOwners: number;
    totalStaff: number;
    newOwners7d: number;
    newOwners30d: number;
  };
  channelsByPlatform: { platform: ChannelName; count: number }[];
  orders: { total: number; last24h: number };
  webhooks: {
    shopee: { status: string; count: number }[];
    misa: { status: string; count: number }[];
  };
}

export function fetchPlatformStats() {
  return apiFetch<PlatformStats>("/api/admin/stats");
}

/** Dashboard điều hành (GĐ5) — biểu đồ đăng ký, phân bố chăm sóc, gia hạn. */
export interface PlatformOverviewResponse {
  totals: {
    owners: number;
    newOwners30d: number;
    /** Shop có đơn phát sinh trong 30 ngày. */
    active30d: number;
    activePct: number;
    churnRisk: number;
    churned: number;
    churnedPct: number;
  };
  signupsByWeek: { weekStart: string; label: string; count: number }[];
  careDistribution: { status: PlatformCareStatus; count: number }[];
  /** Gia hạn gói qua Ví Hubsell — khung demo chờ thương mại hóa. */
  renewals: {
    countTotal: number;
    amountTotal: number;
    count30d: number;
    amount30d: number;
  };
}

export function fetchPlatformOverview() {
  return apiFetch<PlatformOverviewResponse>("/api/admin/overview");
}

/** Trạng thái chăm sóc khách hàng (CRM nội bộ Hubsell — khớp enum backend). */
export type PlatformCareStatus =
  | "NEW"
  | "CONTACTED"
  | "ACTIVE"
  | "CHURN_RISK"
  | "CHURNED";

/** Hồ sơ chăm sóc — null khi chưa ai đụng tới khách này (ngầm định NEW). */
export interface PlatformCareInfo {
  status: PlatformCareStatus;
  note: string | null;
  updatedAt: string;
  assignee: { id: string; fullName: string } | null;
}

export interface PlatformUserRow {
  id: string;
  email: string;
  username: string | null;
  /** SĐT chuẩn E.164 (vd "+84912345678") — null với user cũ/đăng ký Google. */
  phone: string | null;
  fullName: string;
  country: string;
  createdAt: string;
  hasGoogle: boolean;
  staffCount: number;
  channelCount: number;
  productCount: number;
  orderCount: number;
  /** Đơn gần nhất trên mọi gian của shop — tín hiệu "còn hoạt động". */
  lastOrderAt: string | null;
  care: PlatformCareInfo | null;
}

export interface PlatformUsersResponse {
  total: number;
  page: number;
  pageSize: number;
  users: PlatformUserRow[];
}

export function fetchPlatformUsers(params?: {
  page?: number;
  pageSize?: number;
  careStatus?: PlatformCareStatus;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params?.careStatus) qs.set("careStatus", params.careStatus);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<PlatformUsersResponse>(`/api/admin/users${suffix}`);
}

/** Thành viên khu điều hành (chủ nền tảng + nhân viên) — cho ô "người phụ trách". */
export interface HqMember {
  id: string;
  fullName: string;
  staffUsername: string | null;
}

export function fetchHqStaff() {
  return apiFetch<{ members: HqMember[] }>("/api/admin/hq-staff");
}

/** Cập nhật hồ sơ chăm sóc — trường vắng mặt giữ nguyên; assigneeId null = bỏ phân công. */
export function updateCustomerCare(
  userId: string,
  data: { status?: PlatformCareStatus; assigneeId?: string | null; note?: string }
) {
  return apiFetch<{ care: PlatformCareInfo }>(
    `/api/admin/customers/${userId}/care`,
    { method: "PATCH", body: JSON.stringify(data) }
  );
}

// ---------- Kế toán nội bộ (hq.finance) ----------

export interface PlatformWithdrawalRow {
  id: string;
  amount: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  processedAt: string | null;
  createdAt: string;
  user: { id: string; email: string | null; fullName: string };
}

export interface PlatformFinanceResponse {
  wallet: {
    /** Tổng số dư mọi Ví Hubsell = khoản nền tảng đang NỢ người dùng. */
    totalBalance: number;
    totalCommission: number;
    commissionCount: number;
    totalPaidOut: number;
    paidOutCount: number;
    pendingAmount: number;
    pendingCount: number;
  };
  pendingWithdrawals: PlatformWithdrawalRow[];
  processedWithdrawals: PlatformWithdrawalRow[];
}

export function fetchPlatformFinance() {
  return apiFetch<PlatformFinanceResponse>("/api/admin/finance");
}

export function approveWithdrawal(id: string, reviewNote?: string) {
  return apiFetch<{ withdrawal: PlatformWithdrawalRow }>(
    `/api/admin/withdrawals/${id}/approve`,
    { method: "POST", body: JSON.stringify({ reviewNote }) }
  );
}

export function rejectWithdrawal(id: string, reviewNote: string) {
  return apiFetch<{ withdrawal: PlatformWithdrawalRow }>(
    `/api/admin/withdrawals/${id}/reject`,
    { method: "POST", body: JSON.stringify({ reviewNote }) }
  );
}

// ---------- Sổ quỹ nội bộ (GĐ5 — hq.finance) ----------

export type LedgerDirection = "IN" | "OUT";
export type LedgerSource = "SUBSCRIPTION" | "REFERRAL_PAYOUT" | "OTHER";
export type LedgerInvoiceStatus = "NONE" | "PENDING" | "ISSUED";

export interface PlatformLedgerEntry {
  id: string;
  direction: LedgerDirection;
  source: LedgerSource;
  /** Luôn DƯƠNG — chiều tiền do direction quyết định. */
  amount: number;
  note: string | null;
  invoiceStatus: LedgerInvoiceStatus;
  invoiceNo: string | null;
  occurredAt: string;
  createdByName: string;
  /** Khác null = bút toán TỰ SINH từ duyệt lệnh rút (không sửa tiền/xoá được). */
  withdrawalRequestId: string | null;
  customer: { id: string; email: string | null; fullName: string } | null;
}

export interface PlatformLedgerResponse {
  month: string;
  totals: { in: number; out: number; net: number; pendingInvoices: number };
  entries: PlatformLedgerEntry[];
}

export function fetchPlatformLedger(month?: string) {
  const suffix = month ? `?month=${month}` : "";
  return apiFetch<PlatformLedgerResponse>(`/api/admin/finance/ledger${suffix}`);
}

export function createLedgerEntry(data: {
  direction: LedgerDirection;
  source: Exclude<LedgerSource, "REFERRAL_PAYOUT">;
  amount: number;
  note?: string;
  customerEmail?: string;
  occurredAt?: string;
  invoiceStatus?: LedgerInvoiceStatus;
  invoiceNo?: string;
}) {
  return apiFetch<{ entry: PlatformLedgerEntry }>("/api/admin/finance/ledger", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateLedgerEntry(
  id: string,
  data: {
    note?: string | null;
    invoiceStatus?: LedgerInvoiceStatus;
    invoiceNo?: string;
    occurredAt?: string;
    amount?: number;
  }
) {
  return apiFetch<{ entry: PlatformLedgerEntry }>(
    `/api/admin/finance/ledger/${id}`,
    { method: "PATCH", body: JSON.stringify(data) }
  );
}

export function deleteLedgerEntry(id: string) {
  return apiFetch<{ ok: true }>(`/api/admin/finance/ledger/${id}`, {
    method: "DELETE",
  });
}

// ---------- Marketing & Giới thiệu (hq.marketing) ----------

export interface PlatformMarketingResponse {
  totalReferred: number;
  referred30d: number;
  activeReferrers: number;
  topReferrers: {
    userId: string;
    fullName: string;
    email: string | null;
    referralCode: string | null;
    referredCount: number;
    totalCommission: number;
  }[];
}

export function fetchPlatformMarketing() {
  return apiFetch<PlatformMarketingResponse>("/api/admin/marketing");
}

// ---------- Nhật ký thao tác (chỉ chủ nền tảng) ----------

export interface PlatformAuditLogRow {
  id: string;
  actorName: string;
  action: string;
  targetLabel: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlatformAuditLogsResponse {
  total: number;
  page: number;
  pageSize: number;
  logs: PlatformAuditLogRow[];
}

export function fetchPlatformAuditLogs(params?: { page?: number; pageSize?: number }) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<PlatformAuditLogsResponse>(`/api/admin/audit-logs${suffix}`);
}

export type PlatformWebhookSource = "shopee" | "misa";

/** Một dòng nhật ký webhook toàn hệ thống — trường khác nhau theo nguồn. */
export interface PlatformWebhookLogRow {
  id: string;
  status: "PENDING" | "PROCESSING" | "VERIFYING" | "SUCCESS" | "FAILED";
  attempts: number;
  lastError: string | null;
  processedAt: string | null;
  createdAt: string;
  // Shopee
  eventCode?: number;
  shopId?: string;
  orderSn?: string | null;
  // MISA
  eventType?: string;
  invoiceNo?: string | null;
  orderCode?: string | null;
}

export interface PlatformWebhookLogsResponse {
  source: PlatformWebhookSource;
  total: number;
  page: number;
  pageSize: number;
  logs: PlatformWebhookLogRow[];
}

export function fetchPlatformWebhookLogs(params?: {
  source?: PlatformWebhookSource;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.source) qs.set("source", params.source);
  if (params?.status) qs.set("status", params.status);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<PlatformWebhookLogsResponse>(`/api/admin/webhook-logs${suffix}`);
}

// ============================================================
// TRỢ LÝ VẬN HÀNH (CSKH đa kênh) — /api/operations/*
// Shape do backend chuẩn hoá từ Shopee sellerchat/get_comment và Lazada IM/
// review; xem backend/src/routes/operations.ts. Gian nào lỗi (token hết hạn,
// chưa được cấp quyền module chat) nằm trong errors[] — UI ghi chú riêng.
// ============================================================

export type OpsChannelName = "SHOPEE" | "LAZADA";

export interface OpsChannelError {
  channelId: string;
  shopName: string;
  message: string;
}

export interface OpsConversationDTO {
  id: string;
  channelId: string;
  channelName: OpsChannelName;
  shopName: string;
  customer: string;
  lastMessage: string;
  unread: number;
  lastAt: number | null;
  /** Shopee: to_id người mua — bắt buộc kèm khi gửi tin. */
  buyerId: string | null;
  externalId: string;
}

export interface OpsMessageDTO {
  id: string;
  fromShop: boolean;
  text: string;
  at: number | null;
  itemId: string | null;
}

export interface OpsReviewDTO {
  id: string;
  channelId: string;
  channelName: OpsChannelName;
  shopName: string;
  customer: string;
  rating: number;
  content: string;
  reply: string | null;
  productName: string;
  orderCode: string | null;
  createdAt: number | null;
  externalId: string;
}

export interface OpsProductContextDTO {
  sku: string;
  name: string;
  imageUrl: string | null;
  material: string | null;
  care: string | null;
  /** Mô tả sản phẩm TỪ SÀN (Shopee get_item_base_info) — ngữ cảnh cho AI. */
  channelDescription: string | null;
  /** Thuộc tính seller khai TRÊN SÀN (Xuất xứ, kiểu dáng…) — đã tách Chất liệu. */
  channelAttributes: { name: string; value: string }[] | null;
  sizeChart:
    | { size: string; heightCm: [number, number]; weightKg: [number, number] }[]
    | null;
  physicalStock: number | null;
  channelStock: number | null;
  /** Tồn live TỪNG phân loại (model Shopee) — vẽ ma trận màu/size thật. */
  channelVariants: { name: string; stock: number | null }[] | null;
  channelName: ChannelName | null;
  variantName: string | null;
  linked: boolean;
  /** Link xem/đặt hàng trên sàn — nguồn cho nút "Gửi thẻ sản phẩm". */
  productUrl: string | null;
  /** Giá niêm yết (VND) — ưu tiên giá trên sàn, null khi chưa sync giá. */
  price: number | null;
  /** item_id phía sàn — nguồn gửi thẻ SP chuẩn Shopee (message_type item). */
  itemId: string | null;
}

/** Trạng thái từng gian sau một lượt quét inbox — kể cả gian thành công 0 hội thoại. */
export interface OpsChannelStat {
  channelId: string;
  shopName: string;
  channelName: string;
  count: number;
}

export function fetchOpsConversations() {
  return apiFetch<{
    conversations: OpsConversationDTO[];
    errors: OpsChannelError[];
    channelStats?: OpsChannelStat[];
    channelCount: number;
  }>("/api/operations/conversations");
}

export function fetchOpsMessages(params: {
  channelId: string;
  conversationId: string;
  buyerId?: string | null;
}) {
  const q = new URLSearchParams({
    channelId: params.channelId,
    conversationId: params.conversationId,
    ...(params.buyerId ? { buyerId: params.buyerId } : {}),
  });
  return apiFetch<{ messages: OpsMessageDTO[] }>(
    `/api/operations/conversations/messages?${q}`
  );
}

export function sendOpsMessage(body: {
  channelId: string;
  conversationId: string;
  buyerId?: string | null;
  text: string;
}) {
  return apiFetch<{ ok: boolean }>("/api/operations/conversations/send", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Gửi THẺ SẢN PHẨM chuẩn sàn (Shopee message_type "item"). */
export function sendOpsItemMessage(body: {
  channelId: string;
  buyerId?: string | null;
  itemId: string;
}) {
  return apiFetch<{ ok: boolean }>("/api/operations/conversations/send-item", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchOpsReviews() {
  return apiFetch<{
    reviews: OpsReviewDTO[];
    errors: OpsChannelError[];
    channelCount: number;
  }>("/api/operations/reviews");
}

export function replyOpsReview(body: {
  channelId: string;
  reviewId: string;
  content: string;
}) {
  return apiFetch<{ ok: boolean }>("/api/operations/reviews/reply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Gợi ý AI Copilot THẬT (Claude API) — cùng hợp đồng với engine luật. */
export interface CopilotSuggestionDTO {
  text: string;
  intent: "SIZE_ADVICE" | "STOCK_CHECK" | "GENERAL";
}

/**
 * Sinh gợi ý trả lời khách bằng Claude API. Backend chưa cấu hình
 * ANTHROPIC_API_KEY sẽ trả 503 code NO_AI_KEY — caller bắt ApiError.status
 * === 503 để rơi về engine luật và ngưng gọi lại.
 */
export function fetchCopilotSuggestion(body: {
  context: string | null;
  customerMessage: string;
  channelLabel: string | null;
}) {
  return apiFetch<CopilotSuggestionDTO>("/api/operations/copilot-suggest", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchOpsProductContext(params: {
  query?: string;
  channelId?: string;
  itemId?: string;
}) {
  const q = new URLSearchParams();
  if (params.query) q.set("query", params.query);
  if (params.channelId) q.set("channelId", params.channelId);
  if (params.itemId) q.set("itemId", params.itemId);
  return apiFetch<{ found: boolean; product?: OpsProductContextDTO }>(
    `/api/operations/product-context?${q}`
  );
}

// ============================================================
// MẠNG LƯỚI KOC & AFFILIATE — dữ liệu affiliate THẬT từ đối soát sàn
// (Order.affiliateFee: Shopee AMS escrow / Lazada Finance API). Chi tiết
// nguồn số xem backend/src/routes/koc.ts.
// ============================================================

/** Số liệu affiliate gộp của một phạm vi (gian hàng hoặc sàn). */
export interface KocAffiliateStats {
  orders: number;
  gmv: number;
  commission: number;
  refundedAmount: number;
  refundedOrders: number;
  netRevenue: number;
}

/** Một gian hàng trong /api/koc/summary — kèm trạng thái quyền access. */
export interface KocShopDTO {
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  externalShopId: string | null;
  /** Liên kết còn hiệu lực (ACTIVE + có access token) — cờ, không lộ token. */
  connected: boolean;
  accessTokenExpireAt: string | null;
  lastSyncAt: string | null;
  affiliate: KocAffiliateStats & { actualPayout: number };
}

export interface KocPlatformDTO {
  channelName: ChannelName;
  shopCount: number;
  connectedCount: number;
  affiliate: KocAffiliateStats;
}

export interface KocSummaryDTO {
  days: number;
  since: string;
  platforms: KocPlatformDTO[];
  shops: KocShopDTO[];
  total: {
    orders: number;
    gmv: number;
    commission: number;
    refundedAmount: number;
    netRevenue: number;
  };
}

/** Tổng hợp affiliate thật theo sàn/gian trong `days` ngày gần nhất. */
export function fetchKocSummary(days = 30) {
  return apiFetch<KocSummaryDTO>(`/api/koc/summary?days=${days}`);
}

/** Một đơn affiliate thật (sàn đã trừ hoa hồng) trong /api/koc/orders. */
export interface KocAffiliateOrderDTO {
  id: string;
  orderCode: string;
  createdAt: string;
  channelName: ChannelName;
  shopName: string;
  gmv: number;
  commission: number;
  returnStatus: string;
  refundedAmount: number;
  isSettled: boolean;
  actualPayout: number;
}

export interface KocOrdersDTO {
  days: number;
  page: number;
  pageSize: number;
  total: number;
  orders: KocAffiliateOrderDTO[];
}

/** Danh sách đơn affiliate thật, phân trang. */
export function fetchKocAffiliateOrders(params: {
  days?: number;
  page?: number;
  pageSize?: number;
  channel?: ChannelFilterQuery;
}) {
  const q = new URLSearchParams({
    days: String(params.days ?? 30),
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
    ...channelFilterToQuery(params.channel),
  });
  return apiFetch<KocOrdersDTO>(`/api/koc/orders?${q}`);
}

/** Một gian hàng trong channel-detail — kèm cờ đã uỷ quyền OAuth thật. */
export interface KocChannelShopDTO {
  channelId: string;
  shopName: string;
  externalShopId: string | null;
  connected: boolean;
  /** false = gian giả lập/chưa OAuth thật (TikTok đang chờ sandbox). */
  authorizedReal: boolean;
  accessTokenExpireAt: string | null;
  lastSyncAt: string | null;
  affiliate: {
    orders: number;
    gmv: number;
    commission: number;
    refundedAmount: number;
  };
}

/** Bức tranh affiliate thật của MỘT sàn — nguồn số cho 3 trang kênh KOC. */
export interface KocChannelDetailDTO {
  days: number;
  channelName: ChannelName;
  shops: KocChannelShopDTO[];
  totals: {
    orders: number;
    gmv: number;
    commission: number;
    refundedAmount: number;
    refundedOrders: number;
    netRevenue: number;
    /** Tổng GMV toàn sàn cùng kỳ (mọi đơn, không chỉ affiliate). */
    shopGmv: number;
    shopOrders: number;
    /** % GMV toàn sàn đến từ affiliate. */
    sharePct: number;
  };
  series: { date: string; gmv: number; commission: number; orders: number }[];
  topSkus: {
    channelSku: string;
    productName: string;
    quantity: number;
    gmv: number;
    /** Hoa hồng PHÂN BỔ theo tỷ trọng dòng — ước lượng, sàn chỉ trả cấp đơn. */
    commission: number;
  }[];
}

/** Chi tiết affiliate thật của một sàn trong `days` ngày gần nhất. */
export function fetchKocChannelDetail(
  channelName: "SHOPEE" | "LAZADA" | "TIKTOK",
  days = 30
) {
  return apiFetch<KocChannelDetailDTO>(
    `/api/koc/channel-detail?channelName=${channelName}&days=${days}`
  );
}

// ----- Affiliate Tiếp Thị & Ví Hubsell (referral của CHÍNH Hubsell) -----
//
// KHÁC hoàn toàn module KOC & Marketing phía trên (đo Net-ROI creator cho chủ
// shop): đây là chương trình Seller giới thiệu bạn bè dùng Hubsell, nhận 10%
// hoa hồng vĩnh viễn trên mọi lượt thanh toán vào Ví Hubsell.

export type WalletTxnType =
  | "COMMISSION"
  | "PACKAGE_RENEWAL"
  | "WITHDRAWAL"
  | "ADJUSTMENT";
export type WalletTxnStatus = "PENDING" | "COMPLETED" | "REJECTED";
export type WithdrawalRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface RenewalPackage {
  id: string;
  name: string;
  price: number;
}

export interface ReferralSummary {
  referralCode: string;
  referralLink: string;
  stats: {
    referredCount: number;
    paidCount: number;
    totalCommission: number;
    balance: number;
  };
  packages: RenewalPackage[];
  minWithdrawal: number;
}

export interface ReferralFriend {
  id: string;
  fullName: string;
  email: string;
  registeredAt: string;
  paidCount: number;
  totalCommission: number;
}

export interface WalletTxn {
  id: string;
  type: WalletTxnType;
  /** CÓ DẤU: dương = cộng vào ví, âm = trừ khỏi ví. */
  amount: number;
  status: WalletTxnStatus;
  note: string | null;
  createdAt: string;
}

export interface WithdrawalRequestRow {
  id: string;
  amount: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  status: WithdrawalRequestStatus;
  reviewNote: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface ReferralHistory {
  referrals: ReferralFriend[];
  transactions: WalletTxn[];
  withdrawals: WithdrawalRequestRow[];
}

export function fetchReferralSummary() {
  return apiFetch<ReferralSummary>("/api/referral/summary");
}

export function fetchReferralHistory() {
  return apiFetch<ReferralHistory>("/api/referral/history");
}

/** Đặt lệnh rút ví về ngân hàng — tiền bị giữ ngay, chờ Hubsell duyệt tay. */
export function createWalletWithdrawalRequest(data: {
  amount: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
}) {
  return apiFetch<{ id: string; amount: number; status: string; message: string }>(
    "/api/referral/withdraw",
    { method: "POST", body: JSON.stringify(data) }
  );
}

/** Dùng số dư ví gia hạn gói (khung demo — chưa thương mại hóa). */
export function renewPackageWithWallet(packageId: string) {
  return apiFetch<{ ok: boolean; package: RenewalPackage; message: string }>(
    "/api/referral/renew",
    { method: "POST", body: JSON.stringify({ packageId }) }
  );
}

/** DEV ONLY — mô phỏng một người được giới thiệu thanh toán thành công. */
export function mockReferralPayment(payerEmail: string, amount: number) {
  return apiFetch<{ ok: boolean; commission: number }>(
    "/api/referral/mock/payment",
    { method: "POST", body: JSON.stringify({ payerEmail, amount }) }
  );
}

// ----- Trợ lý quảng cáo Shopee (GĐ1 dashboard + GĐ2 rule engine khuyến nghị) -----

/** Verdict của rule engine (null = campaign không chạy / Trợ lý tắt). */
export type ShopeeAssistantVerdict =
  | "spike"
  | "pause_now"
  | "grace"
  | "review"
  | "healthy"
  | "insufficient_data"
  | null;

/** Quyết định của chủ shop với một cảnh báo. */
export type ShopeeAssistantDecision = "" | "HANDLED" | "WATCHING" | "IGNORED";

export interface ShopeeAssistantInfo {
  verdict: ShopeeAssistantVerdict;
  reasons: string[];
  window: string | null;
  decision: ShopeeAssistantDecision;
  /** true = quyết định còn hiệu lực (verdict chưa đổi loại) → ẩn cảnh báo. */
  decisionActive: boolean;
}

export interface ShopeeAssistantConfig {
  enabled: boolean;
  floor: { minSpend7d: number; minClicks7d: number };
  hard: { enabled: boolean; zeroOrderSpend7d: number; breakevenFactor: number };
  review: { enabled: boolean; dangerFactor: number };
  spike: { enabled: boolean; dayMultiple: number; minTodaySpend: number };
  grace: { enabled: boolean; minOrders7d: number };
  /** GĐ3 — tự thực thi: off | dry_run (diễn tập ghi sổ) | live (gọi sàn thật). */
  autoExecute: { mode: "off" | "dry_run" | "live"; maxActionsPerDay: number };
}

/** Một dòng SỔ HÀNH ĐỘNG của Trợ lý (GĐ3). */
export interface ShopeeAdsActionLogRow {
  id: string;
  campaignName: string;
  action: string; // "pause"
  mode: "dry_run" | "live";
  verdict: string;
  reasons: string[];
  status: "PLANNED" | "PENDING" | "SUCCESS" | "FAILED";
  error: string | null;
  createdAt: string;
}

export function fetchShopeeAdsActionLog(
  channelId: string,
  limit = 50,
  platform: "shopee" | "lazada" = "shopee"
) {
  return apiFetch<{ logs: ShopeeAdsActionLogRow[] }>(
    `/api/ads/${platform}/action-log?channelId=${encodeURIComponent(channelId)}&limit=${limit}`
  );
}

// ----- Soi sống chiến dịch Lazada: từng SP (adgroup) + từng từ khóa -----
// Đặc sản Lazada — Shopee không có API hiệu suất keyword. Lấy thẳng từ sàn lúc
// mở modal, kèm ROAS hòa vốn của chính SP để chỉ mặt chỗ đốt tiền.

export interface LazadaAdgroupLiveRow {
  adgroupId: string;
  name: string;
  itemId: string;
  bidPrice: number;
  adSwitchOn: boolean;
  spend: number;
  clicks: number;
  impressions: number;
  storeOrders: number;
  storeRevenue: number;
  roas: number | null;
  breakevenRoas: number | null;
  lossBeforeAds: boolean;
}

export interface LazadaKeywordLiveRow {
  keyword: string;
  adgroupName: string;
  maxBid: number;
  cpc: number;
  spend: number;
  clicks: number;
  impressions: number;
  storeOrders: number;
  storeRevenue: number;
  roas: number | null;
  breakevenRoas: number | null;
}

export interface LazadaCampaignLiveDetail {
  days: number;
  adgroups: LazadaAdgroupLiveRow[];
  keywords: LazadaKeywordLiveRow[];
}

export function fetchLazadaCampaignLiveDetail(
  campaignRowId: string,
  days: number
) {
  return apiFetch<LazadaCampaignLiveDetail>(
    `/api/ads/lazada/campaigns/${campaignRowId}/live-detail?days=${days}`
  );
}

/** Một sản phẩm trong bảng ROAS hòa vốn — tra cứu trước khi tạo campaign. */
export interface ShopeeProductBreakevenRow {
  itemId: string;
  productName: string;
  skuCount: number;
  /** SKU TỔNG cấp sản phẩm (item_sku Shopee) — null nếu người bán không đặt. */
  itemSku: string | null;
  /** SKU phân loại người bán tự đặt (đã lọc khóa tổng hợp SPE-…) — tìm kiếm/tooltip. */
  sellerSkus: string[];
  /** Số đơn P&L 30 ngày khớp SKU của sản phẩm (cỡ mẫu của biên lãi). */
  orders: number;
  revenue: number;
  margin: number | null;
  breakevenRoas: number | null;
  lossBeforeAds: boolean;
  runningAds: boolean;
}

export interface ShopeeProductBreakevenResponse {
  rows: ShopeeProductBreakevenRow[];
  shop: {
    margin: number | null;
    breakevenRoas: number | null;
    pnlOrders: number;
    missingCostOrders: number;
  };
  /** Hệ số vùng an toàn (Q2 dangerFactor) — gợi ý ROAS mục tiêu = hòa vốn × hệ số. */
  safeRoasFactor: number;
  marginWindowDays: number;
}

export function fetchShopeeProductBreakeven(
  channelId: string,
  platform: "shopee" | "lazada" = "shopee"
) {
  return apiFetch<ShopeeProductBreakevenResponse>(
    `/api/ads/${platform}/product-breakeven?channelId=${encodeURIComponent(channelId)}`
  );
}

export interface ShopeeAssistantSummary {
  config: ShopeeAssistantConfig;
  counts: { spike: number; pauseNow: number; grace: number; review: number };
  /** spike + pauseNow + review chưa được quyết — số trên banner. */
  needsAction: number;
}

export interface ShopeeAdsCampaignRow {
  assistant: ShopeeAssistantInfo;
  id: string;
  campaignId: string;
  name: string;
  adType: string; // auto | manual
  status: string; // ongoing | scheduled | ended | paused | deleted | closed
  placement: string; // search | discovery | all
  biddingMethod: string;
  budget: number; // 0 = không giới hạn
  roasTarget: number | null;
  startTime: string | null;
  endTime: string | null;
  itemCount: number;
  spend: number;
  impression: number;
  clicks: number;
  broadOrder: number;
  broadGmv: number;
  directOrder: number;
  directGmv: number;
  roasBroad: number | null;
  roasDirect: number | null;
  /** Biên lãi ròng (chưa trừ ads) của SKU trong campaign — nền của ROAS hòa vốn. */
  margin: number | null;
  /** Nguồn biên lãi: "campaign" = đủ đơn của chính SKU; "shop" = rơi về toàn shop. */
  marginSource: "campaign" | "shop" | null;
  marginOrders: number;
  breakevenRoas: number | null;
  /** Lãi/lỗ ước tính trong kỳ = GMV broad × biên lãi − chi phí ads (cùng rổ đơn với ROAS). */
  estProfit: number | null;
  lossBeforeAds: boolean;
}

export interface ShopeeAdsSummary {
  spend: number;
  broadOrder: number;
  broadGmv: number;
  directOrder: number;
  directGmv: number;
  estProfit: number;
  roasBroad: number | null;
  roasDirect: number | null;
  /** Tổng chi ads toàn shop từ bảng AdSpend (đối chiếu — gồm cả ads ngoài campaign SP). */
  adSpendTotal: number;
  shopMargin: number | null;
  shopBreakevenRoas: number | null;
  marginWindowDays: number;
  pnlOrders: number;
  missingCostOrders: number;
}

export interface ShopeeAdsDashboard {
  channels: { id: string; shopName: string; externalShopId: string | null }[];
  selectedChannelId: string | null;
  days: number;
  wallet: { balance: number } | null;
  assistant: ShopeeAssistantSummary | null;
  summary: ShopeeAdsSummary | null;
  campaigns: ShopeeAdsCampaignRow[];
  series: { date: string; spend: number; broadGmv: number; directGmv: number }[];
}

/** Sàn của Trợ lý quảng cáo dữ liệu thật — backend đăng ký cùng bộ route cho cả hai. */
export type AdsPlatform = "shopee" | "lazada";

export function fetchShopeeAdsDashboard(params: {
  channelId?: string;
  /** Cửa sổ hiển thị 1–30 ngày (dữ liệu sync tối đa 30 ngày về trước). */
  days?: number;
  /** Mặc định "shopee" — trang Lazada truyền "lazada" (payload y hệt). */
  platform?: AdsPlatform;
}) {
  const q = new URLSearchParams();
  if (params.channelId) q.set("channelId", params.channelId);
  if (params.days) q.set("days", String(params.days));
  const qs = q.toString();
  return apiFetch<ShopeeAdsDashboard>(
    `/api/ads/${params.platform ?? "shopee"}${qs ? `?${qs}` : ""}`
  );
}

export interface SyncAdsCampaignsResult {
  message: string;
  campaignsFound: number;
  campaignsUpserted: number;
  perfDaysUpserted: number;
}

/** Kéo chiến dịch quảng cáo + hiệu suất 30 ngày từ Shopee (read-only). */
export function syncShopeeAdsCampaigns(channelId: string) {
  return apiFetch<SyncAdsCampaignsResult>(
    `/api/channels/${channelId}/sync-ads-campaigns`,
    { method: "POST" }
  );
}

/** Lưu luật Trợ lý riêng của một gian (backend normalize trước khi lưu). */
export function saveShopeeAssistantConfig(
  channelId: string,
  config: ShopeeAssistantConfig,
  platform: AdsPlatform = "shopee"
) {
  return apiFetch<{ message: string; config: ShopeeAssistantConfig }>(
    `/api/ads/${platform}/assistant-config`,
    { method: "PUT", body: JSON.stringify({ channelId, config }) }
  );
}

/** Chủ shop quyết một cảnh báo ("" = gỡ quyết định, cảnh báo hiện lại). */
export function decideShopeeAdsCampaign(
  campaignRowId: string,
  decision: ShopeeAssistantDecision,
  verdict: string,
  platform: AdsPlatform = "shopee"
) {
  return apiFetch<{ message: string }>(
    `/api/ads/${platform}/campaigns/${campaignRowId}/decision`,
    { method: "POST", body: JSON.stringify({ decision, verdict }) }
  );
}
