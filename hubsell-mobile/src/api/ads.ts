import { api } from "./client";
import type { AdsOverviewResponse, AdsPlatform, AdsRecommendationsResponse } from "../types/api";

// Đường dẫn là /api/quang-cao (không phải /api/ads) — xem backend app.ts.
const base = (platform: AdsPlatform) => `/api/quang-cao/${platform}`;

/** Số quảng cáo + nhận định Trợ lý của một gian trong khoảng ngày. */
export function fetchAdsOverview(
  platform: AdsPlatform,
  params: { from: string; to: string; channelId?: string }
) {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.channelId) q.set("channelId", params.channelId);
  return api<AdsOverviewResponse>(`${base(platform)}?${q.toString()}`);
}

/** LỆNH THẬT lên sàn — tạm dừng chiến dịch. */
export function pauseAdsCampaign(platform: AdsPlatform, id: string) {
  return api<{ message: string }>(`${base(platform)}/campaigns/${id}/pause`, { method: "POST" });
}

/** LỆNH THẬT lên sàn — bật lại chiến dịch. */
export function resumeAdsCampaign(platform: AdsPlatform, id: string) {
  return api<{ message: string }>(`${base(platform)}/campaigns/${id}/resume`, { method: "POST" });
}

/** Chủ shop quyết một cảnh báo: WATCHING = theo dõi thêm, IGNORED = bỏ qua. */
export function decideAdsCampaign(
  platform: AdsPlatform,
  id: string,
  decision: "WATCHING" | "IGNORED",
  verdict: string
) {
  return api<unknown>(`${base(platform)}/campaigns/${id}/decision`, {
    method: "POST",
    body: { decision, verdict },
  });
}

// ---------- GỢI Ý CHẠY ADS theo sản phẩm (chỉ Shopee có lệnh tạo) ----------

/** Bảng gợi ý đã chấm của một gian — thuần đọc DB, nhẹ nhưng chấm cả kho SP nên không gọi theo nhịp 60s. */
export function fetchAdsRecommendations(channelId: string, platform: AdsPlatform = "shopee") {
  return api<AdsRecommendationsResponse>(
    `${base(platform)}/recommendations?channelId=${encodeURIComponent(channelId)}`
  );
}

/** Lấy số của sàn cho MỘT sản phẩm (3 call Shopee) rồi trả lại cả bảng đã chấm lại. */
export function refreshAdsRecommendationItem(channelId: string, itemId: string, safeRoas: number | null) {
  return api<AdsRecommendationsResponse>(`${base("shopee")}/recommendations/refresh-item`, {
    method: "POST",
    body: { channelId, itemId, safeRoas },
  });
}

/** LỆNH THẬT lên sàn — tạo chiến dịch 1 SP từ gợi ý (đấu thầu tự động theo ROAS mục tiêu). */
export function createAdsCampaignFromRecommendation(input: {
  channelId: string;
  itemId: string;
  roasTarget: number;
  dailyBudget: number;
  snapshot: Record<string, unknown>;
}) {
  return api<{ message: string; campaignId: string }>(`${base("shopee")}/recommendations/create`, {
    method: "POST",
    body: input,
  });
}
