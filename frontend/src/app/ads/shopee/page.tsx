"use client";

import { Suspense } from "react";

import { ShopeeAdsPage } from "@/components/ads/shopee-ads-page";

/**
 * Trợ lý quảng cáo — Shopee (GĐ1: dashboard dữ liệu thật từ Ads API).
 * Bọc <Suspense> vì ShopeeAdsPage đọc useSearchParams (deep-link ?campaign_id=
 * từ Trung tâm điều hành) — yêu cầu của Next khi prerender.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShopeeAdsPage />
    </Suspense>
  );
}
