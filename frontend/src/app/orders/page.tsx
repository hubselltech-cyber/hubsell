"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  PackageOpen,
  Pencil,
  Printer,
  ScanLine,
  Search,
  X,
} from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { DataTable } from "@/components/data-table/data-table";
import { InvoiceStatusPanel } from "@/components/invoice/invoice-status-panel";
import { Money } from "@/components/ui/money";
import { BulkActionBar } from "@/components/orders/bulk-action-bar";
import { OrderProductsCell } from "@/components/orders/order-products-cell";
import { Refreshing } from "@/components/shared/refreshing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  channelFilterToQuery,
  fetchOrders,
  getToken,
  updateOrderStatus,
  type Order,
  type ReturnStatus,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { exportAllOrders } from "@/lib/excel";
import { CARRIER_OPTIONS, carrierShort } from "@/lib/carrier-meta";
import { isExpressShipping } from "@/lib/shipping";
import { CHANNEL_META } from "@/lib/channel-meta";
import {
  ALL_CHANNELS,
  ChannelFilter,
  shopOnlyName,
  type ChannelFilterValue,
} from "@/components/shared/channel-filter";
import { formatNumber, formatDateTime } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Các mức số đơn hiển thị mỗi trang. Backend chặn trần ở 100. */
const PAGE_SIZE_OPTIONS = [20, 50, 100];

const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Chờ xử lý", className: "bg-zinc-50 text-zinc-600 border-zinc-200" },
  PROCESSED: {
    label: "Đã xử lý",
    className: "bg-violet-50 text-violet-700 border-violet-200",
  },
  SHIPPING: { label: "Đang giao", className: "bg-sky-50 text-sky-700 border-sky-200" },
  DELIVERED: { label: "Đã giao", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Đã hủy", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

/** Nhãn tình trạng hàng hoàn — chỉ hiện với đơn thực sự có hoàn (khác NONE) */
const RETURN_META: Record<string, { label: string; className: string }> = {
  AWAITING: {
    label: "Chờ nhận hàng hoàn",
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
    label: "Đã được đền",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
};

const PAYMENT_META: Record<string, { label: string; className: string }> = {
  PAID: { label: "Đã thanh toán", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  UNPAID: { label: "Chưa thanh toán", className: "bg-amber-50 text-amber-700 border-amber-200" },
  REFUNDED: { label: "Đã hoàn tiền", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

function MetaBadge({
  meta,
  fallback,
}: {
  meta?: { label: string; className: string };
  fallback: string;
}) {
  if (!meta) return <Badge variant="outline">{fallback}</Badge>;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

// ---------- Dialog cập nhật trạng thái ----------

function UpdateStatusDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: Order;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [newStatus, setNewStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Các trạng thái có thể chuyển tới (trừ trạng thái hiện tại)
  const options = [
    "PENDING",
    "PROCESSED",
    "SHIPPING",
    "DELIVERED",
    "CANCELLED",
  ].filter(
    (s) => s !== order.shippingStatus
  );

  useEffect(() => {
    if (open) setNewStatus(options[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newStatus) return;
    setSubmitting(true);
    try {
      const res = await updateOrderStatus(order.id, newStatus);
      if (newStatus === "CANCELLED" && res.restored.length > 0) {
        toast.success(
          `Đã hủy đơn ${order.orderCode}. Hoàn kho: ${res.restored
            .map((r) => `${r.productName} +${r.restoredQuantity} (còn ${r.newQuantity})`)
            .join("; ")}`,
          { duration: 7000 }
        );
      } else if (newStatus === "CANCELLED") {
        toast.success(
          `Đã hủy đơn ${order.orderCode}. (Đơn này không có log trừ kho nên không cần hoàn kho.)`,
          { duration: 6000 }
        );
      } else {
        toast.success(
          `Đơn ${order.orderCode} → ${STATUS_META[newStatus]?.label ?? newStatus}`
        );
      }
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cập nhật trạng thái đơn {order.orderCode}</DialogTitle>
          <DialogDescription>
            Trạng thái hiện tại:{" "}
            {STATUS_META[order.shippingStatus]?.label ?? order.shippingStatus} ·
            Khách: {order.customerName}
          </DialogDescription>
        </DialogHeader>

        {/* Khu vực hóa đơn điện tử (giữ chỗ) — tách khỏi luồng đổi trạng thái
            giao vận và khỏi phiếu đóng gói của kho. */}
        <InvoiceStatusPanel reference={order.orderCode} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="new-status">Chuyển sang trạng thái</Label>
            <NativeSelect
              id="new-status"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
            >
              {options.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s]?.label ?? s}
                </option>
              ))}
            </NativeSelect>
          </div>

          {newStatus === "CANCELLED" && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                Hủy đơn sẽ <b>tự động cộng hoàn lại tồn kho</b> cho các sản phẩm
                gốc mà đơn này đã trừ, và ghi vào lịch sử kho. Đơn đã hủy không
                thể đổi trạng thái nữa.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Đóng
            </Button>
            <Button
              type="submit"
              disabled={submitting || !newStatus}
              className={
                newStatus === "CANCELLED" ? "bg-rose-600 hover:bg-rose-700" : ""
              }
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Xác nhận
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Trang chính ----------

/** Các tab theo vòng đời đơn hàng TMĐT. `status` rỗng = tab Tất cả. */
const TABS: { key: string; label: string; status: string; countKey: string }[] = [
  { key: "all", label: "Tất cả", status: "", countKey: "ALL" },
  { key: "pending", label: "Chờ xử lý", status: "PENDING", countKey: "PENDING" },
  {
    key: "processed",
    label: "Đã xử lý",
    status: "PROCESSED",
    countKey: "PROCESSED",
  },
  { key: "shipping", label: "Đang giao", status: "SHIPPING", countKey: "SHIPPING" },
  {
    key: "delivered",
    label: "Đã giao thành công",
    status: "DELIVERED",
    countKey: "DELIVERED",
  },
  {
    key: "cancelled",
    label: "Đơn hủy / Hoàn trả",
    status: "CANCELLED",
    countKey: "CANCELLED",
  },
];

export default function OrdersPage() {
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [tab, setTab] = useState("all");
  // Bộ lọc con chỉ dùng trong tab "Đã xử lý": "" = tất cả, "no" = chưa in phiếu
  const [printedFilter, setPrintedFilter] = useState<"" | "no" | "yes">("");
  const [channelFilter, setChannelFilter] =
    useState<ChannelFilterValue>(ALL_CHANNELS);
  const [carrierFilter, setCarrierFilter] = useState("");
  // Lọc theo độ khó đóng gói: kho ưu tiên gói đơn 1 sản phẩm trước cho nhanh
  const [orderTypeFilter, setOrderTypeFilter] = useState<"" | "single" | "multi">("");
  // Bộ lọc con của tab "Hủy / Hoàn" + đơn vừa quét ra để xử lý
  const [returnFilter, setReturnFilter] = useState<ReturnStatus | "">("");
  const [search, setSearch] = useState("");
  // Từ khoá đã "chốt" sau khi ngừng gõ — tách khỏi `search` để mỗi phím bấm
  // không bắn một request lên máy chủ.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  // Id các đơn đang tích chọn. Dùng Set để tích/bỏ tích không phải quét mảng.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const statusFilter = TABS.find((t) => t.key === tab)?.status ?? "";

  // Chờ 350ms sau phím cuối mới gọi API
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Toàn bộ tham số lọc gom một chỗ — vừa là queryFn vừa sinh queryKey: mỗi tổ
  // hợp tab/bộ lọc/trang là một ô cache riêng, quay lại là hiện ngay bảng cũ.
  const queryParams = {
    page,
    pageSize,
    shippingStatus: statusFilter || undefined,
    channel: channelFilter,
    carrier: carrierFilter || undefined,
    search: debouncedSearch || undefined,
    // Chỉ gửi bộ lọc in khi đang ở tab Đã xử lý — các tab khác không có
    // khái niệm "chưa in / đã in"
    printed: tab === "processed" && printedFilter ? printedFilter : undefined,
    orderType: orderTypeFilter || undefined,
    returnStatus:
      tab === "cancelled" && returnFilter ? returnFilter : undefined,
  };
  const ordersQ = useApiQuery({
    queryKey: qk.orders({
      ...queryParams,
      channel: channelFilterToQuery(channelFilter),
    }),
    queryFn: () => fetchOrders(queryParams),
  });
  const invalidate = useInvalidate();

  const items = ordersQ.data?.items ?? [];
  const counts = ordersQ.data?.counts ?? {};
  const total = ordersQ.data?.total ?? 0;
  const pageCount = ordersQ.data?.pageCount ?? 0;
  const loading = ordersQ.refreshing;
  // Sau thao tác ghi (bulk confirm/handover, đổi trạng thái) làm tươi MỌI biến
  // thể bộ lọc của trang đơn — badge đếm trên các tab khác cũng đổi theo.
  const load = () => invalidate(["orders"]);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // 401 hook tự xử; 409 (chưa có kênh) overlay của AppShell lo; lỗi còn lại
  // báo toast như trước.
  useEffect(() => {
    if (ordersQ.error) toast.error("Không tải được danh sách đơn hàng");
  }, [ordersQ.error]);

  // Chỉ coi là "đang chọn" những đơn CÒN NHÌN THẤY trên bảng. Nhờ vậy đổi tab
  // hay đổi bộ lọc là các lựa chọn cũ tự rơi ra, không thể lỡ tay bấm "xác nhận
  // hàng loạt" lên đơn không còn hiện — mà không cần effect xoá thủ công.
  const selectedOrders = items.filter((o) => selectedIds.has(o.id));

  // ===== ĐỊNH NGHĨA CỘT cho DataTable (Tầng 2) =====
  // `size` chỉ có tác dụng khi cột được GHIM (ép bề rộng để offset sticky
  // khớp); bình thường bảng vẫn tự co giãn. `meta.label` là tên trong menu Cột.
  const orderColumns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        id: "orderCode",
        size: 250,
        meta: { label: "Mã đơn" },
        header: "Mã đơn",
        cell: ({ row }) => {
          const o = row.original;
          const shop = shopOnlyName(o.channel.channelName, o.channel.shopName);
          return (
            <>
              <div className="flex items-center gap-2">
                <MetaBadge
                  meta={CHANNEL_META[o.channel.channelName]}
                  fallback={o.channel.channelName}
                />
                <span className="font-semibold tracking-tight">
                  {o.orderCode}
                </span>
              </div>
              <p className={cn(TEXT_SUB, "mt-1")}>
                {formatDateTime(o.createdAt)}
                {shop && <> · {shop}</>}
              </p>
            </>
          );
        },
      },
      {
        id: "customer",
        size: 170,
        meta: { label: "Khách hàng" },
        header: "Khách hàng",
        cell: ({ row }) => (
          <>
            <p>{row.original.customerName}</p>
            <p className={cn(TEXT_SUB, "font-mono")}>
              {row.original.customerPhone ?? "—"}
            </p>
          </>
        ),
      },
      {
        id: "products",
        size: 300,
        meta: {
          label: "Sản phẩm",
          cellClassName: "w-72 max-w-72 whitespace-normal",
        },
        header: "Sản phẩm",
        cell: ({ row }) => <OrderProductsCell lines={row.original.items ?? []} />,
      },
      {
        id: "shipping",
        size: 170,
        meta: { label: "Vận chuyển" },
        header: "Vận chuyển",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <>
              {/* HỎA TỐC đỏ rực — cùng dấu hiệu với app mobile (chốt 13/08) */}
              {isExpressShipping(o.shippingCarrierName) ? (
                <>
                  <span className="mb-0.5 inline-flex items-center rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">
                    ⚡ Hỏa tốc
                  </span>
                  <p className="font-semibold text-red-600">
                    {o.shippingCarrierName ?? "Hỏa tốc"}
                  </p>
                </>
              ) : (
                <p>{carrierShort(o.carrier)}</p>
              )}
              <p className={cn(TEXT_SUB, "font-mono")}>
                {o.trackingCode ?? "—"}
              </p>
            </>
          );
        },
      },
      {
        id: "total",
        size: 140,
        meta: { label: "Tổng tiền", align: "right" },
        header: "Tổng tiền",
        cell: ({ row }) => (
          <>
            <Money
              value={row.original.totalAmount}
              className="text-slate-900"
            />
            <span className={cn(TEXT_SUB, "block")}>
              {PAYMENT_META[row.original.paymentStatus]?.label ??
                row.original.paymentStatus}
            </span>
          </>
        ),
      },
      {
        id: "status",
        size: 180,
        meta: { label: "Trạng thái", align: "center" },
        header: "Trạng thái",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <>
              <MetaBadge
                meta={STATUS_META[o.shippingStatus]}
                fallback={o.shippingStatus}
              />
              {/* Nhãn đã in phiếu — nhìn là biết đơn nào người khác đang gói */}
              {o.labelPrintedAt && (
                <span
                  className={cn(
                    TEXT_SUB,
                    "mt-1 flex items-center justify-center gap-1 text-emerald-700"
                  )}
                  title={`Đã in phiếu lúc ${formatDateTime(o.labelPrintedAt)}`}
                >
                  <Printer className="size-3 shrink-0" />
                  Đã in phiếu
                </span>
              )}
              {/* Đơn đã sắp xếp vận chuyển mà chưa in — kho nhìn là biết còn
                  việc, khỏi phải mở bộ lọc con (anh Trung 04/09) */}
              {!o.labelPrintedAt && o.shippingStatus === "PROCESSED" && (
                <span
                  className={cn(
                    TEXT_SUB,
                    "mt-1 flex items-center justify-center gap-1 text-amber-600"
                  )}
                  title="Đã chuẩn bị hàng nhưng chưa in vận đơn"
                >
                  <Printer className="size-3 shrink-0" />
                  Chưa in phiếu
                </span>
              )}
              {/* Tình trạng hàng hoàn — chỉ hiện khi đơn có hoàn */}
              {o.returnStatus !== "NONE" && RETURN_META[o.returnStatus] && (
                <span
                  className={cn(
                    "mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    RETURN_META[o.returnStatus].className
                  )}
                  title={o.returnNote ?? undefined}
                >
                  {RETURN_META[o.returnStatus].label}
                </span>
              )}
            </>
          );
        },
      },
      {
        id: "actions",
        size: 130,
        meta: { label: "Thao tác", align: "center" },
        header: "Thao tác",
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            disabled={row.original.shippingStatus === "CANCELLED"}
            onClick={() => setEditing(row.original)}
          >
            <Pencil className="size-3.5" />
            Cập nhật
          </Button>
        ),
      },
    ],
    []
  );

  // Chế độ xem của bảng đóng gói CẢ bộ lọc trang — áp view là quay lại đúng
  // cảnh làm việc (tab + kênh + ĐVVC + loại đơn + từ khóa + cỡ trang).
  const viewExtras = {
    get: () => ({
      tab,
      printedFilter,
      returnFilter,
      channelFilter,
      carrierFilter,
      orderTypeFilter,
      search,
      pageSize,
    }),
    apply: (ex: Record<string, unknown>) => {
      if (typeof ex.tab === "string") setTab(ex.tab);
      if (typeof ex.printedFilter === "string")
        setPrintedFilter(ex.printedFilter as "" | "no" | "yes");
      if (typeof ex.returnFilter === "string")
        setReturnFilter(ex.returnFilter as ReturnStatus | "");
      if (ex.channelFilter && typeof ex.channelFilter === "object")
        setChannelFilter(ex.channelFilter as ChannelFilterValue);
      if (typeof ex.carrierFilter === "string")
        setCarrierFilter(ex.carrierFilter);
      if (typeof ex.orderTypeFilter === "string")
        setOrderTypeFilter(ex.orderTypeFilter as "" | "single" | "multi");
      if (typeof ex.search === "string") setSearch(ex.search);
      if (typeof ex.pageSize === "number") setPageSize(ex.pageSize);
      setPage(1);
    },
  };

  function resetFilters() {
    setTab("all");
    setPrintedFilter("");
    setReturnFilter("");
    setChannelFilter(ALL_CHANNELS);
    setCarrierFilter("");
    setOrderTypeFilter("");
    setSearch("");
    setPage(1);
  }

  const isFiltering =
    Boolean(channelFilter.channelName) ||
    Boolean(carrierFilter) ||
    Boolean(orderTypeFilter) ||
    Boolean(search.trim());

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportAllOrders({
        shippingStatus: statusFilter || undefined,
        channel: channelFilter,
      });
      if (count === 0) {
        toast.info("Không có đơn hàng nào (theo bộ lọc) để xuất");
      } else {
        toast.success(`Đã xuất ${count} đơn hàng ra file Excel`);
      }
    } catch {
      toast.error("Không xuất được file Excel");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      {/* Chừa chỗ dưới đáy để thanh xử lý hàng loạt không che mất dòng cuối bảng */}
      <div className="space-y-5 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Gom đơn từ tất cả các sàn về một chỗ để lọc, duyệt và in phiếu hàng
            loạt.
          </p>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Xuất Excel Đơn Hàng
          </Button>
        </div>

        {/* ===== TAB THEO VÒNG ĐỜI ĐƠN ===== */}
        <div
          role="tablist"
          aria-label="Lọc theo trạng thái đơn hàng"
          className="flex flex-wrap gap-1 border-b"
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            const count = counts[t.countKey];
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(t.key);
                  setPrintedFilter("");
    setReturnFilter(""); // rời tab Đã xử lý thì bỏ lọc con
                  setReturnFilter("");
                  setPage(1);
                }}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {t.label}
                {count !== undefined && count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {formatNumber(count)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ===== BỘ LỌC CON — chỉ có nghĩa trong tab "Đã xử lý" =====
            Đây là chốt chặn in trùng: nhân viên lọc "Chưa in" để gom in một
            lượt, đơn nào đã in tự rơi sang nhóm kia nên người sau không in lại. */}
        {tab === "processed" && (
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: "", label: "Tất cả đã xử lý", countKey: null },
                { key: "no", label: "Chưa in phiếu", countKey: "PROCESSED_NOT_PRINTED" },
                { key: "yes", label: "Đã in phiếu", countKey: "PROCESSED_PRINTED" },
              ] as const
            ).map((f) => {
              const active = printedFilter === f.key;
              const count = f.countKey ? counts[f.countKey] : counts.PROCESSED;
              return (
                <button
                  key={f.key || "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setPrintedFilter(f.key);
                    setPage(1);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {f.label}
                  {count !== undefined && (
                    <span className="tabular-nums opacity-70">{formatNumber(count)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ===== TAB HỦY / HOÀN: quét mã nhận hàng hoàn về kho ===== */}
        {tab === "cancelled" && (
          <Card className="shadow-sm">
            <CardContent className="space-y-4 py-1">
              {/* Hành động vật lý (quét mã, nhận hàng, cộng kho) đã dồn hết về
                  phân hệ Kho để nhân viên chỉ thao tác một nơi. Ở đây chỉ theo
                  dõi luồng đi của đơn. */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p>Cần nhận hàng hoàn về kho?</p>
                  <p className={cn(TEXT_SUB, "mt-0.5")}>
                    Việc quét mã và cộng lại tồn kho nằm ở trang Đối soát đơn
                    hoàn thuộc phân hệ Quản lý Kho.
                  </p>
                </div>
                <Link
                  href="/warehouse/returns"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <ScanLine className="size-4" />
                  Mở trang Đối soát đơn hoàn
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                {(
                  [
                    { key: "", label: "Tất cả đơn hủy/hoàn" },
                    { key: "AWAITING", label: "Chờ nhận hàng hoàn" },
                    { key: "RECEIVED", label: "Đã nhận · chờ nhập kho" },
                    { key: "RECEIVED_INTACT", label: "Đã nhập kho" },
                    { key: "DAMAGED", label: "Chờ khiếu nại sàn" },
                  ] as const
                ).map((f) => {
                  const active = returnFilter === f.key;
                  return (
                    <button
                      key={f.key || "all"}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setReturnFilter(f.key as ReturnStatus | "");
                        setPage(1);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== TÌM KIẾM + BỘ LỌC (khối riêng, tách lớp với bảng) ===== */}
        <Card className="shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-3 py-1">
          <div className="relative min-w-72 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 pr-9"
              placeholder="Tìm mã đơn, tên khách, số điện thoại hoặc mã vận đơn…"
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

          <ChannelFilter
            value={channelFilter}
            onChange={(v) => {
              setPage(1);
              setChannelFilter(v);
            }}
          />

          <NativeSelect
            className="w-52"
            aria-label="Lọc theo đơn vị vận chuyển"
            value={carrierFilter}
            onChange={(e) => {
              setPage(1);
              setCarrierFilter(e.target.value);
            }}
          >
            <option value="">Tất cả đơn vị vận chuyển</option>
            {CARRIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>

          <NativeSelect
            className="w-48"
            aria-label="Lọc theo loại đơn hàng"
            value={orderTypeFilter}
            onChange={(e) => {
              setPage(1);
              setOrderTypeFilter(e.target.value as "" | "single" | "multi");
            }}
          >
            <option value="">Mọi loại đơn</option>
            <option value="single">Đơn 1 sản phẩm</option>
            <option value="multi">Đơn nhiều sản phẩm</option>
          </NativeSelect>

          {isFiltering && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="size-4" />
              Xoá bộ lọc
            </Button>
          )}

            <p className="text-sm text-muted-foreground">
              {formatNumber(total)} đơn
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-0">
            {/* Lần đầu mới hiện chữ "đang tải"; đổi tab/lọc thì giữ bảng và làm mờ */}
            {loading && items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải dữ liệu…
              </p>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <PackageOpen className="mx-auto mb-2 size-8" />
                {isFiltering
                  ? "Không có đơn hàng nào khớp bộ lọc."
                  : "Chưa có đơn hàng nào ở trạng thái này."}
              </div>
            ) : (
              <Refreshing active={loading}>
                {/* Bảng chuẩn ERP (Tầng 2): menu Cột (ẩn/hiện + ghim trái),
                    Chế độ xem lưu cột + bộ lọc, checkbox chọn dòng tích hợp */}
                <DataTable
                  tableId="orders"
                  columns={orderColumns}
                  data={items}
                  getRowId={(o) => o.id}
                  selection={{ selectedIds, onChange: setSelectedIds }}
                  viewExtras={viewExtras}
                  toolbar={`${formatNumber(total)} đơn khớp bộ lọc`}
                />
              </Refreshing>
            )}
          </CardContent>
        </Card>

        {/* Phân trang — luôn hiện để chủ shop đổi được số đơn/trang kể cả khi
            đang chỉ có một trang dữ liệu */}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hiển thị</span>
              <NativeSelect
                className="w-20"
                aria-label="Số đơn mỗi trang"
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1); // đổi cỡ trang thì về trang 1, tránh rơi vào trang trống
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm text-muted-foreground">
                đơn/trang · trang {page}/{Math.max(1, pageCount)}
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
          Hubsell · Trung tâm Xử lý Đơn hàng Tập trung
        </p>
      </div>

      <BulkActionBar
        selected={selectedOrders}
        onClear={() => setSelectedIds(new Set())}
        onDone={load}
      />

      {editing && (
        <UpdateStatusDialog
          order={editing}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onDone={load}
        />
      )}
    </AppShell>
  );
}
