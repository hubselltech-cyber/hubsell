import { api } from "./client";
import type {
  TiktokAdsCampaignVideos,
  TiktokAdsDashboard,
  TiktokAdsVideoHistoryPage,
  TiktokProductBreakevenData,
  TiktokVideoMeta,
} from "../types/api";

/**
 * Trợ lý quảng cáo TikTok (GMV Max) — cùng API với web, backend không đổi
 * (docs/ADS-TIKTOK-TREN-MOBILE.md). Đường dẫn /api/quang-cao/tiktok (tránh
 * chữ ads bị adblock chặn). Lệnh DUY NHẤT lên sàn là loại / khôi phục video.
 */
const BASE = "/api/quang-cao/tiktok";

/** Tổng quan + chiến dịch (có nhận định, tự động, hòa vốn) — đọc DB, nhẹ. */
export function fetchTiktokAdsDashboard(params: { from: string; to: string; channelId?: string }) {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.channelId) q.set("channelId", params.channelId);
  return api<TiktokAdsDashboard>(`${BASE}?${q.toString()}`);
}

/** Video của một chiến dịch — gọi TikTok sống 2–3 lượt, chỉ gọi khi mở màn Video. */
export function fetchTiktokCampaignVideos(campaignRowId: string, range: { from: string; to: string }) {
  return api<TiktokAdsCampaignVideos>(
    `${BASE}/campaigns/${encodeURIComponent(campaignRowId)}/videos?from=${range.from}&to=${range.to}`
  );
}

/**
 * Lịch sử loại / khôi phục CHIA TRANG (24/10/2026): 20 lệnh/trang, chỉ đọc DB — không gọi TikTok,
 * nên lật trang không tốn quota sàn. Payload /videos vẫn mang `actions` 10 lệnh mới nhất (bản
 * 1.4.0 đọc), tab Lịch sử từ 1.4.1 đọc route này. `cursor` lấy từ `nextCursor` trang trước.
 */
export function fetchTiktokVideoHistory(campaignRowId: string, cursor?: string | null) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return api<TiktokAdsVideoHistoryPage>(
    `${BASE}/campaigns/${encodeURIComponent(campaignRowId)}/videos/history${q}`
  );
}

/** LỆNH THẬT lên TikTok: REMOVE = loại video khỏi chiến dịch, ADD = khôi phục. Chỉ chủ shop. */
export function sendTiktokVideoAction(
  campaignRowId: string,
  action: "REMOVE" | "ADD",
  items: { videoId: string; spuId: string; cost: number; orders: number }[]
) {
  return api<{ ok: true; count: number; message: string }>(
    `${BASE}/campaigns/${encodeURIComponent(campaignRowId)}/videos/action`,
    { method: "POST", body: { action, items } }
  );
}

/** Ảnh bìa + kênh + caption (≤ 24 mã) — oEmbed công khai, đang hay bị TikTok chặn: lỗi thì bỏ qua. */
export function fetchTiktokVideoMeta(videoIds: string[]) {
  return api<{ items: Record<string, TiktokVideoMeta> }>(`${BASE}/video-meta?ids=${videoIds.join(",")}`);
}

/**
 * Hòa vốn + nhận định Nên chạy / Chạy thử / Chưa nên của TỪNG sản phẩm (tab Gợi ý, 17/10).
 * Chỉ đọc DB (không gọi TikTok) — gian chưa nối quảng cáo vẫn có; chấm cả kho SP nên không
 * gọi theo nhịp 60s, chỉ khi đổi gian / kéo xuống làm mới.
 */
export function fetchTiktokProductBreakeven(channelId?: string) {
  const qs = channelId ? `?channelId=${encodeURIComponent(channelId)}` : "";
  return api<TiktokProductBreakevenData>(`${BASE}/product-breakeven${qs}`);
}

/** Kéo lại số từ TikTok cho gian (kéo-xuống-làm-mới). */
export function requestTiktokAdsRefresh(channelId: string) {
  return api<unknown>(`${BASE}/refresh`, { method: "POST", body: { channelId } });
}
