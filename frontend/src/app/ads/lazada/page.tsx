"use client";

import { Suspense } from "react";

import { ShopeeAdsPage } from "@/components/ads/shopee-ads-page";

/**
 * Trợ lý quảng cáo — Lazada (GĐ1+2: dashboard dữ liệu thật từ Sponsored
 * Solutions API + rule engine khuyến nghị, 12/08/2026). Dùng chung component
 * với Shopee qua prop platform — backend /api/ads/lazada trả payload y hệt.
 * Bọc <Suspense> vì trang đọc useSearchParams (yêu cầu của Next khi prerender).
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShopeeAdsPage platform="lazada" />
    </Suspense>
  );
}
