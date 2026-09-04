"use client";

import { useState } from "react";
import {
  BadgePercent,
  PlugZap,
  ShoppingBag,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { KOC_PLATFORM_META } from "@/components/koc/koc-data";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Refreshing } from "@/components/shared/refreshing";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  channelFilterToQuery,
  fetchKocAffiliateOrders,
  fetchKocSummary,
} from "@/lib/api";
import type { ChannelFilterValue } from "@/components/shared/channel-filter";
import {
  formatRangeLabel,
  rangeToQuery,
  type DateRange,
} from "@/lib/date-range";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_NUMBER_STRONG,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * DỮ LIỆU AFFILIATE THẬT TỪ SÀN — số do các luồng đối soát THẬT ghi vào
 * Order.affiliateFee (Shopee escrow AMS, Lazada Finance API), token gian đã
 * liên kết sẵn, không cần uỷ quyền thêm.
 *
 * TÁCH 2 KHỐI theo layout tab của Tổng quan (yêu cầu chủ shop 30/08 — trang
 * dàn trải quá dài): KocKpiCards (4 thẻ chỉ số, luôn hiện trên đầu trang) và
 * KocOrdersPanel (bảng gian hàng + bảng đơn, nằm trong tab "Đơn hàng").
 * Cả hai dùng React Query — mount ở đâu cũng chia chung một cache, không
 * bắn API hai lần.
 */

interface KocFilterProps {
  channel: ChannelFilterValue;
  range: DateRange;
}

function useKocSummary({ channel, range }: KocFilterProps) {
  return useApiQuery({
    queryKey: qk.kocSummary({
      ...rangeToQuery(range),
      channel: channelFilterToQuery(channel),
    }),
    queryFn: () => fetchKocSummary({ channel, range }),
  });
}

/** 4 thẻ chỉ số vàng — luôn hiện trên đầu Tổng quan, ngoài mọi tab. */
export function KocKpiCards({ channel, range }: KocFilterProps) {
  const q = useKocSummary({ channel, range });
  const total = q.data?.total;
  const rawRoi =
    total && total.commission > 0 ? total.netRevenue / total.commission : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Total GMV Affiliate"
        value={<Money value={total?.gmv ?? 0} />}
        icon={TrendingUp}
        tone="info"
        subtitle={`${formatNumber(total?.orders ?? 0)} đơn affiliate · ${formatRangeLabel(range)}`}
      />
      <StatCard
        label="Doanh thu ròng thực tế"
        value={<Money value={total?.netRevenue ?? 0} />}
        icon={Wallet}
        tone="positive"
        colorValue
        subtitle="GMV đã trừ tiền hoàn thật từ sàn"
      />
      <StatCard
        label="Hoa hồng sàn đã trừ"
        value={<Money value={total?.commission ?? 0} />}
        icon={BadgePercent}
        tone="negative"
        colorValue
        subtitle="Shopee AMS + Lazada tiếp thị liên kết"
      />
      <StatCard
        label="Net ROI (trên hoa hồng)"
        value={`${rawRoi.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}x`}
        icon={Target}
        tone="accent"
        subtitle="Chưa gồm booking & hàng mẫu (nhập tay)"
      />
    </div>
  );
}

/** Tab "Đơn hàng": bảng nguồn dữ liệu theo gian + bảng đơn affiliate. */
export function KocOrdersPanel({ channel, range }: KocFilterProps) {
  const [page, setPage] = useState(1);
  const summaryQ = useKocSummary({ channel, range });
  const ordersQ = useApiQuery({
    queryKey: qk.kocOrders({
      ...rangeToQuery(range),
      channel: channelFilterToQuery(channel),
      page,
    }),
    queryFn: () =>
      fetchKocAffiliateOrders({ channel, range, page, pageSize: 10 }),
  });

  const shops = summaryQ.data?.shops ?? [];
  const orders = ordersQ.data?.orders ?? [];
  const ordersTotal = ordersQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(ordersTotal / 10));

  return (
    <>
      {/* ===== TRẠNG THÁI LIÊN KẾT + HIỆU QUẢ THEO GIAN HÀNG ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="size-4.5 text-emerald-600" />
            Nguồn dữ liệu thật theo gian hàng
          </CardTitle>
          <CardDescription>
            Dùng token của các gian đã liên kết sẵn — không cần uỷ quyền thêm.
            Sàn chưa kết nối hoặc chưa quyết toán đơn affiliate sẽ hiện 0.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Refreshing active={summaryQ.refreshing}>
            <Table>
              <TableHeader className={TABLE_HEAD_EMPHASIS}>
                <TableRow>
                  <TableHead>Gian hàng</TableHead>
                  <TableHead className="w-36">Liên kết</TableHead>
                  <TableHead className="w-40">Đồng bộ gần nhất</TableHead>
                  <TableHead className="text-right">Đơn affiliate</TableHead>
                  <TableHead className="text-right">GMV</TableHead>
                  <TableHead className="text-right">Hoa hồng</TableHead>
                  <TableHead className="text-right">Đã hoàn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shops.map((s) => {
                  const meta =
                    KOC_PLATFORM_META[s.channelName as keyof typeof KOC_PLATFORM_META];
                  return (
                    <TableRow key={s.channelId}>
                      <TableCell>
                        <p className="text-slate-900">{s.shopName}</p>
                        <p className={TEXT_SUB}>
                          {meta?.label ?? s.channelName}
                          {s.externalShopId ? ` · ID ${s.externalShopId}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        {s.connected ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            Đang hoạt động
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-slate-50 text-slate-500"
                          >
                            Chưa uỷ quyền thật
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {s.lastSyncAt ? (
                          formatDateTime(s.lastSyncAt)
                        ) : (
                          <span className={TEXT_SUB}>Chưa đồng bộ</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-slate-700">
                        {formatNumber(s.affiliate.orders)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={s.affiliate.gmv} className="text-slate-900" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          value={s.affiliate.commission}
                          className={cn(TEXT_NUMBER_STRONG, "text-red-500")}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          value={s.affiliate.refundedAmount}
                          className={TEXT_NUMBER_MUTED}
                        />
                        {s.affiliate.refundedOrders > 0 && (
                          <p className={TEXT_SUB}>
                            {formatNumber(s.affiliate.refundedOrders)} đơn hoàn
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {shops.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {summaryQ.loading
                        ? "Đang tải dữ liệu…"
                        : "Chưa có gian hàng sàn nào được liên kết."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Refreshing>
        </CardContent>
      </Card>

      {/* ===== ĐƠN AFFILIATE THẬT (bằng chứng từng dòng) ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="size-4.5 text-violet-600" />
            Đơn hàng affiliate thật ({formatNumber(ordersTotal)} đơn ·{" "}
            {formatRangeLabel(range)})
          </CardTitle>
          <CardDescription>
            Đơn sàn đã trừ hoa hồng tiếp thị liên kết khi quyết toán — nguồn số
            của các thẻ chỉ số trên đầu trang.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Refreshing active={ordersQ.refreshing}>
            <Table>
              <TableHeader className={TABLE_HEAD_EMPHASIS}>
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Gian hàng</TableHead>
                  <TableHead className="w-40">Ngày tạo</TableHead>
                  <TableHead className="text-right">GMV</TableHead>
                  <TableHead className="text-right">Hoa hồng affiliate</TableHead>
                  <TableHead className="w-32">Quyết toán</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const meta =
                    KOC_PLATFORM_META[o.channelName as keyof typeof KOC_PLATFORM_META];
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-sm text-slate-900">
                        {o.orderCode}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-slate-900">{o.shopName}</p>
                        <p className={TEXT_SUB}>{meta?.label ?? o.channelName}</p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {formatDateTime(o.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={o.gmv} className="text-slate-900" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          value={o.commission}
                          className={cn(TEXT_NUMBER_STRONG, "text-red-500")}
                        />
                      </TableCell>
                      <TableCell>
                        {o.isSettled ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            Đã quyết toán
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-700"
                          >
                            Chờ quyết toán
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {ordersQ.loading
                        ? "Đang tải dữ liệu…"
                        : "Chưa có đơn affiliate nào được sàn quyết toán trong kỳ đã chọn."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Refreshing>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <span className={TEXT_SUB}>
                Trang {page}/{totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || ordersQ.refreshing}
                onClick={() => setPage((p) => p - 1)}
              >
                Trước
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages || ordersQ.refreshing}
                onClick={() => setPage((p) => p + 1)}
              >
                Sau
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
