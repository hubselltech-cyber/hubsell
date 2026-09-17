// ============================================================
// GỢI Ý CHẠY ADS — GOM DỮ LIỆU + LỆNH TẠO CHIẾN DỊCH (đợt D, 17/09/2026)
//
// Trang gợi ý CHỈ ĐỌC DB (cùng nguyên tắc ví ads/xung): biên lãi từ P&L 30 ngày
// (SSOT chung với bảng hòa vốn SP), tồn kho + nhịp bán của Hubsell, lịch sử ads
// của chính SP, và bảng AdsItemSignal (tín hiệu thị trường do worker/nút đồng bộ
// ghi). Bộ chấm thuần ở ads-recommend.ts.
//
// Lệnh tạo: create_manual_product_ads (1 SP, đấu thầu tự động theo ROAS mục
// tiêu) — CHƯA probe sống; lần bấm đầu trên gian thật là lần xác minh, lỗi sàn
// ghi nguyên văn. Campaign tạo ra mang createdByHubsellAt + hubsellProposal (chỗ
// chờ cho đợt B và cho việc chấm gợi ý đúng/sai).
// ============================================================

import { Prisma, type Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { requestAdsRefresh } from "../../services/sync-schedule";
import { resolveShopeeAdsAccess } from "../hubsell-ads";
import { createManualProductAdsRaw } from "./client";
import { toShopeeDate } from "./ads-spend";
import {
  computeChannelProductBreakeven,
  fetchChannelPnlRows,
  type AdsInsightChannel,
} from "./ads-insights";
import {
  medianOrganicCvr,
  recommendAdsForItem,
  type RecommendResult,
  type RecommendSignal,
  type RecommendTier,
} from "./ads-recommend";

export interface AdsRecommendationRow extends RecommendResult {
  productName: string;
  itemSku: string | null;
  imageUrl: string | null;
  price: number;
  margin: number | null;
  orders30d: number;
  revenue30d: number;
  units30d: number;
  stockAvailable: number | null;
  /** Lát tín hiệu sàn cho UI (null = gian chưa đồng bộ tín hiệu cho SP này). */
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

export interface ChannelAdsRecommendations {
  rows: AdsRecommendationRow[];
  counts: Record<RecommendTier, number>;
  /** Lần đồng bộ tín hiệu sàn gần nhất; null = chưa từng. */
  signalsSyncedAt: string | null;
  safeRoasFactor: number;
}

const TIER_RANK: Record<RecommendTier, number> = { run_now: 0, test_small: 1, not_yet: 2, running: 3 };
const num = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v == null ? null : Number(v);

export async function computeChannelAdsRecommendations(
  channel: AdsInsightChannel
): Promise<ChannelAdsRecommendations> {
  const pnlRows = await fetchChannelPnlRows(channel);
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [breakeven, channelProducts, signals, singleCampaigns] = await Promise.all([
    computeChannelProductBreakeven(channel, pnlRows),
    prisma.channelProduct.findMany({
      where: { channelId: channel.id, externalId: { not: null } },
      select: {
        channelSku: true,
        externalId: true,
        price: true,
        imageUrl: true,
        channelStock: true,
        productId: true,
        product: { select: { id: true, quantityInStock: true, holdQuantity: true } },
      },
    }),
    prisma.adsItemSignal.findMany({ where: { channelId: channel.id } }),
    prisma.adsCampaign.findMany({
      where: { channelId: channel.id, itemIds: { not: "" } },
      select: {
        itemIds: true,
        dailyPerf: { where: { date: { gte: since30 } }, select: { expense: true, broadGmv: true } },
      },
    }),
  ]);

  // ---- Gom theo item: SKU, giá, ảnh, tồn ----
  const byItem = new Map<
    string,
    { skus: Set<string>; price: number; imageUrl: string | null; linkedStock: Map<string, number>; channelStock: number | null }
  >();
  for (const cp of channelProducts) {
    const itemId = (cp.externalId ?? "").split("-")[0];
    if (!itemId) continue;
    let g = byItem.get(itemId);
    if (!g) byItem.set(itemId, (g = { skus: new Set(), price: 0, imageUrl: null, linkedStock: new Map(), channelStock: null }));
    g.skus.add(cp.channelSku);
    const price = Number(cp.price);
    if (price > 0 && (g.price === 0 || price < g.price)) g.price = price; // giá thấp nhất = giá khách thấy
    if (!g.imageUrl && cp.imageUrl) g.imageUrl = cp.imageUrl;
    if (cp.product) {
      g.linkedStock.set(cp.product.id, cp.product.quantityInStock - cp.product.holdQuantity);
    } else if (cp.channelStock != null) {
      g.channelStock = (g.channelStock ?? 0) + cp.channelStock;
    }
  }

  // ---- Nhịp bán + cờ thiếu giá vốn theo item (từ chính tập đơn P&L) ----
  const itemBySku = new Map<string, string>();
  for (const [itemId, g] of byItem) for (const sku of g.skus) itemBySku.set(sku, itemId);
  const since7 = Date.now() - 7 * 86_400_000;
  const sales = new Map<string, { units30d: number; units7d: number; missingCost: boolean }>();
  for (const row of pnlRows) {
    const recent = new Date(row.createdAt).getTime() >= since7;
    for (const it of row.items) {
      const itemId = itemBySku.get(it.sku);
      if (!itemId) continue;
      let s = sales.get(itemId);
      if (!s) sales.set(itemId, (s = { units30d: 0, units7d: 0, missingCost: false }));
      s.units30d += it.quantity;
      if (recent) s.units7d += it.quantity;
      if (row.missingCostPrice) s.missingCost = true;
    }
  }

  // ---- Lịch sử ads: chỉ campaign ĐÚNG 1 SP mới quy được về SP ----
  const history = new Map<string, { spend: number; gmv: number }>();
  for (const c of singleCampaigns) {
    const ids = c.itemIds.split(",").filter(Boolean);
    if (ids.length !== 1) continue;
    const h = history.get(ids[0]) ?? { spend: 0, gmv: 0 };
    for (const p of c.dailyPerf) {
      h.spend += Number(p.expense);
      h.gmv += Number(p.broadGmv);
    }
    history.set(ids[0], h);
  }

  const signalByItem = new Map(signals.map((s) => [s.itemId, s] as const));
  const shopMedianCvr = medianOrganicCvr(signals.map((s) => ({ sale: s.sale, views: s.views })));

  const rows: AdsRecommendationRow[] = breakeven.rows.map((b) => {
    const g = byItem.get(b.itemId);
    const sg = signalByItem.get(b.itemId) ?? null;
    const sale = sales.get(b.itemId);
    const h = history.get(b.itemId);
    const stockAvailable =
      g && g.linkedStock.size > 0
        ? [...g.linkedStock.values()].reduce((a, v) => a + v, 0)
        : (g?.channelStock ?? null);
    const signal: RecommendSignal | null = sg
      ? {
          sale: sg.sale,
          views: sg.views,
          ratingStar: num(sg.ratingStar),
          commentCount: sg.commentCount,
          tags: sg.shopeeTags ? sg.shopeeTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
          adBlocked: sg.adBlocked,
          roiLower: num(sg.roiLower),
          roiExact: num(sg.roiExact),
          roiUpper: num(sg.roiUpper),
          budgetMin: num(sg.budgetMin),
          budgetRecommended: num(sg.budgetRecommended),
          budgetMax: num(sg.budgetMax),
          kwSearchVolume: sg.kwSearchVolume,
          kwAvgBid: num(sg.kwAvgBid),
        }
      : null;
    const result = recommendAdsForItem({
      itemId: b.itemId,
      price: g?.price ?? 0,
      margin: b.margin,
      marginOrders: b.orders,
      missingCost: sale?.missingCost ?? false,
      revenue30d: b.revenue,
      units30d: sale?.units30d ?? 0,
      units7d: sale?.units7d ?? 0,
      stockAvailable,
      runningAds: b.runningAds,
      history: h ? { spend30d: h.spend, roas30d: h.spend > 0 ? h.gmv / h.spend : null } : null,
      signal,
      shopMedianCvr,
      dangerFactor: breakeven.safeRoasFactor,
    });
    return {
      ...result,
      productName: b.productName,
      itemSku: b.itemSku,
      imageUrl: g?.imageUrl ?? null,
      price: g?.price ?? 0,
      margin: b.margin,
      orders30d: b.orders,
      revenue30d: b.revenue,
      units30d: sale?.units30d ?? 0,
      stockAvailable,
      market: signal
        ? {
            ratingStar: signal.ratingStar,
            commentCount: signal.commentCount,
            tags: signal.tags,
            roiLower: signal.roiLower,
            roiExact: signal.roiExact,
            roiUpper: signal.roiUpper,
            kwSearchVolume: signal.kwSearchVolume,
          }
        : null,
    };
  });
  rows.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.score - a.score || b.revenue30d - a.revenue30d);

  const counts: Record<RecommendTier, number> = { run_now: 0, test_small: 0, not_yet: 0, running: 0 };
  for (const r of rows) counts[r.tier]++;
  const lastSync = signals.reduce<Date | null>(
    (max, s) => (s.baseSyncedAt && (!max || s.baseSyncedAt > max) ? s.baseSyncedAt : max),
    null
  );
  return { rows, counts, signalsSyncedAt: lastSync?.toISOString() ?? null, safeRoasFactor: breakeven.safeRoasFactor };
}

// ---------- Lệnh tạo chiến dịch từ gợi ý ----------

export interface CreateFromRecommendationInput {
  itemId: string;
  roasTarget: number;
  dailyBudget: number;
  /** Ảnh chụp đề xuất lúc bấm (mức, điểm, lựa chọn mục tiêu, lý do) — lưu nguyên. */
  proposalSnapshot: Record<string, unknown>;
}

export async function createCampaignFromRecommendation(
  channel: Channel,
  input: CreateFromRecommendationInput
): Promise<{ ok: boolean; error: string | null; campaignId: string | null }> {
  const roasTarget = Math.round(input.roasTarget * 10) / 10;
  const dailyBudget = Math.round(input.dailyBudget);
  if (!(roasTarget > 0) || !(dailyBudget > 0) || !/^\d+$/.test(input.itemId)) {
    return { ok: false, error: "Thiếu hoặc sai sản phẩm / mục tiêu ROAS / ngân sách.", campaignId: null };
  }
  const referenceId = `create-${channel.id}-${input.itemId}-${Date.now()}`;
  let raw;
  try {
    const { accessToken, shopId, cfg } = await resolveShopeeAdsAccess(channel);
    raw = await createManualProductAdsRaw(
      {
        accessToken,
        shopId,
        referenceId,
        itemId: input.itemId,
        budget: dailyBudget,
        startDate: toShopeeDate(new Date(Date.now() + 7 * 3600_000)), // ngày theo giờ VN
        biddingMethod: "auto",
        roasTarget,
      },
      cfg
    );
  } catch (err) {
    return { ok: false, error: String((err as Error).message).slice(0, 1000), campaignId: null };
  }
  if (raw.error && raw.error !== "") {
    return { ok: false, error: `${raw.error}: ${raw.message ?? ""}`, campaignId: null };
  }
  const resp = raw.response as { campaign_id?: number } | Array<{ campaign_id?: number }> | undefined;
  const cid = Array.isArray(resp) ? resp[0]?.campaign_id : resp?.campaign_id;
  if (cid == null) {
    return { ok: false, error: "Sàn báo thành công nhưng không trả campaign_id.", campaignId: null };
  }
  const campaignId = String(cid);
  const product = await prisma.channelProduct.findFirst({
    where: { channelId: channel.id, externalId: { startsWith: input.itemId } },
    select: { productName: true },
  });
  const row = await prisma.adsCampaign.upsert({
    where: { channelId_campaignId: { channelId: channel.id, campaignId } },
    update: { createdByHubsellAt: new Date(), hubsellProposal: input.proposalSnapshot as Prisma.InputJsonValue },
    create: {
      channelId: channel.id,
      campaignId,
      adType: "manual",
      name: product?.productName ?? "",
      status: "ongoing",
      biddingMethod: "auto",
      budget: dailyBudget,
      roasTarget,
      itemIds: input.itemId,
      startTime: new Date(),
      createdByHubsellAt: new Date(),
      hubsellProposal: input.proposalSnapshot as Prisma.InputJsonValue,
    },
  });
  await prisma.adsActionLog.create({
    data: {
      channelId: channel.id,
      adsCampaignId: row.id,
      action: "create",
      mode: "manual",
      verdict: "",
      reasons: `Chủ shop tạo chiến dịch từ Gợi ý chạy ads: mục tiêu ROAS ${roasTarget}x, ngân sách ${dailyBudget.toLocaleString("vi-VN")}₫/ngày.`,
      referenceId,
      status: "SUCCESS",
    },
  });
  await prisma.opsActivity.create({
    data: {
      ownerId: channel.userId,
      tag: "ads",
      message: `🚀 Tạo chiến dịch ads cho "${product?.productName ?? `#${input.itemId}`}" (gian "${channel.shopName}") từ Gợi ý Hubsell — mục tiêu ${roasTarget}x, ${dailyBudget.toLocaleString("vi-VN")}₫/ngày. Trợ lý bắt đầu gác.`,
    },
  });
  // Xung ngay để tên/trạng thái thật từ sàn về trong ≤1 nhịp.
  await requestAdsRefresh(channel.id).catch(() => undefined);
  return { ok: true, error: null, campaignId };
}
