"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Crown,
  ImageIcon,
  PackageSearch,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";

import { HintIcon } from "@/components/finance/hint-icon";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchSkuPnl, type SkuPnlResponse } from "@/lib/api";
import { formatVND, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/// Bảng phân tích hiệu quả kinh doanh từng mã SKU:
/// SKU nào là "gà đẻ trứng vàng", SKU nào đang gánh lỗ.
export function SkuPnlTable() {
  const [data, setData] = useState<SkuPnlResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchSkuPnl());
    } catch {
      // Trang cha đã xử lý 401/403/409
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hiệu quả kinh doanh theo sản phẩm (SKU P&amp;L)</CardTitle>
        <CardDescription>
          Lời/lỗ từng mã hàng trên đơn <b>Đã giao</b>. Phí sàn &amp; ship được phân
          bổ theo tỷ trọng doanh thu; chi phí biến đổi tính vào đúng SKU được gắn.
          Chi phí cố định không phân bổ — trừ vào lợi nhuận chung của shop.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tính toán hiệu quả từng SKU…
          </p>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <PackageSearch className="mx-auto mb-2 size-8" />
            Chưa có dữ liệu. Cần ít nhất một đơn <b>Đã giao</b> có chi tiết sản phẩm.
          </div>
        ) : (
          <>
            {/* Cảnh báo tổng: có SKU đang đốt tiền quảng cáo vượt ngưỡng */}
            {(data?.summary.overspendingCount ?? 0) > 0 && (
              <div className="mx-4 mb-3 flex items-start gap-3 rounded-lg border border-rose-300 bg-rose-50 p-3">
                <span className="text-lg leading-none">🚨</span>
                <div className="text-sm">
                  <p className="font-medium text-rose-800">
                    {formatNumber(data!.summary.overspendingCount)} sản phẩm đang chi
                    quảng cáo vượt ngưỡng an toàn
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Chi phí marketing mỗi đơn đã vượt trần cho phép — nên tắt hoặc tối
                    ưu lại chiến dịch để không bị lỗ thêm.
                  </p>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  {/* Hàng gộp nhóm cột */}
                  <TableRow className="hover:bg-transparent">
                    <TableHead colSpan={8} />
                    <TableHead
                      colSpan={3}
                      className="border-l bg-teal-50/70 text-center text-teal-800"
                    >
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <ShieldCheck className="size-4" />
                        Ngưỡng hoà vốn an toàn
                      </span>
                    </TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead>Sản phẩm</TableHead>
                    <TableHead className="text-center">Đã bán</TableHead>
                    <TableHead className="text-right">Doanh thu thuần</TableHead>
                    <TableHead className="text-right">Giá vốn</TableHead>
                    <TableHead className="text-right">Phí sàn &amp; ship</TableHead>
                    <TableHead className="text-right">Chi phí marketing</TableHead>
                    <TableHead className="text-right">Lợi nhuận</TableHead>
                    <TableHead className="text-right">Biên LN</TableHead>

                    <TableHead className="border-l bg-teal-50/40 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        Giá bán hoà vốn
                        <HintIcon hint="Giá vốn + phí sàn & ship trung bình cho mỗi sản phẩm. Bán dưới mức này là chắc chắn âm tiền túi." />
                      </span>
                    </TableHead>
                    <TableHead className="bg-teal-50/40 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        Giảm tối đa
                        <HintIcon hint="Lợi nhuận gộp (trước marketing) ÷ doanh thu. Cho biết được phép chạy Flash Sale giảm tối đa bao nhiêu % mà đơn vẫn hoà vốn trở lên." />
                      </span>
                    </TableHead>
                    <TableHead className="bg-teal-50/40 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        Ads tối đa/đơn
                        <HintIcon hint="Trần chi phí quảng cáo cho mỗi đơn = lợi nhuận gộp trước marketing ÷ số lượng đã bán. Chi vượt mức này thì SKU bắt đầu lỗ." />
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row, index) => {
                    const profitable = row.profit > 0;
                    // Mã lãi cao nhất được gắn vương miện
                    const isTop = index === 0 && profitable;
                    const be = row.breakEven;
                    // Giá bán thực tế đang thấp hơn giá hoà vốn ⇒ mỗi đơn bán ra là mỗi lần lỗ
                    const belowFloor = be ? be.avgSellingPrice < be.floorPrice : false;
                    return (
                      <TableRow key={row.sku}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {row.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={row.imageUrl}
                                alt={row.productName}
                                className="size-9 shrink-0 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                <ImageIcon className="size-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 font-medium">
                                {isTop && (
                                  <Crown className="size-4 shrink-0 text-amber-500" />
                                )}
                                <span className="truncate">{row.productName}</span>
                              </p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {row.sku}
                              </p>
                              {row.missingCost && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                  <AlertTriangle className="size-3" />
                                  Chưa nhập giá vốn
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-medium">
                          {formatNumber(row.quantitySold)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatVND(row.revenue)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {row.cogs > 0 ? `− ${formatVND(row.cogs)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {row.allocatedFee > 0
                            ? `− ${formatVND(row.allocatedFee)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {row.marketingCost > 0
                            ? `− ${formatVND(row.marketingCost)}`
                            : "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right text-base font-bold",
                            profitable ? "text-emerald-700" : "text-rose-600"
                          )}
                        >
                          {formatVND(row.profit)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold",
                            profitable ? "text-emerald-700" : "text-rose-600"
                          )}
                        >
                          <span className="inline-flex items-center gap-1">
                            {!profitable && <TrendingDown className="size-3.5" />}
                            {row.margin}%
                          </span>
                        </TableCell>

                        {/* ===== NGƯỠNG HOÀ VỐN AN TOÀN ===== */}
                        {be ? (
                          <>
                            {/* Giá bán hoà vốn */}
                            <TableCell className="border-l bg-teal-50/40 text-right">
                              <span
                                className={cn(
                                  "font-semibold",
                                  belowFloor ? "text-rose-600" : "text-teal-800"
                                )}
                              >
                                {formatVND(be.floorPrice)}
                              </span>
                              {belowFloor && (
                                <span className="mt-0.5 flex items-center justify-end gap-1 text-xs font-medium text-rose-600">
                                  <AlertTriangle className="size-3" />
                                  Đang bán dưới giá hoà vốn
                                </span>
                              )}
                            </TableCell>

                            {/* Mức giảm giá tối đa */}
                            <TableCell className="bg-teal-50/40 text-right">
                              <span
                                className={cn(
                                  "font-semibold",
                                  be.maxDiscountPercent > 0
                                    ? "text-teal-800"
                                    : "text-rose-600"
                                )}
                              >
                                {be.maxDiscountPercent > 0
                                  ? `${be.maxDiscountPercent}%`
                                  : "Không thể giảm"}
                              </span>
                            </TableCell>

                            {/* Trần chi phí Ads mỗi đơn */}
                            <TableCell className="bg-teal-50/40 text-right">
                              <span
                                className={cn(
                                  "font-semibold",
                                  be.isOverspending
                                    ? "text-rose-600"
                                    : be.targetCpa > 0
                                      ? "text-teal-800"
                                      : "text-muted-foreground"
                                )}
                              >
                                {be.targetCpa > 0 ? formatVND(be.targetCpa) : "0 ₫"}
                              </span>
                              {be.isOverspending ? (
                                <span className="mt-0.5 flex items-center justify-end gap-1 text-xs font-medium text-rose-600">
                                  🚨 Đang tiêu {formatVND(be.actualCpa)}/đơn
                                </span>
                              ) : (
                                be.actualCpa > 0 && (
                                  <span className="mt-0.5 block text-xs text-muted-foreground">
                                    Đang tiêu {formatVND(be.actualCpa)}/đơn
                                  </span>
                                )
                              )}
                            </TableCell>
                          </>
                        ) : (
                          <TableCell
                            colSpan={3}
                            className="border-l bg-teal-50/40 text-center text-xs text-muted-foreground"
                          >
                            Cần nhập giá vốn &amp; có đơn bán để tính
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Đối chiếu về lợi nhuận cuối cùng của shop */}
            {data && (
              <div className="space-y-1 border-t p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Tổng lợi nhuận từ {formatNumber(data.summary.skuCount)} mã sản phẩm
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      data.summary.skuProfitTotal >= 0
                        ? "text-emerald-700"
                        : "text-rose-600"
                    )}
                  >
                    {formatVND(data.summary.skuProfitTotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Chi phí cố định toàn shop (mặt bằng, lương…)
                  </span>
                  <span className="font-semibold text-rose-600">
                    − {formatVND(data.summary.fixedExpense)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-medium">Lợi nhuận cuối cùng của shop</span>
                  <span
                    className={cn(
                      "text-base font-bold",
                      data.summary.shopProfit >= 0
                        ? "text-emerald-700"
                        : "text-rose-600"
                    )}
                  >
                    {formatVND(data.summary.shopProfit)}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
