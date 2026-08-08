"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgePercent,
  CloudOff,
  Loader2,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchKocAffiliateOrders,
  fetchKocSummary,
  type KocAffiliateOrderDTO,
  type KocSummaryDTO,
} from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_NUMBER_STRONG,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * DỮ LIỆU AFFILIATE THẬT TỪ SÀN — khối "sống" của Tổng quan Net-ROI.
 *
 * Đọc /api/koc/summary + /api/koc/orders: số liệu do các luồng đối soát THẬT
 * đang chạy ghi vào Order.affiliateFee (Shopee escrow AMS, Lazada Finance API)
 * bằng token gian hàng đã liên kết sẵn — không cần chủ shop uỷ quyền thêm.
 *
 * GIỚI HẠN NÓI THẲNG TRÊN UI: API seller của sàn không trả danh tính creator
 * theo đơn, nên phần thật dừng ở cấp GIAN HÀNG/SÀN; hồ sơ từng KOC (bảng dưới)
 * vẫn là preview chờ nguồn attribution (TikTok Affiliate API khi có shop thật).
 */

const RANGE_DAYS = 30;

export function KocRealData() {
  const [summary, setSummary] = useState<KocSummaryDTO | null>(null);
  const [orders, setOrders] = useState<KocAffiliateOrderDTO[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pageNo: number) => {
    try {
      setLoading(true);
      setError(null);
      const [sum, ord] = await Promise.all([
        fetchKocSummary(RANGE_DAYS),
        fetchKocAffiliateOrders({ days: RANGE_DAYS, page: pageNo, pageSize: 10 }),
      ]);
      setSummary(sum);
      setOrders(ord.orders);
      setOrdersTotal(ord.total);
      setPage(ord.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không kết nối được máy chủ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  if (loading && !summary) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Đang đọc dữ liệu affiliate từ đối soát sàn…
        </CardContent>
      </Card>
    );
  }

  if (error || !summary) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-sm">
          <CloudOff className="size-5 shrink-0 text-slate-400" />
          <div>
            <p className="font-medium text-slate-900">
              Chưa đọc được dữ liệu affiliate thật
            </p>
            <p className={TEXT_SUB}>{error ?? "Không rõ nguyên nhân"}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => load(1)}
          >
            Thử lại
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { total } = summary;
  // Net ROI THÔ = doanh thu ròng / hoa hồng sàn đã trừ. Chi phí booking + hàng
  // mẫu chưa có bản ghi thật trong DB nên chưa vào mẫu số — ghi chú ngay dưới số.
  const rawRoi = total.commission > 0 ? total.netRevenue / total.commission : 0;
  const totalPages = Math.max(1, Math.ceil(ordersTotal / 10));

  return (
    <>
      {/* ===== 4 THẺ CHỈ SỐ VÀNG — SỐ THẬT ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total GMV Affiliate"
          value={<Money value={total.gmv} />}
          icon={TrendingUp}
          tone="info"
          subtitle={`${formatNumber(total.orders)} đơn affiliate · ${summary.days} ngày`}
        />
        <StatCard
          label="Doanh thu ròng thực tế"
          value={<Money value={total.netRevenue} />}
          icon={Wallet}
          tone="positive"
          colorValue
          subtitle="GMV đã trừ tiền hoàn thật từ sàn"
        />
        <StatCard
          label="Hoa hồng sàn đã trừ"
          value={<Money value={total.commission} />}
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
              {summary.shops.map((s) => {
                const meta =
                  KOC_PLATFORM_META[s.channelName as keyof typeof KOC_PLATFORM_META];
                return (
                  <TableRow key={s.channelId}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{s.shopName}</p>
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
              {summary.shops.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Chưa có gian hàng sàn nào được liên kết.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ===== ĐƠN AFFILIATE THẬT (bằng chứng từng dòng) ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="size-4.5 text-violet-600" />
            Đơn hàng affiliate thật ({formatNumber(ordersTotal)} đơn ·{" "}
            {summary.days} ngày)
          </CardTitle>
          <CardDescription>
            Đơn sàn đã trừ hoa hồng tiếp thị liên kết khi quyết toán — nguồn số
            của các thẻ chỉ số phía trên.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    Chưa có đơn affiliate nào được sàn quyết toán trong{" "}
                    {summary.days} ngày gần nhất.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <span className={TEXT_SUB}>
                Trang {page}/{totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => load(page - 1)}
              >
                Trước
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => load(page + 1)}
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
