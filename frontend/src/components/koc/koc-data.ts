/**
 * MẠNG LƯỚI KOC & AFFILIATE — TYPES + DỮ LIỆU MOCK DÙNG CHUNG
 *
 * Toàn bộ 5 trang /koc-marketing/* đọc từ file này. Số liệu là MOCK cứng phía
 * client (cùng trạng thái preview với Trợ lý quảng cáo /ads/*) — định hình
 * khung UI trước, chờ nối Affiliate API của từng sàn.
 *
 * ─── NGUYÊN TẮC SCHEMA: TÁCH RÕ 2 NGUỒN DỮ LIỆU ───
 * Mỗi KOC gộp số liệu từ 2 phía, khi lên backend sẽ là 2 luồng ghi khác nhau:
 *   1. API SÀN đổ về (đồng bộ tự động):  gmv, orders, refundRate, commission
 *   2. SELLER nhập tay (form/modal):     bookingFee, sampleCost
 * Net-ROI là CHỈ SỐ DẪN XUẤT — chỉ tính qua các hàm helper bên dưới, không
 * trang nào tự bấm công thức riêng (tránh vết xe đổ phí sàn hardcode, xem
 * memory hubsell-tai-chinh-co-so).
 *
 * Khi thương mại hoá, Prisma dự kiến thêm 3 bảng:
 *   KocPartner        — hồ sơ KOC (đa sàn, gắn userId chủ shop)
 *   KocCampaign       — chiến dịch booking (kỳ chạy, ngân sách)
 *   KocSampleShipment — phiếu xuất hàng mẫu, FK về Product kho vật lý;
 *                       mỗi phiếu sinh 1 StockMovement lý do MARKETING_SAMPLE
 *                       và 1 dòng chi phí nhóm CHI_PHI_MARKETING bên Thu chi
 *                       vận hành — MỘT bản ghi nuôi cả Net-ROI lẫn dòng tiền.
 */

export type KocPlatform = "TIKTOK" | "SHOPEE" | "LAZADA";

/** Nhãn + màu nhận diện sàn — dùng cho badge kênh ở mọi bảng KOC. */
export const KOC_PLATFORM_META: Record<
  KocPlatform,
  { label: string; badgeClass: string }
> = {
  TIKTOK: {
    label: "TikTok Shop",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
  },
  SHOPEE: {
    label: "Shopee",
    badgeClass: "border-orange-200 bg-orange-50 text-orange-700",
  },
  LAZADA: {
    label: "Lazada",
    badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
  },
};

/** Chiến dịch booking — nguồn cho filter "Chọn chiến dịch" ở Tổng quan. */
export interface KocCampaign {
  id: string;
  name: string;
}

export const KOC_CAMPAIGNS: KocCampaign[] = [
  { id: "cp-88", name: "Mega Sale 8.8" },
  { id: "cp-seeding", name: "Seeding Always-on T7–T8" },
  { id: "cp-aogio", name: "Launch Áo gió Thu Đông" },
];

/** Một KOC trong mạng lưới — gộp số liệu API sàn + chi phí Seller nhập tay. */
export interface KocPartner {
  id: string;
  name: string;
  /** Handle kênh hiển thị dưới tên — "@daily.style.vn" */
  handle: string;
  platform: KocPlatform;
  followers: number;
  campaignId: string;
  // ----- Nhóm 1: API sàn đổ về (Affiliate API / đối soát settlement) -----
  /** GMV phát sinh quy cho KOC trong kỳ (VND) */
  gmv: number;
  orders: number;
  /** Tỷ lệ hoàn/huỷ — %, ví dụ 8.5 = 8,5% */
  refundRate: number;
  /** Hoa hồng affiliate đã trả cho KOC (VND) */
  commission: number;
  // ----- Nhóm 2: Seller nhập tay -----
  /** Phí booking cứng theo hợp đồng (VND) */
  bookingFee: number;
  /** Giá trị hàng mẫu đã gửi, tính theo GIÁ VỐN kho (VND) */
  sampleCost: number;
  /**
   * % lãi gộp bình quân của giỏ sản phẩm KOC bán (sau giá vốn + phí sàn) —
   * mock cứng; bản thật đọc từ P&L SKU (operations-assistant/loss-orders).
   */
  grossMarginPct: number;
}

/** Ngưỡng gắn badge cảnh báo/khen — chỉnh 1 chỗ, mọi bảng ăn theo. */
export const KOC_REFUND_WARN_PCT = 15;
export const KOC_STAR_ROI = 5;

export const KOC_PARTNERS: KocPartner[] = [
  // ----- TikTok: GMV lớn, chạy qua video gắn giỏ + phiên live -----
  { id: "koc-1", name: "Linh Chi Daily", handle: "@linhchi.daily", platform: "TIKTOK", followers: 486_000, campaignId: "cp-88", gmv: 86_400_000, orders: 612, refundRate: 6.2, commission: 8_640_000, bookingFee: 5_000_000, sampleCost: 1_240_000, grossMarginPct: 34 },
  { id: "koc-2", name: "Tuấn Review Đồ Nam", handle: "@tuanreview.mens", platform: "TIKTOK", followers: 212_000, campaignId: "cp-aogio", gmv: 41_200_000, orders: 268, refundRate: 9.8, commission: 4_530_000, bookingFee: 3_000_000, sampleCost: 860_000, grossMarginPct: 31 },
  { id: "koc-3", name: "Bống Unbox", handle: "@bong.unbox", platform: "TIKTOK", followers: 98_500, campaignId: "cp-seeding", gmv: 9_150_000, orders: 74, refundRate: 21.4, commission: 1_010_000, bookingFee: 2_500_000, sampleCost: 620_000, grossMarginPct: 28 },
  // ----- Shopee: chạy qua SAP (Shopee Affiliate Program) + Shopee Video -----
  { id: "koc-4", name: "Mẹ Bơ Săn Deal", handle: "mebo.sandeal", platform: "SHOPEE", followers: 156_000, campaignId: "cp-88", gmv: 32_700_000, orders: 341, refundRate: 4.6, commission: 2_940_000, bookingFee: 1_500_000, sampleCost: 480_000, grossMarginPct: 33 },
  { id: "koc-5", name: "Hưng Đồ Tốt Giá Rẻ", handle: "hung.dotot", platform: "SHOPEE", followers: 74_200, campaignId: "cp-seeding", gmv: 14_800_000, orders: 187, refundRate: 7.1, commission: 1_180_000, bookingFee: 0, sampleCost: 350_000, grossMarginPct: 30 },
  { id: "koc-6", name: "Ngọc Ordership", handle: "ngoc.ordership", platform: "SHOPEE", followers: 41_800, campaignId: "cp-88", gmv: 5_400_000, orders: 52, refundRate: 18.9, commission: 490_000, bookingFee: 1_200_000, sampleCost: 410_000, grossMarginPct: 27 },
  // ----- Lazada: affiliate nhỏ, chưa có trang riêng — theo dõi ở Tổng quan -----
  { id: "koc-7", name: "LazMall Picks VN", handle: "lazmall.picks", platform: "LAZADA", followers: 63_000, campaignId: "cp-seeding", gmv: 7_900_000, orders: 61, refundRate: 5.8, commission: 710_000, bookingFee: 800_000, sampleCost: 290_000, grossMarginPct: 29 },
  { id: "koc-8", name: "Anh Sáng Săn Sale", handle: "anhsang.sansale", platform: "LAZADA", followers: 28_400, campaignId: "cp-88", gmv: 2_100_000, orders: 19, refundRate: 12.3, commission: 190_000, bookingFee: 900_000, sampleCost: 260_000, grossMarginPct: 26 },
];

// ═══════════════ CHỈ SỐ DẪN XUẤT — NGUỒN CÔNG THỨC DUY NHẤT ═══════════════

/** Doanh thu ròng thực tế = GMV đã trừ phần hoàn/huỷ. */
export function kocNetRevenue(k: KocPartner): number {
  return Math.round(k.gmv * (1 - k.refundRate / 100));
}

/** Tổng chi phí KOC = hoa hồng (API) + booking + hàng mẫu (nhập tay). */
export function kocTotalCost(k: KocPartner): number {
  return k.commission + k.bookingFee + k.sampleCost;
}

/**
 * Lợi nhuận ròng = lãi gộp trên doanh thu ròng − toàn bộ chi phí KOC.
 * Lãi gộp đã sau giá vốn + phí sàn nên không trừ trùng phí sàn lần nữa.
 */
export function kocNetProfit(k: KocPartner): number {
  return Math.round(
    kocNetRevenue(k) * (k.grossMarginPct / 100) - kocTotalCost(k)
  );
}

/** Net ROI (x lần) = doanh thu ròng / tổng chi phí. 0 chi phí → coi là 0. */
export function kocNetRoi(k: KocPartner): number {
  const cost = kocTotalCost(k);
  return cost > 0 ? kocNetRevenue(k) / cost : 0;
}

/** Badge đánh giá KOC — cảnh báo hoàn cao ưu tiên hơn khen hiệu quả. */
export type KocRating = "STAR" | "HIGH_REFUND" | null;
export function kocRating(k: KocPartner): KocRating {
  if (k.refundRate > KOC_REFUND_WARN_PCT) return "HIGH_REFUND";
  if (kocNetRoi(k) >= KOC_STAR_ROI && kocNetProfit(k) > 0) return "STAR";
  return null;
}

// ═══════════════ HÀNG MẪU & SEEDING ═══════════════

/** SKU kho vật lý cho modal xuất mẫu — bản thật fetch từ /products. */
export interface SampleSku {
  sku: string;
  name: string;
  stock: number;
  /** Giá vốn/đơn vị — giá trị hàng mẫu ghi nhận chi phí theo số này. */
  unitCost: number;
}

export const SAMPLE_SKUS: SampleSku[] = [
  { sku: "TC054", name: "Túi đeo chéo canvas TC054", stock: 128, unitCost: 62_000 },
  { sku: "TC055", name: "Túi tote canvas TC055", stock: 86, unitCost: 54_000 },
  { sku: "AOGIO_001", name: "Áo gió nam 2 lớp AOGIO_001", stock: 214, unitCost: 118_000 },
  { sku: "VDT_001", name: "Tất thể thao cổ ngắn (set 5)", stock: 460, unitCost: 21_000 },
];

/** Trạng thái vòng đời hàng mẫu: xuất kho → KOC lên bài → có đơn đầu tiên. */
export type SampleStatus = "POSTED" | "WAITING" | "NOT_POSTED";

export const SAMPLE_STATUS_META: Record<
  SampleStatus,
  { label: string; badgeClass: string }
> = {
  POSTED: {
    label: "✅ Đã đăng video",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  WAITING: {
    label: "⏳ Chờ lên bài",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
  },
  NOT_POSTED: {
    label: "❌ Chưa đăng",
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

/** Một phiếu xuất kho hàng mẫu gắn với KOC. */
export interface SampleShipment {
  id: string;
  kocId: string;
  kocName: string;
  platform: KocPlatform;
  sku: string;
  productName: string;
  qty: number;
  /** Tổng giá trị phiếu theo giá vốn = qty × unitCost tại thời điểm xuất. */
  cost: number;
  /** ISO date xuất kho */
  exportedAt: string;
  status: SampleStatus;
  /** ISO date đơn hàng đầu tiên quy cho KOC sau khi lên bài (nếu có) */
  firstOrderAt?: string;
}

export const SAMPLE_SHIPMENTS: SampleShipment[] = [
  { id: "smp-1", kocId: "koc-1", kocName: "Linh Chi Daily", platform: "TIKTOK", sku: "TC054", productName: "Túi đeo chéo canvas TC054", qty: 2, cost: 124_000, exportedAt: "2026-07-28", status: "POSTED", firstOrderAt: "2026-08-01" },
  { id: "smp-2", kocId: "koc-2", kocName: "Tuấn Review Đồ Nam", platform: "TIKTOK", sku: "AOGIO_001", productName: "Áo gió nam 2 lớp AOGIO_001", qty: 3, cost: 354_000, exportedAt: "2026-07-30", status: "POSTED", firstOrderAt: "2026-08-04" },
  { id: "smp-3", kocId: "koc-4", kocName: "Mẹ Bơ Săn Deal", platform: "SHOPEE", sku: "TC055", productName: "Túi tote canvas TC055", qty: 2, cost: 108_000, exportedAt: "2026-08-02", status: "POSTED", firstOrderAt: "2026-08-05" },
  { id: "smp-4", kocId: "koc-3", kocName: "Bống Unbox", platform: "TIKTOK", sku: "VDT_001", productName: "Tất thể thao cổ ngắn (set 5)", qty: 5, cost: 105_000, exportedAt: "2026-08-03", status: "WAITING" },
  { id: "smp-5", kocId: "koc-6", kocName: "Ngọc Ordership", platform: "SHOPEE", sku: "TC054", productName: "Túi đeo chéo canvas TC054", qty: 1, cost: 62_000, exportedAt: "2026-07-22", status: "NOT_POSTED" },
  { id: "smp-6", kocId: "koc-7", kocName: "LazMall Picks VN", platform: "LAZADA", sku: "TC055", productName: "Túi tote canvas TC055", qty: 2, cost: 108_000, exportedAt: "2026-08-05", status: "WAITING" },
];

// ═══════════════ CHI PHÍ BOOKING & HỢP ĐỒNG ═══════════════

export type KocExpenseType = "BOOKING" | "MCN_CONTRACT";
export type KocExpenseStatus = "PAID" | "PENDING";

/** Một khoản chi booking/hợp đồng — bản thật đổ về Thu chi vận hành. */
export interface KocExpense {
  id: string;
  contractCode: string;
  kocName: string;
  platform: KocPlatform;
  campaignId: string;
  type: KocExpenseType;
  amount: number;
  /** Hạn thanh toán (PENDING) hoặc ngày đã chi (PAID) — ISO date */
  dueDate: string;
  status: KocExpenseStatus;
}

export const KOC_EXPENSES: KocExpense[] = [
  { id: "exp-1", contractCode: "HD-KOC-2607", kocName: "Linh Chi Daily", platform: "TIKTOK", campaignId: "cp-88", type: "BOOKING", amount: 5_000_000, dueDate: "2026-07-26", status: "PAID" },
  { id: "exp-2", contractCode: "HD-KOC-2907", kocName: "Tuấn Review Đồ Nam", platform: "TIKTOK", campaignId: "cp-aogio", type: "BOOKING", amount: 3_000_000, dueDate: "2026-07-29", status: "PAID" },
  { id: "exp-3", contractCode: "HD-MCN-0108", kocName: "MCN VieNetwork (5 KOC)", platform: "TIKTOK", campaignId: "cp-seeding", type: "MCN_CONTRACT", amount: 12_000_000, dueDate: "2026-08-15", status: "PENDING" },
  { id: "exp-4", contractCode: "HD-KOC-0208", kocName: "Mẹ Bơ Săn Deal", platform: "SHOPEE", campaignId: "cp-88", type: "BOOKING", amount: 1_500_000, dueDate: "2026-08-02", status: "PAID" },
  { id: "exp-5", contractCode: "HD-KOC-0508", kocName: "Ngọc Ordership", platform: "SHOPEE", campaignId: "cp-88", type: "BOOKING", amount: 1_200_000, dueDate: "2026-08-12", status: "PENDING" },
  { id: "exp-6", contractCode: "HD-KOC-0608", kocName: "Bống Unbox", platform: "TIKTOK", campaignId: "cp-seeding", type: "BOOKING", amount: 2_500_000, dueDate: "2026-08-20", status: "PENDING" },
];

export const KOC_EXPENSE_TYPE_LABEL: Record<KocExpenseType, string> = {
  BOOKING: "Booking lẻ",
  MCN_CONTRACT: "Hợp đồng MCN",
};

/** Tên chiến dịch theo id — dùng chung cho bảng Tổng quan & Chi phí. */
export function campaignName(id: string): string {
  return KOC_CAMPAIGNS.find((c) => c.id === id)?.name ?? "—";
}
