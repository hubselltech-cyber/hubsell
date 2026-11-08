"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PnlMarginBucket } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

// Thang MỘT màu nhạt → đậm theo bậc biên (dữ liệu có thứ tự), riêng "Lỗ" đỏ.
const FILL: Record<string, string> = {
  loss: "#ef4444", // red-500
  m0: "#a7f3d0", // emerald-200
  m10: "#6ee7b7", // emerald-300
  m20: "#34d399", // emerald-400
  m30: "#10b981", // emerald-500
  m50: "#059669", // emerald-600
};

function BucketTooltip({ active, payload }: { active?: boolean; payload?: { payload: PnlMarginBucket }[] }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-900">Biên lãi {b.label.toLowerCase()}</p>
      <p className="mt-1 tabular-nums text-slate-700">{formatNumber(b.count)} đơn</p>
      <p className={cn("tabular-nums", b.profit >= 0 ? "text-emerald-600" : "text-red-500")}>Σ lãi: {formatVND(b.profit)}</p>
      <p className="tabular-nums text-slate-700">Σ doanh thu thực nhận: {formatVND(b.netRevenue)}</p>
    </div>
  );
}

/**
 * PHÂN BỐ ĐƠN THEO BIÊN LÃI — trả lời "đơn của tôi lãi dày hay mỏng, bao nhiêu
 * đơn đang lỗ?". Bậc theo % (lãi ÷ doanh thu thực nhận) nên shop bán 50 k hay
 * 5 tr đọc cùng một thang. Nút "Xem N đơn lỗ" bật chip "Lợi nhuận âm" của trang.
 */
export function MarginDistributionCard({
  buckets,
  totalCount,
  lossOnly,
  onToggleLossOnly,
}: {
  buckets: PnlMarginBucket[];
  totalCount: number;
  lossOnly: boolean;
  onToggleLossOnly: () => void;
}) {
  const drawn = buckets.filter((b) => b.key !== "none");
  const none = buckets.find((b) => b.key === "none");
  const loss = buckets.find((b) => b.key === "loss");
  const withRevenue = drawn.reduce((s, b) => s + b.count, 0);
  const share = (n: number) => (withRevenue > 0 ? `${((n / withRevenue) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} %` : "");

  return (
    <Card className="h-full shadow-sm">
      <CardHeader>
        <CardTitle>Phân bố đơn theo biên lãi</CardTitle>
        <CardDescription>Biên lãi của mỗi đơn = lãi ÷ doanh thu thực nhận. Số trên cột là số đơn.</CardDescription>
      </CardHeader>
      <CardContent>
        {withRevenue === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Kỳ này chưa có đơn nào có doanh thu thực nhận.</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={drawn} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} stroke="#64748b" interval={0} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="#64748b" width={40} allowDecimals={false} tickFormatter={(v: number) => formatNumber(v)} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} content={<BucketTooltip />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                  {drawn.map((b) => (
                    <Cell key={b.key} fill={FILL[b.key] ?? "#94a3b8"} />
                  ))}
                  <LabelList dataKey="count" position="top" fontSize={11} fill="#64748b" formatter={(v) => { const n = Number(v); return n > 0 ? `${formatNumber(n)} · ${share(n)}` : ""; }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className={cn(TEXT_SUB, "mt-3 flex flex-wrap items-center justify-between gap-2")}>
          <span>
            {formatNumber(withRevenue)} / {formatNumber(totalCount)} đơn có doanh thu thực nhận
            {none && none.count > 0 && <> · {formatNumber(none.count)} đơn hủy / hoàn đủ không xếp bậc</>}
          </span>
          {loss && loss.count > 0 && (
            <Button
              variant={lossOnly ? "default" : "outline"}
              size="sm"
              className="h-7 rounded-full border-rose-200 px-3 text-xs text-red-500 hover:bg-rose-50"
              onClick={onToggleLossOnly}
            >
              {lossOnly ? "Đang xem đơn lỗ — bỏ lọc" : `Xem ${formatNumber(loss.count)} đơn lỗ (${formatVND(loss.profit)})`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
