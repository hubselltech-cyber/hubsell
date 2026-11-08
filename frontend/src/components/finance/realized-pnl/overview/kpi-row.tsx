"use client";

import { AlertTriangle, Percent, RotateCcw, Wallet, WalletCards } from "lucide-react";

import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { HintIcon } from "@/components/finance/hint-icon";
import { MissingCostNote } from "@/components/finance/missing-cost-note";
import { Money } from "@/components/ui/money";
import { CHANNEL_META } from "@/lib/channel-meta";
import type { ChannelName, RealizedPnlInsights } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";

import { DeltaBadge, deltaPercent } from "./delta-badge";

const PLATFORMS: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA"];

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
function fmtPct(v: number): string {
  return `${v.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} %`;
}

/**
 * 4 THẺ CHỈ SỐ của tab Tổng quan Lợi nhuận — mỗi thẻ có huy hiệu so kỳ liền
 * trước + đường sóng theo ngày (cùng DashboardCard với Tổng quan / Dòng tiền).
 *
 * Thẻ 1 cố ý gọi là "Lãi đơn hàng" chứ KHÔNG phải "Lợi nhuận ròng": số này là
 * tiền sàn trả về ví − giá vốn, chưa trừ quảng cáo và chi phí vận hành. Tên
 * "Lợi nhuận ròng" chỉ dành cho Báo cáo dòng tiền / Tổng quan (khách từng thắc
 * mắc hai trang hai số, 08/11/2026) — khối Cầu nối bên dưới nối hai số lại.
 */
export function KpiRow({ insights, prevHint }: { insights: RealizedPnlInsights; prevHint: string }) {
  const cur = insights.current;
  const prev = insights.previous;
  const daily = insights.daily;

  const margin = pct(cur.profit, cur.netRevenue);
  const prevMargin = prev ? pct(prev.profit, prev.netRevenue) : null;
  const returnRate = pct(cur.returnCount, cur.count);
  const prevReturnRate = prev ? pct(prev.returnCount, prev.count) : null;
  const perOrder = cur.count > 0 ? cur.profit / cur.count : 0;

  // Sàn có tỷ lệ hoàn cao nhất (chỉ xét sàn có đơn trong kỳ).
  const worst = insights.byPlatform
    .filter((p) => p.count > 0 && PLATFORMS.includes(p.key as ChannelName))
    .map((p) => ({ key: p.key as ChannelName, rate: pct(p.returnCount, p.count), returnCount: p.returnCount }))
    .reduce<{ key: ChannelName; rate: number; returnCount: number } | null>(
      (acc, p) => (acc === null || p.rate > acc.rate ? p : acc),
      null
    );

  const profitTone = cur.profit >= 0 ? "positive" : "negative";

  return (
    // 2 × 2 tới 1536px: ở 1280 vùng nội dung ~945px, chia 4 thì mỗi thẻ ~225px —
    // số 9 chữ số + huy hiệu kỳ trước không còn chỗ (đo 08/11: ô số rộng 46px).
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      <DashboardCard
        title={
          <>
            Lãi đơn hàng
            <HintIcon
              hint={
                <>
                  <b>Tiền sàn trả về ví − giá vốn</b> của mọi đơn khớp bộ lọc.
                  <br />• Đã trừ: phí sàn, thuế sàn, voucher shop, tiền hoàn khách.
                  <br />• CHƯA trừ: quảng cáo sàn, chi phí vận hành nhập tay.
                  <br />
                  Muốn ra Lợi nhuận ròng xem khối &quot;Từ lãi đơn hàng đến lợi nhuận ròng&quot;.
                </>
              }
            />
          </>
        }
        value={<Money value={cur.profit} />}
        icon={Wallet}
        tone={profitTone}
        featured
        headerRight={<DeltaBadge delta={deltaPercent(cur.profit, prev?.profit)} hint={prevHint} />}
        subtitle={
          <>
            {formatNumber(cur.count)} đơn · {formatNumber(cur.settledCount)} đã đối soát
            <MissingCostNote summary={insights.missingCost} className="mt-0.5 block text-amber-600" />
          </>
        }
        sparkline={{ data: daily.map((d) => d.profit), tone: cur.profit >= 0 ? "positive" : "negative" }}
      />

      <DashboardCard
        title={
          <>
            Doanh thu thực nhận
            <HintIcon hint="Tiền sàn trả về ví sau khi trừ phí, thuế sàn và tiền hoàn khách — chưa trừ giá vốn." />
          </>
        }
        value={<Money value={cur.netRevenue} />}
        icon={WalletCards}
        tone="info"
        headerRight={<DeltaBadge delta={deltaPercent(cur.netRevenue, prev?.netRevenue)} hint={prevHint} />}
        subtitle={<>Lãi mỗi đơn {formatVND(Math.round(perOrder))}</>}
        sparkline={{ data: daily.map((d) => d.netRevenue), tone: "positive" }}
      />

      <DashboardCard
        title={
          <>
            Biên lãi đơn hàng
            <HintIcon hint="Lãi đơn hàng ÷ doanh thu thực nhận. Mỗi 100 đ về ví giữ lại được bao nhiêu sau giá vốn." />
          </>
        }
        value={<span className={cn(margin < 0 && "text-red-500")}>{fmtPct(margin)}</span>}
        icon={Percent}
        tone="accent"
        headerRight={
          <DeltaBadge
            delta={prevMargin == null ? null : margin - prevMargin}
            unit="pt"
            hint={prevHint}
          />
        }
        subtitle={prevMargin == null ? "Chưa có kỳ trước để so" : <>Kỳ trước {fmtPct(prevMargin)}</>}
        sparkline={{
          data: daily.map((d) => (d.netRevenue > 0 ? (d.profit / d.netRevenue) * 100 : 0)),
          tone: "positive",
        }}
      />

      <DashboardCard
        title={
          <>
            Thất thu do đơn hoàn
            <HintIcon hint="Vốn chưa thu hồi + tiền sàn giữ lại + hoàn tiền khách giữ hàng của các đơn hoàn/trả trong kỳ." />
          </>
        }
        value={<Money value={cur.returnLoss.total} negative={cur.returnLoss.total > 0} />}
        icon={cur.returnLoss.total > 0 ? AlertTriangle : RotateCcw}
        tone="negative"
        colorValue={cur.returnLoss.total > 0}
        headerRight={
          <DeltaBadge
            delta={deltaPercent(cur.returnLoss.total, prev?.returnLoss.total)}
            inverted
            hint={prevHint}
          />
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1.5">
            Tỷ lệ hoàn {fmtPct(returnRate)}
            {prevReturnRate != null && (
              <DeltaBadge delta={returnRate - prevReturnRate} unit="pt" inverted hint={prevHint} />
            )}
            · {formatNumber(cur.returnCount)} đơn
            {worst && worst.returnCount > 0 && (
              <>
                · cao nhất{" "}
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-medium",
                    CHANNEL_META[worst.key].className
                  )}
                >
                  {CHANNEL_META[worst.key].label} {fmtPct(worst.rate)}
                </span>
              </>
            )}
          </span>
        }
        sparkline={{ data: daily.map((d) => d.returnLoss), tone: "warning" }}
      />
    </div>
  );
}
