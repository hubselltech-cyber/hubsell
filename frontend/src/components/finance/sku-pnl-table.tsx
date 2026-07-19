"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Crown,
  ImageIcon,
  PackageSearch,
  TrendingDown,
} from "lucide-react";

import { HintText } from "@/components/finance/hint-icon";

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
import { Refreshing } from "@/components/refreshing";
import type { DateRange } from "@/lib/date-range";
import { formatVND, formatNumber } from "@/lib/format";
import { CELL_PADDING } from "@/lib/typography";
import { cn } from "@/lib/utils";

// Khoảng đệm ô lấy từ quy chuẩn hệ thống (lib/typography.ts) để co giãn
// đồng bộ với cỡ chữ trên màn hình lớn
const CELL_PAD = CELL_PADDING;

// Cột "Sản phẩm" ghim cố định mép trái khi cuộn ngang xem các chỉ số tài chính
const STICKY_COL =
  "sticky left-0 z-10 bg-card shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]";

/// Bảng phân tích hiệu quả kinh doanh từng mã SKU:
/// SKU nào là "gà đẻ trứng vàng", SKU nào đang gánh lỗ.
export function SkuPnlTable({ range }: { range?: DateRange }) {
  const [data, setData] = useState<SkuPnlResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchSkuPnl(range));
    } catch {
      // Trang cha đã xử lý 401/403/409
    } finally {
      setLoading(false);
    }
  }, [range]);

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
        {/* Chỉ hiện chữ "đang tính" ở lần tải đầu; đổi bộ lọc thì giữ bảng cũ
            và làm mờ đi để mắt không bị giật khi bảng biến mất rồi hiện lại */}
        {loading && !data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tính toán hiệu quả từng SKU…
          </p>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <PackageSearch className="mx-auto mb-2 size-8" />
            Chưa có dữ liệu. Cần ít nhất một đơn <b>Đã giao</b> có chi tiết sản phẩm.
          </div>
        ) : (
          <Refreshing active={loading}>
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

            <Table>
                <TableHeader>
                  <TableRow>
                    {/* Cột sản phẩm ghim trái — luôn thấy được khi cuộn ngang */}
                    <TableHead className={cn(STICKY_COL, CELL_PADDING)}>
                      Sản phẩm
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>Đã bán</TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>
                      Doanh thu thuần
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>Giá vốn</TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>
                      Phí sàn &amp; ship
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>
                      Chi phí marketing
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>
                      Lợi nhuận
                    </TableHead>
                    <TableHead className={cn(CELL_PAD, "text-right")}>Biên LN</TableHead>
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
                        <TableCell className={cn(STICKY_COL, CELL_PADDING)}>
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
                        <TableCell className={cn(CELL_PAD, "text-right font-medium")}>
                          {formatNumber(row.quantitySold)}
                        </TableCell>

                        {/* Doanh thu thuần + dòng phụ: giá hoà vốn mỗi sản phẩm */}
                        <TableCell className={cn(CELL_PAD, "text-right")}>
                          <span className="block font-semibold">
                            {formatVND(row.revenue)}
                          </span>
                          {be && (
                            <HintText
                              className={cn(
                                "mt-0.5",
                                belowFloor
                                  ? "font-medium text-rose-600"
                                  : "text-muted-foreground"
                              )}
                              hint={
                                <>
                                  <b>Giá bán hoà vốn</b> = giá vốn/sp + phí sàn &amp;
                                  ship trung bình/sp. Bán dưới mức này là chắc chắn âm
                                  tiền túi.
                                  <br />
                                  Giá bán trung bình hiện tại:{" "}
                                  {formatVND(be.avgSellingPrice)}/sp.
                                </>
                              }
                            >
                              {belowFloor && "⚠️ "}
                              Hoà vốn/sp: {formatVND(be.floorPrice)}
                            </HintText>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(CELL_PAD, "text-right text-muted-foreground")}
                        >
                          {row.cogs > 0 ? `− ${formatVND(row.cogs)}` : "—"}
                        </TableCell>
                        <TableCell
                          className={cn(CELL_PAD, "text-right text-muted-foreground")}
                        >
                          {row.allocatedFee > 0
                            ? `− ${formatVND(row.allocatedFee)}`
                            : "—"}
                        </TableCell>
                        {/* Chi phí marketing + dòng phụ: trần Ads cho mỗi đơn */}
                        <TableCell className={cn(CELL_PAD, "text-right")}>
                          <span
                            className={cn(
                              "block",
                              be?.isOverspending
                                ? "font-semibold text-rose-600"
                                : "text-muted-foreground"
                            )}
                          >
                            {row.marketingCost > 0
                              ? `− ${formatVND(row.marketingCost)}`
                              : "—"}
                          </span>
                          {be && (
                            <HintText
                              className={cn(
                                "mt-0.5",
                                be.isOverspending
                                  ? "font-medium text-rose-600"
                                  : "text-muted-foreground"
                              )}
                              hint={
                                <>
                                  <b>Trần Ads</b> = chi phí marketing tối đa trên mỗi
                                  đơn hàng để SKU này không bị lỗ tiền túi.
                                  <br />
                                  Đang tiêu thực tế:{" "}
                                  {formatVND(be.actualCpa)}/đơn.
                                  {be.isOverspending &&
                                    " → Vượt ngưỡng, nên tắt hoặc tối ưu lại chiến dịch."}
                                </>
                              }
                            >
                              {be.isOverspending && "🚨 "}
                              Trần Ads: {formatVND(be.targetCpa)}
                            </HintText>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            CELL_PAD,
                            "text-right text-base font-bold",
                            profitable ? "text-emerald-700" : "text-rose-600"
                          )}
                        >
                          {formatVND(row.profit)}
                        </TableCell>
                        {/* Biên LN + dòng phụ: mức giảm giá tối đa còn hoà vốn */}
                        <TableCell className={cn(CELL_PAD, "text-right")}>
                          <span
                            className={cn(
                              "flex items-center justify-end gap-1 font-semibold",
                              profitable ? "text-emerald-700" : "text-rose-600"
                            )}
                          >
                            {!profitable && <TrendingDown className="size-3.5" />}
                            {row.margin}%
                          </span>
                          {be && (
                            <HintText
                              className={cn(
                                "mt-0.5",
                                be.maxDiscountPercent > 0
                                  ? "text-muted-foreground"
                                  : "font-medium text-rose-600"
                              )}
                              hint={
                                <>
                                  <b>Mức giảm tối đa</b> = lợi nhuận gộp (trước
                                  marketing) ÷ doanh thu. Cho biết được phép chạy Flash
                                  Sale giảm tối đa bao nhiêu % mà đơn vẫn hoà vốn trở
                                  lên.
                                </>
                              }
                            >
                              {be.maxDiscountPercent > 0
                                ? `Giảm tối đa: ${be.maxDiscountPercent}%`
                                : "Không thể giảm giá"}
                            </HintText>
                          )}
                        </TableCell>

                      </TableRow>
                    );
                  })}
                </TableBody>
            </Table>

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
          </Refreshing>
        )}
      </CardContent>
    </Card>
  );
}
