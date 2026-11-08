"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChannelName, PnlPlatformInsight } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { CHANNEL_COLOR_FALLBACK, CHANNEL_COLORS } from "@/lib/chart-colors";
import { formatNumber, formatVND } from "@/lib/format";
import { moneyTone, TABLE_HEAD_EMPHASIS, TEXT_NUMBER_MUTED, TEXT_NUMBER_STRONG, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { DeltaBadge, deltaPercent } from "./delta-badge";

const CELL = "px-3 py-2.5";
const ORDER: string[] = ["SHOPEE", "TIKTOK", "LAZADA", "OFFLINE"];

function pct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} %`;
}
function labelOf(key: string): string {
  return (CHANNEL_META as Record<string, { label: string }>)[key]?.label ?? key;
}

/**
 * LÃI THEO SÀN — một bảng thay cho 3 biểu đồ cột nhỏ (mỗi biểu đồ 3 cột không
 * nói được gì hơn 3 con số). Thanh mảnh trên đầu = tỷ trọng lãi từng sàn (màu
 * nhận diện sàn), bảng: đơn · doanh thu · lãi + so kỳ trước · biên · hoàn ·
 * thất thu · đơn lỗ. Sàn xếp theo lãi giảm dần.
 */
export function PlatformCompareCard({ platforms, prevHint }: { platforms: PnlPlatformInsight[]; prevHint: string }) {
  const rows = [...platforms].sort(
    (a, b) => b.profit - a.profit || ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
  );
  const positiveTotal = rows.reduce((s, p) => s + Math.max(0, p.profit), 0);
  const colorOf = (key: string) => CHANNEL_COLORS[key] ?? CHANNEL_COLOR_FALLBACK;

  return (
    <Card className="h-full shadow-sm">
      <CardHeader>
        <CardTitle>Lãi theo sàn</CardTitle>
        <CardDescription>Cùng kỳ &amp; bộ lọc hiện tại. Thanh trên: sàn nào đang gánh phần lãi.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-muted-foreground">Chưa có đơn ở sàn nào trong kỳ.</p>
        ) : (
          <>
            <div className="px-4 pb-4">
              <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100">
                {positiveTotal > 0 &&
                  rows
                    .filter((p) => p.profit > 0)
                    .map((p) => (
                      <div
                        key={p.key}
                        title={`${labelOf(p.key)}: ${formatVND(p.profit)}`}
                        style={{ width: `${(p.profit / positiveTotal) * 100}%`, backgroundColor: colorOf(p.key) }}
                      />
                    ))}
              </div>
              <div className={cn(TEXT_SUB, "mt-2 flex flex-wrap gap-x-4 gap-y-1")}>
                {rows.map((p) => (
                  <span key={p.key} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ backgroundColor: colorOf(p.key) }} />
                    {labelOf(p.key)}
                    <span className="tabular-nums text-slate-700">
                      {positiveTotal > 0 && p.profit > 0 ? fmtPct((p.profit / positiveTotal) * 100) : "0 %"}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader className={TABLE_HEAD_EMPHASIS}>
                  <TableRow>
                    <TableHead className={CELL}>Sàn</TableHead>
                    <TableHead className={cn(CELL, "text-right")}>Đơn</TableHead>
                    <TableHead className={cn(CELL, "text-right")}>Doanh thu thực nhận</TableHead>
                    <TableHead className={cn(CELL, "text-right")}>Lãi</TableHead>
                    <TableHead className={cn(CELL, "text-right")}>Thất thu hoàn</TableHead>
                    <TableHead className={cn(CELL, "text-right")}>Biên lãi</TableHead>
                    <TableHead className={cn(CELL, "text-right")}>Tỷ lệ hoàn</TableHead>
                    <TableHead className={cn(CELL, "text-right")}>Đơn lỗ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => {
                    const meta = (CHANNEL_META as Record<string, { label: string; className: string }>)[p.key];
                    const returnRate = pct(p.returnCount, p.count);
                    const prevReturnRate = p.prev ? pct(p.prev.returnCount, p.prev.count) : null;
                    return (
                      <TableRow key={p.key}>
                        <TableCell className={CELL}>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                              meta?.className ?? "bg-slate-100 text-slate-700 border-slate-200"
                            )}
                          >
                            {labelOf(p.key)}
                          </span>
                        </TableCell>
                        <TableCell className={cn(CELL, "text-right", TEXT_NUMBER_MUTED)}>
                          {formatNumber(p.count)}
                          {p.prev && (
                            <span className="ml-1.5 inline-block align-middle">
                              <DeltaBadge delta={deltaPercent(p.count, p.prev.count)} hint={prevHint} />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className={cn(CELL, "text-right", TEXT_NUMBER_MUTED)}>{formatVND(p.netRevenue)}</TableCell>
                        <TableCell className={cn(CELL, "text-right", TEXT_NUMBER_STRONG, moneyTone(p.profit))}>
                          <span className="inline-flex flex-col items-end gap-0.5">
                            <Money value={p.profit} />
                            {p.prev && <DeltaBadge delta={deltaPercent(p.profit, p.prev.profit)} hint={prevHint} />}
                          </span>
                        </TableCell>
                        <TableCell className={cn(CELL, "text-right tabular-nums", p.returnLoss > 0 ? "text-red-500" : "text-slate-700")}>
                          {p.returnLoss > 0 ? `− ${formatVND(p.returnLoss)}` : "0 ₫"}
                        </TableCell>
                        <TableCell className={cn(CELL, "text-right tabular-nums text-slate-700")}>{fmtPct(pct(p.profit, p.netRevenue))}</TableCell>
                        <TableCell className={cn(CELL, "text-right tabular-nums text-slate-700")}>
                          {fmtPct(returnRate)}
                          {returnRate != null && prevReturnRate != null && (
                            <span className="ml-1.5 inline-block align-middle">
                              <DeltaBadge delta={returnRate - prevReturnRate} unit="pt" inverted hint={prevHint} />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className={cn(CELL, "text-right tabular-nums", p.lossCount > 0 ? "text-red-500" : "text-slate-700")}>
                          {formatNumber(p.lossCount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export type { ChannelName };
