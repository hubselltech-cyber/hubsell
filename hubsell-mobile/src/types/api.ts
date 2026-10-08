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
  /** Dạng quốc tế ("+84912345678") — phiên cache cũ có thể chưa có trường này. */
  phone?: string | null;
  /** Ảnh đại diện đặt trên web — data URL base64; chỉ có sau khi gọi /me. */
  avatar?: string | null;
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

/**
 * GET /api/subscription/me — chép phần app dùng: dòng gói ở Tài khoản + dải
 * nhắc gia hạn / thẻ khóa (cùng nguồn với PlanQuotaBanner web). Backend là hàng
 * rào thật (requirePlanUnlocked → 403 PLAN_LOCKED); app chỉ trình bày.
 */
export interface MyPlanResponse {
  /** Tài khoản điều hành nền tảng — không thuộc gói nào, ẩn mọi dải nhắc. */
  exempt: boolean;
  /** false = khách cũ chưa gán thuê bao → không giới hạn gì. */
  hasSubscription: boolean;
  plan: { id: string; code: string; name: string } | null;
  subscription: {
    status: "ACTIVE" | "EXPIRED" | "CANCELLED";
    isTrial: boolean;
    /** ISO — null = vô thời hạn. */
    currentPeriodEnd: string | null;
    daysLeft: number | null;
  } | null;
  orders: {
    limit: number | null;
    used: number;
    ratio: number | null;
    state: "ok" | "warn" | "over" | "locked";
    /** Hết ân hạn trần đơn sau mốc này — null khi chưa chạm 100%. */
    graceDeadline: string | null;
  };
  /** Gói hết hạn: ân hạn 7 ngày (lockDeadline) rồi khóa tầng nâng cao. */
  expiry: { expired: boolean; lockDeadline: string | null; locked: boolean };
  locked: boolean;
  lockedReason: "ORDERS" | "EXPIRED" | null;
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

/**
 * THÔNG TIN THANH TOÁN của một đơn theo số của sàn (backend
 * lib/order-payment-detail.ts) — không có giá vốn / lợi nhuận. Chỉ có khi gọi
 * lookup kèm detail=1.
 */
export interface OrderPaymentGroup {
  label: string;
  /** null = nhóm chỉ để tham chiếu, không cộng tổng. */
  total: number | null;
  /** Số CÓ DẤU: âm = sàn trừ, dương = shop được cộng. */
  lines: { label: string; amount: number }[];
}

export interface OrderPaymentDto {
  /** settled = đã quyết toán; estimated = sàn ước tính; none = sàn chưa báo phí. */
  status: "settled" | "estimated" | "none";
  productTotal: number;
  groups: OrderPaymentGroup[];
  payout: number | null;
}

export interface LookupResponse {
  order: OrderDto;
  payment?: OrderPaymentDto;
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
  returnLoss: { total: number; costLoss: number; platformKept: number; refundLoss: number };
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
  /**
   * Bóc chi tiết bên trong khoản (22/08, mới có ở costs.items): giá vốn +
   * Ads theo SÀN, chi phí nhập tay theo DANH MỤC; percent tính trên khoản
   * cha. Backend cũ chưa trả → optional, UI tự ẩn.
   */
  items?: { key: string; label: string; amount: number; percent: number }[];
}

/** Một ngày trong chuỗi trend 14 ngày của GET /api/analytics. */
export interface AnalyticsTrendPoint {
  date: string;
  label: string;
  revenue: number;
  /** Số đơn trong ngày — mọi trạng thái. */
  orders: number;
  /** Giá vốn + chi phí vận hành trong ngày — vắng với SALES. */
  cost?: number;
}

/**
 * GET /api/analytics (backend/src/routes/analytics.ts) — CÙNG nguồn số với
 * Tổng quan web (frontend/src/app/page.tsx: Doanh thu / Đơn hàng / Tổng chi
 * phí / Lợi nhuận dự kiến). KHÁC với /api/finance/analytics (Báo cáo dòng
 * tiền, AnalyticsResponse bên dưới). Chỉ chép các trường mobile dùng; đủ
 * trường xem frontend/src/lib/api.ts AnalyticsResponse.
 */
export interface OverviewAnalytics {
  /** Số đơn PHÁT SINH trong kỳ đang tính doanh thu (không gồm hủy & hoàn/trả). */
  activeOrderCount: number;
  /** Số MÓN bán ra trên cùng rổ activeOrderCount. */
  itemQuantity: number;
  totalRevenue: number;
  totalCost?: number;
  totalPlatformFee?: number;
  /** Riêng THUẾ SÀN (TNCN + VAT thu hộ) đã nằm trong totalPlatformFee. */
  totalPlatformTax?: number;
  /** Bóc tách totalPlatformFee theo đúng các dòng khấu trừ (Σ = totalPlatformFee). */
  platformFeeBreakdown?: {
    service: number;
    affiliate: number;
    tax: number;
    voucher: number;
    shippingDiff: number;
    adWallet: number;
    refund: number;
    other: number;
  };
  totalOperatingExpense?: number;
  /** Chi phí vận hành BIẾN ĐỔI ngoài quảng cáo (bao bì, phí hoàn…). */
  operatingVariableExpense?: number;
  /** Chi phí vận hành CỐ ĐỊNH ngoài quảng cáo (thuê kho, lương…). */
  operatingFixedExpense?: number;
  /** Chi phí nhập tay theo danh mục — ADS = quảng cáo (gồm cả sàn tự đồng bộ). */
  expensesByCategory?: { category: string; amount: number }[];
  /** Lợi nhuận DỰ KIẾN sau giá vốn, phí sàn & chi phí vận hành. */
  netProfit?: number;
  /** Đơn chưa có giá vốn — bị loại khỏi lợi nhuận, vẫn tính doanh thu. */
  missingCost?: { orderCount: number; excludedProfit: number };
  /** 14 ngày liền trước tính đến cuối kỳ — xem "Hôm nay" vẫn có đường sóng. */
  trend: AnalyticsTrendPoint[];
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
    RETURNING: number;
  };
  /** Kỳ trước liền kề (cùng độ dài) để tính tăng/giảm. null khi không lọc ngày. */
  previous: { totalRevenue: number; orderCount: number; activeOrderCount: number } | null;
  /** Backend cắt trường tiền với SALES — mobile chỉ ADMIN xem trang này. */
  financialsHidden?: boolean;
}

/**
 * GET /api/finance/analytics — Báo cáo dòng tiền, chỉ chép phần app dùng
 * (thác nước 4 cột). Đẳng thức: Giá trị SP − Khấu trừ = Doanh thu; Doanh thu
 * − Chi phí + Thu khác − Thuế dự phòng = Lợi nhuận ròng.
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
    profit: {
      total: number;
      items: BreakdownItem[];
      /** Đơn chưa có giá vốn — bị loại khỏi lợi nhuận. Backend cũ có thể vắng. */
      missingCost?: { orderCount: number; excludedProfit: number };
    };
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
/** Một hãng vận chuyển trong phiếu bốc hàng — carrier = "EXPRESS" | mã enum Carrier. */
export interface OrderStatsCarrierRow {
  carrier: string;
  qty: number;
  expressQty: number;
  revenue: number;
  orders: number;
  sku: string | null;
}

export interface OrderStatsResponse {
  days: number;
  /** Dòng tổng cho kho: cần bốc tổng bao nhiêu món, thuộc mấy đơn. */
  totals: { qty: number; expressQty: number; orders: number; revenue: number };
  byProduct: OrderStatsRow[];
  bySku: OrderStatsRow[];
  /** Theo hãng VC — Hỏa tốc đứng đầu, còn lại theo số đơn. Vắng với backend cũ. */
  byCarrier?: OrderStatsCarrierRow[];
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

// ───────────────────────── Tồn kho (tab Kho) ─────────────────────────

/** Một SKU kho trong GET /api/products — chỉ chép trường app dùng. */
export interface ProductDto {
  id: string;
  skuCode: string;
  productName: string;
  imageUrl: string | null;
  quantityInStock: number;
  holdQuantity: number;
  /** Số Hubsell đẩy lên mọi gian = max(0, tồn − giữ − tồn an toàn). */
  availableToSell: number;
  isLowStock: boolean;
  /** Các gian đã nối với SKU này — rỗng = chưa nối gian nào (nối trên web). */
  channelLinks?: { shopName: string; channelName: string; stockSyncEnabled: boolean }[];
}

export interface ProductsListResponse {
  items: ProductDto[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** GET /api/stock-locations — rỗng (enabled=false) khi shop chưa dùng vị trí. */
export interface StockLocationDto {
  id: string;
  /** Đường dẫn theo cây, vd "Kho 2 › Kệ A1". */
  path: string;
  sellable: boolean;
}

export interface StockLocationsResponse {
  items: StockLocationDto[];
  enabled: boolean;
}

/** POST /api/inventory/adjust — nhập / xuất theo SỐ LƯỢNG (không gõ đè tồn). */
export interface AdjustStockResponse {
  product: { id: string; quantityInStock: number };
}

// ============================================================
// TRỢ LÝ QUẢNG CÁO — GET /api/quang-cao/{shopee|lazada} (backend routes/ads.ts),
// chỉ chép phần màn Quảng cáo của app dùng.
// ============================================================
export type AdsPlatform = "shopee" | "lazada";

export type AdsVerdict =
  | "spike"
  | "pause_now"
  | "grace"
  | "review"
  | "healthy"
  | "insufficient_data";

export interface AdsCampaignDto {
  id: string;
  campaignId: string;
  name: string;
  /** ongoing | scheduled | paused | ended | closed | deleted */
  status: string;
  budget: number;
  roasTarget: number | null;
  spend: number;
  broadOrder: number;
  broadGmv: number;
  roasBroad: number | null;
  breakevenRoas: number | null;
  /** Lãi ước tính sau quảng cáo — null khi chưa đủ dữ liệu biên lãi. */
  estProfit: number | null;
  assistant: {
    verdict: AdsVerdict;
    reasons: string[];
    /** Dòng kết luận nên làm gì — máy chủ cũ chưa có trường này. */
    recommendation?: string | null;
    decision: string;
    /** Chủ shop đã quyết (Theo dõi / Bỏ qua / Đã xử lý) và cảnh báo chưa đổi loại. */
    decisionActive: boolean;
  };
  /** Khác null = chính Trợ lý Hubsell đã tạm dừng chiến dịch này. */
  hubsellPause: { at: string; reasons: string[] } | null;
  /** Khác null = Trợ lý đã hạ ngân sách ngày, còn giữ số gốc. */
  hubsellBudgetCut: { at: string; before: number; cut: number } | null;
}

export interface AdsOverviewResponse {
  channels: { id: string; shopName: string }[];
  selectedChannelId: string | null;
  wallet: { balance: number; syncedAt: string | null } | null;
  walletEmpty?: boolean;
  /**
   * Shopee: gian phải ủy quyền THÊM cho app Hubsell Ads mới có số quảng cáo.
   * required = false (hoặc null) → không cần, vd Lazada.
   */
  adsApp?: { required: boolean; status: "ACTIVE" | "NOT_LINKED" | "DISCONNECTED" } | null;
  adsSyncedAt?: string | null;
  assistant?: {
    config: { autoExecute: { mode: "off" | "dry_run" | "live" } };
    needsAction: number;
  };
  summary: {
    spend: number;
    broadGmv: number;
    broadOrder: number;
    /** Tổng lãi ước tính của các chiến dịch có đủ dữ liệu biên lãi. */
    estProfit: number;
    roasBroad: number | null;
    shopBreakevenRoas: number | null;
  } | null;
  campaigns: AdsCampaignDto[];
}

// ---------- GỢI Ý CHẠY ADS theo sản phẩm (Shopee) — chép từ frontend/src/lib/api.ts ----------

/** run_now = nên chạy ngay · test_small = thử nhỏ · not_yet = chưa nên · running = đang chạy ads. */
export type AdsRecommendTier = "run_now" | "test_small" | "not_yet" | "running";

export interface AdsRecommendGate {
  key: "margin" | "feasible" | "stock" | "allowed" | "social";
  ok: boolean;
  text: string;
  /** Trượt cổng thì làm gì trước. */
  todo?: string;
}

export interface AdsRecommendFactor {
  key: "headroom" | "cvr" | "demand" | "cpc" | "momentum" | "history";
  label: string;
  points: number;
  max: number;
  text: string;
}

export interface AdsRecommendProposal {
  /** Đẩy số = mức an toàn · Cân bằng = giữa · Giữ lãi = ROAS thị trường. */
  targets: { push: number; balanced: number; keep: number };
  recommended: "push" | "balanced" | "keep";
  dailyBudget: number;
  budgetNote: string;
  maxTestSpend7d: number;
}

export interface AdsRecommendationRow {
  itemId: string;
  productName: string;
  itemSku: string | null;
  imageUrl: string | null;
  price: number;
  tier: AdsRecommendTier;
  score: number;
  margin: number | null;
  breakevenRoas: number | null;
  /** Hòa vốn × hệ số an toàn — chạy từ mức này trở lên mới có lãi thật. */
  safeRoas: number | null;
  /** ROAS thị trường của sàn ÷ hòa vốn của SP. */
  headroom: number | null;
  organicCvr: number | null;
  daysOfCover: number | null;
  orders30d: number;
  revenue30d: number;
  units30d: number;
  stockAvailable: number | null;
  /** Một câu lý do cho dòng. */
  headline: string;
  gates: AdsRecommendGate[];
  factors: AdsRecommendFactor[];
  /** null = trượt cổng / đang chạy — không có gì để tạo. */
  proposal: AdsRecommendProposal | null;
  /** Lát tín hiệu sàn (null = gian chưa đồng bộ tín hiệu cho SP này). */
  market: {
    ratingStar: number | null;
    commentCount: number | null;
    tags: string[];
    roiLower: number | null;
    roiExact: number | null;
    roiUpper: number | null;
    kwSearchVolume: number | null;
  } | null;
}

/** GET /api/quang-cao/shopee/recommendations?channelId= */
export interface AdsRecommendationsResponse {
  rows: AdsRecommendationRow[];
  counts: Record<AdsRecommendTier, number>;
  /** Lần đồng bộ tín hiệu sàn gần nhất; null = chưa từng. */
  signalsSyncedAt: string | null;
  /** Số SP đang bán bị loại chỉ vì thiếu giá vốn. */
  missingCostCount?: number;
  safeRoasFactor: number;
}
