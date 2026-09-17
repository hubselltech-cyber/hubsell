// ============================================================
// SHOPEE — ĐỒNG BỘ TÍN HIỆU THỊ TRƯỜNG THEO SẢN PHẨM (đợt D pha 2, 17/09/2026)
//
// Ghi bảng AdsItemSignal cho tab "Gợi ý chạy ads" (trang chỉ đọc DB). Hai nhịp:
//
//   NỀN — 1 lần/ngày/gian (worker, sau lượt lịch sử ads) hoặc nút "Cập nhật số của sàn":
//     · product.get_item_extra_info   (app CHÍNH, 50 SP/call) → sale/views/sao/đánh giá
//     · ads.get_recommended_item_list (Hubsell Ads, 1 call)   → tag + trạng thái + ads đang chạy
//     · TOP ỨNG VIÊN (≤ TOP_N theo doanh thu 30 ngày, có biên lãi dương, CHƯA chạy ads):
//         ROI target (1) + từ khóa gợi ý (1) + ngân sách gợi ý (1) = 3 call/SP
//     → gian 200 SP: 4 + 1 + 90 ≈ 95 call/ngày, đi qua token bucket 3 call/s của app Ads.
//
//   THEO SP — seller mở hộp thoại một SP ngoài top (hoặc số cũ >24h): 3 call cho đúng SP đó.
//
// Thiếu quyền / sàn lỗi ở một nhánh KHÔNG chặn nhánh khác (extra_info đi app chính,
// phần ads đi Hubsell Ads). ApiBudgetError ném lên để worker lùi lịch.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isApiBudgetError } from "../../services/api-budget";
import { resolveShopeeAdsAccess, type ShopeeAdsAccess } from "../hubsell-ads";
import { getShopeeConfig } from "./config";
import { getValidShopeeAccessToken } from "./service";
import {
  getAdsBudgetSuggestionRaw,
  getAdsRecommendedItemListRaw,
  getAdsRecommendedKeywordListRaw,
  getAdsRecommendedRoiTargetRaw,
  getItemExtraInfoRaw,
  type ShopeeAdsRecommendedItem,
} from "./client";
import { computeChannelProductBreakeven } from "./ads-insights";
import { chunk } from "./ads-campaigns";

/** Số ứng viên được kéo đủ 3 tín hiệu ads mỗi lượt nền. */
export const SIGNAL_TOP_N = 30;
/** Tín hiệu nền / theo SP coi là tươi trong bấy nhiêu giờ. */
export const SIGNAL_FRESH_HOURS = 24;

const ref = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** item_status_list báo SP không đủ điều kiện ads (enum docs không liệt kê hết — bắt theo từ khóa). */
export function isAdBlockedStatus(list: string[] | undefined): boolean {
  return (list ?? []).some((s) => /block|ban|sold|delete|unlist|violat/i.test(s));
}

/** Probe ANO 17/09: sàn trả max_budget = 9999999999 nghĩa là "không giới hạn" → coi như không có trần. */
function finiteBudget(raw: unknown): number | null {
  const v = Number(raw) || 0;
  return v > 0 && v < 1_000_000_000 ? v : null;
}

/** Gộp từ khóa gợi ý thành 2 số: tổng lượt tìm và giá thầu trung bình CÓ TRỌNG SỐ lượt tìm. */
export function summarizeKeywords(
  list: Array<{ search_volume?: number; suggested_bid?: number }>
): { volume: number; avgBid: number | null; count: number } {
  let volume = 0;
  let bidWeighted = 0;
  let weight = 0;
  for (const k of list) {
    const v = Number(k.search_volume) || 0;
    const b = Number(k.suggested_bid) || 0;
    volume += v;
    if (b > 0) {
      bidWeighted += b * Math.max(v, 1);
      weight += Math.max(v, 1);
    }
  }
  return { volume, avgBid: weight > 0 ? bidWeighted / weight : null, count: list.length };
}

function unwrapRecommendedItems(
  resp: ShopeeAdsRecommendedItem[] | { item_list?: ShopeeAdsRecommendedItem[] } | undefined
): ShopeeAdsRecommendedItem[] {
  if (!resp) return [];
  return Array.isArray(resp) ? resp : (resp.item_list ?? []);
}

async function upsertSignal(channelId: string, itemId: string, data: Record<string, unknown>): Promise<void> {
  await prisma.adsItemSignal.upsert({
    where: { channelId_itemId: { channelId, itemId } },
    update: data,
    create: { channelId, itemId, ...data },
  });
}

/** 3 call tín hiệu ads cho MỘT sản phẩm. safeRoas = mục tiêu dùng hỏi ngân sách gợi ý. */
export async function syncAdsItemProposal(
  channel: Channel,
  itemId: string,
  safeRoas: number | null,
  access?: ShopeeAdsAccess
): Promise<void> {
  const a = access ?? (await resolveShopeeAdsAccess(channel));
  const base = { accessToken: a.accessToken, shopId: a.shopId };
  const data: Record<string, unknown> = { proposalSyncedAt: new Date() };

  const roi = await getAdsRecommendedRoiTargetRaw({ ...base, itemId, referenceId: ref("roi") }, a.cfg);
  const lower = Number(roi.response?.lower_bound?.value) || null;
  const exact = Number(roi.response?.exact?.value) || null;
  const upper = Number(roi.response?.upper_bound?.value) || null;
  Object.assign(data, { roiLower: lower, roiExact: exact, roiUpper: upper });

  try {
    const kw = await getAdsRecommendedKeywordListRaw({ ...base, itemId }, a.cfg);
    const sum = summarizeKeywords(kw.response?.suggested_keywords ?? []);
    Object.assign(data, {
      kwSearchVolume: sum.count > 0 ? sum.volume : null,
      kwAvgBid: sum.avgBid,
      kwCount: sum.count,
    });
  } catch (err) {
    if (isApiBudgetError(err)) throw err;
    console.warn(`[Ads-signals] Từ khóa gợi ý SP ${itemId} "${channel.shopName}":`, (err as Error).message);
  }

  // Hỏi ngân sách ở đúng mục tiêu sẽ đề xuất: giữa mức an toàn và ROAS thị trường.
  const target = safeRoas != null && exact != null && exact > safeRoas ? (safeRoas + exact) / 2 : (safeRoas ?? exact);
  if (target != null && target > 0) {
    try {
      const b = await getAdsBudgetSuggestionRaw(
        { ...base, itemId, referenceId: ref("bud"), roasTarget: Math.round(target * 10) / 10 },
        a.cfg
      );
      Object.assign(data, {
        budgetMin: Number(b.response?.budget?.min_budget) || null,
        budgetRecommended: Number(b.response?.budget?.recommended_budget) || null,
        budgetMax: finiteBudget(b.response?.budget?.max_budget),
      });
    } catch (err) {
      if (isApiBudgetError(err)) throw err;
      console.warn(`[Ads-signals] Ngân sách gợi ý SP ${itemId} "${channel.shopName}":`, (err as Error).message);
    }
  }
  await upsertSignal(channel.id, itemId, data);
}

export interface AdsItemSignalsSyncResult {
  items: number;
  extraInfo: number;
  recommended: number;
  proposals: number;
  errors: string[];
}

/** LƯỢT NỀN trọn bộ cho một gian Shopee. */
export async function syncShopeeAdsItemSignals(channel: Channel): Promise<AdsItemSignalsSyncResult> {
  const out: AdsItemSignalsSyncResult = { items: 0, extraInfo: 0, recommended: 0, proposals: 0, errors: [] };
  const now = new Date();

  const products = await prisma.channelProduct.findMany({
    where: { channelId: channel.id, externalId: { not: null }, status: "ACTIVE" },
    select: { externalId: true },
  });
  const itemIds = [...new Set(products.map((p) => (p.externalId ?? "").split("-")[0]).filter((id) => /^\d+$/.test(id)))];
  out.items = itemIds.length;
  if (itemIds.length === 0) return out;

  // 1. Lượt bán / lượt xem / sao / đánh giá — app CHÍNH (Product API).
  try {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    for (const batch of chunk(itemIds, 50)) {
      const res = await getItemExtraInfoRaw(accessToken, shopId, batch, getShopeeConfig());
      for (const it of res.response?.item_list ?? []) {
        await upsertSignal(channel.id, String(it.item_id), {
          sale: it.sale ?? null,
          views: it.views ?? null,
          likes: it.likes ?? null,
          ratingStar: it.rating_star ?? null,
          commentCount: it.comment_count ?? null,
          baseSyncedAt: now,
        });
        out.extraInfo++;
      }
    }
  } catch (err) {
    out.errors.push(`extra_info: ${(err as Error).message}`);
  }

  // 2–3. Phần Ads API — cần gian đã nối Hubsell Ads.
  let access: ShopeeAdsAccess;
  try {
    access = await resolveShopeeAdsAccess(channel);
  } catch (err) {
    out.errors.push(`ads_access: ${(err as Error).message}`);
    return out;
  }

  const runningOnShopee = new Set<string>();
  try {
    const rec = await getAdsRecommendedItemListRaw({ accessToken: access.accessToken, shopId: access.shopId }, access.cfg);
    for (const it of unwrapRecommendedItems(rec.response)) {
      const itemId = String(it.item_id);
      // Probe ANO 17/09: giá trị thật là "product_ads" | "no_ongoing_promotion" (gạch dưới).
      const ongoing = (it.ongoing_ad_type_list ?? []).filter((t) => !/no[_\s]?ongoing/i.test(t));
      if (ongoing.length > 0) runningOnShopee.add(itemId);
      await upsertSignal(channel.id, itemId, {
        shopeeTags: (it.sku_tag_list ?? []).join(","),
        adBlocked: isAdBlockedStatus(it.item_status_list),
        ongoingAdTypes: ongoing.join(","),
        baseSyncedAt: now,
      });
      out.recommended++;
    }
  } catch (err) {
    if (isApiBudgetError(err)) throw err;
    out.errors.push(`recommended_item_list: ${(err as Error).message}`);
  }

  // Top ứng viên: biên lãi dương, chưa chạy ads, doanh thu 30 ngày lớn nhất (bảng đã sort theo doanh thu).
  const breakeven = await computeChannelProductBreakeven({
    id: channel.id,
    userId: channel.userId,
    channelName: channel.channelName,
  });
  const candidates = breakeven.rows
    .filter((r) => r.breakevenRoas != null && !r.runningAds && !runningOnShopee.has(r.itemId) && /^\d+$/.test(r.itemId))
    .slice(0, SIGNAL_TOP_N);
  for (const c of candidates) {
    try {
      const safe = Math.ceil(c.breakevenRoas! * breakeven.safeRoasFactor * 10 - 1e-9) / 10;
      await syncAdsItemProposal(channel, c.itemId, safe, access);
      out.proposals++;
    } catch (err) {
      if (isApiBudgetError(err)) throw err;
      out.errors.push(`proposal ${c.itemId}: ${(err as Error).message}`);
      if (out.errors.length >= 8) break; // sàn đang lỗi hàng loạt — dừng, lượt sau thử lại
    }
  }
  return out;
}

/** Gian đã tới hạn lượt nền chưa (chưa từng / cũ hơn SIGNAL_FRESH_HOURS). */
export async function adsItemSignalsDue(channelId: string): Promise<boolean> {
  const last = await prisma.adsItemSignal.findFirst({
    where: { channelId, baseSyncedAt: { not: null } },
    orderBy: { baseSyncedAt: "desc" },
    select: { baseSyncedAt: true },
  });
  return !last?.baseSyncedAt || Date.now() - last.baseSyncedAt.getTime() > SIGNAL_FRESH_HOURS * 3_600_000;
}

/** PROBE đọc thuần — in nguyên văn 5 endpoint cho một SP để chốt shape + ngưỡng trên số thật. */
export async function probeAdsItemSignals(channel: Channel, itemId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const safe = async (key: string, fn: () => Promise<unknown>) => {
    try {
      out[key] = await fn();
    } catch (err) {
      out[key] = { error: (err as Error).message };
    }
  };
  await safe("extra_info", async () => {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    return getItemExtraInfoRaw(accessToken, shopId, [itemId], getShopeeConfig());
  });
  let access: ShopeeAdsAccess | null = null;
  await safe("ads_access", async () => {
    access = await resolveShopeeAdsAccess(channel);
    return { source: access.source };
  });
  if (access) {
    const a = access as ShopeeAdsAccess;
    const base = { accessToken: a.accessToken, shopId: a.shopId };
    await safe("recommended_item_list", async () => {
      const r = await getAdsRecommendedItemListRaw(base, a.cfg);
      const list = unwrapRecommendedItems(r.response);
      return { total: list.length, sample: list.slice(0, 5), thisItem: list.find((i) => String(i.item_id) === itemId) ?? null };
    });
    await safe("roi_target", () => getAdsRecommendedRoiTargetRaw({ ...base, itemId, referenceId: ref("probe-roi") }, a.cfg));
    await safe("keywords", async () => {
      const r = await getAdsRecommendedKeywordListRaw({ ...base, itemId }, a.cfg);
      const list = r.response?.suggested_keywords ?? [];
      return { count: list.length, summary: summarizeKeywords(list), top: list.slice(0, 8) };
    });
    await safe("budget_suggestion_at_roas_5", () =>
      getAdsBudgetSuggestionRaw({ ...base, itemId, referenceId: ref("probe-bud"), roasTarget: 5 }, a.cfg)
    );
  }
  return out;
}
