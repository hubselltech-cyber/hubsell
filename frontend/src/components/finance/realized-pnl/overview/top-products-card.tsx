"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ImageIcon, PackageOpen } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PnlTopProductRow, PnlTopProducts } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import {
  moneyTone,
  PRODUCT_NAME_CLAMP,
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_NUMBER_STRONG,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

import { DeltaBadge, deltaPercent, NewBadge } from "./delta-badge";

type TopTab = "byProfit" | "byLoss" | "rising" | "falling";

const TABS: { key: TopTab; label: string; empty: string }[] = [
  { key: "byProfit", label: "Lãi cao nhất", empty: "Kỳ này chưa có mã nào bán được." },
  { key: "byLoss", label: "Đang lỗ", empty: "Không có mã nào lỗ trong kỳ — tốt." },
  { key: "rising", label: "Tăng mạnh", empty: "Chưa có mã nào tăng lãi so kỳ trước (cần từ 3 đơn)." },
  { key: "falling", label: "Giảm mạnh", empty: "Không có mã nào giảm lãi so kỳ trước." },
];

const CELL = "px-3 py-2.5";
/** Kỳ trước phải có từng này đơn mới so % (cùng ngưỡng TOP_PRODUCT_MIN_ORDERS của backend). */
const MIN_PREV_ORDERS = 3;

function pct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} %`;
}

/**
 * TOP SẢN PHẨM THEO LÃI (không theo doanh thu — doanh thu cao mà lãi âm là
 * bẫy hay gặp). 4 chip một chạm: Lãi cao nhất · Đang lỗ · Tăng mạnh · Giảm
 * mạnh (so kỳ liền trước, mã ≥ 3 đơn mới được xếp hạng tăng/giảm). Cột tiền
 * trước, % dồn về phải; tên cắt theo PRODUCT_NAME_CLAMP + tooltip tên đủ.
 * Xếp hạng làm sẵn trong database — bảng chỉ hiển thị ≤ 10 dòng mỗi chip.
 */
export function TopProductsCard({ top, prevHint }: { top: PnlTopProducts; prevHint: string }) {
  const [tab, setTab] = useState<TopTab>("byProfit");
  const rows: PnlTopProductRow[] = top[tab];
  const meta = TABS.find((t) => t.key === tab)!;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Top sản phẩm theo lãi</CardTitle>
            <CardDescription>
              Lãi của từng mã = lãi đơn phân bổ theo giá trị dòng hàng · {formatNumber(top.skuCount)} mã có bán trong kỳ.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => {
              const active = tab === t.key;
              const n = top[t.key].length;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      active ? "bg-primary-foreground/20" : "bg-muted"
                    )}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
            <PackageOpen className="mb-2 size-8" />
            {meta.empty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader className={TABLE_HEAD_EMPHASIS}>
                <TableRow>
                  <TableHead className={cn(CELL, "w-10 text-center")}>#</TableHead>
                  <TableHead className={CELL}>Sản phẩm</TableHead>
                  <TableHead className={cn(CELL, "text-right")}>Đã bán</TableHead>
                  <TableHead className={cn(CELL, "text-right")}>Doanh thu</TableHead>
                  <TableHead className={cn(CELL, "text-right")}>Lãi</TableHead>
                  <TableHead className={cn(CELL, "text-right")}>So kỳ trước</TableHead>
                  <TableHead className={cn(CELL, "text-right")}>Biên lãi</TableHead>
                  <TableHead className={cn(CELL, "text-right")}>Tỷ lệ hoàn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const margin = pct(r.profit, r.revenue);
                  const returnRate = pct(r.returnedQuantity, r.quantity);
                  const delta = r.prev ? deltaPercent(r.profit, r.prev.profit) : null;
                  return (
                    <TableRow key={r.sku}>
                      <TableCell className={cn(CELL, "text-center text-slate-500 tabular-nums")}>{i + 1}</TableCell>
                      <TableCell className={CELL}>
                        <div className="flex items-center gap-3">
                          {r.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.imageUrl} alt={r.productName} className="size-9 shrink-0 rounded-lg object-cover" />
                          ) : (
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <ImageIcon className="size-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            {/* Chuẩn cắt tên 26rem; dưới 1536px vùng nội dung ~945px nên hẹp lại 15rem
                                để 8 cột không phải cuộn ngang. */}
                            <p className={cn(PRODUCT_NAME_CLAMP, "max-w-[15rem] 2xl:max-w-[26rem] text-sm text-slate-900")} title={r.productName}>
                              {r.productName}
                            </p>
                            <p className={cn(TEXT_SUB, "truncate font-mono")} title={r.sku}>
                              {r.sku}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={cn(CELL, "text-right", TEXT_NUMBER_MUTED)}>
                        {formatNumber(r.quantity)}
                        <span className={cn(TEXT_SUB, "block")}>{formatNumber(r.orders)} đơn</span>
                      </TableCell>
                      <TableCell className={cn(CELL, "text-right", TEXT_NUMBER_MUTED)}>
                        {formatVND(r.revenue)}
                        <span className={cn(TEXT_SUB, "block")}>vốn {formatVND(r.cost)}</span>
                      </TableCell>
                      <TableCell className={cn(CELL, "text-right", TEXT_NUMBER_STRONG, moneyTone(r.profit))}>
                        <Money value={r.profit} />
                      </TableCell>
                      <TableCell className={cn(CELL, "text-right")}>
                        {r.prev ? (
                          <span className="inline-flex flex-col items-end gap-0.5">
                            {r.prev.orders >= MIN_PREV_ORDERS ? (
                              <DeltaBadge delta={delta} hint={prevHint} />
                            ) : (
                              // Kỳ trước chỉ 1–2 đơn thì % so sánh vô nghĩa — ghi số đơn thay vì %.
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" title={prevHint}>
                                kỳ trước {r.prev.orders} đơn
                              </span>
                            )}
                            <span className={cn(TEXT_SUB, "tabular-nums")}>{formatVND(r.prev.profit)}</span>
                          </span>
                        ) : (
                          <NewBadge />
                        )}
                      </TableCell>
                      <TableCell className={cn(CELL, "text-right tabular-nums", margin != null && margin < 0 ? "text-red-500" : "text-slate-700")}>
                        {fmtPct(margin)}
                      </TableCell>
                      <TableCell className={cn(CELL, "text-right tabular-nums", returnRate != null && returnRate >= 5 ? "text-red-500" : "text-slate-700")}>
                        {fmtPct(returnRate)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className={cn(TEXT_SUB, "flex items-center gap-1 border-t px-4 py-2.5")}>
          Mỗi chip tối đa 10 mã. Xem mọi mã với điểm hòa vốn ở
          <Link href="/operations-assistant/loss-orders" className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
            Lãi/Lỗ theo SKU <ArrowRight className="size-3" />
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
