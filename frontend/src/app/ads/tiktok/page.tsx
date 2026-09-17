import { Suspense } from "react";

import { TiktokAdsPage } from "@/components/ads/tiktok-ads-page";

/**
 * Trợ lý quảng cáo — TikTok Shop (GMV Max, TikTok Marketing API).
 *
 * 17/09/2026: app Marketing API được duyệt → thay trang "sắp ra mắt" bằng số
 * thật. Backend chưa đặt TIKTOK_ADS_* thì component tự hiện lại "sắp ra mắt".
 * Suspense: component đọc useSearchParams (?channelId=).
 */
export default function Page() {
  return (
    <Suspense>
      <TiktokAdsPage />
    </Suspense>
  );
}
