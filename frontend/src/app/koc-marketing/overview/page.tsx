"use client";

import { KocPerformanceTable } from "@/components/koc/koc-performance-table";
import { KocRealData } from "@/components/koc/koc-real-data";
import { KocShell } from "@/components/koc/koc-shell";

/**
 * TỔNG QUAN NET-ROI ĐA KÊNH — màn hình chính của Mạng lưới KOC.
 *
 * Trả lời một câu hỏi duy nhất: "Đổ tiền booking + hàng mẫu cho từng KOC,
 * cuối cùng LÃI hay LỖ bao nhiêu?"
 *
 * HAI TẦNG DỮ LIỆU, TÁCH BẠCH TRÊN UI:
 *   1. KocRealData — số THẬT cấp sàn/gian hàng từ /api/koc/* (đối soát sàn
 *      ghi Order.affiliateFee). 4 thẻ chỉ số vàng + bảng gian hàng + bảng đơn.
 *   2. KocPerformanceTable — hồ sơ TỪNG KOC, vẫn PREVIEW MOCK: API seller
 *      của Shopee/Lazada không trả danh tính creator theo đơn, phải chờ
 *      TikTok Affiliate API (shop thật + scope) mới có attribution thật.
 *      Badge 3 loại + cột thao tác nhanh (gửi mẫu / booking / dừng hợp tác).
 */
export default function KocOverviewPage() {
  return (
    <KocShell>
      <KocRealData />
      <KocPerformanceTable />
      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · Tổng quan Net-ROI Đa kênh (Preview)
      </p>
    </KocShell>
  );
}
