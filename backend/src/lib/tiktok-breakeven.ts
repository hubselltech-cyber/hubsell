// ============================================================
// HÒA VỐN QUẢNG CÁO TikTok (GMV Max) — LUẬT + MẶT TIỀN HAI ĐƯỜNG CỘNG
// (thuần, không gọi DB — docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 12)
//
// Câu hỏi: với giá vốn + phí sàn thật của shop, ROI của TikTok phải trên bao
// nhiêu thì quảng cáo mới KHÔNG LỖ? → hòa vốn = 1 ÷ biên lãi TRƯỚC quảng cáo.
// Đây là căn cứ cho mọi ngưỡng của luật loại video (ROI mục tiêu, mức loại) —
// trước 18/09 các ngưỡng đó đặt theo cảm tính.
//
// ★ CHỈ TÍNH ĐƠN ĐÃ CÓ KẾT CỤC CUỐI (anh Trung 18/09: "chỉ tính trên đơn đã giao
//   thành công và hoàn thành công… TikTok đối soát rất lâu… phải tính trên đơn đã
//   đối soát thành công"):
//     · đơn ĐÃ ĐỐI SOÁT THẬT (Order.isSettled — bản kê TikTok estimated = false):
//       gồm cả đơn giao thành công lẫn đơn hoàn xong, phí và tiền hoàn đều là số
//       cuối của sàn. Đơn đang giao / vừa giao / đang hoàn / mới có số ƯỚC TÍNH
//       của sàn → KHÔNG tính: kết cục chưa chốt, đưa vào là biên lãi ảo.
//     · đơn HỦY: cũng là kết cục cuối (xem điểm 2 bên dưới), nhưng chỉ lấy đơn
//       hủy CÙNG LỨA với đơn đã đối soát — tạo không muộn hơn đơn đã đối soát mới
//       nhất. Đơn hủy chốt trong vài giờ còn đối soát mất hàng tuần; không cắt
//       cùng lứa thì mấy tuần gần nhất chỉ toàn đơn hủy, tỷ lệ hủy bị thổi phồng.
//   Vì đơn mới chưa đối soát nên cửa sổ là 60 ngày theo ngày tạo đơn (Shopee dùng
//   30): phần đóng góp thật thường là đơn tạo từ ~2 tuần trước trở về. 60 là mặc
//   định chọn cho đủ mẫu, không phải số của sàn.
//
// KHÁC Shopee/Lazada ở hai chỗ, đều vì cách TikTok tính tiền:
//   1. PHÍ GMV MAX CÓ THỂ NẰM TRONG LỢI NHUẬN ĐƠN. Gian chọn "Nạp tiền quảng cáo
//      từ đơn hàng" thì sàn trừ ngay trong quyết toán từng đơn
//      (TiktokOrderSettlement.feeGmvMax, số CÓ DẤU, âm = bị trừ; mapper dồn vào
//      order.serviceFee) → computePnlRow trả lợi nhuận ĐÃ trừ quảng cáo → phải
//      CỘNG NGƯỢC mới ra biên lãi trước quảng cáo: lãi trước ads = profit − feeGmvMax.
//      Gian trả bằng số dư tài khoản quảng cáo (and.not.or: 0/692 đơn có phí,
//      kiểm 26/09/2026) thì feeGmvMax = 0 và phép cộng ngược không đổi gì —
//      đính chính 18/10: chú thích cũ viết như thể sàn luôn trừ.
//   2. MẪU SỐ PHẢI CÙNG ĐỊNH NGHĨA VỚI "DOANH THU" CỦA TIKTOK. ROI của TikTok =
//      gross_revenue ÷ chi phí, mà gross_revenue tính trên đơn ĐẶT — đơn hủy /
//      hoàn về sau KHÔNG bị rút ra (tiền quảng cáo cho đơn đó vẫn mất). Nên đơn
//      HỦY góp doanh thu vào mẫu số nhưng góp 0 đồng lãi (không lấy "lỗ ảo" bằng
//      giá vốn của computePnlRow — hàng hủy quay lại kho). Hệ quả: hòa vốn
//      nghiêng về phía CAO (dè dặt) — đúng hướng "giữ tiền".
//      ★ GIẢ ĐỊNH chưa kiểm bằng số prod → kết quả trả kèm `check`: doanh thu MỌI
//      đơn đặt Hubsell thấy vs doanh thu TikTok báo, cùng SKU, cùng khoảng ngày.
//
// Đơn thiếu giá vốn (đã có kết cục cuối) bị loại khỏi cả tử lẫn mẫu và cộng vào
// `missingCostRevenue` để UI nói rõ "tính trên X% doanh thu có giá vốn".
// Đơn nhiều SKU phân bổ theo tỷ trọng giá trị hàng của SKU khớp (như Shopee).
//
// Hai đường cộng cho cùng một kết quả:
//   "rows": duyệt mảng đơn trong RAM (các hàm thuần ở đây) — có phanh số đơn;
//   "sql" : GROUP BY trên sổ dòng hàng (ledgerTiktokBreakevenByGroup ở
//           services/order-ledger.ts) — đủ mọi đơn.
// Nạp dữ liệu + bộ đệm: integrations/tiktok-ads/breakeven-source.ts.
// Ghép số thành kết luận: integrations/tiktok-ads/breakeven.ts.
// ============================================================

import { createHash } from "crypto";
import { ShippingStatus } from "@prisma/client";
import { startOfDaysAgo } from "./ads-dates";
import { BREAKEVEN_CHECK_MAX_GAP_PCT, PRODUCT_GROUP_PREFIX, SHOP_GROUP, adsGroupMappingOf, lineGroupKey, lineInGroup, placedRevenueOf, type AdsGroupSets } from "./ads-margin";
import type { DateRangeFilter } from "./date-range";

/** Cửa sổ lấy đơn (theo ngày tạo) — dài hơn Shopee vì chỉ đơn ĐÃ ĐỐI SOÁT mới được tính. Mặc định chọn, không phải số của sàn. */
export const TIKTOK_MARGIN_WINDOW_DAYS = 60;

/**
 * Khóa giữa hai nấc hạ ROI mục tiêu của TikTok = 72 giờ: tài liệu "Best practices for Product GMV Max" (ads.tiktok.com/help, đọc
 * 08/10/2026): "Keep each ROI setting for at least three full days before making adjustments." (Shopee giữ 48 giờ — anh Trung
 * chọn 04/10.) Đặt ở lib thuần để breakeven.ts và campaign-advice.ts cùng dùng mà không vòng import.
 */
export const TIKTOK_TARGET_STEP_WAIT_HOURS = 72;

/**
 * Hai mốc ngân sách của TikTok (đặt ở lib thuần để campaign-advice.ts và product-run-advice.ts cùng dùng, không vòng import):
 *   · TIKTOK_BUDGET_USED_PCT 80 — tiêu từ 80% ngân sách ngày = ngân sách đang là thứ chặn (tự tăng ngân sách của GMV Max kích hoạt khi
 *     "at least 80% of your budget has been used"; Best practices: "Giữ mức tiêu thụ ngân sách dưới 80%").
 *   · TIKTOK_BUDGET_STEP_PCT 0,3 — mỗi lần tăng ngân sách 30%: "Best practices for Max delivery" (03/2026): "tăng dần thêm 30% mỗi
 *     ngày thay vì tăng đột ngột"; tự tăng ngân sách của chính TikTok là +50%/bước. Đề xuất 15/10/2026, anh Trung chốt "cứ làm theo
 *     hướng này" (docs/ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md mục 3.3).
 */
export const TIKTOK_BUDGET_USED_PCT = 80;
export const TIKTOK_BUDGET_STEP_PCT = 0.3;
/** Mức ngân sách ngày tối thiểu VND của chiến dịch PRODUCT_SALES theo phụ lục Marketing API (GMV Max chưa có trang riêng). */
export const TIKTOK_MIN_DAILY_BUDGET = 100_000;
/**
 * Số ngày trọn tối thiểu trước khi nhận định "không ra đơn" (TikTok: "Giữ mỗi cài đặt ROI ít nhất 3 ngày trọn vẹn trước khi điều
 * chỉnh" — cùng mốc với khóa 72 giờ) và % ngân sách dưới mức đó coi là "TikTok không phân phối" (20% — MẶC ĐỊNH TỰ CHỌN, anh Trung
 * chốt 15/10/2026 đêm; docs/ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md mục 7f).
 */
export const TIKTOK_MIN_FULL_DAYS = 3;
export const TIKTOK_NO_DELIVERY_BUDGET_PCT = 20;

/** Cửa sổ hòa vốn tính tới lúc gọi: TIKTOK_MARGIN_WINDOW_DAYS ngày, theo ngày tạo đơn. */
export function tiktokMarginWindowRange(): DateRangeFilter {
  return { gte: startOfDaysAgo(TIKTOK_MARGIN_WINDOW_DAYS), lte: new Date() };
}

/** Phanh số đơn khi giữ đơn 60 ngày của một gian trong RAM. Chỉ đường "rows" còn dùng. */
export const TIKTOK_BREAKEVEN_MAX_ORDERS = 8000;

/**
 * Nơi cộng nguyên liệu hòa vốn của Trợ lý quảng cáo TikTok: "sql" = GROUP BY trên
 * sổ dòng hàng (mặc định từ 30/09/2026); "rows" = duyệt mảng dòng gọn đọc từ sổ
 * cái (lưới đỡ khi câu gom lỗi, công cụ đối chiếu, test). Công tắc env
 * TIKTOK_BREAKEVEN_SOURCE đã gỡ 14/10/2026.
 */
export type TiktokBreakevenSource = "rows" | "sql";

/** Phần của một dòng P&L mà phép tính hòa vốn cần — tách riêng để test không phải dựng cả đơn. */
export interface BreakevenPnlRow {
  createdAt: Date;
  shippingStatus: ShippingStatus;
  /** Đã đối soát THẬT (bản kê estimated = false). */
  isSettled: boolean;
  /** `itemId` = SPU của dòng (sổ dòng hàng, từ OrderItem.externalId — Lát 1a); null/bỏ trống = chưa có id → khớp theo mã (lib/ads-margin AdsGroupSets). */
  items: { sku: string; itemId?: string | null; price: number; quantity: number }[];
  actualRevenue: number;
  profit: number;
  missingCostPrice: boolean;
  /** Bản kê TikTok của đơn (null = chưa có). feeGmvMax có dấu, âm = bị trừ. */
  tiktok: { feeGmvMax: number } | null;
}

export interface BreakevenBase {
  /** Đơn đã đối soát góp vào phép tính (giao thành công + hoàn xong). */
  settledOrders: number;
  /** Đơn hủy cùng lứa góp doanh thu vào mẫu số. */
  cancelledOrders: number;
  /** Mẫu số: doanh thu (giá gốc − chiết khấu shop) của đơn được tính, gồm đơn hủy cùng lứa. */
  revenue: number;
  /** Tử số: lợi nhuận đã cộng ngược phí GMV Max. */
  profitBeforeAds: number;
  /** Phí GMV Max sàn đã trừ trong các đơn này (số dương). */
  adFee: number;
  /** Doanh thu của đơn đã có kết cục cuối nhưng thiếu giá vốn — để tính độ phủ. */
  missingCostRevenue: number;
  /** Số đơn CHƯA có kết cục cuối (đang giao, chờ đối soát, đang hoàn, hủy ngoài lứa) — không tính. */
  pendingOrders: number;
}

const emptyBreakevenBase = (): BreakevenBase => ({
  settledOrders: 0,
  cancelledOrders: 0,
  revenue: 0,
  profitBeforeAds: 0,
  adFee: 0,
  missingCostRevenue: 0,
  pendingOrders: 0,
});

const isCancelled = (r: BreakevenPnlRow) => r.shippingStatus === ShippingStatus.CANCELLED;
const isSettledFinal = (r: BreakevenPnlRow) => r.isSettled && r.tiktok != null && !isCancelled(r);

/** Mốc cùng lứa: ngày tạo của đơn ĐÃ ĐỐI SOÁT mới nhất (null = gian chưa có đơn đối soát nào trong cửa sổ). */
export function settledCohortCutoff(rows: BreakevenPnlRow[]): Date | null {
  let cutoff: Date | null = null;
  for (const r of rows) {
    if (isSettledFinal(r) && (!cutoff || r.createdAt > cutoff)) cutoff = r.createdAt;
  }
  return cutoff;
}

/** Gom nguyên liệu hòa vốn trên một tập SKU (null = toàn gian). `rows` = MỌI đơn của gian trong cửa sổ. Thuần. */
export function tiktokBreakevenBase(rows: BreakevenPnlRow[], skuSet: ReadonlySet<string> | null): BreakevenBase {
  const base = emptyBreakevenBase();
  const cutoff = settledCohortCutoff(rows);
  for (const row of rows) {
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    if (itemTotal <= 0) continue;
    const matchTotal = skuSet
      ? row.items.filter((it) => lineInGroup(it, skuSet)).reduce((s, it) => s + it.price * it.quantity, 0)
      : itemTotal;
    if (matchTotal <= 0) continue;
    const ratio = matchTotal / itemTotal;
    const revenue = row.actualRevenue * ratio;

    const cancelled = isCancelled(row);
    const final = cancelled ? cutoff != null && row.createdAt <= cutoff : isSettledFinal(row);
    if (!final) {
      base.pendingOrders++;
      continue;
    }
    if (row.missingCostPrice) {
      base.missingCostRevenue += revenue;
      continue;
    }
    base.revenue += revenue;
    if (cancelled) {
      base.cancelledOrders++;
      continue;
    }
    const feeGmvMax = row.tiktok?.feeGmvMax ?? 0;
    base.settledOrders++;
    base.profitBeforeAds += (row.profit - feeGmvMax) * ratio;
    base.adFee += -feeGmvMax * ratio;
  }
  return base;
}

/**
 * Cùng phép gom của tiktokBreakevenBase nhưng cho NHIỀU nhóm SKU trong MỘT lượt quét đơn (tab Hòa vốn sản phẩm: mỗi sản
 * phẩm một nhóm — vài trăm sản phẩm × vài nghìn đơn thì không quét lại từng nhóm). `groupOfKey`: khóa dòng hàng (lineGroupKey:
 * "i:<itemId>" hoặc mã SKU thô) → mã nhóm; khóa không
 * có trong bảng thì bỏ qua. Kết quả của một nhóm PHẢI bằng tiktokBreakevenBase(rows, tập SKU của nhóm) — có test giữ điều đó,
 * để con số của một sản phẩm ở tab mới không bao giờ lệch con số hòa vốn của chiến dịch chỉ chứa sản phẩm đó. Thuần.
 */
export function tiktokBreakevenBaseByGroup(rows: BreakevenPnlRow[], groupOfKey: ReadonlyMap<string, string>): Map<string, BreakevenBase> {
  const out = new Map<string, BreakevenBase>();
  const baseOf = (g: string) => {
    let b = out.get(g);
    if (!b) out.set(g, (b = emptyBreakevenBase()));
    return b;
  };
  const cutoff = settledCohortCutoff(rows);
  for (const row of rows) {
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    if (itemTotal <= 0) continue;
    const matchByGroup = new Map<string, number>();
    for (const it of row.items) {
      const g = groupOfKey.get(lineGroupKey(it));
      if (g != null) matchByGroup.set(g, (matchByGroup.get(g) ?? 0) + it.price * it.quantity);
    }
    const cancelled = isCancelled(row);
    const final = cancelled ? cutoff != null && row.createdAt <= cutoff : isSettledFinal(row);
    const feeGmvMax = row.tiktok?.feeGmvMax ?? 0;
    for (const [g, matchTotal] of matchByGroup) {
      if (matchTotal <= 0) continue;
      const base = baseOf(g);
      const ratio = matchTotal / itemTotal;
      const revenue = row.actualRevenue * ratio;
      if (!final) {
        base.pendingOrders++;
        continue;
      }
      if (row.missingCostPrice) {
        base.missingCostRevenue += revenue;
        continue;
      }
      base.revenue += revenue;
      if (cancelled) {
        base.cancelledOrders++;
        continue;
      }
      base.settledOrders++;
      base.profitBeforeAds += (row.profit - feeGmvMax) * ratio;
      base.adFee += -feeGmvMax * ratio;
    }
  }
  return out;
}

export interface TiktokBreakeven {
  /** ROI hòa vốn; null = chưa tính được (thiếu dữ liệu) hoặc biên lãi ≤ 0 (xem negativeMargin). */
  breakevenRoi: number | null;
  /** Biên lãi trước quảng cáo (0,16 = 16%). */
  margin: number | null;
  /** Bán đã lỗ trước cả quảng cáo → ROI nào cũng lỗ. */
  negativeMargin: boolean;
  /** campaign = biên lãi riêng các SKU của chiến dịch; shop = mượn biên lãi toàn gian; product = riêng một sản phẩm (tab Hòa vốn sản phẩm). */
  source: "campaign" | "shop" | "product" | null;
  /** Đơn đã đối soát góp vào phép tính. */
  orders: number;
  /** Đơn hủy cùng lứa nằm trong mẫu số. */
  cancelledOrders: number;
  /** Đơn chưa có kết cục cuối bị để ngoài. */
  pendingOrders: number;
  /** % doanh thu (trong phạm vi) đã có giá vốn — dưới 100 nghĩa là hòa vốn chỉ đại diện phần đó. */
  costCoveragePct: number | null;
  /** Tự kiểm mẫu số (chỉ khi source = campaign): doanh thu MỌI đơn đặt Hubsell thấy vs TikTok báo, cùng SKU, cùng khoảng ngày. */
  check: TiktokBreakevenCheck | null;
  /**
   * Lý do hòa vốn CHƯA TIN ĐƯỢC vì tự kiểm lệch quá ngưỡng (breakevenCheckProblem); "" / bỏ trống = ổn. Chỉ nguồn
   * campaign mới có tự kiểm. Mọi nơi quyết định (luật tự động, nhận định, lãi ước tính, API) phải coi hòa vốn có
   * checkProblem như CHƯA CÓ hòa vốn — bất biến B6 của docs/MO-HINH-CAY-SAN-PHAM-SAN.md.
   */
  checkProblem?: string;
}

export interface TiktokBreakevenCheck {
  revenuePlaced: number;
  tiktokGmv: number;
  from: string;
  to: string;
}

// ------------------------------------------------------------
// TỰ KIỂM MẪU SỐ → HÒA VỐN CHƯA TIN ĐƯỢC (Lát 0, 18/10/2026 — docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 5)
// ------------------------------------------------------------
//
// Doanh thu MỌI đơn đặt Hubsell thấy trên tập SKU của chiến dịch phải xấp xỉ doanh thu TikTok báo cho cùng sản phẩm,
// cùng khoảng ngày. Lệch nhiều là CÂY SẢN PHẨM Hubsell dựng cho chiến dịch không khớp sàn, hai chiều đều hỏng:
//   · Hubsell THIẾU: dòng đơn chưa nối đúng lá (đơn cũ mang mã thô sau khi mã đổi đuôi — TC025 NEW 18/10: 15,4tr so
//     với 60,0tr, hòa vốn báo 8,90 trong khi đủ đơn là 7,10);
//   · Hubsell THỪA: mã người bán dùng chung nhiều sản phẩm kéo đơn của sản phẩm khác vào.
// Khi đó biên lãi là của một tập đơn khác tập TikTok tính ROI → không được dùng để quyết định (loại video, nấc hạ, lãi
// ước tính). Thà không có số còn hơn số sai.

/** % lệch có dấu = (Hubsell − TikTok) ÷ TikTok × 100; null khi TikTok chưa báo doanh thu (không có gì để so). Thuần. */
export function breakevenCheckGapPct(check: TiktokBreakevenCheck | null | undefined): number | null {
  if (!check || !(check.tiktokGmv > 0)) return null;
  return ((check.revenuePlaced - check.tiktokGmv) / check.tiktokGmv) * 100;
}

/** Lý do hòa vốn chưa tin được theo tự kiểm; "" = ổn hoặc không có gì để so. Thuần. */
export function breakevenCheckProblem(check: TiktokBreakevenCheck | null | undefined): string {
  const gap = breakevenCheckGapPct(check);
  if (gap == null || Math.abs(gap) <= BREAKEVEN_CHECK_MAX_GAP_PCT) return "";
  const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
  const pct = Math.abs(Math.round(gap));
  const c = check as TiktokBreakevenCheck;
  return gap < 0
    ? `doanh thu Hubsell thấy cho sản phẩm của chiến dịch thấp hơn TikTok báo ${pct}% (${vnd(c.revenuePlaced)} so với ${vnd(c.tiktokGmv)}) — dòng đơn chưa nối đúng sản phẩm, hòa vốn chưa tin được`
    : `doanh thu Hubsell thấy cho sản phẩm của chiến dịch cao hơn TikTok báo ${pct}% (${vnd(c.revenuePlaced)} so với ${vnd(c.tiktokGmv)}) — mã SKU đang gom cả đơn của sản phẩm khác, hòa vốn chưa tin được`;
}

/** Từ nguyên liệu → kết quả hòa vốn. Thuần. */
export function toTiktokBreakeven(base: BreakevenBase, source: "campaign" | "shop" | "product"): TiktokBreakeven {
  const scoped = base.revenue + base.missingCostRevenue;
  const common = {
    cancelledOrders: base.cancelledOrders,
    pendingOrders: base.pendingOrders,
    costCoveragePct: scoped > 0 ? Math.round((base.revenue / scoped) * 100) : null,
    check: null,
  };
  if (base.settledOrders === 0 || base.revenue <= 0) {
    return { breakevenRoi: null, margin: null, negativeMargin: false, source: null, orders: 0, ...common };
  }
  const margin = base.profitBeforeAds / base.revenue;
  return {
    breakevenRoi: margin > 0 ? 1 / margin : null,
    margin,
    negativeMargin: margin <= 0,
    source,
    orders: base.settledOrders,
    ...common,
  };
}

// ------------------------------------------------------------
// Lãi/lỗ ước tính của một chiến dịch trong kỳ xem (cột "Lãi/lỗ ước tính", 12/10/2026 — khách xin giống Shopee)
// ------------------------------------------------------------
//
//   lãi ước tính = doanh thu GMV Max × biên lãi TRƯỚC quảng cáo − chi phí quảng cáo
//
// Cùng rổ số với "ROI thực" (doanh thu ÷ chi phí): ROI trên hòa vốn thì số dương, dưới thì âm, đổi dấu đúng tại hòa vốn.
// Không trừ ads hai lần: phí GMV Max sàn trừ trong quyết toán đơn đã được cộng ngược khi tính biên lãi.
// Là ƯỚC TÍNH vì: biên lãi lấy từ đơn ĐÃ ĐỐI SOÁT 60 ngày (lứa cũ) áp vào doanh thu kỳ xem (đơn chưa đối soát); doanh thu
// GMV Max gồm cả đơn tự nhiên của sản phẩm trong chiến dịch (định nghĩa của TikTok) nên đây là lãi của SẢN PHẨM sau quảng
// cáo, không phải phần lãi "quảng cáo đẻ thêm". ★ Mẫu số (gross_revenue có rút đơn hủy hay không) vẫn là giả định chưa kiểm
// bằng số prod — dòng "Đối chiếu doanh thu" trong ô Hòa vốn là chỗ kiểm (docs/ADS-TIKTOK-GMV-MAX.md mục 8).
// Biên lãi ≤ 0 ("lỗ sẵn") vẫn tính: ra số âm sâu hơn cả tiền ads, đúng với thực tế bán đã lỗ trước quảng cáo.

/**
 * Lãi/lỗ ước tính; null khi chưa có biên lãi (chiến dịch lẫn gian đều chưa đủ đơn đã đối soát có giá vốn) hoặc biên lãi
 * chưa tin được vì tự kiểm lệch (checkProblem — 18/10/2026). Thuần.
 */
export function tiktokEstProfit(
  gmv: number,
  spend: number,
  breakeven: Pick<TiktokBreakeven, "margin" | "checkProblem"> | null | undefined
): number | null {
  const margin = breakeven?.margin;
  if (margin == null || !Number.isFinite(margin) || breakeven?.checkProblem) return null;
  return gmv * margin - spend;
}

/** Doanh thu MỌI đơn đặt (kể cả hủy / đang giao) trên tập SKU, ngày tạo (giờ VN) trong [from, to] — để so với doanh thu TikTok báo. Thuần. */
export function placedRevenue(rows: BreakevenPnlRow[], skuSet: ReadonlySet<string>, from: string, to: string): number {
  // Một luật cho hai sàn (Lát 4): lib/ads-margin placedRevenueOf.
  return placedRevenueOf(rows, skuSet, from, to);
}

/** Đà bán của một nhóm SKU: số sản phẩm bán ra 7 ngày và 30 ngày gần nhất + doanh thu 30 ngày (mọi đơn đặt trừ hủy). */
export interface TiktokSalesPace {
  units7d: number;
  units30d: number;
  /**
   * Doanh thu 30 ngày của nhóm trên MỌI đơn đặt trừ đơn hủy (kể cả chưa đối soát) — cùng cách chia theo tỷ trọng giá trị hàng
   * với placedRevenue. Là "GMV lịch sử" của công thức ngân sách TikTok (ngân sách = 2 × GMV ÷ ROI mục tiêu — product-run-advice.ts).
   */
  revenue30d: number;
}

/** Hai mốc lùi của đà bán, tính từ lúc tính. */
export const TIKTOK_PACE_RECENT_MS = 7 * 86_400_000;
export const TIKTOK_PACE_WINDOW_MS = 30 * 86_400_000;

/**
 * ĐÀ BÁN từng nhóm SKU: số sản phẩm bán ra 7 ngày và 30 ngày gần nhất, tính trên MỌI đơn đặt trừ đơn hủy (đây là nhịp bán,
 * không phải lãi — không cần chờ đối soát). Thuần.
 */
export function salesPaceByGroup(rows: BreakevenPnlRow[], groupOfKey: ReadonlyMap<string, string>, now: Date): Map<string, TiktokSalesPace> {
  const out = new Map<string, TiktokSalesPace>();
  const t7 = now.getTime() - TIKTOK_PACE_RECENT_MS;
  const t30 = now.getTime() - TIKTOK_PACE_WINDOW_MS;
  for (const row of rows) {
    if (isCancelled(row)) continue;
    const t = row.createdAt.getTime();
    if (t < t30 || t > now.getTime()) continue;
    // Doanh thu chia cho từng dòng hàng theo tỷ trọng giá trị hàng — đúng luật của placedRevenue và cột actualRevenue của sổ dòng hàng.
    const itemTotal = row.items.reduce((s, it) => s + it.price * it.quantity, 0);
    for (const it of row.items) {
      const g = groupOfKey.get(lineGroupKey(it));
      if (g == null) continue;
      let cur = out.get(g);
      if (!cur) out.set(g, (cur = { units7d: 0, units30d: 0, revenue30d: 0 }));
      cur.units30d += it.quantity;
      if (t >= t7) cur.units7d += it.quantity;
      if (itemTotal > 0) cur.revenue30d += row.actualRevenue * ((it.price * it.quantity) / itemTotal);
    }
  }
  return out;
}

// ------------------------------------------------------------
// Bộ nhóm của một gian TikTok + khoảng ngày tự kiểm của từng chiến dịch
// ------------------------------------------------------------
//
// Bộ nhóm dùng chung khuôn với Shopee/Lazada (lib/ads-margin.ts): nhóm toàn gian
// SHOP_GROUP, mỗi chiến dịch campaignGroupKey(AdsCampaign.id), mỗi sản phẩm
// productGroupKey(product id) — externalId TikTok = "productId-skuId", productId
// chính là item_group_id của report GMV Max.

/**
 * Khoảng ngày (ngày sàn, giờ VN) của phép tự kiểm mẫu số: mỗi chiến dịch một
 * ngày đầu riêng (ngày đầu Hubsell CÓ số TikTok của chiến dịch), chung ngày cuối
 * (hết hôm qua — hôm nay còn dở). Chiến dịch chưa có số thì không có trong `from`.
 */
export interface TiktokCheckWindows {
  /** campaignGroupKey → "YYYY-MM-DD" ngày đầu. */
  from: ReadonlyMap<string, string>;
  /** "YYYY-MM-DD" ngày cuối, chung mọi chiến dịch. */
  to: string;
}

/** Phép tự kiểm của một chiến dịch: ngày đầu Hubsell có số TikTok + doanh thu TikTok báo từ ngày đó tới hết `to`. */
export interface TiktokCampaignCheck {
  from: string;
  tiktokGmv: number;
}

/** Từ số quảng cáo theo ngày đã lưu của một chiến dịch (ngày sàn "YYYY-MM-DD") → phép tự kiểm tới hết `to`; null = chưa có ngày nào. Thuần. */
export function tiktokCampaignCheckOf(perf: Iterable<{ day: string; gmv: number }>, to: string): TiktokCampaignCheck | null {
  let from = "";
  let tiktokGmv = 0;
  for (const p of perf) {
    if (p.day > to) continue;
    if (from === "" || p.day < from) from = p.day;
    tiktokGmv += p.gmv;
  }
  return from ? { from, tiktokGmv } : null;
}

/** Bộ nhóm ở dạng gửi được vào câu SQL (LedgerTiktokBreakevenMapping) + dấu vân tay để nhận biết bộ nhóm / khoảng tự kiểm đổi. */
export interface TiktokGroupMapping extends LedgerTiktokBreakevenMapping {
  groups: string[];
  keys: string[];
  checkFrom: string[];
  digest: string;
}

/** Trải bộ nhóm + khoảng tự kiểm thành mảng song song xếp thứ tự cố định — cùng đầu vào luôn ra cùng `digest`. */
export function tiktokGroupMappingOf(sets: AdsGroupSets, checks: TiktokCheckWindows): TiktokGroupMapping {
  const { groups, keys, digest } = adsGroupMappingOf(sets);
  const hash = createHash("sha1").update(`${digest}\u0002${checks.to}`);
  for (const [group, from] of [...checks.from].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    hash.update(`\u0002${group}\u0000${from}`);
  }
  return {
    groups,
    keys,
    checkFrom: groups.map((g) => checks.from.get(g) ?? ""),
    checkTo: checks.to,
    digest: hash.digest("hex"),
  };
}

// ------------------------------------------------------------
// Mặt tiền chung của hai đường cộng
// ------------------------------------------------------------

/** Nguyên liệu hòa vốn + tự kiểm + đà bán của mọi nhóm của một gian — cùng mặt tiền cho hai đường cộng. */
export interface ChannelBreakevens {
  /** SHOP_GROUP, campaignGroupKey(...) hoặc productGroupKey(...). Nhóm không có đơn → toàn 0. */
  base(groupKey: string): BreakevenBase;
  /** Tự kiểm mẫu số của một chiến dịch: doanh thu mọi đơn đặt của nhóm trong khoảng ngày riêng của nó (0 = không có khoảng). */
  placedRevenue(groupKey: string): number;
  /** Theo product id; chỉ sản phẩm có dòng hàng CÓ GIÁ trong cửa sổ (kể cả đơn chưa đối soát). */
  productBases(): Map<string, BreakevenBase>;
  /** Theo product id; sản phẩm không bán được gì trong 30 ngày có thể vắng mặt hoặc mang số 0. */
  productPace(): Map<string, TiktokSalesPace>;
}

const EMPTY_BREAKEVEN_BASE: BreakevenBase = Object.freeze(emptyBreakevenBase());

/**
 * Khóa dòng hàng → product id, từ các nhóm sản phẩm của bộ nhóm: "i:<itemId>" là chính sản phẩm đó; mã SKU sàn chỉ thuộc
 * một sản phẩm (ChannelProduct unique theo gian + SKU).
 */
function productOfKey(sets: AdsGroupSets): Map<string, string> {
  const out = new Map<string, string>();
  for (const [groupKey, keys] of sets) {
    if (!groupKey.startsWith(PRODUCT_GROUP_PREFIX)) continue;
    const productId = groupKey.slice(PRODUCT_GROUP_PREFIX.length);
    for (const key of keys) out.set(key, productId);
  }
  return out;
}

/** Đường "rows": cộng trên mảng MỌI đơn của gian trong cửa sổ. `nowMs` = mốc "bây giờ" của đà bán. */
export function breakevensFromRows(
  rows: BreakevenPnlRow[],
  sets: AdsGroupSets,
  checks: TiktokCheckWindows,
  nowMs: number = Date.now()
): ChannelBreakevens {
  return {
    base(groupKey) {
      if (groupKey === SHOP_GROUP) return tiktokBreakevenBase(rows, null);
      const skus = sets.get(groupKey);
      return skus && skus.size > 0 ? tiktokBreakevenBase(rows, skus) : EMPTY_BREAKEVEN_BASE;
    },
    placedRevenue(groupKey) {
      const from = checks.from.get(groupKey);
      const skus = sets.get(groupKey);
      return from && skus && skus.size > 0 ? placedRevenue(rows, skus, from, checks.to) : 0;
    },
    productBases: () => tiktokBreakevenBaseByGroup(rows, productOfKey(sets)),
    productPace: () => salesPaceByGroup(rows, productOfKey(sets), new Date(nowMs)),
  };
}

// ------------------------------------------------------------
// Đường "sql": hợp đồng với câu gom trong database (services/order-ledger.ts)
// ------------------------------------------------------------

/** Tổng của MỘT nhóm SKU trong cửa sổ, do câu gom trả về. */
export interface LedgerTiktokBreakevenGroup extends BreakevenBase, TiktokSalesPace {
  /** Nhóm có ít nhất một dòng hàng CÓ GIÁ trong cửa sổ (đường "rows" chỉ liệt kê sản phẩm như vậy). */
  hasPaid: boolean;
  /** Doanh thu mọi đơn đặt của nhóm trong khoảng tự kiểm của nhóm (0 = nhóm không tự kiểm). */
  placedRevenue: number;
}

/** Ba mảng song song (nhóm, khóa dòng hàng "i:<itemId>" | mã SKU thô, ngày đầu tự kiểm của nhóm); một khóa được thuộc nhiều nhóm. */
export interface LedgerTiktokBreakevenMapping {
  groups: readonly string[];
  keys: readonly string[];
  /** "YYYY-MM-DD" ngày đầu tự kiểm của nhóm ở cùng vị trí ("" = nhóm không tự kiểm). */
  checkFrom: readonly string[];
  /** "YYYY-MM-DD" ngày cuối tự kiểm, chung mọi nhóm. */
  checkTo: string;
}

export interface LedgerTiktokBreakevenOptions {
  /** Mốc "bây giờ" của đà bán: tính lùi 7 và 30 ngày từ đây. */
  paceNow: Date;
}

/** Đường "sql": tra trong kết quả đã gom sẵn. */
export function breakevensFromGroups(groups: ReadonlyMap<string, LedgerTiktokBreakevenGroup>): ChannelBreakevens {
  const products = function* () {
    for (const [groupKey, g] of groups) {
      if (groupKey.startsWith(PRODUCT_GROUP_PREFIX)) yield [groupKey.slice(PRODUCT_GROUP_PREFIX.length), g] as const;
    }
  };
  const baseOf = (g: LedgerTiktokBreakevenGroup): BreakevenBase => ({
    settledOrders: g.settledOrders,
    cancelledOrders: g.cancelledOrders,
    revenue: g.revenue,
    profitBeforeAds: g.profitBeforeAds,
    adFee: g.adFee,
    missingCostRevenue: g.missingCostRevenue,
    pendingOrders: g.pendingOrders,
  });
  return {
    base(groupKey) {
      const g = groups.get(groupKey);
      return g ? baseOf(g) : EMPTY_BREAKEVEN_BASE;
    },
    placedRevenue: (groupKey) => groups.get(groupKey)?.placedRevenue ?? 0,
    productBases() {
      const out = new Map<string, BreakevenBase>();
      for (const [productId, g] of products()) if (g.hasPaid) out.set(productId, baseOf(g));
      return out;
    },
    productPace() {
      const out = new Map<string, TiktokSalesPace>();
      for (const [productId, g] of products()) out.set(productId, { units7d: g.units7d, units30d: g.units30d, revenue30d: g.revenue30d });
      return out;
    },
  };
}
