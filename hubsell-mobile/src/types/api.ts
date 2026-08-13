/**
 * DTO CHÉP TAY từ backend — backend là package Express/Prisma riêng nên không
 * import chéo được (đúng convention permission-registry giữa backend/frontend).
 *
 * ⚠️ GIỮ ĐỒNG BỘ với:
 *   - backend/prisma/schema.prisma        (enum + trường Order)
 *   - backend/src/routes/auth.ts          (LoginResponse, /me)
 *   - backend/src/routes/orders.ts        (GET /, /lookup, POST /:id/return)
 *   - backend/src/routes/warehouse.ts     (POST /returns/:id/receive)
 *   - backend/src/routes/finance.ts       (realized-pnl summary, cash-flow)
 *   - backend/src/routes/operations.ts    (conversations: inbox/messages/send)
 *
 * Lưu ý: Prisma Decimal (totalAmount, price) serialize thành CHUỖI qua JSON —
 * luôn bọc Number() khi tính toán (xem lib/format.ts num()).
 */

export type ChannelName = "SHOPEE" | "LAZADA" | "TIKTOK" | "OFFLINE";

export type ShippingStatus =
  | "PENDING"
  | "PROCESSED"
  | "SHIPPING"
  | "DELIVERED"
  | "CANCELLED";

export type ReturnStatus =
  | "NONE"
  | "AWAITING"
  | "RECEIVED"
  | "RECEIVED_INTACT"
  | "DAMAGED"
  | "CLAIM_SETTLED"
  | "WRITTEN_OFF";

export type Role = "ADMIN" | "SALES" | "WAREHOUSE";

export interface AuthUser {
  id: string;
  email: string | null;
  username: string | null;
  /** Nhân viên "chủ/nhânviên" — null với chủ shop. */
  staffUsername: string | null;
  fullName: string;
  role: Role;
  /** Khóa LÁ phân quyền (vd "warehouse.returns") — rỗng với ADMIN (toàn quyền). */
  permissions: string[];
  isPlatformAdmin?: boolean;
  platformWorkspace?: boolean;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
  hasChannels: boolean;
}

export interface OrderItemDto {
  id: string;
  productName: string;
  channelSku: string | null;
  quantity: number;
  price: string | number;
  product: { imageUrl: string | null } | null;
  /** Backend gắn phẳng: ảnh SP kho gốc → fallback ảnh ChannelProduct — ƯU TIÊN đọc trường này. */
  imageUrl?: string | null;
}

export interface OrderDto {
  id: string;
  orderCode: string;
  customerName: string;
  customerPhone?: string | null;
  totalAmount: string | number;
  carrier: string | null;
  trackingCode: string | null;
  returnTrackingCode: string | null;
  shippingStatus: ShippingStatus;
  returnStatus: ReturnStatus;
  returnNote?: string | null;
  itemCount: number;
  createdAt: string;
  channel: { channelName: ChannelName; shopName: string };
  items: OrderItemDto[];
}

export interface OrdersListResponse {
  items: OrderDto[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: Record<string, number>;
}

export interface LookupResponse {
  order: OrderDto;
}

/** Body lỗi 409 của GET /api/orders/lookup khi mã khớp nhiều đơn. */
export interface LookupAmbiguousBody {
  error: string;
  candidates: { orderCode: string; trackingCode: string | null }[];
}

export interface ReceiveReturnResponse {
  order: OrderDto;
  /** true = sàn CHƯA báo hoàn mà kho đã cầm kiện (hoàn "ngoài luồng"). */
  unannounced: boolean;
}

export interface PnlDailyPoint {
  date: string; // yyyy-mm-dd (ngày nghiệp vụ giờ VN)
  label: string; // dd/mm
  profit: number;
  returnLoss: number;
  orderCount: number;
  returnCount: number;
  returnRatePercent: number;
}

export interface PnlSummary {
  count: number;
  settledCount: number;
  /** Doanh thu thực nhận (đã trừ tiền hoàn khách). */
  totalNetRevenue: number;
  returnCount: number;
  totalRefunded: number;
  returnLoss: { total: number; feeLoss: number; shipLoss: number; costLoss: number };
  daily: PnlDailyPoint[];
  totalProfit: number;
  totalPlatformTax: number;
  additionalTax: number;
  /** Lợi nhuận ròng sau mọi loại thuế — con số cho thẻ "Lợi nhuận ròng". */
  totalProfitAfterTax: number;
  byPlatform: Record<
    string,
    { count: number; profit: number; returnCount: number; returnLoss: number }
  >;
}

export interface RealizedPnlResponse {
  summary: PnlSummary;
  total: number;
  page: number;
  pageCount: number;
}

/** Một gian hàng trong GET /api/finance/cash-flow (vị trí thực của dòng tiền). */
export interface CashFlowRow {
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  inTransit: number;
  pendingSettle: number;
  /** Tiền ĐANG NẰM TRONG VÍ SÀN (đã quyết toán, chưa rút). */
  settled: number;
  /** Tiền ĐÃ RÚT VỀ NGÂN HÀNG. */
  withdrawn: number;
  total: number;
}

export interface CashFlowResponse {
  rows: CashFlowRow[];
}

/** Một dòng bóc tách trong thác nước 4 cột của GET /api/finance/analytics. */
export interface BreakdownItem {
  key: string;
  label: string;
  hint: string;
  amount: number;
  percent: number;
  count?: number;
}

/**
 * GET /api/finance/analytics — chỉ chép phần app dùng (thác nước 4 cột).
 * Đẳng thức: Giá trị SP − Khấu trừ = Doanh thu; Doanh thu − Chi phí
 * + Thu khác − Thuế dự phòng = Lợi nhuận ròng.
 */
export interface AnalyticsResponse {
  breakdown: {
    gross: {
      total: number;
      orderCount: number;
      items: BreakdownItem[];
      totalDeduction: number;
    };
    revenue: { total: number; items: BreakdownItem[] };
    costs: { total: number; items: BreakdownItem[] };
    profit: { total: number; items: BreakdownItem[] };
  };
}

/** Đơn hoàn trong danh sách kho — kèm số ngày chờ backend đã tính sẵn. */
export interface ReturnOrderDto extends OrderDto {
  daysWaiting: number | null;
  agingLevel: "unknown" | "ok" | "warning" | "overdue";
}

/** GET /api/warehouse/returns — summary + danh sách phân trang. */
export interface ReturnsSummaryResponse {
  items: ReturnOrderDto[];
  total: number;
  page: number;
  pageCount: number;
  summary: {
    AWAITING: number;
    RECEIVED: number;
    RECEIVED_INTACT: number;
    DAMAGED: number;
    CLAIM_SETTLED: number;
    WRITTEN_OFF: number;
    /** Đơn AWAITING đã chờ 7–13 ngày. */
    warning: number;
    /** Đơn AWAITING đã chờ ≥14 ngày — cần đi đòi bưu cục. */
    overdue: number;
    unknown: number;
  };
  totalCompensated: number;
}

// ============================================================
// Tin nhắn CSKH — chép tay từ backend/src/routes/operations.ts
// ============================================================

/** Một hội thoại trong inbox hợp nhất — id là chuỗi ghép "channelId:idSàn". */
export interface OpsConversationDto {
  id: string;
  channelId: string;
  /** Backend hiện chỉ trả SHOPEE/LAZADA — TikTok chưa có API chat. */
  channelName: "SHOPEE" | "LAZADA";
  shopName: string;
  customer: string;
  lastMessage: string;
  unread: number;
  /** epoch MILI-giây; null nếu sàn không trả. */
  lastAt: number | null;
  /** Shopee: user_id người mua — BẮT BUỘC khi gửi tin. Lazada: null. */
  buyerId: string | null;
  externalId: string;
  /**
   * Tin CUỐI là của shop? — nguồn bộ lọc Đã/Chưa trả lời. Lazada không trả
   * người gửi trong session list → null (chỉ hiện ở tab "Tất cả").
   */
  lastFromShop: boolean | null;
}

export interface OpsMessageDto {
  id: string;
  fromShop: boolean;
  text: string;
  at: number | null;
  itemId: string | null;
  /** url ảnh nếu là tin kiểu image — render bong bóng ảnh thay text. */
  imageUrl: string | null;
}

/** Gian bị lỗi (hết hạn token, sàn chưa mở quyền chat) — UI ghi chú riêng. */
export interface OpsChannelErrorDto {
  channelId: string;
  shopName: string;
  message: string;
}

/** GET /api/operations/conversations */
export interface OpsConversationsResponse {
  conversations: OpsConversationDto[];
  errors: OpsChannelErrorDto[];
  channelStats: {
    channelId: string;
    shopName: string;
    channelName: string;
    count: number;
  }[];
  channelCount: number;
}

/** GET /api/operations/conversations/messages */
export interface OpsMessagesResponse {
  messages: OpsMessageDto[];
}

// ============================================================
// Thống kê SP/SKU + danh sách gian — chép tay từ backend
// (routes/orders.ts GET /stats, routes/channels.ts GET /)
// ============================================================

export interface OrderStatsRow {
  name: string;
  /** null với nhóm theo sản phẩm; mã SKU với nhóm theo SKU. */
  sku: string | null;
  qty: number;
  revenue: number;
  orders: number;
}

/** GET /api/orders/stats?days=30 (days=0 = toàn bộ) + nguyên bộ query lọc. */
export interface OrderStatsResponse {
  days: number;
  /** Dòng tổng cho kho: cần bốc tổng bao nhiêu món, thuộc mấy đơn. */
  totals: { qty: number; orders: number; revenue: number };
  byProduct: OrderStatsRow[];
  bySku: OrderStatsRow[];
}

/** GET /api/channels — chỉ lấy các trường màn lọc cần. */
export interface ChannelListItem {
  id: string;
  channelName: ChannelName;
  shopName: string;
  status: string;
}
