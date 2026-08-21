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
  /** Tên hãng NGUYÊN VĂN sàn trả — nguồn nhận diện đơn HỎA TỐC (lib/shipping). */
  shippingCarrierName?: string | null;
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
  /** Gian đã ngắt kết nối — hiển thị thêm 30 ngày rồi backend tự ẩn. */
  disconnected: boolean;
  /** Doanh thu đơn ĐÃ bàn giao vận chuyển, chưa quyết toán. */
  inTransit: number;
  /** Doanh thu đơn đã giao, sàn chưa quyết toán. */
  pendingSettle: number;
  /** Số dư Ví sàn THẬT từ API — null = sàn không có ví/chưa sync (hiện "—"). */
  walletBalance: number | null;
  /** Mốc đồng bộ số dư ví (ISO) — chỉ Shopee có. */
  walletSyncedAt: string | null;
  /** Tiền đã về ngân hàng 30 ngày gần nhất. */
  withdrawn30d: number;
  /** Tổng doanh thu DỰ KIẾN = đang giao + chờ đối soát + ví sàn. */
  totalExpected: number;
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
    /** Tổng nhóm "hàng đã về tay" — backend tính cùng định nghĩa với ?status=SCANNED. */
    SCANNED: number;
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
  /** SKU đại diện (nhóm sản phẩm) / mã SKU (nhóm SKU) — null nếu không có. */
  sku: string | null;
  qty: number;
  /** Số món thuộc đơn HỎA TỐC — kho nhặt TRƯỚC, hiện đỏ. */
  expressQty: number;
  revenue: number;
  orders: number;
  /** Ảnh ChannelProduct theo sku — cùng luật ưu tiên ảnh sàn. */
  imageUrl: string | null;
}

/**
 * GET /api/orders/stats — PHIẾU BỐC HÀNG. Backend CỐ ĐỊNH phạm vi trạng
 * thái = Chờ xử lý + Đã xử lý (đè mọi lựa chọn từ query); days=0 = toàn bộ.
 */
export interface OrderStatsResponse {
  days: number;
  /** Dòng tổng cho kho: cần bốc tổng bao nhiêu món, thuộc mấy đơn. */
  totals: { qty: number; expressQty: number; orders: number; revenue: number };
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

// ───────────────────────── Trợ lý Hubsell (hỏi số liệu vận hành) ─────────────────────────

export interface AssistantAnswerRow {
  label: string;
  value: string;
  /** pos = xanh (lãi), neg = đỏ (lỗ/cảnh báo). */
  tone?: "pos" | "neg";
}

/** POST /api/assistant/ask — tầng luật trả số thật, cùng shape với web. */
export interface AssistantReply {
  /** answered = có số; clarify = hỏi lại bằng chip; miss = chưa hiểu (đã ghi
   *  log để bồi luật); analysis = câu phân tích chờ tầng AI gói cao. */
  outcome: "answered" | "clarify" | "miss" | "analysis";
  text: string;
  rows?: AssistantAnswerRow[];
  /** Deep-link tới trang WEB quản trị — mobile chưa có màn tương ứng nên ẩn. */
  link?: { href: string; label: string };
  chips?: { intent: string; label: string }[];
  suggestions?: string[];
  /** Biểu đồ cột mini (báo cáo tuần/tháng) — doanh thu theo ngày. */
  chart?: { caption: string; points: { label: string; value: number }[] };
}
