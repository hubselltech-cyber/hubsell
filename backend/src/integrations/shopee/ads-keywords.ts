// ============================================================
// TRỢ LÝ QUẢNG CÁO SHOPEE — ĐỢT C (24/09/2026): TỪ KHÓA — ĐỌC ĐƯỢC GÌ THÌ HIỆN, GỢI Ý CÓ SỐ
//
// Shopee KHÔNG cấp hiệu suất từng từ khóa qua API (Lazada có) → máy không có
// căn cứ để tự bỏ/giảm bid từ khóa; đợt C chỉ ĐỌC + ĐỐI CHIẾU, người quyết trên
// Seller Center:
//   1. Từ khóa ĐÃ CHỌN của campaign thủ công: nguyên văn manual_bidding_info
//      (info_type 2) lưu ở AdsCampaign.manualBidding mỗi xung — 0 call thêm.
//   2. Từ khóa SHOPEE GỢI Ý cho SP của campaign (get_recommended_keyword_list):
//      search_volume 30 ngày, quality_score, suggested_bid — gọi khi bấm nút,
//      cache 24h trong AdsItemSignal.kwSuggestions. Probe ANO 17/09: gọi không
//      kèm input_keyword trả rỗng → rỗng thì gọi lại kèm 2–3 chữ đầu tên SP
//      (docs: "keyword seller typed in the manually add keyword window").
//   3. Đối chiếu: từ khóa gợi ý CHƯA có trong campaign (cơ hội) + từ khóa đang
//      đặt bid CAO HƠN suggested_bid × KEYWORD_OVERPAY_FACTOR (trả giá hớ).
//      1,3 = MẶC ĐỊNH TỰ ĐẶT (docs mục 3 đợt C "> 30%"), không sàn nào công bố.
// ============================================================

import { Prisma, type Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isApiBudgetError } from "../../services/api-budget";
import { resolveShopeeAdsAccess } from "../hubsell-ads";
import { getAdsRecommendedKeywordListRaw, type ShopeeSuggestedKeyword } from "./client";
import { SIGNAL_FRESH_HOURS } from "./ads-item-signals";

export const KEYWORD_OVERPAY_FACTOR = 1.3;
/** Giữ tối đa bấy nhiêu từ khóa gợi ý trong cache (sàn thường trả vài chục). */
export const KEYWORD_CACHE_TOP_N = 60;

export interface SelectedKeyword {
  keyword: string;
  matchType: string;
  bid: number;
  status: string;
}

export interface CampaignKeywords {
  enhancedCpc: boolean;
  selected: SelectedKeyword[];
  discovery: { location: string; active: boolean; bid: number }[];
}

/** Chuẩn hóa JSON manual_bidding_info của sàn thành khối gọn cho UI — THUẦN. */
export function parseManualBidding(raw: unknown): CampaignKeywords | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    enhanced_cpc?: unknown;
    selected_keywords?: Array<Record<string, unknown>>;
    discovery_ads_locations?: Array<Record<string, unknown>>;
  };
  const selected: SelectedKeyword[] = (r.selected_keywords ?? [])
    .map((k) => ({
      keyword: String(k.keyword ?? "").trim(),
      matchType: String(k.match_type ?? ""),
      bid: Number(k.bid_price_per_click) || 0,
      status: String(k.status ?? ""),
    }))
    .filter((k) => k.keyword !== "");
  const discovery = (r.discovery_ads_locations ?? [])
    .map((d) => ({
      location: String(d.location ?? ""),
      active: String(d.status ?? "") === "active",
      bid: Number(d.bid_price) || 0,
    }))
    .filter((d) => d.location !== "");
  if (selected.length === 0 && discovery.length === 0) return null;
  return { enhancedCpc: r.enhanced_cpc === true, selected, discovery };
}

export interface KeywordSuggestionRow {
  keyword: string;
  qualityScore: number | null;
  searchVolume: number | null;
  suggestedBid: number | null;
  inCampaign: boolean;
  currentBid: number | null;
  overpaid: boolean;
}

/** Từ khóa đang CHẠY trong campaign (deleted / blacklist không tính). */
function isLiveKeyword(k: SelectedKeyword): boolean {
  return k.status === "normal" || k.status === "reserved" || k.status === "";
}

/**
 * Đối chiếu từ khóa Shopee gợi ý với từ khóa đang chọn — THUẦN, vitest đánh thẳng.
 * Xếp: từ khóa đang trả giá hớ trước (mất tiền), rồi gợi ý chưa có theo lượt tìm giảm dần.
 */
export function mergeKeywordSignals(
  selected: SelectedKeyword[],
  suggestions: ShopeeSuggestedKeyword[],
  overpayFactor: number = KEYWORD_OVERPAY_FACTOR
): { rows: KeywordSuggestionRow[]; selectedWithoutSuggestion: SelectedKeyword[] } {
  const live = selected.filter(isLiveKeyword);
  const byKey = new Map(live.map((k) => [k.keyword.toLowerCase(), k] as const));
  const seen = new Set<string>();
  const rows: KeywordSuggestionRow[] = [];
  for (const s of suggestions) {
    const keyword = String(s.keyword ?? "").trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const cur = byKey.get(key) ?? null;
    const suggestedBid = Number(s.suggested_bid) > 0 ? Number(s.suggested_bid) : null;
    const currentBid = cur ? cur.bid : null;
    rows.push({
      keyword,
      qualityScore: Number.isFinite(Number(s.quality_score)) && s.quality_score != null ? Number(s.quality_score) : null,
      searchVolume: Number.isFinite(Number(s.search_volume)) && s.search_volume != null ? Number(s.search_volume) : null,
      suggestedBid,
      inCampaign: cur != null,
      currentBid,
      overpaid: cur != null && suggestedBid != null && currentBid != null && currentBid > suggestedBid * overpayFactor,
    });
  }
  rows.sort((a, b) => {
    if (a.overpaid !== b.overpaid) return a.overpaid ? -1 : 1;
    if (a.inCampaign !== b.inCampaign) return a.inCampaign ? 1 : -1;
    return (b.searchVolume ?? 0) - (a.searchVolume ?? 0);
  });
  const selectedWithoutSuggestion = live.filter((k) => !seen.has(k.keyword.toLowerCase()));
  return { rows, selectedWithoutSuggestion };
}

/** 2–3 chữ đầu tên SP làm input_keyword khi sàn trả rỗng — THUẦN. */
export function inputKeywordFromName(name: string | null | undefined): string {
  const words = String(name ?? "")
    .replace(/[\[\](){}|/\\,.!?:;"']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 3).join(" ").toLowerCase();
}

export interface KeywordSuggestionsResult {
  itemId: string;
  fromCache: boolean;
  syncedAt: Date | null;
  inputKeyword: string;
  overpayFactor: number;
  rows: KeywordSuggestionRow[];
  selectedWithoutSuggestion: SelectedKeyword[];
}

/**
 * Từ khóa Shopee gợi ý cho SP của campaign (cache 24h) đối chiếu với từ khóa đang chọn.
 * Gọi sàn tối đa 2 lần/lượt (không kèm input_keyword, rỗng → kèm chữ đầu tên SP).
 */
export async function getCampaignKeywordSuggestions(
  channel: Channel,
  row: { id: string; itemIds: string; manualBidding: unknown }
): Promise<KeywordSuggestionsResult> {
  const itemId = (row.itemIds || "").split(",").map((s) => s.trim()).filter(Boolean)[0] ?? "";
  if (!itemId) throw new Error("Chiến dịch chưa có sản phẩm để hỏi từ khóa gợi ý.");
  const selected = parseManualBidding(row.manualBidding)?.selected ?? [];

  const cached = await prisma.adsItemSignal.findUnique({
    where: { channelId_itemId: { channelId: channel.id, itemId } },
    select: { kwSuggestions: true, kwSuggestionsAt: true },
  });
  const fresh =
    cached?.kwSuggestionsAt != null && Date.now() - cached.kwSuggestionsAt.getTime() < SIGNAL_FRESH_HOURS * 3_600_000;
  let list: ShopeeSuggestedKeyword[] = [];
  let inputKeyword = "";
  let syncedAt: Date | null = cached?.kwSuggestionsAt ?? null;
  if (fresh && cached?.kwSuggestions && typeof cached.kwSuggestions === "object") {
    const c = cached.kwSuggestions as { list?: ShopeeSuggestedKeyword[]; inputKeyword?: string };
    list = c.list ?? [];
    inputKeyword = c.inputKeyword ?? "";
  } else {
    const a = await resolveShopeeAdsAccess(channel);
    const base = { accessToken: a.accessToken, shopId: a.shopId, itemId };
    try {
      const r1 = await getAdsRecommendedKeywordListRaw(base, a.cfg);
      list = r1.response?.suggested_keywords ?? [];
      if (list.length === 0) {
        const product = await prisma.channelProduct.findFirst({
          where: { channelId: channel.id, OR: [{ externalId: itemId }, { externalId: { startsWith: `${itemId}-` } }] },
          select: { productName: true },
        });
        inputKeyword = inputKeywordFromName(product?.productName);
        if (inputKeyword) {
          const r2 = await getAdsRecommendedKeywordListRaw({ ...base, inputKeyword }, a.cfg);
          list = r2.response?.suggested_keywords ?? [];
        }
      }
    } catch (err) {
      if (isApiBudgetError(err)) throw err;
      throw new Error(`Shopee không trả từ khóa gợi ý: ${(err as Error).message}`);
    }
    list = list.slice(0, KEYWORD_CACHE_TOP_N);
    syncedAt = new Date();
    const payload = { list, inputKeyword } as unknown as Prisma.InputJsonValue;
    await prisma.adsItemSignal.upsert({
      where: { channelId_itemId: { channelId: channel.id, itemId } },
      update: { kwSuggestions: payload, kwSuggestionsAt: syncedAt },
      create: { channelId: channel.id, itemId, kwSuggestions: payload, kwSuggestionsAt: syncedAt },
    });
  }
  const merged = mergeKeywordSignals(selected, list);
  return { itemId, fromCache: fresh, syncedAt, inputKeyword, overpayFactor: KEYWORD_OVERPAY_FACTOR, ...merged };
}
