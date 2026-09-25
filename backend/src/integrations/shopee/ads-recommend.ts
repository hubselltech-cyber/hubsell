// ============================================================
// GỢI Ý CHẠY ADS THEO SẢN PHẨM — BỘ CHẤM THUẦN (đợt D, 17/09/2026)
//
// Thiết kế: docs/ADS-SHOPEE-KHAI-THAC-API.md mục 6. Nguyên lý người chạy ads:
//   ROAS = giá trị đơn × tỉ lệ chuyển đổi ÷ giá mỗi click;  lãi = ROAS × biên lãi − 1.
// CTR KHÔNG phải tiêu chí chọn SP (chỉ chẩn đoán sau khi chạy).
//
// Ba tầng:
//   1. CỔNG LOẠI  — trượt một cổng = "Chưa nên", nói rõ vì sao + việc làm trước.
//   2. ĐIỂM 0–100 — dư địa lãi (nặng nhất) · sức chuyển đổi tự nhiên · cầu ·
//                   giá click chịu được · đà bán · lịch sử ads của chính SP.
//   3. ĐỀ XUẤT    — 3 mức ROAS mục tiêu + ngân sách ngày đã chặn trần.
//
// File này KHÔNG đụng DB/sàn — mọi số đi vào qua RecommendInput, vitest đánh thẳng.
// Thiếu tín hiệu thị trường (gian chưa đồng bộ) thì cổng tương ứng CHO QUA kèm ghi
// chú "chưa có số", điểm lấy mức trung tính — không bịa số.
// ============================================================

export type RecommendTier = "run_now" | "test_small" | "not_yet" | "running";

export interface RecommendSignal {
  sale: number | null;
  /** Lượt xem trang SP — probe ANO 17/09: là số THEO KỲ GẦN ĐÂY (SP 870 lượt bán trọn đời mà chỉ
   *  2.464 lượt xem) chứ không phải trọn đời → tỉ lệ chuyển đổi lấy ĐƠN 30 NGÀY của Hubsell ÷ views. */
  views: number | null;
  ratingStar: number | null;
  commentCount: number | null;
  tags: string[]; // "best selling" | "best ROI" | "top search"
  adBlocked: boolean;
  roiLower: number | null;
  roiExact: number | null;
  roiUpper: number | null;
  budgetMin: number | null;
  budgetRecommended: number | null;
  budgetMax: number | null;
  kwSearchVolume: number | null;
  kwAvgBid: number | null;
}

export interface RecommendInput {
  itemId: string;
  price: number;
  /** Biên lãi ròng chưa trừ ads (P&L 30 ngày); null = chưa có đơn khớp. */
  margin: number | null;
  marginOrders: number;
  missingCost: boolean;
  revenue30d: number;
  units30d: number;
  units7d: number;
  /** Tồn có thể bán; null = không rõ (SKU chưa nối kho, sàn không báo). */
  stockAvailable: number | null;
  runningAds: boolean;
  /** Campaign 1-SP của chính item trong 30 ngày. */
  history: { spend30d: number; roas30d: number | null } | null;
  signal: RecommendSignal | null;
  /** Trung vị sale÷views của các SP trong shop (đủ ≥100 lượt xem). */
  shopMedianCvr: number | null;
  /** Hệ số vùng an toàn trong cấu hình Trợ lý (mặc định 1,1). */
  dangerFactor: number;
}

export interface RecommendGate {
  key: "margin" | "feasible" | "stock" | "allowed" | "social";
  ok: boolean;
  /** Câu hiển thị: lý do qua/trượt, có số. */
  text: string;
  /** Trượt thì làm gì trước. */
  todo?: string;
}

export interface RecommendFactor {
  key: "headroom" | "cvr" | "demand" | "cpc" | "momentum" | "history";
  label: string;
  points: number;
  max: number;
  text: string;
}

export interface RecommendProposal {
  /** Đẩy số = mức an toàn · Cân bằng = giữa · Giữ lãi = ROAS thị trường (p50). */
  targets: { push: number; balanced: number; keep: number };
  recommended: "push" | "balanced" | "keep";
  dailyBudget: number;
  budgetNote: string;
  /** Tiền thử tối đa 7 ngày ở ngân sách này. */
  maxTestSpend7d: number;
}

export interface RecommendResult {
  itemId: string;
  tier: RecommendTier;
  score: number;
  breakevenRoas: number | null;
  safeRoas: number | null;
  /** ROAS thị trường (p50) ÷ hòa vốn. */
  headroom: number | null;
  organicCvr: number | null;
  daysOfCover: number | null;
  headline: string;
  gates: RecommendGate[];
  factors: RecommendFactor[];
  proposal: RecommendProposal | null;
}

export const RECOMMEND_THRESHOLDS = {
  minMarginOrders: 5,
  minCoverDays: 14,
  adsLiftFactor: 1.5,
  minReviews: 10,
  minRating: 4.5,
  runNowScore: 70,
  testSmallScore: 45,
  /** Tiền thử 7 ngày ≤ bấy nhiêu phần lãi 30 ngày của SP. */
  testSpendShareOfProfit: 0.1,
  minHistorySpend: 100_000,
} as const;

const T = RECOMMEND_THRESHOLDS;

const x = (v: number) => `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;
const pct = (v: number) => `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
const vnd = (v: number) => `${Math.round(v).toLocaleString("vi-VN")}₫`;
const ceil1 = (v: number) => Math.ceil(v * 10 - 1e-9) / 10;
const round1 = (v: number) => Math.round(v * 10) / 10;
const roundK = (v: number) => Math.max(0, Math.round(v / 1000) * 1000);

export function recommendAdsForItem(input: RecommendInput): RecommendResult {
  const s = input.signal;
  const factor = input.dangerFactor > 0 ? input.dangerFactor : 1.1;
  const breakevenRoas = input.margin != null && input.margin > 0 ? 1 / input.margin : null;
  const safeRoas = breakevenRoas != null ? ceil1(breakevenRoas * factor) : null;
  const headroom = breakevenRoas != null && s?.roiExact ? s.roiExact / breakevenRoas : null;
  const organicCvr = organicCvrOf(input.units30d, s?.views ?? null);
  const dailyVelocity = input.units30d / 30;
  const daysOfCover =
    input.stockAvailable != null && dailyVelocity > 0
      ? input.stockAvailable / (dailyVelocity * T.adsLiftFactor)
      : null;

  // ---------- Tầng 1: cổng loại ----------
  const gates: RecommendGate[] = [];

  if (input.margin == null) {
    gates.push({
      key: "margin",
      ok: false,
      text: "Chưa có đơn nào trong 30 ngày để biết biên lãi.",
      todo: "Để sản phẩm bán tự nhiên vài đơn (và nhập giá vốn) rồi mới đổ tiền ads.",
    });
  } else if (input.margin <= 0) {
    gates.push({
      key: "margin",
      ok: false,
      text: `Bán đã lỗ trước cả ads (biên lãi ${pct(input.margin)}).`,
      todo: "Xem lại giá bán / giá vốn / phí — không ROAS nào cứu được.",
    });
  } else if (input.missingCost) {
    gates.push({
      key: "margin",
      ok: false,
      text: "Thiếu giá vốn — biên lãi đang ảo cao, hòa vốn ảo thấp.",
      todo: "Nhập giá vốn cho sản phẩm rồi xem lại gợi ý.",
    });
  } else {
    gates.push({
      key: "margin",
      ok: true,
      text:
        `Biên lãi ${pct(input.margin)} → hòa vốn ${x(breakevenRoas!)}` +
        (input.marginOrders < T.minMarginOrders
          ? ` (mới ${input.marginOrders} đơn — số còn mỏng)`
          : ` (${input.marginOrders} đơn)`),
    });
  }

  if (safeRoas != null && s?.roiUpper != null) {
    // Dải lower–upper = ROAS mục tiêu các quảng cáo SP tương tự trên sàn đang đặt (API
    // get_product_recommended_roi_target). Khả thi khi mức an toàn của mình ≤ nhóm khắt khe nhất.
    // Anh Trung 25/09: mức an toàn thường nằm DƯỚI đáy dải (hàng biên lãi tốt) mà câu cũ in
    // "nằm trong dải" → seller đọc thấy mâu thuẫn. Nay tách 3 câu theo vị trí: dưới / trong / trên.
    const ok = safeRoas <= s.roiUpper;
    const lower = s.roiLower ?? s.roiUpper;
    const range = `${x(lower)}–${x(s.roiUpper)}`;
    gates.push({
      key: "feasible",
      ok,
      text: !ok
        ? `Cần ROAS ≥ ${x(safeRoas)} mới có lãi, trong khi nhóm khắt khe nhất trên sàn chỉ đặt ${x(s.roiUpper)}.`
        : safeRoas < lower
          ? `Mức an toàn ${x(safeRoas)} thấp hơn cả mức các shop tương tự đang đặt (${range}) — dễ đạt.`
          : `Mức an toàn ${x(safeRoas)} nằm trong dải các shop tương tự đang đặt (${range}).`,
      todo: ok ? undefined : "Tăng giá bán hoặc giảm giá vốn để hạ hòa vốn trước khi chạy ads.",
    });
  } else if (safeRoas != null) {
    gates.push({ key: "feasible", ok: true, text: "Chưa có dải ROAS thị trường của sàn cho sản phẩm này." });
  }

  if (input.stockAvailable != null) {
    if (input.stockAvailable <= 0) {
      gates.push({ key: "stock", ok: false, text: "Hết hàng.", todo: "Nhập hàng trước khi chạy ads." });
    } else if (daysOfCover != null) {
      const ok = daysOfCover >= T.minCoverDays;
      gates.push({
        key: "stock",
        ok,
        text: `Tồn ${input.stockAvailable} — đủ khoảng ${Math.floor(daysOfCover)} ngày khi ads đẩy lượng bán lên gấp rưỡi.`,
        todo: ok ? undefined : `Nhập thêm hàng (cần đủ ${T.minCoverDays} ngày) — hết hàng giữa chừng là mất thứ hạng.`,
      });
    } else {
      gates.push({ key: "stock", ok: true, text: `Tồn ${input.stockAvailable}, chưa có nhịp bán để ước số ngày.` });
    }
  } else {
    gates.push({ key: "stock", ok: true, text: "Chưa rõ tồn kho (SKU chưa nối kho)." });
  }

  if (s?.adBlocked) {
    gates.push({
      key: "allowed",
      ok: false,
      text: "Sàn báo sản phẩm không đủ điều kiện chạy ads.",
      todo: "Kiểm tra trạng thái sản phẩm trên Seller Center.",
    });
  }

  if (s?.commentCount != null && s.ratingStar != null) {
    const ok = s.commentCount >= T.minReviews && s.ratingStar >= T.minRating;
    gates.push({
      key: "social",
      ok,
      text: `${s.commentCount} đánh giá · ${s.ratingStar.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} sao.`,
      todo: ok
        ? undefined
        : s.commentCount < T.minReviews
          ? `Gom đủ ${T.minReviews} đánh giá trước — click đắt mà khách chưa dám mua.`
          : "Xử lý đánh giá xấu trước — sao thấp kéo tỉ lệ chuyển đổi xuống.",
    });
  }

  // ---------- Tầng 2: điểm ----------
  const factors: RecommendFactor[] = [];

  {
    let points = 20;
    let text = "Chưa có ROAS thị trường — tạm tính trung tính.";
    if (headroom != null) {
      points = headroom >= 2 ? 40 : headroom >= 1.5 ? 32 : headroom >= 1.3 ? 26 : headroom >= 1.1 ? 16 : 6;
      text = `ROAS thị trường ${x(s!.roiExact!)} ÷ hòa vốn ${x(breakevenRoas!)} = dư địa ${x(headroom)}.`;
    }
    factors.push({ key: "headroom", label: "Dư địa lãi", points, max: 40, text });
  }
  {
    let points = 10;
    let text = "Chưa đủ lượt xem để đo sức chuyển đổi.";
    if (organicCvr != null) {
      const rel = input.shopMedianCvr && input.shopMedianCvr > 0 ? organicCvr / input.shopMedianCvr : null;
      points = rel == null ? 10 : rel >= 1.5 ? 20 : rel >= 1 ? 15 : rel >= 0.6 ? 8 : 3;
      text =
        `Ước ${pct(organicCvr)} lượt xem thành đơn` +
        (rel != null ? ` — ${rel >= 1 ? "cao" : "thấp"} hơn mặt bằng shop (${pct(input.shopMedianCvr!)}).` : ".");
    }
    factors.push({ key: "cvr", label: "Sức chuyển đổi tự nhiên", points, max: 20, text });
  }
  {
    let points = 7;
    let text = "Chưa có số lượt tìm kiếm của sàn.";
    const topSearch = s?.tags.includes("top search") ?? false;
    if (s?.kwSearchVolume != null) {
      const v = s.kwSearchVolume;
      points = v >= 50_000 ? 15 : v >= 10_000 ? 11 : v >= 2_000 ? 7 : 3;
      text = `${v.toLocaleString("vi-VN")} lượt tìm / 30 ngày trên các từ khóa sàn gợi ý.`;
    }
    if (topSearch) {
      points = Math.min(15, points + 2);
      text += " Sàn gắn nhãn tìm kiếm nhiều.";
    }
    factors.push({ key: "demand", label: "Cầu", points, max: 15, text });
  }
  {
    let points = 5;
    let text = "Chưa có giá thầu gợi ý của sàn.";
    if (s?.kwAvgBid != null && s.kwAvgBid > 0 && input.margin != null && input.margin > 0 && organicCvr != null) {
      // Giá click tối đa để một click không lỗ (lấy CVR tự nhiên làm trần lạc quan).
      const maxCpc = input.price * input.margin * organicCvr;
      const ratio = maxCpc / s.kwAvgBid;
      points = ratio >= 2 ? 10 : ratio >= 1 ? 6 : 2;
      text = `Click gánh được tối đa ${vnd(maxCpc)}, sàn gợi ý thầu ${vnd(s.kwAvgBid)}.`;
    }
    factors.push({ key: "cpc", label: "Giá click chịu được", points, max: 10, text });
  }
  {
    const v7 = input.units7d / 7;
    const v30 = input.units30d / 30;
    let points = 2;
    let text = "Chưa bán được trong 30 ngày.";
    if (v30 > 0) {
      const ratio = v7 / v30;
      points = ratio >= 1.2 ? 10 : ratio >= 0.8 ? 7 : 3;
      text =
        ratio >= 1.2
          ? "7 ngày gần đây bán nhanh hơn nhịp tháng — ads sẽ khuếch đại đà lên."
          : ratio >= 0.8
            ? "Nhịp bán ổn định."
            : "Đang bán chậm lại so với nhịp tháng.";
    }
    factors.push({ key: "momentum", label: "Đà bán", points, max: 10, text });
  }
  let historyAdjust = 0;
  if (input.history && input.history.spend30d >= T.minHistorySpend && input.history.roas30d != null && safeRoas != null) {
    const r = input.history.roas30d;
    historyAdjust = r >= safeRoas ? 25 : breakevenRoas != null && r < breakevenRoas ? -25 : 0;
    factors.push({
      key: "history",
      label: "Đã từng chạy",
      points: historyAdjust,
      max: 25,
      text: `30 ngày qua tiêu ${vnd(input.history.spend30d)}, ROAS ${x(r)} so với hòa vốn ${x(breakevenRoas!)}.`,
    });
  }
  const tagBonus = s?.tags.some((t) => t === "best ROI" || t === "best selling") ? 5 : 0;
  const score = Math.max(
    0,
    Math.min(100, factors.reduce((sum, f) => sum + f.points, 0) + tagBonus)
  );

  // ---------- Xếp mức ----------
  const failed = gates.filter((g) => !g.ok);
  let tier: RecommendTier;
  let headline: string;
  if (input.runningAds) {
    tier = "running";
    headline = "Đang chạy ads — theo dõi ở tab Tổng quan chiến dịch.";
  } else if (failed.length > 0) {
    tier = "not_yet";
    headline = failed[0].todo ?? failed[0].text;
  } else if (score >= T.runNowScore) {
    tier = "run_now";
    headline =
      headroom != null
        ? `Sàn chạy quanh ${x(s!.roiExact!)}, anh/chị chỉ cần ${x(safeRoas!)} là có lãi.`
        : "Đủ điều kiện và điểm cao — nên chạy.";
  } else if (score >= T.testSmallScore) {
    tier = "test_small";
    const weakest = [...factors].filter((f) => f.key !== "history").sort((a, b) => a.points / a.max - b.points / b.max)[0];
    headline = `Chạy được nhưng nên thử nhỏ — điểm yếu: ${weakest.label.toLowerCase()}.`;
  } else {
    tier = "not_yet";
    const weakest = [...factors].filter((f) => f.key !== "history").sort((a, b) => a.points / a.max - b.points / b.max)[0];
    headline = `Điểm thấp (${score}/100) — yếu nhất ở ${weakest.label.toLowerCase()}.`;
  }

  // ---------- Tầng 3: đề xuất ----------
  let proposal: RecommendProposal | null = null;
  if ((tier === "run_now" || tier === "test_small") && safeRoas != null && input.margin != null) {
    // "Đẩy số" = mức an toàn (hòa vốn × hệ số), KHÔNG kẹp theo mốc thấp nhất Shopee gợi ý — anh Trung
    // cân nhắc rồi bỏ 24/09 22:50 ("mình có lưu ý lãi mỏng / lỗ nhẹ rồi"): seller được chọn mức thấp nhất
    // còn lãi, câu cảnh báo trên thẻ đã nói rõ lãi mỗi đơn mỏng nhất.
    const push = safeRoas;
    const exact = s?.roiExact ?? null;
    const keep = exact != null && exact > push ? round1(exact) : push;
    const balanced = keep > push ? round1((push + keep) / 2) : push;
    const profit30d = Math.max(0, input.revenue30d * input.margin);
    const caps: Array<{ value: number; why: string }> = [];
    if (profit30d > 0) {
      caps.push({
        value: (profit30d * T.testSpendShareOfProfit) / 7,
        why: `tiền thử 7 ngày không quá ${pct(T.testSpendShareOfProfit)} lãi tháng của sản phẩm (${vnd(profit30d)})`,
      });
    }
    if (input.stockAvailable != null && input.stockAvailable > 0) {
      caps.push({
        value: (input.stockAvailable * input.price) / balanced / T.minCoverDays,
        why: `không bán cạn ${input.stockAvailable} tồn kho trước ${T.minCoverDays} ngày`,
      });
    }
    const suggested = s?.budgetRecommended ?? null;
    let budget = suggested ?? (caps.length > 0 ? Math.min(...caps.map((c) => c.value)) : 50_000);
    let note = suggested != null ? `Sàn gợi ý ${vnd(suggested)}/ngày.` : "Sàn chưa có gợi ý ngân sách.";
    const binding = caps.filter((c) => c.value < budget).sort((a, b) => a.value - b.value)[0];
    if (binding) {
      budget = binding.value;
      note += ` Hubsell hạ xuống để ${binding.why}.`;
    }
    if (tier === "test_small") {
      budget = budget * 0.5;
      note += " Mức Thử nhỏ: lấy một nửa.";
    }
    if (s?.budgetMin != null && budget < s.budgetMin) {
      // Probe ANO 17/09: sàn đòi tối thiểu 100.000₫/ngày — thường CAO hơn mức thử an toàn của SP nhỏ.
      note += ` Nhưng sàn bắt buộc tối thiểu ${vnd(s.budgetMin)}/ngày, cao hơn mức thử an toàn Hubsell tính (${vnd(roundK(budget))}) — cân nhắc trước khi chạy.`;
      budget = s.budgetMin;
    }
    const dailyBudget = Math.max(roundK(budget), 10_000);
    proposal = {
      targets: { push, balanced, keep },
      recommended: tier === "test_small" ? "keep" : "balanced",
      dailyBudget,
      budgetNote: note,
      maxTestSpend7d: dailyBudget * 7,
    };
  }

  return {
    itemId: input.itemId,
    tier,
    score,
    breakevenRoas,
    safeRoas,
    headroom,
    organicCvr,
    daysOfCover,
    headline,
    gates,
    factors,
    proposal,
  };
}

/** Tỉ lệ chuyển đổi tự nhiên ƯỚC TÍNH = số bán 30 ngày (Hubsell) ÷ lượt xem của sàn; <100 lượt xem thì bỏ (nhiễu). */
export function organicCvrOf(units30d: number, views: number | null): number | null {
  return views != null && views >= 100 ? Math.min(1, units30d / views) : null;
}

/** Trung vị tỉ lệ chuyển đổi của shop — chỉ tính SP đủ ≥100 lượt xem VÀ có bán (SP không bán kéo trung vị về 0). */
export function medianOrganicCvr(items: Array<{ units30d: number; views: number | null }>): number | null {
  const list = items
    .filter((i) => i.units30d > 0)
    .map((i) => organicCvrOf(i.units30d, i.views))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  if (list.length === 0) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}
