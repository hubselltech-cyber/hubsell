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
  Loader2,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PackageX,
  RefreshCw,
  Search,
  Timer,
  X,
} from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { OrderProductsCell } from "@/components/orders/order-products-cell";
import { ReturnDialog } from "@/components/orders/return-dialog";
import { ScanReturnBox } from "@/components/orders/scan-return-box";
import { Refreshing } from "@/components/shared/refreshing";
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
  bulkInboundReturns,
  channelFilterToQuery,
  fetchWarehouseReturns,
  getToken,
  processOrderReturn,
  receiveWarehouseReturn,
  syncWarehouseReturns,
  type ChannelName,
  type Order,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { carrierShort } from "@/lib/carrier-meta";
import { CHANNEL_META } from "@/lib/channel-meta";
import {
  ALL_CHANNELS,
  ChannelFilter,
  shopOnlyName,
  type ChannelFilterValue,
} from "@/components/shared/channel-filter";
import { formatDateTime, formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Các mức số dòng mỗi trang — đồng bộ với module Đơn hàng */
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** Nhãn tình trạng hàng hoàn */
const STATUS_META: Record<string, { label: string; className: string }> = {
  AWAITING: {
    label: "Chờ về tay",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  RECEIVED: {
    label: "Đã nhận · chờ nhập kho",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  RECEIVED_INTACT: {
    label: "Đã nhập kho",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  DAMAGED: {
    label: "Chờ khiếu nại sàn",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
  CLAIM_SETTLED: {
    label: "Đã đền bù",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  WRITTEN_OFF: {
    label: "Hao hụt / Thất thoát",
    className: "bg-zinc-200 text-zinc-700 border-zinc-300",
  },
};

/** Nhóm trạng thái gộp cho tab Hao hụt/Khiếu nại — khớp filter ISSUES ở backend */
const ISSUE_KEYS = ["DAMAGED", "CLAIM_SETTLED", "WRITTEN_OFF"] as const;

const TABS: { key: string; label: string; countKey: string }[] = [
  { key: "", label: "Tất cả", countKey: "" },
  { key: "AWAITING", label: "Chờ về tay", countKey: "AWAITING" },
  { key: "RECEIVED", label: "Đã nhận (Chờ nhập kho)", countKey: "RECEIVED" },
  { key: "RECEIVED_INTACT", label: "Đã nhập kho", countKey: "RECEIVED_INTACT" },
  { key: "ISSUES", label: "Hao hụt/Khiếu nại", countKey: "ISSUES" },
];

/**
 * ĐỐI SOÁT ĐƠN HOÀN — nơi DUY NHẤT nhân viên kho thao tác với hàng hoàn.
 *
 * Luồng 2 CÔNG ĐOẠN, tối ưu thao tác một tay trên điện thoại:
 *
 *   1. QUÉT NHẬN — bắn máy quét / camera vào mã vận đơn là đơn TỰ chuyển sang
 *      "Đã nhận · chờ nhập kho" (RECEIVED), không mở dialog, không hỏi gì thêm.
 *      Chỉ ghi nhận hàng đã về tay, CHƯA cộng tồn kho.
 *   2. NHẬP KHO — một nút "Nhập kho tất cả đơn đã nhận" cộng tồn kho cho toàn
 *      bộ đơn RECEIVED, không cần tích chọn checkbox từng đơn. Xử lý lẻ vẫn có
 *      nút Nhập kho / Báo hỏng trên từng dòng.
 *
 * ⚠️ Việc cộng tồn kho vẫn chỉ đi qua `/api/orders/*` (đơn lẻ: /:id/return,
 * hàng loạt: /returns/bulk-inbound) — nơi duy nhất có chốt chặn
 * `stockRestoredAt` chống cộng trùng. KHÔNG có đường cộng kho riêng ở phân hệ Kho.
 */
export default function WarehouseReturnsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [tab, setTab] = useState("");
  const [channelFilter, setChannelFilter] =
    useState<ChannelFilterValue>(ALL_CHANNELS);
  const [claiming, setClaiming] = useState<Order | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [syncing, setSyncing] = useState(false);
  /** Đơn đang mở dialog Báo hỏng / Khiếu nại (xử lý lẻ công đoạn 2) */
  const [processing, setProcessing] = useState<Order | null>(null);
  /** id đơn đang gọi API quét nhận — khoá nút của đúng dòng đó */
  const [receivingId, setReceivingId] = useState<string | null>(null);
  /** id đơn đang nhập kho lẻ */
  const [inboundingId, setInboundingId] = useState<string | null>(null);
  const [bulkInbounding, setBulkInbounding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // TỰ CẬP NHẬT: worker nền + webhook đã đổ đơn hoàn mới vào DB — trang phải
  // tự thấy chứ không bắt ai bấm gì. refetchInterval 30s của React Query tự
  // đứng im khi cửa sổ mất focus (refetchIntervalInBackground mặc định false),
  // đỡ gọi API vô ích đúng như setInterval + visibilitychange cũ.
  const returnsQ = useApiQuery({
    queryKey: qk.warehouseReturns({
      status: tab || undefined,
      search: debounced || undefined,
      channel: channelFilterToQuery(channelFilter),
      page,
      pageSize,
    }),
    queryFn: () =>
      fetchWarehouseReturns({
        status: tab || undefined,
        search: debounced || undefined,
        channel: channelFilter,
        page,
        pageSize,
      }),
    refetchInterval: 30 * 1000,
    // Trang cần số NÓNG (nhân viên đang cầm kiện hàng quét mã) — quay lại
    // trang là refetch ngay thay vì tin cache 30s.
    staleTime: 0,
  });
  const invalidate = useInvalidate();

  const rows = returnsQ.data?.items ?? [];
  const summary = returnsQ.data?.summary ?? {};
  const thresholds = returnsQ.data?.thresholds ?? { warningDays: 7, overdueDays: 14 };
  const total = returnsQ.data?.total ?? 0;
  const pageCount = returnsQ.data?.pageCount ?? 0;
  // Lượt TỰ cập nhật nền + refetch sau thao tác chạy IM LẶNG — không làm mờ
  // bảng trước mặt nhân viên đang quét hàng. Chỉ báo bận khi tải lần đầu hoặc
  // đổi bộ lọc (placeholder = đang hiện số cũ của bộ lọc trước).
  const loading = returnsQ.loading || returnsQ.placeholder;

  // Sau thao tác ghi (quét nhận / nhập kho / khiếu nại) làm tươi mọi biến thể
  // bộ lọc của trang — badge đếm các tab khác đổi theo.
  const load = useCallback(
    () => invalidate(["warehouse-returns"]),
    [invalidate]
  );

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // 401 hook tự xử; 409 (chưa có kênh) overlay lo; lỗi khác báo toast như cũ.
  useEffect(() => {
    if (returnsQ.error) toast.error("Không tải được danh sách đơn hoàn");
  }, [returnsQ.error]);

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

  /**
   * CÔNG ĐOẠN 1 — quét nhận: đơn tự chuyển sang "Đã nhận · chờ nhập kho".
   * KHÔNG cộng tồn kho ở bước này.
   */
  const handleReceive = useCallback(
    async (order: Order) => {
      setReceivingId(order.id);
      try {
        const res = await receiveWarehouseReturn(order.id);
        if (res.unannounced) {
          toast.warning(
            `${order.orderCode}: sàn CHƯA báo hoàn đơn này — vẫn ghi nhận đã về tay, chờ nhập kho`,
            { duration: 6000 }
          );
        } else {
          toast.success(`Đã nhận hàng đơn ${order.orderCode} — chờ nhập kho`);
        }
        load();
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Không ghi nhận được đơn hoàn"
        );
      } finally {
        setReceivingId(null);
      }
    },
    [load]
  );

  /**
   * Quét trúng mã → nhận hàng NGAY, không mở dialog hỏi thêm — nhân viên đang
   * cầm điện thoại một tay, tay kia cầm kiện hàng. Đơn đã qua bước nhận thì chỉ
   * nhắc trạng thái hiện tại chứ không làm gì.
   */
  const handleScanFound = useCallback(
    (order: Order) => {
      if (order.returnStatus === "RECEIVED") {
        toast.info(
          `${order.orderCode} đã quét nhận rồi — bấm “Nhập kho” hoặc dùng nút Nhập kho tất cả`
        );
        return;
      }
      const meta = STATUS_META[order.returnStatus];
      if (order.returnStatus !== "AWAITING" && order.returnStatus !== "NONE") {
        toast.info(
          `${order.orderCode} đã xử lý hoàn trước đó${meta ? ` (${meta.label})` : ""}`
        );
        return;
      }
      handleReceive(order);
    },
    [handleReceive]
  );

  /** CÔNG ĐOẠN 2 xử lý lẻ — nhập kho một đơn đã nhận, một chạm. */
  async function handleInbound(order: Order) {
    setInboundingId(order.id);
    try {
      const res = await processOrderReturn(order.id, "INTACT");
      if (res.restored.length > 0) {
        toast.success(
          `Đã nhập kho ${order.orderCode} · ${res.restored
            .map((r) => `${r.productName} +${r.restoredQuantity} (còn ${r.newQuantity})`)
            .join("; ")}`,
          { duration: 8000 }
        );
      } else if (res.stockSkippedReason) {
        toast.warning(`${order.orderCode}: ${res.stockSkippedReason}`, {
          duration: 8000,
        });
      } else {
        toast.success(`Đã nhập kho đơn ${order.orderCode}`);
      }
      load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không nhập kho được đơn hoàn"
      );
    } finally {
      setInboundingId(null);
    }
  }

  /**
   * CÔNG ĐOẠN 2 hàng loạt — "NHẬP KHO TẤT CẢ ĐƠN ĐÃ NHẬN" một chạm: backend tự
   * quét toàn bộ đơn RECEIVED và cộng kho, không cần tích chọn gì ở đây.
   */
  async function handleBulkInbound() {
    setBulkInbounding(true);
    try {
      const res = await bulkInboundReturns();
      if (res.processed === 0 && res.failed.length === 0) {
        toast.info("Không có đơn nào đang chờ nhập kho");
      } else {
        toast.success(
          `Đã nhập kho ${res.processed} đơn · cộng ${formatNumber(
            res.restockedUnits
          )} sản phẩm vào tồn kho`,
          { duration: 8000 }
        );
        if (res.failed.length > 0) {
          toast.error(
            `${res.failed.length} đơn lỗi, chưa nhập được: ${res.failed
              .map((f) => f.orderCode)
              .join(", ")}`,
            { duration: 10000 }
          );
        }
      }
      load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không nhập kho hàng loạt được"
      );
    } finally {
      setBulkInbounding(false);
    }
  }

  // Đơn quá hạn dồn lên đầu bảng đã do backend sắp; ở đây chỉ đếm để cảnh báo
  const overdue = summary.overdue ?? 0;
  const warning = summary.warning ?? 0;
  /** Số đơn đã quét nhận, đang chờ nhập kho — hiện ngay trên nút bulk */
  const receivedCount = summary.RECEIVED ?? 0;

  const isFiltering =
    Boolean(tab) || Boolean(search.trim()) || Boolean(channelFilter.channelName);

  const emptyMessage = useMemo(() => {
    if (isFiltering) return "Không có đơn hoàn nào khớp bộ lọc.";
    return "Chưa có đơn hoàn nào. Bấm “Đồng bộ từ sàn” để kéo về danh sách sàn báo hoàn.";
  }, [isFiltering]);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Hai công đoạn: <b>quét mã để nhận hàng</b> về tay, rồi bấm{" "}
            <b>Nhập kho tất cả</b> để cộng tồn kho một lượt. Đơn sàn báo hoàn{" "}
            <b>tự đổ về</b> (danh sách tự làm mới mỗi 30 giây) — nút bên chỉ để
            quét ngay khỏi đợi nhịp.
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

        {/* ===== CÔNG ĐOẠN 1: QUÉT NHẬN — quét trúng là tự nhận, không hỏi thêm ===== */}
        <Card className="shadow-sm">
          <CardContent className="py-1">
            <ScanReturnBox onFound={handleScanFound} disabled={receivingId !== null} />
          </CardContent>
        </Card>

        {/* ===== CÔNG ĐOẠN 2: NHẬP KHO TẤT CẢ — nút 1 chạm cho điện thoại,
             không có checkbox tích chọn gì hết ===== */}
        <Button
          size="lg"
          onClick={handleBulkInbound}
          disabled={bulkInbounding || receivedCount === 0}
          className="w-full bg-emerald-600 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 sm:w-auto"
        >
          {bulkInbounding ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <PackageOpen className="size-5" />
          )}
          {bulkInbounding
            ? "Đang nhập kho…"
            : `📦 Nhập kho tất cả đơn đã nhận (${formatNumber(receivedCount)})`}
        </Button>

        {/* ===== BỐN CHỈ SỐ ĐỐI SOÁT ===== */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardCard
            title="Chờ về tay"
            value={formatNumber(summary.AWAITING ?? 0)}
            icon={PackageSearch}
            tone="warning"
            subtitle="Sàn đã báo hoàn, kho chưa quét nhận"
          />
          <DashboardCard
            title="Đã nhận · chờ nhập kho"
            value={formatNumber(receivedCount)}
            icon={PackageOpen}
            tone={receivedCount > 0 ? "positive" : "neutral"}
            subtitle="Hàng đã về tay, bấm nút trên để cộng kho"
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
            // Tab gộp Hao hụt/Khiếu nại cũng cộng từ ISSUE_KEYS cùng lý do.
            const count =
              t.countKey === "ISSUES"
                ? ISSUE_KEYS.reduce((sum, k) => sum + (summary[k] ?? 0), 0)
                : t.countKey
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

          <div className="ml-auto">
            <ChannelFilter
              value={channelFilter}
              onChange={(v) => {
                setChannelFilter(v);
                setPage(1);
              }}
            />
          </div>

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
                              "bg-rose-50 hover:bg-rose-50"
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
                            <p>{o.customerName}</p>
                            <p className={cn(TEXT_SUB, "font-mono")}>
                              {o.customerPhone ?? "—"}
                            </p>
                          </TableCell>

                          <TableCell className="w-72 max-w-72 whitespace-normal">
                            <OrderProductsCell lines={o.items ?? []} />
                          </TableCell>

                          <TableCell>
                            <p>{carrierShort(o.carrier)}</p>
                            <p className={cn(TEXT_SUB, "font-mono")}>
                              {o.trackingCode ?? "—"}
                            </p>
                            {/* Kiện hoàn Shopee đi chiều ngược bằng MÃ RIÊNG —
                                đây là mã in trên tem kiện đang về, kho dò tem
                                bằng mắt là so với dòng này */}
                            {o.returnTrackingCode &&
                              o.returnTrackingCode !== o.trackingCode && (
                                <p className={cn(TEXT_SUB, "font-mono text-indigo-700")}>
                                  Hoàn: {o.returnTrackingCode}
                                </p>
                              )}
                          </TableCell>

                          <TableCell>
                            {o.daysWaiting === null ? (
                              <span className={TEXT_SUB}>Chưa rõ</span>
                            ) : (
                              <span
                                className={cn(
                                  "font-semibold tabular-nums",
                                  o.agingLevel === "overdue" && "text-red-500",
                                  o.agingLevel === "warning" && "text-amber-700"
                                )}
                              >
                                {formatNumber(o.daysWaiting)} ngày
                              </span>
                            )}
                            {o.agingLevel === "overdue" && (
                              <p className={cn(TEXT_SUB, "text-red-500")}>
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
                              // Công đoạn 1 xử lý lẻ: bấm là nhận luôn, không dialog
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={receivingId === o.id}
                                onClick={() => handleReceive(o)}
                              >
                                {receivingId === o.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <PackageCheck className="size-3.5" />
                                )}
                                Nhận hàng
                              </Button>
                            ) : o.returnStatus === "RECEIVED" ? (
                              // Công đoạn 2 xử lý lẻ: nhập kho 1 chạm là chính,
                              // báo hỏng là đường phụ (mở dialog ghi chú)
                              <div className="flex flex-col items-stretch gap-1.5">
                                <Button
                                  size="sm"
                                  disabled={
                                    inboundingId === o.id || bulkInbounding
                                  }
                                  onClick={() => handleInbound(o)}
                                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                                >
                                  {inboundingId === o.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <PackageOpen className="size-3.5" />
                                  )}
                                  📦 Nhập kho
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={
                                    inboundingId === o.id || bulkInbounding
                                  }
                                  onClick={() => setProcessing(o)}
                                >
                                  <PackageX className="size-3.5" />
                                  Báo hỏng/Khiếu nại
                                </Button>
                              </div>
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
