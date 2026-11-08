"use client";

import { PackageOpen } from "lucide-react";

import { HintIcon } from "@/components/finance/hint-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import type { PnlPeriodTotals } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { DeltaBadge, deltaPercent } from "./delta-badge";

/**
 * THẤT THU ĐƠN HOÀN bóc 3 khoản — thanh ngang xếp hạng (thay donut: ba lát gần
 * nhau trên donut khó so, thanh trên một đường chuẩn so được). Lời giải thích
 * BÁM ĐÚNG computeReturnLoss ở backend, không hứa hơn công thức thật.
 */
export function ReturnLossCard({ current, previous, prevHint }: { current: PnlPeriodTotals; previous: PnlPeriodTotals | null; prevHint: string }) {
  const loss = current.returnLoss;
  const items = [
    {
      key: "cost",
      name: "Giá vốn hàng chưa thu hồi",
      value: loss.costLoss,
      prev: previous?.returnLoss.costLoss,
      color: "bg-red-500",
      hint: (
        <>
          <b>Tiền vốn của món hàng shop đã bỏ ra nhưng chưa lấy lại được.</b>
          <br />• Khách được hoàn tiền nhưng giữ hàng · hàng trả về hỏng/mất · hàng đang trên đường về.
          <br />• Kho quét nhận hàng nguyên vẹn thì khoản này tự giảm đúng phần vốn thu hồi.
        </>
      ),
    },
    {
      key: "kept",
      name: "Tiền sàn giữ lại",
      value: loss.platformKept,
      prev: previous?.returnLoss.platformKept,
      color: "bg-slate-500",
      hint: (
        <>
          <b>Tiền sàn đã trừ của đơn hoàn mà không trả lại shop.</b>
          <br />• Phần ví bị âm trên sao kê của đơn (phí sàn + phí vận chuyển sàn trừ, sao kê không tách).
          <br />• Lấy đúng số sàn ghi; đơn chưa quyết toán dùng số sàn ước tính, chưa có thì tạm 0.
        </>
      ),
    },
    {
      key: "refund",
      name: "Hoàn tiền khách giữ hàng",
      value: loss.refundLoss,
      prev: previous?.returnLoss.refundLoss,
      color: "bg-amber-500",
      hint: (
        <>
          <b>Tiền trả lại khách khi khách giữ hàng, chỉ hoàn một phần.</b>
          <br />• Hàng vẫn bán được nhưng shop thu thiếu đúng số này (đền bù hàng lỗi nhẹ, thiếu phụ kiện).
        </>
      ),
    },
  ].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <Card className="h-full shadow-sm">
      <CardHeader>
        <CardTitle>Thất thu do đơn hoàn</CardTitle>
        <CardDescription>
          {formatNumber(current.returnCount)} đơn hoàn/trả trong kỳ. Rê chuột vào dấu ? để xem cách tính từng khoản.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loss.total > 0 ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className={TEXT_SUB}>Tổng thất thu</span>
              <span className="flex items-center gap-2">
                <DeltaBadge delta={deltaPercent(loss.total, previous?.returnLoss.total)} inverted hint={prevHint} />
                <span className="text-lg font-semibold tabular-nums text-red-500">
                  − <Money value={loss.total} />
                </span>
              </span>
            </div>
            <ul className="mt-4 space-y-3">
              {items.map((it) => (
                <li key={it.key}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-1 text-slate-700">
                      <span>{it.name}</span>
                      <HintIcon hint={it.hint} />
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <DeltaBadge delta={deltaPercent(it.value, it.prev)} inverted hint={prevHint} />
                      <span className="font-medium tabular-nums text-slate-900">
                        <Money value={it.value} />
                      </span>
                      <span className={cn(TEXT_SUB, "w-11 text-right tabular-nums")}>
                        {((it.value / loss.total) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} %
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={cn("h-full rounded-full", it.color)} style={{ width: `${(it.value / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <PackageOpen className="mb-2 size-8" />
            Kỳ này chưa phát sinh thất thu do đơn hoàn.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
