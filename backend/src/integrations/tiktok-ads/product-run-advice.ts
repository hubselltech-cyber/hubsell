// ============================================================
// TIKTOK ADS — NHẬN ĐỊNH "NÊN CHẠY / CHẠY THỬ / CHƯA NÊN" cho sản phẩm CHƯA chạy quảng cáo (thuần, không đụng DB / sàn)
//
// Anh Trung 19/09/2026 xem tab Hòa vốn sản phẩm: sản phẩm chưa chạy chỉ ghi "Đã có mốc hòa vốn" — có mốc rồi thì phải nói
// luôn nên chạy hay không, như tab Gợi ý chạy ads của Shopee. Chỉ chấm khi hòa vốn của sản phẩm ĐÃ TIN ĐƯỢC (dòng "ok": đủ
// đơn đã đối soát + đủ giá vốn); các dòng khác giữ nhận định cũ (Thiếu giá vốn, Ít đơn, Lỗ trước quảng cáo…).
//
// ★ 15/10/2026 — LÀM LẠI ROI MỤC TIÊU + THÊM NGÂN SÁCH (anh Trung: "chạy theo đề xuất hiện tại thì chỉ có hòa vốn hoặc lãi rất
// mỏng"; khảo sát + nguồn nguyên văn ở docs/ADS-KHAO-SAT-ROI-MUC-TIEU-NGAN-SACH.md). Bản cũ đặt mục tiêu = hòa vốn × 1,1 — 1,1 là
// hệ số VÙNG VÀNG của luật rà Shopee (dưới đó là nguy hiểm), không phải mức nên đặt; và lấy sàn làm đích là mời TikTok kéo ROI
// từ mức gian đang đạt xuống sát hòa vốn (TikTok: "ROI thấp hơn giúp tăng phân phối, mục tiêu cao hơn hạn chế chi tiêu"). Nay:
//   · SÀN GIỮ LÃI  = 1 ÷ (biên − lãi muốn giữ/100) — profitFloorRoas, cùng cấu hình AdsAssistantConfig.profit với Shopee (anh chốt
//                    08/10; mặc định 5đ/100đ là MẶC ĐỊNH TỰ CHỌN, khách sửa được); không bao giờ dưới hòa vốn.
//   · MỐC ĐANG ĐẠT = ROI GMV Max của gian 30 ngày (GMV ÷ chi phí) — đúng "ROI khuyến nghị = GMV trước đây ÷ chi phí quảng cáo
//                    trước đây" của TikTok (Best practices for Product GMV Max, 06/2026). Gian chưa tiêu đủ (minHistorySpend) → chưa có mốc.
//   · QUY VỀ BIÊN CỦA TỪNG SẢN PHẨM (anh Trung 15/10 đêm: "ROI mục tiêu của tất cả các chiến dịch đều giống nhau thì giá trị của
//                    công cụ giảm đi rất nhiều — hòa vốn khác nhau mà đề xuất giống nhau là chưa ổn"): mốc của gian là ROI trộn của
//                    CÁC SẢN PHẨM ĐANG QUẢNG CÁO, ứng với biên lãi của chính chúng (anchorMargin). Cái giữ nguyên khi chuyển sang sản
//                    phẩm khác không phải con số ROI mà là TỶ LỆ TIỀN QUẢNG CÁO TRÊN BIÊN LÃI: k = (1 ÷ ROI gian) ÷ biên đang quảng cáo
//                    (ANO: 1/12,85 ÷ 17,5% ≈ 44% biên lãi đi vào quảng cáo). Áp cùng k cho sản phẩm biên m → ROI = 1 ÷ (k × m) =
//                    ROI gian × biên đang quảng cáo ÷ m: biên thấp → ROI cao hơn, biên cao → được đặt thấp hơn. Đây là cách đặt
//                    "ACoS mục tiêu = một phần của biên lãi" của giới Amazon (Perpetua: Target ACoS = margin − target profit margin)
//                    và đúng ý DataGlass Labs: "Target ROAS should not be the same for every product… split the catalogue into
//                    margin bands". Không có biên đang quảng cáo (chiến dịch chưa biết SKU / chưa đủ đơn) → mượn biên toàn gian;
//                    không có nốt → dùng thẳng ROI gian (ghi rõ).
//   · KHỞI ĐIỂM    = max(sàn giữ lãi, ROI quy về biên × RUN_ADVICE_ANCHOR_FACTOR) — TikTok: "theo ROI khuyến nghị hoặc đặt thấp hơn
//                    một chút"; 0,9 là MẶC ĐỊNH TỰ CHỌN, mượn mốc 90% mục tiêu của chính TikTok (ROI protection / tự tăng ngân sách).
//                    Chưa có mốc → khởi điểm = sàn giữ lãi, nhắc khách dùng ROI gợi ý trong Seller Center (TikTok: "không có dữ liệu
//                    thì dùng ROI và ngân sách khuyến nghị ở giao diện hệ thống").
//   · NGÂN SÁCH    = 2 × GMV ngày của sản phẩm ÷ ROI khởi điểm — công thức CHÍNH THỨC của TikTok ("Ngân sách khuyến nghị = 2 × GMV
//                    trước đây ÷ mục tiêu ROI"); GMV ngày = doanh thu 30 ngày mọi đơn đặt trừ hủy ÷ 30. Chặn trần tồn (không bán cạn
//                    tồn trước minCoverDays — luật Shopee đang có); "Chạy thử" chặn thêm trần thử (10% lãi tháng ÷ 7 — luật Shopee,
//                    mặc định tự chọn) rồi lấy một nửa. Sàn RUN_ADVICE_MIN_BUDGET 100.000đ/ngày = mức tối thiểu VND chiến dịch
//                    PRODUCT_SALES theo phụ lục Marketing API (chưa chứng minh riêng cho GMV Max — ghi rõ trong câu).
//   · NHỊP SAU KHI CHẠY (in trong kết luận, cùng luật campaign-advice.ts): giữ mỗi mức ROI 3 ngày trọn (TikTok), tiêu < 80% ngân sách
//                    thì hạ 10%/nấc (anh chốt 04/10), tối đa 1 lần/ngày (hạ quá 1 lần/ngày mất ROI protection — TikTok), lãi tuyệt
//                    đối không tăng sau nấc hạ thì dừng; tiêu ≥ 80% thì tăng ngân sách BUDGET_STEP_PCT.
//
// Ba điều kiện xét (số thật, không chấm điểm 0–100 vì TikTok không cho tín hiệu thị trường theo sản phẩm như Shopee):
//   1. TỒN     — tồn trên sàn ÷ (nhịp bán 30 ngày × 1,5) < 14 ngày → Chưa nên. Hai số 1,5 và 14 lấy ĐÚNG của bộ chấm Shopee
//                (RECOMMEND_THRESHOLDS.adsLiftFactor / minCoverDays) — cùng một khái niệm thì cùng một ngưỡng.
//   2. KHẢ THI — mốc đang đạt của gian so với hòa vốn và sàn giữ lãi của sản phẩm: dưới hòa vốn → Chưa nên; trên hòa vốn nhưng dưới
//                sàn giữ lãi → Chạy thử; biên không đủ giữ mức lãi mong muốn → Chạy thử (nói rõ). Chưa có mốc → cho qua, ghi "chưa có số".
//   3. ĐÀ BÁN  — nhịp 7 ngày ÷ nhịp 30 ngày dưới 0,8 (mốc của Shopee, cũng là mốc chữ "đang chậm lại" ở cột Sản phẩm) → Chạy thử.
// ============================================================

import { RECOMMEND_THRESHOLDS } from "../shopee/ads-recommend";
import { DEFAULT_MIN_KEEP_PER_100, TARGET_STEP_PCT, profitFloorRoas } from "../shopee/ads-assistant-rules";
// Ba mốc của TikTok nằm ở lib/tiktok-breakeven.ts (campaign-advice.ts cũng lấy từ đó) — không import campaign-advice để khỏi vòng
// product-run-advice → campaign-advice → breakeven → product-run-advice.
import {
  TIKTOK_BUDGET_STEP_PCT as BUDGET_STEP_PCT,
  TIKTOK_BUDGET_USED_PCT as BUDGET_USED_PCT,
  TIKTOK_TARGET_STEP_WAIT_HOURS,
} from "../../lib/tiktok-breakeven";

/** "Thấp hơn một chút" so với mốc đang đạt (TikTok không nêu %) — MẶC ĐỊNH TỰ CHỌN, đối xứng mốc 90% mục tiêu của TikTok. */
export const RUN_ADVICE_ANCHOR_FACTOR = 0.9;
/** Ngân sách = 2 × GMV ÷ ROI mục tiêu — số của TikTok (Best practices for Product GMV Max). */
export const RUN_ADVICE_BUDGET_GMV_MULTIPLIER = 2;
/** Mức tối thiểu VND của chiến dịch PRODUCT_SALES theo phụ lục Marketing API; GMV Max chưa có trang riêng. */
export const RUN_ADVICE_MIN_BUDGET = 100_000;
export const RUN_ADVICE_PACE_SLOW = 0.8;
export const RUN_ADVICE_PACE_UP = 1.2;

export type ProductRunTier = "run" | "test" | "not_yet";

export interface ProductRunAdviceInput {
  /** Biên lãi trước quảng cáo + ROI hòa vốn của CHÍNH sản phẩm (đã tin được). */
  margin: number;
  breakevenRoi: number;
  units7d: number;
  units30d: number;
  /** Doanh thu 30 ngày mọi đơn đặt trừ hủy (GMV lịch sử của sản phẩm). */
  revenue30d: number;
  /** Tồn trên sàn; null = Hubsell chưa đọc được. */
  stock: number | null;
  /** Quảng cáo GMV Max của cả gian 30 ngày gần nhất (số TikTok báo). */
  shopAdsSpend30d: number;
  shopAdsGmv30d: number;
  /**
   * Biên lãi trước quảng cáo của CÁC SẢN PHẨM ĐANG QUẢNG CÁO (SKU của những chiến dịch có tiêu tiền trong 30 ngày, đơn đã đối soát);
   * không có thì biên toàn gian; null = không biết → không quy về biên, dùng thẳng ROI gian.
   */
  anchorMargin?: number | null;
  /** Lãi tối thiểu muốn giữ sau quảng cáo (đ/100đ doanh thu) — cấu hình gian; bỏ trống = mặc định. */
  minKeepPer100?: number;
}

/** Một ĐIỀU KIỆN đã xét: đạt / cần dè chừng / không đạt / chưa có số — ô lý do in từng điều kiện kèm số thật và mốc so sánh. */
export interface ProductRunCheck {
  key: "feasible" | "pace" | "stock";
  title: string;
  /** pass = đạt · caution = kéo xuống Chạy thử · block = kéo xuống Chưa nên · unknown = chưa có số, không tính vào kết luận. */
  status: "pass" | "caution" | "block" | "unknown";
  /** Số thật + mốc so sánh + vì sao đạt / không đạt. */
  text: string;
}

export interface ProductRunBudget {
  /** Ngân sách ngày đề xuất (đã chặn trần, nâng lên sàn tối thiểu, làm tròn 10.000). */
  daily: number;
  /** Số theo công thức TikTok trước khi chặn; null = sản phẩm chưa có doanh thu 30 ngày. */
  byTiktok: number | null;
  /** Cách ra số, mỗi ý một câu. */
  note: string;
}

export interface ProductRunAdvice {
  tier: ProductRunTier;
  label: string;
  tone: "warn" | "info" | "ok";
  /** Dữ kiện nền (biên lãi, hòa vốn, sàn giữ lãi, mốc đang đạt, khởi điểm), mỗi ý một dòng. */
  points: string[];
  /** CĂN CỨ của kết luận (anh Trung 19/09: ô lý do phải rõ tại sao nên, tại sao chưa nên) — từng điều kiện đạt hay không, vì số nào. */
  checks: ProductRunCheck[];
  conclusion: string;
  text: string;
  /** ROI mục tiêu KHỞI ĐIỂM khi tạo chiến dịch = max(sàn giữ lãi, mốc đang đạt × 0,9), làm tròn LÊN 0,1. */
  suggestedRoi: number;
  /** Sàn giữ lãi: không đặt ROI mục tiêu dưới mức này (1 ÷ (biên − lãi muốn giữ)); không dưới hòa vốn. */
  floorRoi: number;
  /** Lãi muốn giữ (đ/100đ) đã dùng để tính floorRoi. */
  minKeepPer100: number;
  /** Mốc đang đạt: ROI GMV Max của gian 30 ngày; null = gian chưa có đủ số. */
  anchorRoi: number | null;
  /** Biên lãi các sản phẩm đang quảng cáo đã dùng để quy mốc về biên của sản phẩm này; null = không quy (dùng thẳng ROI gian). */
  anchorMargin: number | null;
  /** Mốc đã quy về biên của sản phẩm = ROI gian × biên đang quảng cáo ÷ biên sản phẩm (trước khi × 0,9); null = không có mốc. */
  scaledAnchorRoi: number | null;
  /** Ngân sách ngày đề xuất; null khi Chưa nên. */
  budget: ProductRunBudget | null;
}

const LABEL: Record<ProductRunTier, string> = { run: "Nên chạy", test: "Chạy thử", not_yet: "Chưa nên" };
const TONE: Record<ProductRunTier, ProductRunAdvice["tone"]> = { run: "ok", test: "info", not_yet: "warn" };
const FEASIBLE_TITLE = "ROI gian đang đạt so với sàn giữ lãi";
const PACE_TITLE = "Đà bán tự nhiên";
const STOCK_TITLE = "Tồn trên sàn";

const num = (n: number, d = 2) => n.toLocaleString("vi-VN", { maximumFractionDigits: d });
const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
/** Làm tròn LÊN 0,1 — mọi mốc ROI đề xuất không bao giờ thấp hơn số tính ra. */
const ceil1 = (v: number) => Math.ceil(v * 10 - 1e-9) / 10;
const roundK = (v: number) => Math.round(v / 10_000) * 10_000;

/** Lãi sau quảng cáo trên 100đ doanh thu nếu đạt ĐÚNG một mức ROI (cùng số học với breakeven.ts profitPer100AtRoi). */
const keepAt = (margin: number, roi: number) => Math.round((margin - 1 / roi) * 1000) / 10;

export function productRunAdvice(i: ProductRunAdviceInput): ProductRunAdvice {
  const T = RECOMMEND_THRESHOLDS;
  const minKeepPer100 = i.minKeepPer100 ?? DEFAULT_MIN_KEEP_PER_100;
  const be = num(i.breakevenRoi);

  // SÀN GIỮ LÃI — biên không đủ cho mức lãi muốn giữ → sàn rơi về hòa vốn, điều kiện Khả thi sẽ nói rõ.
  const profitFloor = profitFloorRoas(i.margin, minKeepPer100);
  const floorRoi = profitFloor != null ? Math.max(profitFloor, ceil1(i.breakevenRoi)) : ceil1(i.breakevenRoi);
  const floor = num(floorRoi, 1);

  // MỐC ĐANG ĐẠT — ROI quảng cáo thật của chính gian 30 ngày (GMV ÷ chi phí, số TikTok báo).
  const anchorRoi = i.shopAdsSpend30d >= T.minHistorySpend && i.shopAdsGmv30d > 0 ? i.shopAdsGmv30d / i.shopAdsSpend30d : null;

  // QUY MỐC VỀ BIÊN CỦA SẢN PHẨM — giữ cùng tỷ lệ tiền quảng cáo trên biên lãi mà gian đang đạt (xem đầu tệp).
  const anchorMargin = i.anchorMargin != null && i.anchorMargin > 0 && i.margin > 0 ? i.anchorMargin : null;
  const scaledAnchorRoi = anchorRoi != null ? (anchorMargin != null ? (anchorRoi * anchorMargin) / i.margin : anchorRoi) : null;
  /** Phần biên lãi đang đi vào quảng cáo ở mức gian đang đạt (ANO ≈ 44%). */
  const adsShareOfMargin = anchorRoi != null && anchorMargin != null ? 1 / anchorRoi / anchorMargin : null;

  // KHỞI ĐIỂM — thấp hơn mốc (đã quy về biên) một chút, không thủng sàn.
  const anchorStart = scaledAnchorRoi != null ? ceil1(scaledAnchorRoi * RUN_ADVICE_ANCHOR_FACTOR) : null;
  const suggestedRoi = anchorStart != null ? Math.max(floorRoi, anchorStart) : floorRoi;
  const start = num(suggestedRoi, 1);

  const anchorLine = (): string => {
    if (anchorRoi == null || scaledAnchorRoi == null || anchorStart == null) {
      return `Gian chưa có đủ số quảng cáo GMV Max 30 ngày để làm mốc → khởi điểm lấy sàn giữ lãi ${start}; TikTok khuyên dùng ROI gợi ý hiện trong Seller Center khi tạo chiến dịch, nhưng không đặt dưới ${start}.`;
    }
    const scaling =
      anchorMargin != null && adsShareOfMargin != null
        ? `Gian đang đạt ROI ${num(anchorRoi)} (GMV Max 30 ngày qua) trên các sản phẩm biên lãi ${num(anchorMargin * 100, 1)}%, tức khoảng ${num(adsShareOfMargin * 100, 0)}% biên lãi đi vào quảng cáo. ` +
          `Giữ cùng tỷ lệ đó cho sản phẩm này (biên ${num(i.margin * 100, 1)}%) → ROI ${num(scaledAnchorRoi, 1)}`
        : `Gian đang đạt ROI ${num(anchorRoi)} (GMV Max 30 ngày qua; chưa biết biên lãi các sản phẩm đang quảng cáo nên chưa quy về biên của sản phẩm này)`;
    const pick =
      floorRoi > anchorStart
        ? `× ${num(RUN_ADVICE_ANCHOR_FACTOR)} = ${num(anchorStart, 1)} thấp hơn sàn giữ lãi nên khởi điểm lấy sàn ${start}`
        : `× ${num(RUN_ADVICE_ANCHOR_FACTOR)} (TikTok khuyên theo ROI đang đạt hoặc thấp hơn một chút) → ROI mục tiêu khởi điểm ${start}`;
    return `${scaling} ${pick}: đạt đúng mức này thì mỗi 100đ doanh thu còn lãi khoảng ${num(keepAt(i.margin, suggestedRoi), 1)}đ.`;
  };

  const points: string[] = [
    `Biên lãi trước quảng cáo ${num(i.margin * 100, 1)}% → ROI hòa vốn ${be}. ` +
      (profitFloor != null
        ? `Sàn giữ lãi ${floor}: không đặt ROI mục tiêu dưới mức này thì mỗi 100đ doanh thu còn giữ từ ${minKeepPer100}đ lãi sau quảng cáo.`
        : `Biên lãi không đủ để giữ ${minKeepPer100}đ/100đ sau quảng cáo — sàn chỉ còn là hòa vốn ${floor}.`),
    anchorLine(),
  ];
  const checks: ProductRunCheck[] = [];

  // KHẢ THI — mốc đang đạt của gian so với hòa vốn / sàn giữ lãi của sản phẩm.
  const shopLine = anchorRoi != null ? `Quảng cáo GMV Max của gian 30 ngày qua đạt ROI ${num(anchorRoi)}` : "";
  if (anchorRoi == null) {
    checks.push({ key: "feasible", title: FEASIBLE_TITLE, status: "unknown", text: "Gian chưa có đủ số quảng cáo GMV Max 30 ngày để so — điều kiện này chưa xét được." });
  } else if (anchorRoi < i.breakevenRoi) {
    checks.push({
      key: "feasible",
      title: FEASIBLE_TITLE,
      status: "block",
      text: `${shopLine}, THẤP hơn hòa vốn ${be} của sản phẩm này — chạy ở mức gian đang đạt thì quảng cáo ăn vào vốn. Cần tăng biên lãi (giá bán, giá vốn, phí) trước.`,
    });
  } else if (profitFloor == null) {
    checks.push({
      key: "feasible",
      title: FEASIBLE_TITLE,
      status: "caution",
      text: `${shopLine}, trên hòa vốn ${be}, nhưng biên lãi ${num(i.margin * 100, 1)}% không đủ giữ ${minKeepPer100}đ/100đ sau quảng cáo — chạy thì chỉ hơn hòa vốn chút ít, lệch nhẹ là lỗ.`,
    });
  } else if (anchorRoi < floorRoi) {
    checks.push({
      key: "feasible",
      title: FEASIBLE_TITLE,
      status: "caution",
      text: `${shopLine}: trên hòa vốn ${be} nhưng chưa tới sàn giữ lãi ${floor} (giữ ${minKeepPer100}đ/100đ) — lãi mỏng, lệch nhẹ là lỗ.`,
    });
  } else {
    checks.push({
      key: "feasible",
      title: FEASIBLE_TITLE,
      status: "pass",
      text: `${shopLine}, cao hơn sàn giữ lãi ${floor} của sản phẩm — giữ được mức gian đang đạt là có lãi từ ${minKeepPer100}đ/100đ.`,
    });
  }

  // ĐÀ BÁN — nhịp 7 ngày so với nhịp 30 ngày.
  const pace = i.units30d > 0 ? i.units7d / 7 / (i.units30d / 30) : null;
  const sold = `Bán ${num(i.units7d, 0)} sản phẩm trong 7 ngày / ${num(i.units30d, 0)} trong 30 ngày`;
  if (pace == null) {
    checks.push({ key: "pace", title: PACE_TITLE, status: "caution", text: "30 ngày gần nhất không bán được sản phẩm nào — chưa có sức bán tự nhiên để quảng cáo đẩy thêm." });
  } else if (pace <= RUN_ADVICE_PACE_SLOW) {
    checks.push({
      key: "pace",
      title: PACE_TITLE,
      status: "caution",
      text: `${sold}: nhịp 7 ngày chỉ bằng ${num(pace)} lần nhịp 30 ngày (từ ${num(RUN_ADVICE_PACE_SLOW)} trở xuống là đang chậm lại).`,
    });
  } else {
    checks.push({
      key: "pace",
      title: PACE_TITLE,
      status: "pass",
      text: `${sold}: nhịp 7 ngày bằng ${num(pace)} lần nhịp 30 ngày — ${pace >= RUN_ADVICE_PACE_UP ? "đang lên" : "bán đều"} (trên ${num(RUN_ADVICE_PACE_SLOW)} là đạt).`,
    });
  }

  // TỒN — quảng cáo đẩy lượng gấp rưỡi thì tồn còn đủ bao nhiêu ngày.
  if (i.stock == null) {
    checks.push({ key: "stock", title: STOCK_TITLE, status: "unknown", text: "Hubsell chưa đọc được tồn trên sàn của sản phẩm — tự kiểm tồn trước khi chạy." });
  } else if (i.stock <= 0) {
    checks.push({ key: "stock", title: STOCK_TITLE, status: "block", text: "Tồn trên sàn đang là 0 — chạy quảng cáo lúc hết hàng là mất tiền. Nhập hàng trước." });
  } else if (i.units30d > 0) {
    const cover = Math.floor(i.stock / ((i.units30d / 30) * T.adsLiftFactor));
    const ok = cover >= T.minCoverDays;
    checks.push({
      key: "stock",
      title: STOCK_TITLE,
      status: ok ? "pass" : "block",
      text:
        `Tồn ${num(i.stock, 0)}: nếu quảng cáo đẩy lượng bán gấp ${num(T.adsLiftFactor)} thì đủ khoảng ${num(cover, 0)} ngày ` +
        (ok ? `(cần từ ${T.minCoverDays} ngày).` : `— KHÔNG đủ ${T.minCoverDays} ngày, dễ hết hàng giữa chừng. Nhập thêm hàng trước.`),
    });
  } else {
    checks.push({ key: "stock", title: STOCK_TITLE, status: "pass", text: `Tồn ${num(i.stock, 0)} — còn hàng để bán.` });
  }

  const blocks = checks.filter((c) => c.status === "block");
  const cautions = checks.filter((c) => c.status === "caution");
  const unknown = checks.filter((c) => c.status === "unknown");
  const names = (list: ProductRunCheck[]) => list.map((c) => `"${c.title}"`).join(", ");
  const tier: ProductRunTier = blocks.length > 0 ? "not_yet" : cautions.length > 0 ? "test" : "run";

  const budget = tier === "not_yet" ? null : runBudget(i, tier, suggestedRoi);
  const budgetLine = budget ? ` Ngân sách ${vnd(budget.daily)}/ngày.` : "";
  const rhythm =
    `Giữ mỗi mức ROI ${TIKTOK_TARGET_STEP_WAIT_HOURS / 24} ngày trọn; tiêu dưới ${BUDGET_USED_PCT}% ngân sách thì hạ ROI mục tiêu ${Math.round(TARGET_STEP_PCT * 100)}% một nấc ` +
    `(tối đa 1 lần/ngày — hạ nhiều hơn là mất bảo vệ ROI của TikTok ngày đó), lãi không tăng thêm sau nấc hạ thì dừng; ` +
    `tiêu từ ${BUDGET_USED_PCT}% ngân sách mà vẫn đạt ROI thì tăng ngân sách ${Math.round(BUDGET_STEP_PCT * 100)}%.`;
  const conclusion =
    tier === "not_yet"
      ? `Chưa nên chạy vì không đạt ${names(blocks)}. Xử lý xong rồi hãy chạy.`
      : tier === "test"
        ? `Chỉ nên chạy thử ngân sách nhỏ vì còn phải dè chừng ${names(cautions)}. Đặt ROI mục tiêu ${start}, không dưới ${floor}.${budgetLine} ` +
          `ROI thực giữ được trên ${floor} đủ ${TIKTOK_TARGET_STEP_WAIT_HOURS / 24} ngày trọn thì mới tăng ngân sách ${Math.round(BUDGET_STEP_PCT * 100)}% mỗi lần.`
        : `Nên chạy vì ${unknown.length === 0 ? "đạt cả ba điều kiện" : `các điều kiện xét được đều đạt (chưa xét được ${names(unknown)})`}. ` +
          `Tạo chiến dịch GMV Max trong Seller Center với ROI mục tiêu ${start}, không đặt dưới ${floor}.${budgetLine} ${rhythm}`;
  return {
    tier,
    label: LABEL[tier],
    tone: TONE[tier],
    points,
    checks,
    conclusion,
    text: [...points, ...checks.map((c) => c.text), conclusion, budget?.note ?? ""].filter(Boolean).join(" "),
    suggestedRoi,
    floorRoi,
    minKeepPer100,
    anchorRoi,
    anchorMargin,
    scaledAnchorRoi,
    budget,
  };
}

/**
 * Ngân sách ngày đề xuất. Thuần.
 *   theo TikTok = 2 × GMV ngày ÷ ROI khởi điểm (GMV ngày = doanh thu 30 ngày ÷ 30)
 *   trần tồn    = tồn × giá bán TB ÷ ROI ÷ minCoverDays (không bán cạn tồn trước 14 ngày — luật Shopee)
 *   trần thử    = 10% lãi 30 ngày ÷ 7, CHỈ cho Chạy thử (luật Shopee testSpendShareOfProfit); Chạy thử lấy một nửa
 *   sàn         = RUN_ADVICE_MIN_BUDGET, làm tròn 10.000
 * Ở chế độ ROI mục tiêu, ngân sách là TRẦN — TikTok chỉ tiêu khi đạt ROI mục tiêu; thứ quyết định lãi / lỗ là ROI mục tiêu.
 */
export function runBudget(i: ProductRunAdviceInput, tier: Exclude<ProductRunTier, "not_yet">, roi: number): ProductRunBudget {
  const T = RECOMMEND_THRESHOLDS;
  const gmvDay = i.revenue30d > 0 ? i.revenue30d / 30 : 0;
  const byTiktok = gmvDay > 0 ? (RUN_ADVICE_BUDGET_GMV_MULTIPLIER * gmvDay) / roi : null;
  const notes: string[] = [];
  const caps: Array<{ value: number; why: string }> = [];
  const price = i.units30d > 0 && i.revenue30d > 0 ? i.revenue30d / i.units30d : null;
  if (i.stock != null && i.stock > 0 && price != null) {
    caps.push({ value: (i.stock * price) / roi / T.minCoverDays, why: `không bán cạn ${num(i.stock, 0)} tồn trước ${T.minCoverDays} ngày` });
  }
  if (tier === "test") {
    const profit30d = Math.max(0, i.revenue30d * i.margin);
    if (profit30d > 0) {
      caps.push({
        value: (profit30d * T.testSpendShareOfProfit) / 7,
        why: `tiền thử 7 ngày không quá ${Math.round(T.testSpendShareOfProfit * 100)}% lãi tháng của sản phẩm (${vnd(profit30d)})`,
      });
    }
  }
  let budget: number;
  if (byTiktok != null) {
    budget = byTiktok;
    notes.push(`Theo công thức TikTok: ${RUN_ADVICE_BUDGET_GMV_MULTIPLIER} × GMV ngày ${vnd(gmvDay)} ÷ ROI ${num(roi, 1)} = ${vnd(byTiktok)}/ngày.`);
  } else if (caps.length > 0) {
    budget = Math.min(...caps.map((c) => c.value));
    notes.push("Sản phẩm chưa có doanh thu 30 ngày để áp công thức TikTok — lấy theo trần an toàn.");
  } else {
    budget = RUN_ADVICE_MIN_BUDGET;
    notes.push("Sản phẩm chưa có doanh thu 30 ngày để áp công thức TikTok — lấy mức tối thiểu.");
  }
  const binding = caps.filter((c) => c.value < budget).sort((a, b) => a.value - b.value)[0];
  if (binding) {
    budget = binding.value;
    notes.push(`Hubsell hạ xuống để ${binding.why}.`);
  }
  if (tier === "test") {
    budget *= 0.5;
    notes.push("Chạy thử: lấy một nửa.");
  }
  if (budget < RUN_ADVICE_MIN_BUDGET) {
    notes.push(`Nâng lên ${vnd(RUN_ADVICE_MIN_BUDGET)}/ngày — mức tối thiểu của chiến dịch TikTok Shop tại Việt Nam (phụ lục API, GMV Max chưa có mức riêng).`);
    budget = RUN_ADVICE_MIN_BUDGET;
  }
  notes.push("Ngân sách là trần: TikTok chỉ tiêu khi đạt ROI mục tiêu, nên giữ tiêu dưới 80% rồi tăng dần.");
  return { daily: Math.max(roundK(budget), RUN_ADVICE_MIN_BUDGET), byTiktok, note: notes.join(" ") };
}
