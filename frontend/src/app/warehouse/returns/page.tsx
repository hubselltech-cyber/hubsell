"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Gavel,
  HandCoins,
  PackageCheck,
  PackageSearch,
  PackageX,
  RefreshCw,
  Search,
  Timer,
  X,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { OrderProductsCell } from "@/components/orders/order-products-cell";
import { ReturnDialog } from "@/components/orders/return-dialog";
import { ScanReturnBox } from "@/components/orders/scan-return-box";
import { Refreshing } from "@/components/refreshing";
import { ClaimDialog } from "@/components/warehouse/claim-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  fetchWarehouseReturns,
  getToken,
  syncWarehouseReturns,
  type ChannelName,
  type Order,
  type ReturnRow,
} from "@/lib/api";
import { carrierShort } from "@/lib/carrier-meta";
import { CHANNEL_META } from "@/lib/channel-meta";
import { ShopFilter, shopOnlyName } from "@/components/shop-filter";
import { formatDateTime, formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Các mức số dòng mỗi trang — đồng bộ với module Đơn hàng */
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** Nhãn tình trạng hàng hoàn */
const STATUS_META: Record<string, { label: string; className: string }> = {
  AWAITING: {
    label: "Chờ về tay",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  RECEIVED_INTACT: {
    label: "Hoàn thành công",
    className: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  DAMAGED: {
    label: "Chờ khiếu nại sàn",
    className: "bg-rose-100 text-rose-700 border-rose-200",
  },
  CLAIM_SETTLED: {
    label: "Đã đền bù",
    className: "bg-sky-100 text-sky-700 border-sky-200",
  },
  WRITTEN_OFF: {
    label: "Hao hụt / Thất thoát",
    className: "bg-zinc-200 text-zinc-700 border-zinc-300",
  },
};

const TABS: { key: string; label: string; countKey: string }[] = [
  { key: "", label: "Tất cả", countKey: "" },
  { key: "AWAITING", label: "Chờ về tay", countKey: "AWAITING" },
  { key: "RECEIVED_INTACT", label: "Hoàn thành công", countKey: "RECEIVED_INTACT" },
  { key: "DAMAGED", label: "Chờ khiếu nại", countKey: "DAMAGED" },
  { key: "CLAIM_SETTLED", label: "Đã đền bù", countKey: "CLAIM_SETTLED" },
  { key: "WRITTEN_OFF", label: "Hao hụt", countKey: "WRITTEN_OFF" },
];

/**
 * ĐỐI SOÁT ĐƠN HOÀN — nơi DUY NHẤT nhân viên kho thao tác với hàng hoàn.
 *
 * Trang /orders chỉ còn hiển thị trạng thái để theo dõi luồng đơn; mọi hành
 * động vật lý (quét mã, xác nhận nhận hàng, cộng kho) nằm ở đây.
 *
 * ⚠️ Việc cộng tồn kho vẫn gọi `POST /api/orders/:id/return` qua ReturnDialog —
 * KHÔNG có đường cộng kho riêng ở phân hệ Kho. Đó là nơi duy nhất có chốt chặn
 * `stockRestoredAt` chống cộng trùng.
 */
export default function WarehouseReturnsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [thresholds, setThresholds] = useState({ warningDays: 7, overdueDays: 14 });
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [tab, setTab] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [claiming, setClaiming] = useState<Order | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [processing, setProcessing] = useState<Order | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWarehouseReturns({
        status: tab || undefined,
        search: debounced || undefined,
        channelId: channelFilter || undefined,
        page,
        pageSize,
      });
      setRows(res.items);
      setSummary(res.summary);
      setThresholds(res.thresholds);
      setTotal(res.total);
      setPageCount(res.pageCount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 409) return; // chưa có kênh
      toast.error("Không tải được danh sách đơn hoàn");
    } finally {
      setLoading(false);
    }
  }, [tab, debounced, channelFilter, page, pageSize, router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load();
  }, [load, router]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncWarehouseReturns();
      if (res.synced === 0) {
        toast.info("Sàn chưa báo thêm đơn hoàn nào");
      } else {
        toast.success(
          `Sàn báo ${res.synced} đơn đang hoàn: ${res.orderCodes.join(", ")}`,
          { duration: 6000 }
        );
      }
      load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không đồng bộ được đơn hoàn"
      );
    } finally {
      setSyncing(false);
    }
  }

  // Đơn quá hạn dồn lên đầu bảng đã do backend sắp; ở đây chỉ đếm để cảnh báo
  const overdue = summary.overdue ?? 0;
  const warning = summary.warning ?? 0;

  const isFiltering =
    Boolean(tab) || Boolean(search.trim()) || Boolean(channelFilter);

  const emptyMessage = useMemo(() => {
    if (isFiltering) return "Không có đơn hoàn nào khớp bộ lọc.";
    return "Chưa có đơn hoàn nào. Bấm “Đồng bộ từ sàn” để kéo về danh sách sàn báo hoàn.";
  }, [isFiltering]);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Đối chiếu danh sách sàn báo hoàn với hàng kho thực nhận. Quét mã để
            nhận hàng về kho; đơn quá hạn là căn cứ khiếu nại bưu cục.
          </p>
          <Button
            onClick={handleSync}
            disabled={syncing}
            className="bg-teal-600 text-white hover:bg-teal-700"
          >
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            {syncing ? "Đang đồng bộ…" : "Đồng bộ từ sàn"}
          </Button>
        </div>

        {/* ===== QUÉT MÃ — hành động chính của kho ===== */}
        <Card className="shadow-sm">
          <CardContent className="py-1">
            <ScanReturnBox onFound={setProcessing} />
          </CardContent>
        </Card>

        {/* ===== BA CHỈ SỐ ĐỐI SOÁT ===== */}
        <div className="grid gap-4 sm:grid-cols-3">
          <DashboardCard
            title="Chờ về tay"
            value={formatNumber(summary.AWAITING ?? 0)}
            icon={PackageSearch}
            tone="warning"
            subtitle="Sàn đã báo hoàn, kho chưa quét nhận"
          />
          <DashboardCard
            title={`Quá ${thresholds.overdueDays} ngày chưa về`}
            value={formatNumber(overdue)}
            icon={Timer}
            tone={overdue > 0 ? "negative" : "neutral"}
            featured={overdue > 0}
            subtitle="Căn cứ khiếu nại bưu cục"
          />
          <DashboardCard
            title="Chờ khiếu nại sàn"
            value={formatNumber(summary.DAMAGED ?? 0)}
            icon={PackageX}
            tone="negative"
            colorValue
            subtitle="Hàng hư hỏng / mất / bị tráo"
          />
        </div>

        {(overdue > 0 || warning > 0) && (
          <Card className="border-amber-300 bg-amber-50/60 shadow-sm">
            <CardContent className="flex items-start gap-3 py-1">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-900">
                {overdue > 0 && (
                  <>
                    <b>{formatNumber(overdue)} đơn</b> đã quá{" "}
                    {thresholds.overdueDays} ngày chưa về tay — nên gửi khiếu nại
                    bưu cục.{" "}
                  </>
                )}
                {warning > 0 && (
                  <>
                    <b>{formatNumber(warning)} đơn</b> đã quá{" "}
                    {thresholds.warningDays} ngày, cần theo dõi sát.
                  </>
                )}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ===== TAB + TÌM KIẾM ===== */}
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => {
            const active = tab === t.key;
            // Tab "Tất cả" cộng dồn TỪ DANH SÁCH TRẠNG THÁI, không liệt kê tay
            // — thêm trạng thái mới mà quên cộng vào đây là con số lệch âm thầm
            // (đã dính đúng lỗi này khi thêm Hao hụt).
            const count = t.countKey
              ? summary[t.countKey]
              : Object.keys(STATUS_META).reduce(
                  (sum, k) => sum + (summary[k] ?? 0),
                  0
                );
            return (
              <button
                key={t.key || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
                {count !== undefined && count > 0 && (
                  <span className="tabular-nums opacity-70">
                    {formatNumber(count)}
                  </span>
                )}
              </button>
            );
          })}

          <ShopFilter
            className="ml-auto w-52"
            value={channelFilter}
            onChange={(id) => {
              setChannelFilter(id);
              setPage(1);
            }}
          />

          <div className="relative min-w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 pr-9"
              placeholder="Tìm mã đơn, mã vận đơn, tên khách…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Xoá từ khoá"
                className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <Card className="shadow-sm">
          <CardContent className="p-0">
            {loading && rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải danh sách đơn hoàn…
              </p>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <PackageSearch className="mx-auto mb-2 size-8" />
                {emptyMessage}
              </div>
            ) : (
              <Refreshing active={loading}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã đơn</TableHead>
                      <TableHead>Khách hàng</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Vận chuyển</TableHead>
                      <TableHead>Thời gian chờ</TableHead>
                      <TableHead>Tình trạng</TableHead>
                      <TableHead className="text-center">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((o, index) => {
                      const meta = STATUS_META[o.returnStatus];
                      return (
                        <TableRow
                          key={o.id}
                          className={cn(
                            "transition-colors hover:bg-primary/10",
                            index % 2 === 1 && "bg-muted/40",
                            // Đơn quá hạn nhuộm hồng để nhìn phát thấy ngay
                            o.agingLevel === "overdue" &&
                              "bg-rose-50 hover:bg-rose-100"
                          )}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                                  CHANNEL_META[o.channel.channelName as ChannelName]
                                    .className
                                )}
                              >
                                {CHANNEL_META[o.channel.channelName as ChannelName].label}
                              </span>
                              <span className="font-semibold tracking-tight">
                                {o.orderCode}
                              </span>
                              {shopOnlyName(
                                o.channel.channelName as ChannelName,
                                o.channel.shopName
                              ) && (
                                <span className={TEXT_SUB}>
                                  {shopOnlyName(
                                    o.channel.channelName as ChannelName,
                                    o.channel.shopName
                                  )}
                                </span>
                              )}
                            </div>
                            <p className={cn(TEXT_SUB, "mt-1")}>
                              {o.returnRequestedAt
                                ? `Sàn báo hoàn ${formatDateTime(o.returnRequestedAt)}`
                                : "Chưa rõ mốc sàn báo hoàn"}
                            </p>
                          </TableCell>

                          <TableCell>
                            <p className="font-medium">{o.customerName}</p>
                            <p className={cn(TEXT_SUB, "font-mono")}>
                              {o.customerPhone ?? "—"}
                            </p>
                          </TableCell>

                          <TableCell className="w-72 max-w-72 whitespace-normal">
                            <OrderProductsCell lines={o.items ?? []} />
                          </TableCell>

                          <TableCell>
                            <p className="font-medium">{carrierShort(o.carrier)}</p>
                            <p className={cn(TEXT_SUB, "font-mono")}>
                              {o.trackingCode ?? "—"}
                            </p>
                          </TableCell>

                          <TableCell>
                            {o.daysWaiting === null ? (
                              <span className={TEXT_SUB}>Chưa rõ</span>
                            ) : (
                              <span
                                className={cn(
                                  "font-semibold tabular-nums",
                                  o.agingLevel === "overdue" && "text-rose-600",
                                  o.agingLevel === "warning" && "text-amber-700"
                                )}
                              >
                                {formatNumber(o.daysWaiting)} ngày
                              </span>
                            )}
                            {o.agingLevel === "overdue" && (
                              <p className={cn(TEXT_SUB, "text-rose-600")}>
                                Chưa về tay
                              </p>
                            )}
                          </TableCell>

                          <TableCell>
                            {meta && (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                                  meta.className
                                )}
                              >
                                {meta.label}
                              </span>
                            )}
                            {/* Tiền đòi được — nhìn phát biết đơn này thu về
                                bao nhiêu từ bưu cục */}
                            {Number(o.compensationAmount) > 0 && (
                              <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-emerald-700">
                                <HandCoins className="size-3.5 shrink-0" />
                                {formatVND(o.compensationAmount)}
                              </p>
                            )}
                            {o.returnStatus === "WRITTEN_OFF" && (
                              <p className={cn(TEXT_SUB, "mt-1 text-zinc-600")}>
                                Không đòi được đồng nào
                              </p>
                            )}
                            {o.returnNote && (
                              <p className={cn(TEXT_SUB, "mt-1 max-w-48")}>
                                {o.returnNote}
                              </p>
                            )}
                          </TableCell>

                          <TableCell className="text-center">
                            {o.returnStatus === "AWAITING" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setProcessing(o)}
                              >
                                <PackageCheck className="size-3.5" />
                                Nhận hàng
                              </Button>
                            ) : o.returnStatus === "DAMAGED" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setClaiming(o)}
                              >
                                <Gavel className="size-3.5" />
                                Cập nhật khiếu nại
                              </Button>
                            ) : (
                              <span className={TEXT_SUB}>
                                {o.returnedAt ? formatDateTime(o.returnedAt) : "—"}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Refreshing>
            )}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hiển thị</span>
              <NativeSelect
                className="w-20"
                aria-label="Số đơn mỗi trang"
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1); // đổi cỡ trang thì về trang 1, tránh trang trống
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm text-muted-foreground">
                đơn/trang · trang {page}/{Math.max(1, pageCount)} ·{" "}
                {formatNumber(total)} đơn
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
                Trang trước
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Trang sau
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell · Quản lý Kho — Đối soát đơn hoàn
        </p>
      </div>

      <ClaimDialog
        order={claiming}
        open={claiming !== null}
        onOpenChange={(o) => {
          if (!o) setClaiming(null);
        }}
        onDone={load}
      />

      <ReturnDialog
        order={processing}
        open={processing !== null}
        onOpenChange={(o) => {
          if (!o) setProcessing(null);
        }}
        onDone={load}
      />
    </AppShell>
  );
}
