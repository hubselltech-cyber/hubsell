// ============================================================
// TIKTOK ADS — ROI HÒA VỐN (GMV Max): GHÉP SỐ THÀNH KẾT LUẬN
//
// Luật hòa vốn (chỉ đơn đã có kết cục cuối, cộng ngược phí GMV Max, đơn hủy cùng
// lứa, tự kiểm mẫu số) nằm ở lib/tiktok-breakeven.ts; nạp dữ liệu + bộ đệm + hai
// đường cộng (duyệt mảng đơn ↔ gom trong database) ở ./breakeven-source.ts.
// File này ghép nguyên liệu thành kết quả khách nhìn thấy: hòa vốn toàn gian +
// từng chiến dịch, tab Hòa vốn sản phẩm (kết luận từng dòng, nhận định Nên chạy).
// ============================================================

import { dateKey, vnDateKey } from "../../lib/ads-dates";
import { SHOP_GROUP, campaignGroupKey } from "../../lib/ads-margin";
import { registerCostCacheInvalidator } from "../../lib/cost-cache-invalidation";
import { prisma } from "../../lib/prisma";
import type { TiktokBreakevenSource } from "../../lib/report-source";
import { TIKTOK_MARGIN_WINDOW_DAYS, toTiktokBreakeven, type TiktokBreakeven } from "../../lib/tiktok-breakeven";
import { MIN_ORDERS_FOR_MARGIN } from "../shopee/ads-insights";
import {
  fetchChannelBreakevens,
  loadBreakevenInputs,
  type TiktokBreakevenChannel,
} from "./breakeven-source";
import { productRunAdvice, type ProductRunAdvice } from "./product-run-advice";

export interface ChannelTiktokBreakeven {
  shop: TiktokBreakeven;
  byCampaignRowId: Map<string, TiktokBreakeven>;
}

// ---------- NHỚ ĐỆM NGẮN + GỘP LƯỢT TÍNH TRÙNG (hạ tầng 18/09/2026) ----------
// Phép tính hòa vốn đọc tới 8.000 đơn 60 ngày qua computePnlRow và được gọi ở 7 route; MỘT lần mở trang chiến dịch bắn 2–3
// request song song, mỗi cái tính lại từ đầu. Nhớ KẾT QUẢ (nhỏ — không nhớ đơn hàng) 45 giây theo gian và cho các request
// đang chờ dùng chung một lượt tính. 45 giây là mặc định chọn: đủ gộp các request của một lần mở trang, đủ ngắn để giá vốn
// vừa nhập hiện lên gần như ngay. Nhớ trong RAM từng tiến trình — chỉ là bộ đệm đọc, không phải khóa.
// Ở đường "sql", phần gom trên sổ dòng hàng còn được nhớ riêng 30 phút (breakeven-source.ts); 45 giây ở đây khi đó chỉ
// còn là nhịp đọc lại chiến dịch + số quảng cáo theo ngày.
const RESULT_TTL_MS = 45_000;
const RESULT_CACHE_MAX = 500;

/** Mọi bộ đệm memoizeByChannel đang sống — để xóa theo gian khi giá vốn đổi. */
const memoCaches = new Set<Map<string, { at: number; value: Promise<unknown> }>>();
registerCostCacheInvalidator((ids) => {
  for (const cache of memoCaches) for (const id of ids) cache.delete(id);
});

export function memoizeByChannel<T>(compute: (channel: { id: string; userId: string }) => Promise<T>, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; value: Promise<T> }>();
  memoCaches.add(cache as Map<string, { at: number; value: Promise<unknown> }>);
  return (channel: { id: string; userId: string }): Promise<T> => {
    const hit = cache.get(channel.id);
    if (hit && now() - hit.at < RESULT_TTL_MS) return hit.value;
    const value = compute(channel);
    cache.set(channel.id, { at: now(), value });
    // Lượt tính hỏng thì không giữ lại (lần gọi sau tính lại ngay).
    value.catch(() => {
      if (cache.get(channel.id)?.value === value) cache.delete(channel.id);
    });
    if (cache.size > RESULT_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return value;
  };
}

/** Hòa vốn toàn gian + từng chiến dịch. Chiến dịch chưa đủ mẫu / chưa biết SKU → mượn biên lãi gian. (Có nhớ đệm 45 giây.) */
export const computeTiktokAdsBreakeven = memoizeByChannel(computeTiktokAdsBreakevenUncached);

/**
 * Bản không nhớ đệm của computeTiktokAdsBreakeven. `opts.source`: ép đường cộng (công cụ đối chiếu, test); bỏ trống = theo
 * env TIKTOK_BREAKEVEN_SOURCE, có lưới đỡ.
 */
export async function computeTiktokAdsBreakevenUncached(
  channel: TiktokBreakevenChannel,
  opts: { source?: TiktokBreakevenSource } = {}
): Promise<ChannelTiktokBreakeven> {
  const inputs = await loadBreakevenInputs(channel.id);
  const breakevens = await fetchChannelBreakevens(channel, inputs, opts.source);

  const shop = toTiktokBreakeven(breakevens.base(SHOP_GROUP), "shop");

  const byCampaignRowId = new Map<string, TiktokBreakeven>();
  for (const c of inputs.campaigns) {
    // Chiến dịch chưa biết SKU → nhóm rỗng → toàn 0 → mượn biên lãi gian.
    const groupKey = campaignGroupKey(c.id);
    const own = breakevens.base(groupKey);
    if (own.settledOrders < MIN_ORDERS_FOR_MARGIN || own.revenue <= 0) {
      byCampaignRowId.set(c.id, shop);
      continue;
    }
    const check = inputs.checkByCampaignRowId.get(c.id);
    byCampaignRowId.set(c.id, {
      ...toTiktokBreakeven(own, "campaign"),
      check: check
        ? { revenuePlaced: breakevens.placedRevenue(groupKey), tiktokGmv: check.tiktokGmv, from: check.from, to: inputs.checks.to }
        : null,
    });
  }

  return { shop, byCampaignRowId };
}

/** Ghi danh sách sản phẩm (SPU) của chiến dịch vào AdsCampaign.itemIds khi đổi — nguồn nối chiến dịch → SKU. */
export async function saveCampaignProductIds(adsCampaignId: string, current: string, spuIds: string[]): Promise<void> {
  const next = [...new Set(spuIds.filter(Boolean))].sort().join(",");
  if (!next || next === current) return;
  await prisma.adsCampaign.update({ where: { id: adsCampaignId }, data: { itemIds: next } });
}

// ============================================================
// TAB "HÒA VỐN SẢN PHẨM" (anh Trung 18/09 khuya): ROI hòa vốn của TỪNG sản phẩm, hoàn toàn từ Lãi/Lỗ thực hiện, đúng luật
// ở đầu file (chỉ đơn ĐÃ ĐỐI SOÁT — giao thành công / hoàn xong — + đơn hủy cùng lứa; đơn chưa đối soát để ngoài). Chỉ đọc
// DB, KHÔNG gọi TikTok. Đây là nền cho phần gợi ý tạo quảng cáo về sau (cần xin thêm quyền Campaign — làm sau).
// ============================================================

/** Cửa sổ "ROI quảng cáo gian thực tế đạt được" của nhận định Nên chạy — cùng 30 ngày với cột Chi quảng cáo của tab. */
const RUN_ADVICE_ADS_DAYS = 30;

export type ProductBreakevenVerdict = "ok" | "target_below" | "low_sample" | "loss" | "no_cost" | "no_settled";

export interface ProductCampaignRef {
  id: string;
  name: string;
  status: string;
  roasTarget: number | null;
}

/**
 * Lãi SAU quảng cáo trên mỗi 100đ doanh thu nếu chiến dịch đạt ĐÚNG một mức ROI. Thuần — chỉ là số học trên hai số đã có:
 * biên lãi trước quảng cáo (đơn đã đối soát) − phần doanh thu trả cho quảng cáo (1 / ROI). Âm = mức ROI đó ăn vào vốn.
 * Cùng hệ quy chiếu với ROI hòa vốn: doanh thu GMV Max tính MỌI đơn của sản phẩm, biên lãi cũng tính trên mọi đơn đã đối soát.
 */
export function profitPer100AtRoi(margin: number, roi: number): number | null {
  if (!(roi > 0) || !Number.isFinite(margin)) return null;
  return Math.round((margin - 1 / roi) * 1000) / 10;
}

/** " (mỗi 100đ doanh thu lỗ khoảng Xđ)" cho câu cảnh báo mục tiêu dưới hòa vốn; rỗng khi không tính được. */
function lossAt(margin: number | null, roasTarget: number): string {
  const p = margin != null ? profitPer100AtRoi(margin, roasTarget) : null;
  if (p == null || p >= 0) return "";
  return ` (mỗi 100đ doanh thu lỗ khoảng ${Math.abs(p).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}đ)`;
}

/** Kết luận một dòng sản phẩm + lý do (cột riêng, trỏ chuột / bấm hiện lý do). Thuần. */
export function productBreakevenVerdict(
  be: TiktokBreakeven,
  campaigns: ProductCampaignRef[],
  minCoveragePct: number
): { verdict: ProductBreakevenVerdict; reason: string } {
  const roi = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  if (be.orders === 0 && (be.costCoveragePct ?? 100) < minCoveragePct) {
    return { verdict: "no_cost", reason: "Đơn đã đối soát của sản phẩm chưa có giá vốn — nhập giá vốn thì mới tính được hòa vốn." };
  }
  if (be.orders === 0) {
    return {
      verdict: "no_settled",
      reason:
        be.pendingOrders > 0
          ? `Chưa có đơn nào đã đối soát trong ${TIKTOK_MARGIN_WINDOW_DAYS} ngày (${be.pendingOrders} đơn đang giao / chờ đối soát chưa được tính).`
          : `Chưa có đơn nào đã đối soát trong ${TIKTOK_MARGIN_WINDOW_DAYS} ngày.`,
    };
  }
  if ((be.costCoveragePct ?? 100) < minCoveragePct) {
    return { verdict: "no_cost", reason: `Mới ${be.costCoveragePct}% doanh thu đã đối soát có giá vốn — con số chỉ đại diện phần đó, nhập đủ giá vốn để tin được.` };
  }
  if (be.negativeMargin) {
    return { verdict: "loss", reason: "Bán đang lỗ trước cả quảng cáo — ROI nào cũng lỗ. Xem lại giá bán, giá vốn, phí sàn trước khi chạy." };
  }
  if (be.orders < MIN_ORDERS_FOR_MARGIN) {
    return { verdict: "low_sample", reason: `Mới ${be.orders} đơn đã đối soát (cần từ ${MIN_ORDERS_FOR_MARGIN}) — con số còn dao động, xem để tham khảo.` };
  }
  const bad = campaigns.find((c) => c.status === "ongoing" && c.roasTarget != null && be.breakevenRoi != null && c.roasTarget < be.breakevenRoi);
  if (bad && be.breakevenRoi != null) {
    return {
      verdict: "target_below",
      reason:
        `Chiến dịch "${bad.name}" đang đặt ROI mục tiêu ${roi(bad.roasTarget as number)}, thấp hơn hòa vốn ${roi(be.breakevenRoi)} của sản phẩm — đạt mục tiêu vẫn lỗ` +
        `${lossAt(be.margin, bad.roasTarget as number)}. Nâng ROI mục tiêu lên ít nhất ${roi(be.breakevenRoi)}.`,
    };
  }
  if (be.breakevenRoi == null) return { verdict: "ok", reason: "" };
  // Đang chạy với mục tiêu TRÊN hòa vốn: nói luôn đạt mục tiêu thì còn lãi bao nhiêu — con số để khách tự cân giữa lãi mỗi đơn và
  // độ rộng phân phối. Không phán "nên hạ" theo một bội số tự đặt (không có căn cứ nào cho bội số đó).
  const running = campaigns.find((c) => c.status === "ongoing" && c.roasTarget != null);
  const keep = running && be.margin != null ? profitPer100AtRoi(be.margin, running.roasTarget as number) : null;
  if (running && keep != null) {
    return {
      verdict: "ok",
      reason:
        `Chiến dịch "${running.name}" đang đặt ROI mục tiêu ${roi(running.roasTarget as number)}, trên hòa vốn ${roi(be.breakevenRoi)}: đạt đúng mục tiêu thì mỗi 100đ doanh thu còn lãi khoảng ${roi(keep)}đ sau quảng cáo. ` +
        `Hạ mục tiêu thì TikTok phân phối rộng hơn nhưng lãi mỗi đơn mỏng đi — đừng đặt dưới ${roi(be.breakevenRoi)}.`,
    };
  }
  return { verdict: "ok", reason: `Đặt ROI mục tiêu từ ${roi(be.breakevenRoi)} trở lên thì quảng cáo không ăn vào vốn.` };
}

export interface ProductBreakevenRow {
  productId: string;
  name: string;
  imageUrl: string | null;
  skuCount: number;
  /** Doanh thu đã có kết cục cuối và có giá vốn (mẫu số của biên lãi). */
  revenue: number;
  /** Lãi trước quảng cáo trên phần doanh thu đó (đã cộng ngược phí GMV Max). */
  profitBeforeAds: number;
  /** Doanh thu đã có kết cục cuối nhưng THIẾU giá vốn — không vào phép tính, hiện riêng để khách thấy mình đang bỏ sót bao nhiêu. */
  missingCostRevenue: number;
  /** Đà bán: số sản phẩm bán ra (mọi đơn đặt trừ hủy) 7 và 30 ngày gần nhất. */
  units7d: number;
  units30d: number;
  /** Tồn TRÊN SÀN cộng các phân loại (ChannelProduct.channelStock); null = Hubsell chưa đọc được tồn của sản phẩm này. */
  stock: number | null;
  breakeven: TiktokBreakeven;
  /** Chiến dịch GMV Max đang chứa sản phẩm này (theo danh sách sản phẩm Hubsell đã lưu của từng chiến dịch). */
  campaigns: ProductCampaignRef[];
  verdict: ProductBreakevenVerdict;
  reason: string;
  /** Sản phẩm CHƯA nằm trong chiến dịch đang chạy + hòa vốn đã tin được → Nên chạy / Chạy thử / Chưa nên (product-run-advice.ts); còn lại null. */
  runAdvice: ProductRunAdvice | null;
}

export interface ChannelProductBreakevens {
  shop: TiktokBreakeven;
  windowDays: number;
  products: ProductBreakevenRow[];
}

/** Hòa vốn từng sản phẩm của một gian TikTok. Chỉ liệt kê sản phẩm CÓ đơn trong cửa sổ (kể cả đơn chưa đối soát). (Có nhớ đệm 45 giây.) */
const productBreakevenMemo = new Map<number, ReturnType<typeof memoizeByChannel<ChannelProductBreakevens>>>();
export function computeTiktokProductBreakevens(channel: { id: string; userId: string }, minCoveragePct: number): Promise<ChannelProductBreakevens> {
  let memo = productBreakevenMemo.get(minCoveragePct);
  if (!memo) productBreakevenMemo.set(minCoveragePct, (memo = memoizeByChannel((c) => computeTiktokProductBreakevensUncached(c, minCoveragePct))));
  return memo(channel);
}

/**
 * Bản không nhớ đệm của computeTiktokProductBreakevens. `opts.source`: ép đường cộng (công cụ đối chiếu, test); bỏ trống =
 * theo env TIKTOK_BREAKEVEN_SOURCE, có lưới đỡ.
 */
export async function computeTiktokProductBreakevensUncached(
  channel: TiktokBreakevenChannel,
  minCoveragePct: number,
  opts: { source?: TiktokBreakevenSource } = {}
): Promise<ChannelProductBreakevens> {
  const inputs = await loadBreakevenInputs(channel.id);
  const { campaigns, channelProducts, skusByProductId } = inputs;
  const breakevens = await fetchChannelBreakevens(channel, inputs, opts.source);
  const info = new Map<string, { name: string; imageUrl: string | null }>();
  for (const cp of channelProducts) {
    const productId = (cp.externalId ?? "").split("-")[0];
    if (!productId) continue;
    const cur = info.get(productId);
    if (!cur) info.set(productId, { name: cp.productName, imageUrl: cp.imageUrl });
    else if (!cur.imageUrl && cp.imageUrl) cur.imageUrl = cp.imageUrl;
  }
  const stockOf = new Map<string, number>();
  for (const cp of channelProducts) {
    const productId = (cp.externalId ?? "").split("-")[0];
    if (productId && cp.channelStock != null) stockOf.set(productId, (stockOf.get(productId) ?? 0) + cp.channelStock);
  }
  const pace = breakevens.productPace();
  const campaignsOf = new Map<string, ProductCampaignRef[]>();
  for (const c of campaigns) {
    const ref = { id: c.id, name: c.name, status: c.status, roasTarget: c.roasTarget != null ? Number(c.roasTarget) : null };
    for (const productId of c.itemIds ? c.itemIds.split(",") : []) {
      const list = campaignsOf.get(productId) ?? [];
      list.push(ref);
      campaignsOf.set(productId, list);
    }
  }

  // Quảng cáo GMV Max của CẢ GIAN 30 ngày gần nhất (số TikTok báo, đã lưu DB) — mốc "ROI gian thực tế đạt được" của nhận định Nên chạy.
  const adsFrom = vnDateKey(RUN_ADVICE_ADS_DAYS - 1);
  let shopAdsSpend30d = 0;
  let shopAdsGmv30d = 0;
  for (const c of campaigns)
    for (const d of c.dailyPerf) {
      if (dateKey(d.date) < adsFrom) continue;
      shopAdsSpend30d += Number(d.expense);
      shopAdsGmv30d += Number(d.broadGmv);
    }

  const products: ProductBreakevenRow[] = [];
  for (const [productId, base] of breakevens.productBases()) {
    const breakeven = toTiktokBreakeven(base, "product");
    // Chiến dịch đang chạy đứng trước để cột "Đang chạy ở" và kết luận nhìn vào đúng chỗ đang tiêu tiền.
    const camps = (campaignsOf.get(productId) ?? []).sort((a, b) => Number(b.status === "ongoing") - Number(a.status === "ongoing"));
    const v = productBreakevenVerdict(breakeven, camps, minCoveragePct);
    products.push({
      productId,
      name: info.get(productId)?.name ?? "",
      imageUrl: info.get(productId)?.imageUrl ?? null,
      skuCount: skusByProductId.get(productId)?.size ?? 0,
      revenue: base.revenue,
      profitBeforeAds: base.profitBeforeAds,
      missingCostRevenue: base.missingCostRevenue,
      units7d: pace.get(productId)?.units7d ?? 0,
      units30d: pace.get(productId)?.units30d ?? 0,
      stock: stockOf.get(productId) ?? null,
      breakeven,
      campaigns: camps,
      ...v,
      runAdvice:
        v.verdict === "ok" && breakeven.margin != null && breakeven.breakevenRoi != null && !camps.some((c) => c.status === "ongoing")
          ? productRunAdvice({
              margin: breakeven.margin,
              breakevenRoi: breakeven.breakevenRoi,
              units7d: pace.get(productId)?.units7d ?? 0,
              units30d: pace.get(productId)?.units30d ?? 0,
              stock: stockOf.get(productId) ?? null,
              shopAdsSpend30d,
              shopAdsGmv30d,
            })
          : null,
    });
  }
  // Bán nhiều đứng trước — tính cả phần doanh thu thiếu giá vốn, để sản phẩm bán chạy mà chưa nhập giá vốn không chìm xuống đáy.
  const sold = (p: ProductBreakevenRow) => p.revenue + p.missingCostRevenue;
  products.sort((a, b) => sold(b) - sold(a) || b.breakeven.pendingOrders - a.breakeven.pendingOrders);
  return { shop: toTiktokBreakeven(breakevens.base(SHOP_GROUP), "shop"), windowDays: TIKTOK_MARGIN_WINDOW_DAYS, products };
}
