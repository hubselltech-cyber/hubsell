"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  PackageX,
  Receipt,
  RefreshCw,
  TrendingDown,
} from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import {
  ALL_CHANNELS,
  ChannelFilter,
  shopOnlyName,
  type ChannelFilterValue,
} from "@/components/shared/channel-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import {
  MONEY_NEGATIVE,
  MONEY_POSITIVE,
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { SkuPnlTable } from "@/components/finance/sku-pnl-table";
import { defaultRange, type DateRange } from "@/lib/date-range";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  fetchLossOrders,
  getStoredUser,
  getToken,
  type ChannelName,
  type LossOrder,
} from "@/lib/api";
import { can } from "@/lib/permissions";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber, formatDateTime } from "@/lib/format";

export default function LossOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<LossOrder[]>([]);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [lossCount, setLossCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [channel, setChannel] = useState<ChannelFilterValue>(ALL_CHANNELS);
  // Phân biệt lần tải đầu (hiện chữ "đang quét") với các lần đổi bộ lọc
  // sau đó (giữ nguyên bảng cũ, chỉ làm mờ) để giao diện không nhấp nháy
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [page, setPage] = useState(1);

  // Đổi bộ lọc là quay về trang đầu; riêng "Quét lại" giữ nguyên trang để
  // không mất mạch đang soát dở danh sách (cùng quy ước với SkuPnlTable).
  useEffect(() => {
    setPage(1);
  }, [range, channel]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLossOrders(range, channel);
      setOrders(res.orders);
      setAnalyzedCount(res.analyzedCount);
      setLossCount(res.lossCount);
      setWarningCount(res.warningCount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      // 409 (chưa có kênh) — AppShell overlay xử lý
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, [router, range, channel]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Trang này phơi bày giá vốn và lợi nhuận từng mã: chỉ Chủ shop
    if (!can(getStoredUser(), "operations.loss-orders")) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const totalLoss = orders
    .filter((o) => o.isLoss)
    .reduce((s, o) => s + o.profit, 0);

  // Cắt trang tại chỗ — dữ liệu đã về đủ trong một lần gọi API. Kẹp lại số
  // trang khi danh sách co hẹp (đổi khoảng ngày/kênh) để không đứng ở trang rỗng.
  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedOrders = orders.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Soát hiệu quả từng mã hàng và từng đơn trên {formatNumber(analyzedCount)}{" "}
            đơn <b>Đã giao</b> để biết mã nào đang gánh lỗ và vì sao.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ChannelFilter value={channel} onChange={setChannel} />
            <DateRangePicker value={range} onChange={setRange} disabled={loading} />
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Quét lại
            </Button>
          </div>
        </div>

        {/* KHỐI CHÍNH — hiệu quả theo từng mã hàng */}
        <SkuPnlTable range={range} channel={channel} />

        {/* KHỐI PHỤ — soi xuống từng đơn cụ thể.
            Bảng SKU trả lời "mã nào lỗ", bảng này trả lời "đơn nào lỗ" — hai câu
            hỏi khác nhau nên giữ cả hai, xếp dưới vì ít dùng hơn. */}
        <div className="border-t pt-6">
          <h2 className="text-lg font-semibold tracking-tight">
            Chi tiết đơn hàng lỗ
          </h2>
          <p className="text-sm text-muted-foreground">
            Từng đơn có Doanh thu ≤ Giá vốn + Phí sàn, để đối soát lại với sàn.
          </p>
        </div>

        {/* Thẻ cảnh báo tổng */}
        {loadedOnce && (lossCount > 0 || warningCount > 0) && (
          <Refreshing
            active={loading}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            {lossCount > 0 && (
              <DashboardCard
                title="Tổng tiền lỗ"
                value={<Money value={totalLoss} />}
                icon={TrendingDown}
                tone="negative"
                featured /* ← chỉ số cốt lõi: chủ shop phải thấy ngay */
                subtitle={`Phát hiện ${formatNumber(lossCount)} đơn hàng đang bán lỗ`}
              />
            )}
            {warningCount > 0 && (
              <DashboardCard
                title="Đơn chưa có giá vốn"
                value={`${formatNumber(warningCount)} đơn`}
                icon={AlertTriangle}
                tone="warning"
                colorValue
                subtitle={
                  <>
                    Số liệu lãi/lỗ của các đơn này chưa chính xác. Vào{" "}
                    <Link
                      href="/finance/cost-prices"
                      className="font-medium text-primary hover:underline"
                    >
                      Cấu hình Giá vốn
                    </Link>{" "}
                    để nhập.
                  </>
                }
              />
            )}
          </Refreshing>
        )}

        <Card>
          <CardContent className="p-0">
            {loading && !loadedOnce ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang quét đơn hàng…
              </p>
            ) : orders.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="mx-auto mb-3 size-10 text-emerald-500" />
                <p className="font-medium text-emerald-700">
                  Tuyệt vời! Không có đơn hàng nào bị lỗ.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tất cả {formatNumber(analyzedCount)} đơn Đã giao đều có lãi.
                </p>
              </div>
            ) : (
              <Refreshing active={loading}>
                <Table>
                <TableHeader className={TABLE_HEAD_EMPHASIS}>
                  <TableRow>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Kênh</TableHead>
                    <TableHead className="text-right">Doanh thu</TableHead>
                    <TableHead className="text-right">Phí sàn</TableHead>
                    <TableHead className="text-right">Giá vốn</TableHead>
                    <TableHead className="text-right">Lãi / Lỗ</TableHead>
                    <TableHead className="text-right">Thời gian</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedOrders.map((o) => {
                    const meta = CHANNEL_META[o.channelName as ChannelName];
                    return (
                      <TableRow key={o.id}>
                        <TableCell>
                          <span className="flex items-center gap-1.5">
                            {o.isLoss && (
                              <AlertTriangle className="size-4 shrink-0 text-rose-500" />
                            )}
                            {o.orderCode}
                          </span>
                          {/* Nhãn bóc tách LÝ DO LỖ */}
                          {o.lossReason === "COST" && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-red-500">
                              <PackageX className="size-3" />
                              Lỗ do Giá vốn
                            </span>
                          )}
                          {o.lossReason === "FEE" && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600">
                              <Receipt className="size-3" />
                              Lỗ do Chi phí sàn
                            </span>
                          )}
                          {o.warning && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              <AlertTriangle className="size-3" />
                              Chưa cấu hình giá vốn
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{o.customerName}</TableCell>
                        <TableCell>
                          {meta ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                          ) : (
                            <Badge variant="outline">{o.channelName}</Badge>
                          )}
                          {shopOnlyName(o.channelName as ChannelName, o.shopName) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {shopOnlyName(o.channelName as ChannelName, o.shopName)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={o.revenue} className="text-slate-900" />
                        </TableCell>
                        <TableCell className="text-right">
                          {o.platformFee > 0 ? (
                            <Money
                              value={o.platformFee}
                              negative
                              className={TEXT_NUMBER_MUTED}
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                          <span className={cn(TEXT_SUB, "block")}>
                            {o.isSettled ? "quyết toán" : "tạm tính"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={o.cost} className={TEXT_NUMBER_MUTED} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold",
                            o.isLoss ? MONEY_NEGATIVE : MONEY_POSITIVE
                          )}
                        >
                          <Money value={o.profit} />
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatDateTime(o.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                </Table>

                {/* Thanh phân trang — chỉ hiện khi danh sách vượt một trang */}
                {orders.length > PAGE_SIZE && (
                  <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3">
                    <span className="text-sm text-muted-foreground">
                      Hiển thị {formatNumber((safePage - 1) * PAGE_SIZE + 1)}–
                      {formatNumber(
                        Math.min(safePage * PAGE_SIZE, orders.length)
                      )}{" "}
                      trên {formatNumber(orders.length)} đơn · trang {safePage}/
                      {pageCount}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage <= 1}
                        onClick={() => setPage(safePage - 1)}
                      >
                        <ChevronLeft className="size-4" />
                        Trang trước
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage >= pageCount}
                        onClick={() => setPage(safePage + 1)}
                      >
                        Trang sau
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </Refreshing>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Finance · Cảnh báo &amp; P&amp;L Sản phẩm — giá vốn của đơn lấy
          theo snapshot tại thời điểm bán (costPriceAtSale)
        </p>
      </div>
    </AppShell>
  );
}
