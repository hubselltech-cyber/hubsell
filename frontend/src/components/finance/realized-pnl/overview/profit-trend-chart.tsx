"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PnlInsightDaily } from "@/lib/api";
import { formatCompactVND, formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

// Màu tín hiệu + màu kỳ trước (slate-400) — hex trùng thang chuẩn để khối
// .dark của globals.css lật được (svg [stroke="#e2e8f0"] …).
const COLOR = { profit: "#10b981", loss: "#ef4444", prev: "#94a3b8", grid: "#e2e8f0", axis: "#64748b" };

function dayLabel(key: string | null): string {
  if (!key) return "";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PnlInsightDaily }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-900">{dayLabel(d.date)}</p>
      <p className={cn("mt-1 tabular-nums", d.profit >= 0 ? "text-emerald-600" : "text-red-500")}>
        Lãi đơn hàng: {formatVND(d.profit)}
      </p>
      <p className="tabular-nums text-slate-700">{formatNumber(d.orderCount)} đơn phát sinh</p>
      {d.returnLoss > 0 && <p className="tabular-nums text-slate-700">Thất thu hoàn: {formatVND(d.returnLoss)}</p>}
      {d.prevDate && (
        <p className="mt-1 border-t pt-1 tabular-nums text-slate-500">
          Kỳ trước ({dayLabel(d.prevDate)}): {formatVND(d.prevProfit ?? 0)} · {formatNumber(d.prevOrderCount ?? 0)} đơn
        </p>
      )}
    </div>
  );
}

/**
 * LÃI ĐƠN HÀNG THEO NGÀY — cột theo dấu (xanh lãi / đỏ lỗ) + đường mảnh xám
 * là cùng ngày thứ k của kỳ trước. MỘT trục tiền (bản cũ gộp trục % tỷ lệ
 * hoàn lên cùng biểu đồ — hai thang đo một hình, bỏ).
 */
export function ProfitTrendChart({ daily, hasPrev }: { daily: PnlInsightDaily[]; hasPrev: boolean }) {
  const many = daily.length > 45;
  return (
    <Card className="h-full shadow-sm">
      <CardHeader>
        <CardTitle>Lãi đơn hàng theo ngày</CardTitle>
        <CardDescription>
          Cột: lãi của đơn phát sinh trong ngày{hasPrev ? " · Đường: cùng ngày của kỳ liền trước" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLOR.grid} />
              <XAxis
                dataKey="label"
                fontSize={12}
                tickLine={false}
                axisLine={{ stroke: COLOR.grid }}
                stroke={COLOR.axis}
                interval={many ? Math.ceil(daily.length / 15) - 1 : "preserveStartEnd"}
                minTickGap={16}
              />
              <YAxis
                fontSize={12}
                tickLine={false}
                axisLine={false}
                stroke={COLOR.axis}
                width={56}
                tickFormatter={formatCompactVND}
              />
              <ReferenceLine y={0} stroke={COLOR.axis} strokeOpacity={0.4} />
              <Tooltip cursor={{ fill: "#f1f5f9" }} content={<TrendTooltip />} />
              <Bar dataKey="profit" name="Lãi đơn hàng" radius={[4, 4, 0, 0]} maxBarSize={many ? 10 : 22} isAnimationActive={false}>
                {daily.map((d) => (
                  <Cell key={d.date} fill={d.profit >= 0 ? COLOR.profit : COLOR.loss} />
                ))}
              </Bar>
              {hasPrev && (
                <Line
                  type="monotone"
                  dataKey="prevProfit"
                  name="Kỳ trước"
                  stroke={COLOR.prev}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className={cn(TEXT_SUB, "mt-3 flex flex-wrap items-center gap-4")}>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: COLOR.profit }} /> Ngày lãi
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: COLOR.loss }} /> Ngày lỗ
          </span>
          {hasPrev && (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ backgroundColor: COLOR.prev }} /> Kỳ trước
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
