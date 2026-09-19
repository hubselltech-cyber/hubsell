// ============================================================
// TIKTOK ADS — NHẬN ĐỊNH "NÊN CHẠY / CHẠY THỬ / CHƯA NÊN" cho sản phẩm CHƯA chạy quảng cáo (thuần, không đụng DB / sàn)
//
// Anh Trung 19/09/2026 xem tab Hòa vốn sản phẩm: sản phẩm chưa chạy chỉ ghi "Đã có mốc hòa vốn" — có mốc rồi thì phải nói
// luôn nên chạy hay không, như tab Gợi ý chạy ads của Shopee. Chỉ chấm khi hòa vốn của sản phẩm ĐÃ TIN ĐƯỢC (dòng "ok": đủ
// đơn đã đối soát + đủ giá vốn); các dòng khác giữ nhận định cũ (Thiếu giá vốn, Ít đơn, Lỗ trước quảng cáo…).
//
// TikTok KHÔNG cho tín hiệu thị trường theo sản phẩm như Shopee (ROI gợi ý của sàn là theo chiến dịch) → không chấm điểm 0–100,
// chỉ xét ba thứ có số thật:
//   1. TỒN     — tồn trên sàn ÷ (nhịp bán 30 ngày × 1,5) < 14 ngày → Chưa nên. Hai số 1,5 và 14 lấy ĐÚNG của bộ chấm Shopee
//                (RECOMMEND_THRESHOLDS.adsLiftFactor / minCoverDays) — cùng một khái niệm thì cùng một ngưỡng.
//   2. KHẢ THI — ROI quảng cáo THẬT của gian 30 ngày (mọi chiến dịch GMV Max, số TikTok báo, đã lưu DB) so với hòa vốn của sản phẩm:
//                thấp hơn hòa vốn → Chưa nên; trên hòa vốn nhưng dưới mức an toàn → Chạy thử. Gian chưa tiêu đủ tiền quảng cáo
//                (dưới minHistorySpend của Shopee) → cho qua, ghi rõ "chưa có số".
//   3. ĐÀ BÁN  — nhịp 7 ngày ÷ nhịp 30 ngày dưới 0,8 (mốc của Shopee, cũng là mốc chữ "đang chậm lại" ở cột Sản phẩm) → Chạy thử.
// Mức an toàn = hòa vốn × 1,1 — MẶC ĐỊNH, cùng hệ số vùng an toàn của Trợ lý Shopee (review.dangerFactor); không phải số của TikTok.
// ============================================================

import { RECOMMEND_THRESHOLDS } from "../shopee/ads-recommend";

export const RUN_ADVICE_SAFE_FACTOR = 1.1;
export const RUN_ADVICE_PACE_SLOW = 0.8;
export const RUN_ADVICE_PACE_UP = 1.2;

export type ProductRunTier = "run" | "test" | "not_yet";

export interface ProductRunAdviceInput {
  /** Biên lãi trước quảng cáo + ROI hòa vốn của CHÍNH sản phẩm (đã tin được). */
  margin: number;
  breakevenRoi: number;
  units7d: number;
  units30d: number;
  /** Tồn trên sàn; null = Hubsell chưa đọc được. */
  stock: number | null;
  /** Quảng cáo GMV Max của cả gian 30 ngày gần nhất (số TikTok báo). */
  shopAdsSpend30d: number;
  shopAdsGmv30d: number;
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

export interface ProductRunAdvice {
  tier: ProductRunTier;
  label: string;
  tone: "warn" | "info" | "ok";
  /** Dữ kiện nền (biên lãi, hòa vốn, mục tiêu đề xuất), mỗi ý một dòng. */
  points: string[];
  /** CĂN CỨ của kết luận (anh Trung 19/09: ô lý do phải rõ tại sao nên, tại sao chưa nên) — từng điều kiện đạt hay không, vì số nào. */
  checks: ProductRunCheck[];
  conclusion: string;
  text: string;
  /** ROI mục tiêu đề xuất khi tạo chiến dịch = hòa vốn × 1,1, làm tròn LÊN 0,1. */
  suggestedRoi: number;
}

const LABEL: Record<ProductRunTier, string> = { run: "Nên chạy", test: "Chạy thử", not_yet: "Chưa nên" };
const TONE: Record<ProductRunTier, ProductRunAdvice["tone"]> = { run: "ok", test: "info", not_yet: "warn" };
const FEASIBLE_TITLE = "ROI gian đang đạt so với hòa vốn";
const PACE_TITLE = "Đà bán tự nhiên";
const STOCK_TITLE = "Tồn trên sàn";

const num = (n: number, d = 2) => n.toLocaleString("vi-VN", { maximumFractionDigits: d });

export function productRunAdvice(i: ProductRunAdviceInput): ProductRunAdvice {
  const T = RECOMMEND_THRESHOLDS;
  const suggestedRoi = Math.ceil(i.breakevenRoi * RUN_ADVICE_SAFE_FACTOR * 10 - 1e-9) / 10;
  const keep = Math.round((i.margin - 1 / suggestedRoi) * 1000) / 10;
  const be = num(i.breakevenRoi);
  const safe = num(suggestedRoi, 1);
  const points: string[] = [
    `Biên lãi trước quảng cáo ${num(i.margin * 100, 1)}% → ROI hòa vốn ${be}.`,
    `ROI mục tiêu đề xuất ${safe} (hòa vốn × ${num(RUN_ADVICE_SAFE_FACTOR)}): đạt đúng mục tiêu thì mỗi 100đ doanh thu còn lãi khoảng ${num(keep, 1)}đ sau quảng cáo.`,
  ];
  const checks: ProductRunCheck[] = [];

  // KHẢ THI — ROI quảng cáo thật của chính gian so với hòa vốn của sản phẩm.
  const shopRoi = i.shopAdsSpend30d >= T.minHistorySpend && i.shopAdsGmv30d > 0 ? i.shopAdsGmv30d / i.shopAdsSpend30d : null;
  const shopLine = shopRoi != null ? `Quảng cáo GMV Max của gian 30 ngày qua đạt ROI ${num(shopRoi)}` : "";
  if (shopRoi == null) {
    checks.push({ key: "feasible", title: FEASIBLE_TITLE, status: "unknown", text: "Gian chưa có đủ số quảng cáo GMV Max 30 ngày để so — điều kiện này chưa xét được." });
  } else if (shopRoi < i.breakevenRoi) {
    checks.push({
      key: "feasible",
      title: FEASIBLE_TITLE,
      status: "block",
      text: `${shopLine}, THẤP hơn hòa vốn ${be} của sản phẩm này — chạy ở mức gian đang đạt thì quảng cáo ăn vào vốn. Cần tăng biên lãi (giá bán, giá vốn, phí) trước.`,
    });
  } else if (shopRoi < suggestedRoi) {
    checks.push({
      key: "feasible",
      title: FEASIBLE_TITLE,
      status: "caution",
      text: `${shopLine}: trên hòa vốn ${be} nhưng chưa tới mức an toàn ${safe} — lãi rất mỏng, lệch nhẹ là lỗ.`,
    });
  } else {
    checks.push({
      key: "feasible",
      title: FEASIBLE_TITLE,
      status: "pass",
      text: `${shopLine}, cao hơn mức an toàn ${safe} của sản phẩm — đạt được mức gian đang đạt là có lãi.`,
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
  const conclusion =
    tier === "not_yet"
      ? `Chưa nên chạy vì không đạt ${names(blocks)}. Xử lý xong rồi hãy chạy.`
      : tier === "test"
        ? `Chỉ nên chạy thử ngân sách nhỏ vì còn phải dè chừng ${names(cautions)}. Đặt ROI mục tiêu từ ${safe}; ROI thực giữ được trên hòa vốn ${be} thì mới nâng ngân sách.`
        : `Nên chạy vì ${unknown.length === 0 ? "đạt cả ba điều kiện" : `các điều kiện xét được đều đạt (chưa xét được ${names(unknown)})`}. Tạo chiến dịch GMV Max trong Seller Center với ROI mục tiêu từ ${safe}, đừng đặt dưới hòa vốn ${be}.`;
  return {
    tier,
    label: LABEL[tier],
    tone: TONE[tier],
    points,
    checks,
    conclusion,
    text: [...points, ...checks.map((c) => c.text), conclusion].join(" "),
    suggestedRoi,
  };
}
