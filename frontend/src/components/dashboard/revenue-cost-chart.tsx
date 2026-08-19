"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnalyticsResponse } from "@/lib/api";
import { formatCompactVND, formatVND } from "@/lib/format";
import { moneyTone, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

type DayPoint = AnalyticsResponse["revenueByDay"][number];

/** Trên ngưỡng này cột ghép thành "que tăm" → chuyển sang dải lợi nhuận. */
const BAND_THRESHOLD = 14;

const COLOR = {
  revenue: "#10b981", // emerald-500
  cost: "#94a3b8", // slate-400 — đường chi phí
  costBar: "#cbd5e1", // slate-300 — cột chi phí (như cũ)
  loss: "#ef4444", // red-500
  axis: "#64748b",
};

interface BandPoint {
  label: string;
  revenue: number;
  cost: number;
  profit: number;
  /** [thấp, cao] vùng lãi — suy biến [rev, rev] khi ngày lỗ */
  profitBand: [number, number];
  /** [thấp, cao] vùng lỗ — suy biến [cost, cost] khi ngày lãi */
  lossBand: [number, number];
}

function toBand(points: DayPoint[]): BandPoint[] {
  return points.map((p) => {
    const cost = p.cost ?? 0;
    const profit = p.revenue - cost;
    return {
      label: p.label,
      revenue: p.revenue,
      cost,
      profit,
      profitBand: profit >= 0 ? [cost, p.revenue] : [p.revenue, p.revenue],
      lossBand: profit < 0 ? [p.revenue, cost] : [cost, cost],
    };
  });
}

/** Tooltip chung: Doanh thu · Chi phí · Lãi ngày (+ biên). */
function DayTooltip({
  active,
  label,
  payload,
  showCost,
}: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ payload?: { revenue: number; cost?: number } }>;
  showCost: boolean;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const cost = p.cost ?? 0;
  const profit = p.revenue - cost;
  const margin =
    p.revenue > 0 ? Math.round((profit / p.revenue) * 1000) / 10 : null;
  return (
    <div className="rounded-lg border border-slate-200/80 bg-card px-3 py-2 text-card-foreground shadow-[0_2px_8px_-2px_rgb(15_23_42/0.15)]">
      <p className={TEXT_SUB}>Ngày {label}</p>
      <div className="mt-1 space-y-0.5 text-sm tabular-nums">
        <p className="flex justify-between gap-4">
          <span className="text-slate-500">Doanh thu</span>
          <span className="font-semibold text-slate-900">{formatVND(p.revenue)}</span>
        </p>
        {showCost && (
          <>
            <p className="flex justify-between gap-4">
              <span className="text-slate-500">Chi phí</span>
              <span className="text-slate-700">{formatVND(cost)}</span>
            </p>
            <p className="flex justify-between gap-4 border-t border-slate-100 pt-1">
              <span className="text-slate-500">Lãi ngày</span>
              <span className={cn("font-semibold", moneyTone(profit))}>
                {formatVND(profit)}
                {margin !== null && (
                  <span className="ml-1 text-xs font-normal text-slate-500">
                    ({margin}%)
                  </span>
                )}
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const yAxisProps = {
  fontSize: 12,
  tickLine: false,
  axisLine: false,
  stroke: COLOR.axis,
  width: 56,
  tickFormatter: (v: number) => formatCompactVND(v),
};

/**
 * DOANH THU vs CHI PHÍ theo ngày — THÍCH ỨNG theo độ dài kỳ:
 *  - ≤ 14 điểm (Hôm nay / 7 ngày): CỘT GHÉP — ngày là đại lượng rời rạc, so
 *    hôm nay với hôm qua bằng cột chính xác hơn; 1 điểm thì miền rỗng hoàn toàn.
 *  - > 14 điểm (30 / 90 ngày): DẢI LỢI NHUẬN — đường doanh thu + đường chi phí,
 *    tô phần giữa: xanh = ngày lãi, đỏ = ngày lỗ (Area nhận dataKey [thấp, cao]).
 *    Không xếp chồng vì chi phí không phải THÀNH PHẦN của doanh thu.
 * SALES (không có cost): cột/miền doanh thu đơn.
 */
export function RevenueCostChart({
  data,
  showCost,
  className,
}: {
  data: DayPoint[];
  showCost: boolean;
  className?: string;
}) {
  const band = data.length > BAND_THRESHOLD;

  return (
    <div className={className}>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {band ? (
            <ComposedChart data={toBand(data)} margin={{ top: 8, right: 8 }}>
              <defs>
                <linearGradient id="rc-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR.revenue} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={COLOR.revenue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
              <XAxis
                dataKey="label"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: "currentColor", strokeOpacity: 0.15 }}
                stroke={COLOR.axis}
                minTickGap={24}
              />
              <YAxis {...yAxisProps} />
              <Tooltip
                cursor={{ stroke: COLOR.axis, strokeOpacity: 0.4, strokeDasharray: "3 3" }}
                content={({ active, label, payload }) => (
                  <DayTooltip
                    active={active}
                    label={label}
                    payload={payload as ReadonlyArray<{ payload?: BandPoint }>}
                    showCost={showCost}
                  />
                )}
              />
              {showCost ? (
                <>
                  {/* Dải lãi / dải lỗ — vẽ TRƯỚC để hai đường đè lên trên */}
                  <Area
                    type="monotone"
                    dataKey="profitBand"
                    stroke="none"
                    fill={COLOR.revenue}
                    fillOpacity={0.18}
                    isAnimationActive={false}
                    activeDot={false}
                    tooltipType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="lossBand"
                    stroke="none"
                    fill={COLOR.loss}
                    fillOpacity={0.2}
                    isAnimationActive={false}
                    activeDot={false}
                    tooltipType="none"
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke={COLOR.cost}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                </>
              ) : (
                // SALES: miền doanh thu đơn với gradient nhẹ
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="none"
                  fill="url(#rc-revenue-fill)"
                  isAnimationActive={false}
                  activeDot={false}
                  tooltipType="none"
                />
              )}
              <Line
                type="monotone"
                dataKey="revenue"
                stroke={COLOR.revenue}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
              <XAxis
                dataKey="label"
                fontSize={12}
                tickLine={false}
                axisLine={{ stroke: "currentColor", strokeOpacity: 0.15 }}
                stroke={COLOR.axis}
              />
              <YAxis {...yAxisProps} />
              <Tooltip
                cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
                content={({ active, label, payload }) => (
                  <DayTooltip
                    active={active}
                    label={label}
                    payload={payload as ReadonlyArray<{ payload?: DayPoint }>}
                    showCost={showCost}
                  />
                )}
              />
              <Bar
                dataKey="revenue"
                name="revenue"
                fill={COLOR.revenue}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
              {showCost && (
                <Bar
                  dataKey="cost"
                  name="cost"
                  fill={COLOR.costBar}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Chú thích đổi theo chế độ */}
      {showCost && (
        <div className={cn(TEXT_SUB, "mt-3 flex flex-wrap items-center gap-x-4 gap-y-1")}>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "bg-emerald-500",
                band ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-sm"
              )}
            />
            Doanh thu
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                band ? "h-0.5 w-3.5 rounded-full bg-slate-400" : "size-2.5 rounded-sm bg-slate-300"
              )}
            />
            Chi phí
          </span>
          {band && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-emerald-500/25" />
                Lãi trong ngày
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-red-500/25" />
                Lỗ trong ngày
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
