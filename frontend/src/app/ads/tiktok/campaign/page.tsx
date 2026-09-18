import { Suspense } from "react";

import { TiktokCampaignPage } from "@/components/ads/tiktok-campaign-page";

/**
 * Soi video của một chiến dịch GMV Max — /ads/tiktok/campaign?id=<AdsCampaign.id>&from=&to= (khoảng ngày mang từ Tổng quan).
 * Dùng query thay route động cho đồng bộ với cả app (?channelId=…). Suspense: đọc useSearchParams.
 */
export default function Page() {
  return (
    <Suspense>
      <TiktokCampaignPage />
    </Suspense>
  );
}
