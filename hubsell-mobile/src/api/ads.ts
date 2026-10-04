import { api } from "./client";
import type { AdsOverviewResponse, AdsPlatform } from "../types/api";

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
