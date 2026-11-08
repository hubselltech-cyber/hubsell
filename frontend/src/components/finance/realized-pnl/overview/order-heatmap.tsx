"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PnlHeatCell } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const DOW_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]; // isodow 1..7
const DOW_FULL = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"];

/**
 * GIỜ VÀNG — ô lưới thứ × giờ (giờ VN) tô MỘT màu nhạt → đậm theo số đơn phát
 * sinh (ô càng đậm càng nhiều đơn); rê chuột thấy số đơn + lãi. Vẽ bằng CSS
 * grid, không thư viện; màu pha bằng color-mix với token sky-500 nên tự đúng
 * ở giao diện tối. Dùng để chọn giờ lên live / đẩy ngân sách quảng cáo.
 */
export function OrderHeatmap({ cells, days }: { cells: PnlHeatCell[]; days: number }) {
  const byKey = new Map<string, PnlHeatCell>();
  let max = 0;
  let total = 0;
  for (const c of cells) {
    byKey.set(`${c.dow}-${c.hour}`, c);
    if (c.count > max) max = c.count;
    total += c.count;
  }
  // 3 ô đông nhất → câu kết luận; gộp giờ liền kề cùng thứ cho dễ đọc.
  const top = [...cells].sort((a, b) => b.count - a.count).slice(0, 3);
  const hourTotals = Array.from({ length: 24 }, (_, h) =>
    cells.filter((c) => c.hour === h).reduce((s, c) => s + c.count, 0)
  );
  const peakHour = hourTotals.indexOf(Math.max(...hourTotals));
  const dowTotals = Array.from({ length: 7 }, (_, i) =>
    cells.filter((c) => c.dow === i + 1).reduce((s, c) => s + c.count, 0)
  );
  const peakDow = dowTotals.indexOf(Math.max(...dowTotals));

  return (
    <Card className="h-full shadow-sm">
      <CardHeader>
        <CardTitle>Giờ vàng — đơn phát sinh theo thứ &amp; giờ</CardTitle>
        <CardDescription>
          {total > 0 ? (
            <>
              Đông nhất: <b className="font-medium text-slate-900">{DOW_FULL[peakDow]}</b> và khung{" "}
              <b className="font-medium text-slate-900">{peakHour}h–{(peakHour + 1) % 24}h</b>
              {days < 14 && " · kỳ dưới 2 tuần nên mẫu còn mỏng"}. Ô càng đậm càng nhiều đơn.
            </>
          ) : (
            "Chưa có đơn trong kỳ."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid gap-px" style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className={cn(TEXT_SUB, "pb-1 text-center tabular-nums", h % 3 !== 0 && "invisible")}>
                  {h}h
                </div>
              ))}
              {DOW_LABELS.map((lbl, i) => (
                <div key={lbl} className="contents">
                  <div className={cn(TEXT_SUB, "flex items-center pr-1")}>{lbl}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const c = byKey.get(`${i + 1}-${h}`);
                    const n = c?.count ?? 0;
                    const ratio = max > 0 ? n / max : 0;
                    const isTop = n > 0 && top.some((t) => t.dow === i + 1 && t.hour === h);
                    return (
                      <div
                        key={h}
                        title={`${DOW_FULL[i]} · ${h}h–${(h + 1) % 24}h: ${formatNumber(n)} đơn${c ? ` · lãi ${formatVND(c.profit)}` : ""}`}
                        className={cn(
                          "aspect-square rounded-[3px] bg-slate-100 transition-opacity",
                          isTop && "ring-2 ring-sky-500 ring-offset-1 ring-offset-card"
                        )}
                        style={
                          n > 0
                            ? { backgroundColor: `color-mix(in oklab, var(--color-sky-500) ${Math.round(15 + ratio * 85)}%, var(--card))` }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className={cn(TEXT_SUB, "mt-3 flex items-center justify-between gap-3")}>
          <span>{formatNumber(total)} đơn trong {formatNumber(days)} ngày · giờ Việt Nam</span>
          <span className="flex items-center gap-1.5">
            ít
            {[0.15, 0.35, 0.6, 0.85, 1].map((r) => (
              <span
                key={r}
                className="size-3 rounded-[3px]"
                style={{ backgroundColor: `color-mix(in oklab, var(--color-sky-500) ${Math.round(r * 100)}%, var(--card))` }}
              />
            ))}
            nhiều
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
