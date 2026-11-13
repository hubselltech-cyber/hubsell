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
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { ClaimDialog } from "@/components/warehouse/claim-dialog";
import {
  ReturnsBulkBar,
  isReturnBulkSelectable,
} from "@/components/warehouse/returns-bulk-bar";
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
import { rangeToQuery, type DateRange } from "@/lib/date-range";
import { formatDateTime, formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Các mức số dòng mỗi trang — đồng bộ với module Đơn hàng */
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** Nhãn tình trạng hàng hoàn */
const STATUS_META: Record<string, { label: string; className: string }> = {
  // Câu chữ thống nhất với /orders và app mobile (26/10/2026).
  AWAITING: {
    label: "Chờ hàng về",
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
    label: "Hàng hỏng · chờ khiếu nại sàn",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
  CLAIM_SETTLED: {
    label: "Đã được đền bù",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  WRITTEN_OFF: {
    label: "Hao hụt / xóa sổ",
    className: "bg-zinc-200 text-zinc-700 border-zinc-300",
  },
};

/** Nhóm trạng thái gộp cho tab Hao hụt/Khiếu nại — khớp filter ISSUES ở backend */
const ISSUE_KEYS = ["DAMAGED", "CLAIM_SETTLED", "WRITTEN_OFF"] as const;

const TABS: { key: string; label: string; countKey: string }[] = [
  { key: "", label: "Tất cả", countKey: "" },
  { key: "AWAITING", label: "Chờ hàng về", countKey: "AWAITING" },
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
 *   2. NHẬP KHO — tích các đơn Đã nhận rồi bấm Nhập kho ở thanh nổi đáy màn
 *      (cộng tồn kho cho đúng các đơn đang tích), hoặc nút Nhập kho / Báo hỏng
 *      trên từng dòng. Nút "Nhập kho tất cả đơn đã nhận" đã gỡ 13/11/2026.
 *
 * BỐ CỤC (anh Trung chốt 13/11/2026): đầu trang ô quét gọn (trái) + lọc thời
 * gian, nút đồng bộ (phải) → bốn thẻ số → dải nhắc mỏng → tab trạng thái (trái)
 * + lọc gian, ô tìm (phải) → bảng.
 *
 * Ô TÍCH (13/11/2026, anh Trung): tích theo TỪNG TRANG, tích bao nhiêu tác động
 * bấy nhiêu đơn — thanh nổi đáy màn có Nhận hàng / Nhập kho / Báo hỏng cho các
 * đơn đang tích (components/warehouse/returns-bulk-bar.tsx). Đổi trang / tab /
 * bộ lọc là bỏ chọn; không có "chọn mọi đơn khớp bộ lọc".
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
  /** Lọc theo ngày sàn báo hoàn; null = toàn bộ thời gian (mặc định — đơn chờ về có thể rất cũ). */
  const [range, setRange] = useState<DateRange | null>(null);
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
  /**
   * Đơn đang tích, gắn với ĐÚNG cảnh đang xem (tab + lọc + trang): đổi cảnh thì
   * `viewKey` khác → coi như chưa tích gì, khỏi phải dọn ở từng nút đổi cảnh.
   */
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({
    key: "",
    ids: new Set(),
  });

  // Chuông "đơn đã bàn giao bị hủy" dẫn tới đây kèm ?search=<mã đơn> (12/11/2026) → đổ sẵn
  // vào ô tìm để thấy ngay đúng đơn. Đọc sau khi mount (trang dựng sẵn không có query).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("search")?.trim();
    if (code) queueMicrotask(() => setSearch(code));
  }, []);

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
      range: rangeToQuery(range ?? undefined),
      page,
      pageSize,
    }),
    queryFn: () =>
      fetchWarehouseReturns({
        status: tab || undefined,
        search: debounced || undefined,
        channel: channelFilter,
        range,
        page,
        pageSize,
      }),
    refetchInterval: 30 * 1000,
    // Trang cần số NÓNG (nhân viên đang cầm kiện hàng quét mã) — quay lại
    // trang là refetch ngay thay vì tin cache 30s.
    staleTime: 0,
  });
  const invalidate = useInvalidate();

  const rows = useMemo(() => returnsQ.data?.items ?? [], [returnsQ.data]);
  const viewKey = JSON.stringify([
    tab,
    debounced,
    channelFilter,
    rangeToQuery(range ?? undefined),
    page,
    pageSize,
  ]);
  // Chỉ đơn ĐANG HIỆN trên trang mới được tính là đang tích (lượt tự làm mới 30
  // giây có thể đưa một đơn ra khỏi trang).
  const selectedRows = useMemo(
    () =>
      selection.key === viewKey
        ? rows.filter((o) => selection.ids.has(o.id) && isReturnBulkSelectable(o))
        : [],
    [rows, selection, viewKey]
  );
  const selectedIds = useMemo(() => new Set(selectedRows.map((o) => o.id)), [selectedRows]);
  const selectableRows = useMemo(() => rows.filter(isReturnBulkSelectable), [rows]);
  const allSelected =
    selectableRows.length > 0 && selectableRows.every((o) => selectedIds.has(o.id));
  const setSelectedIds = (ids: Set<string>) => setSelection({ key: viewKey, ids });
  const toggleRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(selectableRows.map((o) => o.id)));
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
          `${order.orderCode} đã quét nhận rồi — bấm “Nhập kho” trên dòng, hoặc tích chọn rồi Nhập kho`
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
      // Trả Promise: ô quét chạy mã kế trong hàng chờ sau khi đơn này ghi xong.
      return handleReceive(order);
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

  // Đơn quá hạn dồn lên đầu bảng đã do backend sắp; ở đây chỉ đếm để cảnh báo
  const overdue = summary.overdue ?? 0;
  const warning = summary.warning ?? 0;
  /** Số đơn đã quét nhận, đang chờ nhập kho — theo bộ lọc đang xem (thẻ + tab) */
  const receivedCount = summary.RECEIVED ?? 0;

  const isFiltering =
    Boolean(tab) ||
    Boolean(search.trim()) ||
    Boolean(channelFilter.channelName) ||
    range !== null;

  const emptyMessage = useMemo(() => {
    if (isFiltering) return "Không có đơn hoàn nào khớp bộ lọc.";
    return "Chưa có đơn hoàn nào. Đơn sàn báo hoàn sẽ tự đổ về đây.";
  }, [isFiltering]);

  return (
    <AppShell>
      {/* pb-28: chừa chỗ cho thanh thao tác hàng loạt nổi ở đáy khỏi che dòng cuối */}
      <div className={cn("space-y-5", selectedRows.length > 0 && "pb-28")}>
        {/* ===== ĐẦU TRANG (anh Trung chốt vị trí 13/11/2026): ô quét gọn ở bên
             trái — đúng chỗ nút "Nhập kho tất cả" cũ (nút đó đã gỡ: đã có ô tích +
             thanh Nhập kho ở đáy); bộ lọc thời gian ở bên phải, kèm nút đồng bộ.
             Lọc thời gian đứng TRÊN bốn thẻ vì nó đổi cả số trên thẻ lẫn danh sách. ===== */}
        <div className="flex flex-wrap items-start gap-2">
          <div className="w-full sm:w-96">
            <ScanReturnBox compact onFound={handleScanFound} />
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            {/* Lọc theo NGÀY SÀN BÁO HOÀN — bộ chọn kỳ chuẩn của app */}
            <DateRangePicker
              allowAll
              value={range}
              onChange={(r) => {
                setRange(r);
                setPage(1);
              }}
            />

            {/* Chỉ còn biểu tượng: đơn sàn báo hoàn TỰ đổ về, nút này hiếm khi cần. */}
            <Button
              variant="outline"
              size="icon"
              onClick={handleSync}
              disabled={syncing}
              aria-label="Đồng bộ từ sàn"
              title="Đồng bộ từ sàn — đơn sàn báo hoàn tự đổ về (danh sách tự làm mới mỗi 30 giây), nút này chỉ để kéo ngay khỏi đợi nhịp."
            >
              <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* ===== BỐN CHỈ SỐ ĐỐI SOÁT ===== */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardCard
            title="Chờ hàng về"
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
            subtitle="Hàng đã về tay, chờ cộng lại tồn kho"
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
            title="Hàng hỏng · chờ khiếu nại sàn"
            value={formatNumber(summary.DAMAGED ?? 0)}
            icon={PackageX}
            tone="negative"
            colorValue
            subtitle="Hàng hư hỏng / mất / bị tráo"
          />
        </div>

        {/* Dải nhắc mỏng một dòng (anh Trung 13/11: "rải màu cam cho nhỏ lại") — con
            số chính đã có ở thẻ "Quá N ngày chưa về" ngay trên. */}
        {(overdue > 0 || warning > 0) && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              {overdue > 0 && (
                <>
                  <b>{formatNumber(overdue)} đơn</b> đã quá {thresholds.overdueDays} ngày chưa về
                  tay — nên gửi khiếu nại bưu cục.{" "}
                </>
              )}
              {warning > 0 && (
                <>
                  <b>{formatNumber(warning)} đơn</b> đã quá {thresholds.warningDays} ngày, cần
                  theo dõi sát.
                </>
              )}
            </span>
          </p>
        )}

        {/* ===== TAB TRẠNG THÁI (trái) + lọc gian + ô tìm (phải), sát bảng ===== */}
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

          <div className="relative w-full sm:w-64">
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
                      <TableHead className="w-10 pr-0">
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả đơn xử lý được trên trang này"
                          checked={allSelected}
                          disabled={selectableRows.length === 0}
                          ref={(el) => {
                            if (el) el.indeterminate = !allSelected && selectedRows.length > 0;
                          }}
                          onChange={toggleAll}
                          className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </TableHead>
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
                              "bg-rose-50 hover:bg-rose-50",
                            selectedIds.has(o.id) && "bg-primary/10"
                          )}
                        >
                          <TableCell className="w-10 pr-0">
                            <input
                              type="checkbox"
                              aria-label={`Chọn đơn ${o.orderCode}`}
                              checked={selectedIds.has(o.id)}
                              // Đơn đã nhập kho / đã báo hỏng không còn việc hàng loạt nào
                              disabled={!isReturnBulkSelectable(o)}
                              onChange={() => toggleRow(o.id)}
                              className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-30"
                            />
                          </TableCell>
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
                              {o.platformReturnStatus === "CANCELLED_AFTER_SHIP" && (
                                <span className="ml-1 text-amber-600 dark:text-amber-400">
                                  · giao thất bại, kiện quay đầu
                                </span>
                              )}
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
                                  disabled={inboundingId === o.id}
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
                                  disabled={inboundingId === o.id}
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

      <ReturnsBulkBar
        selected={selectedRows}
        onClear={() => setSelectedIds(new Set())}
        onDone={load}
      />

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
