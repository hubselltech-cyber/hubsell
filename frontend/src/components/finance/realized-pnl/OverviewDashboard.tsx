"use client";

/**
 * TAB "TỔNG QUAN LỢI NHUẬN" của trang Lãi/Lỗ thực hiện — bản thiết kế lại
 * 08/11/2026 (docs/LAI-LO-TONG-QUAN-LOI-NHUAN.md; khảo sát chuẩn báo cáo
 * Shopify / sellerboard / TrueProfit / TikTok Seller Center / Haravan / Sapo).
 *
 * Bố cục, trên xuống theo thứ tự khách xem hằng ngày:
 *   1. Dải KPI: Lãi đơn hàng · Doanh thu thực nhận · Biên lãi · Thất thu hoàn —
 *      mỗi thẻ có % so kỳ liền trước + đường sóng theo ngày.
 *   2. Lãi theo ngày (cột theo dấu + đường kỳ trước, MỘT trục) · Cầu nối "Từ
 *      lãi đơn hàng đến lợi nhuận ròng" (khớp Báo cáo dòng tiền).
 *   3. Top sản phẩm theo LÃI: Lãi cao nhất / Đang lỗ / Tăng mạnh / Giảm mạnh.
 *   4. Lãi theo sàn (bảng trọn bề ngang).
 *   5. Phân bố đơn theo biên lãi · Thất thu đơn hoàn bóc 3 khoản.
 *   6. Giờ vàng (thứ × giờ).
 *
 * Số liệu lấy NGUYÊN KHỐI từ /api/finance/realized-pnl/insights (SUM/GROUP BY
 * trên sổ cái, cùng bộ lọc với bảng) — component KHÔNG tự tính lại tài chính,
 * chỉ cộng trừ hiển thị. `summary` của bảng vẫn truyền vào để tương thích khi
 * insights chưa về (lệch pha deploy web/backend): khi đó chỉ hiện dải KPI cũ.
 */

import { Card, CardContent } from "@/components/ui/card";
import type { RealizedPnlInsights, RealizedPnlSummary } from "@/lib/api";
import { formatDayVN, previousRange, rangeDayCount, type DateRange } from "@/lib/date-range";

import { KpiRow } from "./overview/kpi-row";
import { MarginDistributionCard } from "./overview/margin-distribution-card";
import { OrderHeatmap } from "./overview/order-heatmap";
import { PlatformCompareCard } from "./overview/platform-compare-card";
import { ProfitBridgeCard } from "./overview/profit-bridge-card";
import { ProfitTrendChart } from "./overview/profit-trend-chart";
import { ReturnLossCard } from "./overview/return-loss-card";
import { TopProductsCard } from "./overview/top-products-card";

export function OverviewDashboard({
  summary,
  insights,
  range,
  lossOnly,
  onToggleLossOnly,
}: {
  summary: RealizedPnlSummary;
  insights: RealizedPnlInsights | null;
  range: DateRange;
  lossOnly: boolean;
  onToggleLossOnly: () => void;
}) {
  if (!insights) {
    // Backend cũ chưa có /insights (web lên trước vài phút) — không vỡ trang.
    return (
      <Card className="shadow-sm">
        <CardContent>
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang cập nhật số liệu phân tích cho {summary.count.toLocaleString("vi-VN")} đơn… Tải lại trang sau ít phút.
          </p>
        </CardContent>
      </Card>
    );
  }

  const prev = previousRange(range);
  const prevHint = `so với kỳ liền trước cùng độ dài (${formatDayVN(prev.from)} – ${formatDayVN(prev.to)})`;
  const hasPrev = insights.previous != null;
  const days = rangeDayCount(range);

  return (
    <div className="space-y-4">
      <KpiRow insights={insights} prevHint={prevHint} />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className={insights.bridge ? "lg:col-span-7" : "lg:col-span-12"}>
          <ProfitTrendChart daily={insights.daily} hasPrev={hasPrev} />
        </div>
        {insights.bridge && (
          <div className="lg:col-span-5">
            <ProfitBridgeCard bridge={insights.bridge} />
          </div>
        )}
      </div>

      <TopProductsCard top={insights.topProducts} prevHint={prevHint} />

      {/* Bảng 8 cột cần trọn bề ngang ở 1280 (nửa card = 543px thì phải cuộn ngang). */}
      <PlatformCompareCard platforms={insights.byPlatform} prevHint={prevHint} />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <MarginDistributionCard
          buckets={insights.marginBuckets}
          totalCount={insights.current.count}
          lossOnly={lossOnly}
          onToggleLossOnly={onToggleLossOnly}
        />
        <ReturnLossCard current={insights.current} previous={insights.previous} prevHint={prevHint} />
      </div>

      <OrderHeatmap cells={insights.heatmap} days={days} />
    </div>
  );
}
